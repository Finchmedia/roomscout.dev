/// <reference types="vite/client" />
import agentTest from "@convex-dev/agent/test";
import workpoolTest from "@convex-dev/workpool/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { normalizeResetEmailAddresses } from "./participantReset";
import schema from "./schema";
import { simulatedProviderAgent } from "./simulatedProviderModel";

const modules = import.meta.glob("./**/*.ts");
const RESET_SECRET = "test-reset-secret";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_SITE_URL", "https://sensible-ladybug-38.eu-west-1.convex.site");
  vi.stubEnv("SIMULATED_PROVIDER_ENGINE_ENABLED", "true");
  vi.stubEnv("AGENTMAIL_API_KEY", "");
  vi.stubEnv("PORTAL_RESET_SECRET", RESET_SECRET);
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

function testConvex() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  workpoolTest.register(t, "simulatedProviderWorkpool");
  return t;
}

/** Two participants share the bound listing; A also has a second, unbound thread.
 * A's rows are shaped to exercise every stage: a processing job, a completed job,
 * a non-default runtime state, and more messages than one page deletes. */
async function fixture() {
  const t = testConvex();
  const ids = await t.run(async (ctx) => {
    const now = Date.now();
    const listing = {
      ownerLabel: "Mara at Kanalwerk", side: "supply" as const, city: "Berlin", district: "Kreuzberg",
      description: "Fictional room", priceEur: 350, pricePeriod: "month" as const, status: "published" as const,
      createdAt: now, updatedAt: now,
    };
    const boundListingId = await ctx.db.insert("listings", { ...listing, ownerId: "simulated-provider:BER-01", title: "Kanalwerk A" });
    const plainListingId = await ctx.db.insert("listings", { ...listing, ownerId: "user_landlord", ownerLabel: "finchlandlord", title: "Stuttgart room" });
    const bindingId = await ctx.db.insert("simulatedProviderListings", {
      listingId: boundListingId, seedKey: "berlin-demo-v1:BER-01", scenarioId: "BER-01", scenarioVersion: 1,
      enabled: true, createdAt: now, updatedAt: now,
    });
    for (const [authSubject, emailAddress] of [["juror-a", "juror-a@example.com"], ["juror-b", "juror-b@example.com"], ["user_landlord", "landlord@example.com"]]) {
      await ctx.db.insert("portalUsers", { authSubject: authSubject!, emailAddress: emailAddress!, createdAt: now, updatedAt: now });
    }

    async function thread(listingId: Id<"listings">, ownerId: string, participantId: string, messageCount: number) {
      const threadId = await ctx.db.insert("threads", {
        listingId, ownerId, participantId, participantLabel: `Band ${participantId}`, subject: "Re: room", lastMessageAt: now, createdAt: now,
      });
      const messageIds: Id<"messages">[] = [];
      for (let index = 0; index < messageCount; index++) {
        messageIds.push(await ctx.db.insert("messages", {
          threadId, senderId: index % 2 === 0 ? participantId : ownerId, senderLabel: index % 2 === 0 ? "Band" : "Provider",
          body: `Message ${index}`, notificationStatus: "skipped_unconfigured", createdAt: now + index,
        }));
      }
      return { threadId, messageIds };
    }
    async function runtime(threadId: Id<"threads">, listingId: Id<"listings">, participantId: string, stateKey: string, replyCount: number) {
      const { threadId: agentThreadId } = await simulatedProviderAgent.createThread(ctx, { userId: participantId, title: "Provider" });
      const runtimeId = await ctx.db.insert("simulatedProviderThreads", {
        threadId, listingId, participantId, scenarioId: "BER-01", scenarioVersion: 1, agentThreadId, locale: "en",
        stateKey, replyCount, createdAt: now, updatedAt: now,
      });
      await simulatedProviderAgent.saveMessage(ctx, { threadId: agentThreadId, userId: participantId, prompt: "Hello", skipEmbeddings: true });
      return { runtimeId, agentThreadId };
    }

    const a1 = await thread(boundListingId, "simulated-provider:BER-01", "juror-a", 120);
    const a1Runtime = await runtime(a1.threadId, boundListingId, "juror-a", "viewing_agreed", 3);
    const aProcessingJobId = await ctx.db.insert("simulatedProviderJobs", {
      threadId: a1.threadId, inputMessageId: a1.messageIds[0]!, locale: "en", status: "processing", attemptCount: 1, manualRetryCount: 0,
      claimToken: "worker-1", leaseExpiresAt: now + 1_000, createdAt: now, updatedAt: now,
    });
    const aCompletedJobId = await ctx.db.insert("simulatedProviderJobs", {
      threadId: a1.threadId, inputMessageId: a1.messageIds[2]!, locale: "en", status: "completed", attemptCount: 1, manualRetryCount: 0,
      responseMessageId: a1.messageIds[3], createdAt: now + 1, updatedAt: now + 1, completedAt: now + 1,
    });
    await ctx.db.patch(a1Runtime.runtimeId, { activeJobId: aProcessingJobId });
    const a2 = await thread(plainListingId, "user_landlord", "juror-a", 3);

    const b1 = await thread(boundListingId, "simulated-provider:BER-01", "juror-b", 2);
    const b1Runtime = await runtime(b1.threadId, boundListingId, "juror-b", "default", 1);
    const bQueuedJobId = await ctx.db.insert("simulatedProviderJobs", {
      threadId: b1.threadId, inputMessageId: b1.messageIds[0]!, locale: "en", status: "queued", attemptCount: 0, manualRetryCount: 0,
      createdAt: now, updatedAt: now,
    });

    // Operator proof records reference A's thread but are audit history: kept.
    const runId = await ctx.db.insert("controlledRuns", {
      runKey: "proof-participant-reset", scenario: "happy_path", listingId: plainListingId, expectedInbox: "juror-a@agentmail.to",
      expiresAt: now + 60_000, replyCount: 1,
    });
    const receiptId = await ctx.db.insert("controlledReceipts", {
      runId, requestKey: "r1", threadId: a2.threadId, messageId: a2.messageIds[1]!, body: "Message 1",
    });

    return {
      boundListingId, plainListingId, bindingId, runId, receiptId,
      a1ThreadId: a1.threadId, a2ThreadId: a2.threadId, aAgentThreadId: a1Runtime.agentThreadId, aRuntimeId: a1Runtime.runtimeId,
      aProcessingJobId, aCompletedJobId,
      b1ThreadId: b1.threadId, bAgentThreadId: b1Runtime.agentThreadId, bRuntimeId: b1Runtime.runtimeId, bQueuedJobId,
      bMessageIds: b1.messageIds,
    };
  });
  return { t, ids, participantA: t.withIdentity({ subject: "juror-a", email: "juror-a@example.com", emailVerified: true }) };
}

async function pendingPagerCount(t: ReturnType<typeof testConvex>, resetId: Id<"participantResets">) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    return jobs.filter((job) =>
      job.name.includes("participantReset") && job.state.kind === "pending" &&
      (job.args[0] as { resetId?: string } | undefined)?.resetId === resetId,
    ).length;
  });
}

async function drain(t: ReturnType<typeof testConvex>) {
  await t.finishAllScheduledFunctions(() => vi.runAllTimers());
}

describe("participant reset", () => {
  it("deletes only the participant's conversations, children first, across pages", async () => {
    const { t, ids } = await fixture();
    const resetId = await t.mutation(internal.participantReset.start, { participantId: "juror-a" });
    expect(await t.run((ctx) => ctx.db.get(resetId))).toMatchObject({
      participantId: "juror-a", status: "scheduled", stage: "pending", deletedDocumentCount: 0,
    });

    // The first page marks the in-flight job with a terminal failure before anything else goes.
    await t.mutation(internal.participantReset.runPage, { resetId });
    expect(await t.run((ctx) => ctx.db.get(ids.aProcessingJobId))).toMatchObject({ status: "failed", errorCode: "PARTICIPANT_RESET" });
    expect((await t.run((ctx) => ctx.db.get(ids.aProcessingJobId)))?.claimToken).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(ids.aCompletedJobId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(ids.a1ThreadId))).not.toBeNull();
    // The retained job holds thread A1 back; the same page moves on and finishes the small thread A2.
    expect(await t.run((ctx) => ctx.db.get(ids.a2ThreadId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(resetId))).toMatchObject({ status: "running", stage: "threads", deletedDocumentCount: 5 });

    await drain(t);

    const reset = await t.run((ctx) => ctx.db.get(resetId));
    // A: 2 threads + 123 messages + 1 runtime + 2 jobs.
    expect(reset).toMatchObject({ status: "completed", stage: "done", deletedDocumentCount: 128 });
    expect(reset?.completedAt).toBeTypeOf("number");
    await t.run(async (ctx) => {
      expect(await ctx.db.get(ids.a1ThreadId)).toBeNull();
      expect(await ctx.db.get(ids.a2ThreadId)).toBeNull();
      expect(await ctx.db.get(ids.aRuntimeId)).toBeNull();
      expect(await ctx.db.get(ids.aProcessingJobId)).toBeNull();
      expect(await ctx.db.query("threads").withIndex("by_participant_and_last_message_at", (q) => q.eq("participantId", "juror-a")).collect()).toEqual([]);
      expect(await ctx.db.query("messages").withIndex("by_thread_and_created_at", (q) => q.eq("threadId", ids.a1ThreadId)).collect()).toEqual([]);
      expect(await ctx.db.query("messages").withIndex("by_thread_and_created_at", (q) => q.eq("threadId", ids.a2ThreadId)).collect()).toEqual([]);
      expect(await ctx.db.query("simulatedProviderJobs").withIndex("by_thread_id_and_created_at", (q) => q.eq("threadId", ids.a1ThreadId)).collect()).toEqual([]);
      expect(await ctx.runQuery(components.agent.threads.getThread, { threadId: ids.aAgentThreadId })).toBeNull();

      expect(await ctx.db.get(ids.b1ThreadId)).not.toBeNull();
      expect(await ctx.db.get(ids.bRuntimeId)).toMatchObject({ participantId: "juror-b", stateKey: "default", replyCount: 1 });
      expect(await ctx.db.get(ids.bQueuedJobId)).toMatchObject({ status: "queued" });
      expect((await ctx.db.query("messages").withIndex("by_thread_and_created_at", (q) => q.eq("threadId", ids.b1ThreadId)).collect()).map((m) => m._id)).toEqual(ids.bMessageIds);
      expect(await ctx.runQuery(components.agent.threads.getThread, { threadId: ids.bAgentThreadId })).toMatchObject({ userId: "juror-b" });

      expect(await ctx.db.get(ids.boundListingId)).not.toBeNull();
      expect(await ctx.db.get(ids.plainListingId)).not.toBeNull();
      expect(await ctx.db.get(ids.bindingId)).toMatchObject({ enabled: true, scenarioId: "BER-01" });
      expect(await ctx.db.get(ids.runId)).not.toBeNull();
      expect(await ctx.db.get(ids.receiptId)).not.toBeNull();
      expect((await ctx.db.query("portalUsers").collect()).map((user) => user.authSubject).sort()).toEqual(["juror-a", "juror-b", "user_landlord"]);
    });
  });

  it("returns the active reset instead of starting another, and reschedules a stale one", async () => {
    const { t } = await fixture();
    const resetId = await t.mutation(internal.participantReset.start, { participantId: "juror-a" });
    expect(await t.mutation(internal.participantReset.start, { participantId: "juror-a" })).toBe(resetId);
    expect(await pendingPagerCount(t, resetId)).toBe(1);

    await t.run((ctx) => ctx.db.patch(resetId, { updatedAt: Date.now() - 31_000 }));
    expect(await t.mutation(internal.participantReset.start, { participantId: "juror-a" })).toBe(resetId);
    expect(await pendingPagerCount(t, resetId)).toBe(2);
    expect((await t.run((ctx) => ctx.db.get(resetId)))?.updatedAt).toBe(Date.now());

    await drain(t);
    expect(await t.run((ctx) => ctx.db.get(resetId))).toMatchObject({ status: "completed" });
    const nextResetId = await t.mutation(internal.participantReset.start, { participantId: "juror-a" });
    expect(nextResetId).not.toBe(resetId);
    await drain(t);
    expect(await t.run((ctx) => ctx.db.get(nextResetId))).toMatchObject({ status: "completed", deletedDocumentCount: 0 });
  });

  it("lets the participant start over at the scenario's default state", async () => {
    const { t, ids, participantA } = await fixture();
    await t.mutation(internal.participantReset.start, { participantId: "juror-a" });
    await drain(t);

    const started = await participantA.mutation(api.messages.start, {
      listingId: ids.boundListingId, participantLabel: "Band A", body: "Is Wednesday available?",
    });
    expect(started.threadId).not.toBe(ids.a1ThreadId);
    const runtime = await t.run((ctx) => ctx.db.query("simulatedProviderThreads").withIndex("by_thread_id", (q) => q.eq("threadId", started.threadId)).unique());
    expect(runtime).toMatchObject({ participantId: "juror-a", stateKey: "default", replyCount: 0, locale: "en" });
    expect(runtime?.agentThreadId).not.toBe(ids.aAgentThreadId);
    expect(await t.run((ctx) => ctx.runQuery(components.agent.threads.getThread, { threadId: runtime!.agentThreadId }))).toMatchObject({ userId: "juror-a" });
    const jobs = await t.run((ctx) => ctx.db.query("simulatedProviderJobs").withIndex("by_thread_id_and_created_at", (q) => q.eq("threadId", started.threadId)).collect());
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ inputMessageId: started.messageId, status: "queued" });
  });

  it("tolerates a finished worker whose thread was reset meanwhile", async () => {
    const { t, ids } = await fixture();
    await t.mutation(internal.participantReset.start, { participantId: "juror-a" });
    await drain(t);
    await expect(t.mutation(internal.simulatedProviders.completeJob, {
      jobId: ids.aProcessingJobId, claimToken: "worker-1", message: "Late reply", proposedTransition: null, locale: "en",
    })).resolves.toBeNull();
    await expect(t.mutation(internal.simulatedProviders.claimJob, { jobId: ids.aProcessingJobId, claimToken: "worker-2" })).resolves.toBeNull();
    await expect(t.mutation(internal.simulatedProviders.finalizeWork, { jobId: ids.aProcessingJobId, succeeded: false })).resolves.toBeNull();
    expect(await t.run((ctx) => ctx.db.get(ids.a1ThreadId))).toBeNull();
  });
});

describe("POST /participant-reset", () => {
  function post(t: ReturnType<typeof testConvex>, body: BodyInit | null, secret: string | null = RESET_SECRET) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (secret !== null) headers["X-RoomScout-Reset-Secret"] = secret;
    return t.fetch("/participant-reset", { method: "POST", headers, body });
  }

  it("rejects a missing or wrong secret before reading the body", async () => {
    const { t } = await fixture();
    const body = JSON.stringify({ emailAddresses: ["juror-a@example.com"] });
    expect((await post(t, body, null)).status).toBe(401);
    expect((await post(t, body, "wrong")).status).toBe(401);
    expect((await post(t, body, `${RESET_SECRET}x`)).status).toBe(401);
    expect((await post(t, body, RESET_SECRET.slice(1))).status).toBe(401);
    expect(await t.run((ctx) => ctx.db.query("participantResets").collect())).toEqual([]);
  });

  it("answers 503 while the secret is not configured", async () => {
    vi.stubEnv("PORTAL_RESET_SECRET", "");
    const { t } = await fixture();
    const response = await post(t, JSON.stringify({ emailAddresses: ["juror-a@example.com"] }), "");
    expect(response.status).toBe(503);
    expect(await t.run((ctx) => ctx.db.query("participantResets").collect())).toEqual([]);
  });

  it("rejects malformed bodies", async () => {
    const { t } = await fixture();
    for (const body of [
      "not json",
      JSON.stringify([]),
      JSON.stringify({}),
      JSON.stringify({ emailAddresses: [] }),
      JSON.stringify({ emailAddresses: "juror-a@example.com" }),
      JSON.stringify({ emailAddresses: ["juror-a@example.com", 5] }),
      JSON.stringify({ emailAddresses: ["not-an-email"] }),
      JSON.stringify({ emailAddresses: Array.from({ length: 6 }, (_, index) => `band-${index}@example.com`) }),
    ]) {
      expect((await post(t, body)).status, body).toBe(400);
    }
    expect(normalizeResetEmailAddresses({ emailAddresses: [" Juror-A@Example.com ", "juror-a@example.com"] })).toEqual(["juror-a@example.com"]);
  });

  it("answers 200 with no match and 202 with a scheduled reset per matched account", async () => {
    const { t } = await fixture();
    const miss = await post(t, JSON.stringify({ emailAddresses: ["nobody@example.com"] }));
    expect(miss.status).toBe(200);
    expect(await miss.json()).toEqual({ resetIds: [], matched: 0 });

    const hit = await post(t, JSON.stringify({ emailAddresses: ["Juror-A@Example.com", "nobody@example.com"] }));
    expect(hit.status).toBe(202);
    const payload = await hit.json() as { resetIds: string[]; matched: number };
    expect(payload.matched).toBe(1);
    expect(payload.resetIds).toHaveLength(1);
    const reset = await t.run((ctx) => ctx.db.get(payload.resetIds[0] as Id<"participantResets">));
    expect(reset).toMatchObject({ participantId: "juror-a", status: "scheduled" });
    expect((await t.run((ctx) => ctx.db.query("participantResets").collect()))).toHaveLength(1);

    // Repeating the call while the reset runs returns the same reset.
    const again = await post(t, JSON.stringify({ emailAddresses: ["juror-a@example.com"] }));
    expect(again.status).toBe(202);
    expect(await again.json()).toEqual({ resetIds: payload.resetIds, matched: 1 });

    await drain(t);
    expect(await t.run((ctx) => ctx.db.get(payload.resetIds[0] as Id<"participantResets">))).toMatchObject({ status: "completed" });
    expect(await t.run((ctx) => ctx.db.query("threads").withIndex("by_participant_and_last_message_at", (q) => q.eq("participantId", "juror-a")).collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query("threads").withIndex("by_participant_and_last_message_at", (q) => q.eq("participantId", "juror-b")).collect())).toHaveLength(1);
  });
});
