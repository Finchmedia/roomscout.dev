import { AgentMail, type OutboundId } from "@agentmail/convex";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { simulatedProviderAgent } from "./simulatedProviderModel";

/** Documents written per pager run. Keeps one mutation small even when a
 * thread carries hundreds of messages. */
const PAGE_BUDGET = 50;
/** A reset whose pager has not checkpointed for this long may be rescheduled
 * by the next start call (a lost scheduled function after a deploy, for example). */
const STALE_AFTER_MS = 30_000;
export const MAX_RESET_EMAIL_ADDRESSES = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const resetAgentMail = new AgentMail(components.agentmail);

type ResetStage = Doc<"participantResets">["stage"];
type Page = { remaining: number; deleted: number; stage: ResetStage };

/** Validates the HTTP body: 1–5 email addresses, returned trimmed, lowercased
 * and de-duplicated. `null` means the body is malformed. */
export function normalizeResetEmailAddresses(payload: unknown): string[] | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const raw = (payload as { emailAddresses?: unknown }).emailAddresses;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_RESET_EMAIL_ADDRESSES) return null;
  const normalized = new Set<string>();
  for (const candidate of raw) {
    if (typeof candidate !== "string") return null;
    const emailAddress = candidate.trim().toLowerCase();
    if (!emailAddress || emailAddress.length > 320 || !EMAIL_PATTERN.test(emailAddress)) return null;
    normalized.add(emailAddress);
  }
  return [...normalized];
}

async function latestActiveReset(ctx: MutationCtx, participantId: string): Promise<Doc<"participantResets"> | null> {
  // Only the newest reset of a participant can still be active; older ones completed
  // before a new one was allowed to start.
  const recent = await ctx.db.query("participantResets")
    .withIndex("by_participant_and_created_at", (q) => q.eq("participantId", participantId))
    .order("desc")
    .take(5);
  return recent.find((reset) => reset.status !== "completed") ?? null;
}

/** Records the reset and schedules its pager. An active reset is returned as is;
 * one that stopped checkpointing is rescheduled. */
export async function startParticipantReset(ctx: MutationCtx, participantId: string): Promise<Id<"participantResets">> {
  const now = Date.now();
  const active = await latestActiveReset(ctx, participantId);
  if (active) {
    if (now - active.updatedAt >= STALE_AFTER_MS) {
      await ctx.db.patch(active._id, { updatedAt: now });
      await ctx.scheduler.runAfter(0, internal.participantReset.runPage, { resetId: active._id });
    }
    return active._id;
  }
  const resetId = await ctx.db.insert("participantResets", {
    participantId,
    status: "scheduled",
    stage: "pending",
    deletedDocumentCount: 0,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.scheduler.runAfter(0, internal.participantReset.runPage, { resetId });
  return resetId;
}

export const start = internalMutation({
  args: { participantId: v.string() },
  returns: v.id("participantResets"),
  handler: async (ctx, args): Promise<Id<"participantResets">> => {
    return await startParticipantReset(ctx, args.participantId);
  },
});

/** Used by the HTTP endpoint: resolves portal accounts by their stored (lowercased)
 * email address and starts one reset per matched participant. */
export const startByEmailAddresses = internalMutation({
  args: { emailAddresses: v.array(v.string()) },
  returns: v.object({ resetIds: v.array(v.id("participantResets")), matched: v.number() }),
  handler: async (ctx, args): Promise<{ resetIds: Id<"participantResets">[]; matched: number }> => {
    const participantIds = new Set<string>();
    for (const candidate of args.emailAddresses.slice(0, MAX_RESET_EMAIL_ADDRESSES)) {
      const emailAddress = candidate.trim().toLowerCase();
      if (!emailAddress) continue;
      const users = await ctx.db.query("portalUsers")
        .withIndex("by_email_address", (q) => q.eq("emailAddress", emailAddress))
        .take(10);
      for (const user of users) participantIds.add(user.authSubject);
    }
    const resetIds: Id<"participantResets">[] = [];
    for (const participantId of participantIds) {
      resetIds.push(await startParticipantReset(ctx, participantId));
    }
    return { resetIds, matched: participantIds.size };
  },
});

/** A queued "new message" email about a conversation that is being wiped must
 * not go out. Mirrors testReset.begin; the component remains the send queue. */
async function cancelQueuedNotification(ctx: MutationCtx, message: Doc<"messages">): Promise<void> {
  if (message.notificationProvider !== "agentmail" || !message.notificationEmailId || message.notificationStatus !== "queued") return;
  const outboundId = message.notificationEmailId as OutboundId;
  const status = await resetAgentMail.status(ctx, outboundId);
  if (status?.status === "pending") await resetAgentMail.cancel(ctx, outboundId);
}

/** Deletes one thread's documents children first: jobs, runtime row (with its
 * Agent-component thread), messages, then the thread. Stops when the page budget
 * is spent; the next page re-reads the thread from scratch, so documents added
 * in between are picked up and the thread is only deleted once it has no children. */
async function resetThread(ctx: MutationCtx, thread: Doc<"threads">, page: Page): Promise<void> {
  const now = Date.now();

  const jobs = await ctx.db.query("simulatedProviderJobs")
    .withIndex("by_thread_id_and_created_at", (q) => q.eq("threadId", thread._id))
    .take(page.remaining);
  if (jobs.length > 0) {
    page.stage = "jobs";
    let retained = false;
    for (const job of jobs) {
      if (job.status === "processing") {
        // Terminal write first, as finalizeWork writes it, so an in-flight worker and
        // the Workpool completion see a failed job rather than a vanished one. The
        // row itself is deleted on the next page.
        await ctx.db.patch(job._id, {
          status: "failed", errorCode: "PARTICIPANT_RESET", claimToken: undefined, leaseExpiresAt: undefined,
          completedAt: now, updatedAt: now,
        });
        retained = true;
      } else {
        await ctx.db.delete(job._id);
        page.deleted++;
      }
      page.remaining--;
    }
    if (retained || page.remaining <= 0) return;
  }

  const runtime = await ctx.db.query("simulatedProviderThreads")
    .withIndex("by_thread_id", (q) => q.eq("threadId", thread._id))
    .unique();
  if (runtime) {
    page.stage = "runtime";
    await simulatedProviderAgent.deleteThreadAsync(ctx, { threadId: runtime.agentThreadId });
    await ctx.db.delete(runtime._id);
    page.deleted++;
    page.remaining--;
    if (page.remaining <= 0) return;
  }

  const messages = await ctx.db.query("messages")
    .withIndex("by_thread_and_created_at", (q) => q.eq("threadId", thread._id))
    .take(page.remaining);
  if (messages.length > 0) {
    page.stage = "messages";
    for (const message of messages) {
      await cancelQueuedNotification(ctx, message);
      await ctx.db.delete(message._id);
      page.deleted++;
      page.remaining--;
    }
    // A full page may have stopped short of the last message; only the next page knows.
    if (page.remaining <= 0) return;
  }

  page.stage = "threads";
  await ctx.db.delete(thread._id);
  page.deleted++;
  page.remaining--;
}

export const runPage = internalMutation({
  args: { resetId: v.id("participantResets") },
  returns: v.object({ done: v.boolean(), deleted: v.number() }),
  handler: async (ctx, args): Promise<{ done: boolean; deleted: number }> => {
    const reset = await ctx.db.get(args.resetId);
    if (!reset || reset.status === "completed") return { done: true, deleted: 0 };
    const page: Page = { remaining: PAGE_BUDGET, deleted: 0, stage: reset.stage };
    const threads = await ctx.db.query("threads")
      .withIndex("by_participant_and_last_message_at", (q) => q.eq("participantId", reset.participantId))
      .order("asc")
      .take(PAGE_BUDGET);
    for (const thread of threads) {
      if (page.remaining <= 0) break;
      await resetThread(ctx, thread, page);
    }
    const now = Date.now();
    // Done only when a page found nothing to do: a page that deleted the last
    // document cannot tell whether more arrived, so one more page confirms it.
    if (threads.length === 0) {
      await ctx.db.patch(reset._id, { status: "completed", stage: "done", updatedAt: now, completedAt: now });
      return { done: true, deleted: 0 };
    }
    await ctx.db.patch(reset._id, {
      status: "running",
      stage: page.stage,
      deletedDocumentCount: reset.deletedDocumentCount + page.deleted,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.participantReset.runPage, { resetId: reset._id });
    return { done: false, deleted: page.deleted };
  },
});
