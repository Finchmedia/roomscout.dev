import { ConvexError, v } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal, components } from "./_generated/api";
import { AgentMail, type OutboundId } from "@agentmail/convex";

const resetAgentMail = new AgentMail(components.agentmail);

const selection = { keepListingId: v.id("listings"), keepOwnerId: v.string() };
const tables = ["messages", "threads", "controlledReceipts", "controlledRuns", "listings", "portalUsers"] as const;
const confirmation = v.literal("RESET_TEST_PORTAL_KEEP_LANDLORD");
export function assertResetDeployment() {
  if (process.env.CONVEX_SITE_URL !== "https://sensible-ladybug-38.eu-west-1.convex.site") {
    throw new ConvexError({ code: "RESET_CONTROLLED_PORTAL_ONLY" });
  }
}

export async function assertTestResetAllowsWrite(ctx: Pick<QueryCtx, "db">, subject?: string) {
  for (const status of ["deleting_accounts", "deleting_data"] as const) {
    if (await ctx.db.query("testResets").withIndex("by_status", q => q.eq("status", status)).first()) {
      throw new ConvexError({ code: "TEST_RESET_IN_PROGRESS" });
    }
  }
  if (subject && await ctx.db.query("retiredTestIdentities").withIndex("by_auth_subject", q => q.eq("authSubject", subject)).first()) {
    throw new ConvexError({ code: "TEST_IDENTITY_RETIRED" });
  }
}

async function protect(ctx: Pick<QueryCtx, "db">, args: { keepListingId: Id<"listings">; keepOwnerId: string }) {
  assertResetDeployment();
  const listing = await ctx.db.get(args.keepListingId);
  if (!listing || listing.ownerId !== args.keepOwnerId || listing.ownerLabel !== "finchlandlord") {
    throw new ConvexError({ code: "PROTECTED_LANDLORD_MISMATCH" });
  }
}

async function snapshot(ctx: Pick<QueryCtx, "db">, args: { keepListingId: Id<"listings">; keepOwnerId: string }) {
  await protect(ctx, args);
  // Explicitly fail instead of returning a silently truncated destructive preview.
  const users = await ctx.db.query("portalUsers").take(1001);
  if (users.length > 1000) throw new ConvexError({ code: "RESET_PREVIEW_REQUIRES_PAGINATION" });
  const subjects = users.filter(u => u.authSubject !== args.keepOwnerId).map(u => ({ id: u.authSubject, email: u.emailAddress }));
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const rows = await ctx.db.query(table).take(1001);
    if (rows.length > 1000) throw new ConvexError({ code: "RESET_PREVIEW_REQUIRES_PAGINATION" });
    counts[table] = rows.filter(row => table === "listings" ? row._id !== args.keepListingId : table === "portalUsers" ? (row as { authSubject?: string }).authSubject !== args.keepOwnerId : true).length;
  }
  // Changes to rows after the preview invalidate the plan, including new messages.
  const revision = [];
  for (const table of tables) revision.push([table, await ctx.db.query(table).take(1001)]);
  const bytes = new TextEncoder().encode(JSON.stringify({ keepListingId: args.keepListingId, keepOwnerId: args.keepOwnerId, revision }));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
  return { hash, counts, subjects };
}

export const preview = internalQuery({
  args: selection,
  returns: v.object({ hash: v.string(), counts: v.record(v.string(), v.number()), subjects: v.array(v.object({ id: v.string(), email: v.string() })) }),
  handler: snapshot,
});

export const begin = internalMutation({
  args: { ...selection, key: v.string(), expectedHash: v.string(), confirmation, clerkSubjects: v.array(v.object({ id: v.string(), email: v.string() })) },
  returns: v.id("testResets"),
  handler: async (ctx, args) => {
    assertResetDeployment();
    if (!args.key.trim() || args.key.length > 100) throw new ConvexError({ code: "INVALID_RESET_KEY" });
    const existing = await ctx.db.query("testResets").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (existing) {
      if (existing.keepListingId !== args.keepListingId || existing.keepOwnerId !== args.keepOwnerId) throw new ConvexError({ code: "RESET_KEY_MISMATCH" });
      return existing._id;
    }
    await assertTestResetAllowsWrite(ctx);
    const plan = await snapshot(ctx, args);
    if (plan.hash !== args.expectedHash) throw new ConvexError({ code: "RESET_PREVIEW_CHANGED" });
    const subjects = new Map(plan.subjects.map(s => [s.id, s]));
    for (const subject of args.clerkSubjects) {
      if (!subject.id.startsWith("user_") || subject.id === args.keepOwnerId || !subject.email) throw new ConvexError({ code: "RESET_CLERK_TARGET_INVALID" });
      subjects.set(subject.id, subject);
    }
    for (const subject of subjects.values()) {
      if (!await ctx.db.query("retiredTestIdentities").withIndex("by_auth_subject", q => q.eq("authSubject", subject.id)).first()) {
        await ctx.db.insert("retiredTestIdentities", { authSubject: subject.id });
      }
    }
    const resetId = await ctx.db.insert("testResets", { key: args.key, keepListingId: args.keepListingId, keepOwnerId: args.keepOwnerId,
      status: "deleting_accounts", subjects: [...subjects.values()], deletedSubjects: [], createdAt: Date.now() });
    for (const message of await ctx.db.query("messages").take(1001)) {
      if (!message.notificationEmailId) continue;
      // Historical Resend IDs remain history and must not be interpreted as
      // AgentMail IDs or replayed during reset.
      if (message.notificationProvider !== "agentmail") continue;
      const outboundId = message.notificationEmailId as OutboundId;
      const status = await resetAgentMail.status(ctx, outboundId);
      if (status?.status === "pending") await resetAgentMail.cancel(ctx, outboundId);
    }
    await ctx.scheduler.runAfter(0, internal.testResetActions.resume, { resetId });
    return resetId;
  },
});

export const get = internalQuery({
  args: { resetId: v.id("testResets") },
  returns: v.union(v.null(), v.object({ keepOwnerId: v.string(), completed: v.boolean(), subjects: v.array(v.object({ id: v.string(), email: v.string() })), deletedSubjects: v.array(v.string()) })),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.resetId);
    return job ? { keepOwnerId: job.keepOwnerId, completed: job.status === "completed", subjects: job.subjects, deletedSubjects: job.deletedSubjects } : null;
  },
});

export const accountDeleted = internalMutation({
  args: { resetId: v.id("testResets"), subject: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.resetId);
    if (!job || args.subject === job.keepOwnerId || !job.subjects.some(s => s.id === args.subject)) throw new ConvexError({ code: "RESET_SUBJECT_MISMATCH" });
    if (!job.deletedSubjects.includes(args.subject)) await ctx.db.patch(job._id, { deletedSubjects: [...job.deletedSubjects, args.subject] });
    return null;
  },
});

export const deletePage = internalMutation({
  args: { resetId: v.id("testResets"), table: v.union(...tables.map(t => v.literal(t))), cursor: v.union(v.string(), v.null()) },
  returns: v.object({ isDone: v.boolean(), continueCursor: v.string(), deleted: v.number() }),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.resetId);
    if (!job || job.status === "completed" || job.subjects.some(s => !job.deletedSubjects.includes(s.id))) throw new ConvexError({ code: "RESET_ACCOUNTS_NOT_FINISHED" });
    await protect(ctx, job);
    await ctx.db.patch(job._id, { status: "deleting_data" });
    const page = await ctx.db.query(args.table).paginate({ cursor: args.cursor, numItems: 100 });
    let deleted = 0;
    for (const row of page.page) {
      if (args.table === "listings" && row._id === job.keepListingId) continue;
      if (args.table === "portalUsers" && (row as { authSubject?: string }).authSubject === job.keepOwnerId) continue;
      await ctx.db.delete(row._id); deleted++;
    }
    return { isDone: page.isDone, continueCursor: page.continueCursor, deleted };
  },
});

export const complete = internalMutation({
  args: { resetId: v.id("testResets") }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.resetId);
    if (!job) throw new ConvexError({ code: "RESET_NOT_FOUND" });
    const plan = await snapshot(ctx, job);
    if (Object.values(plan.counts).some(n => n !== 0) || job.subjects.some(s => !job.deletedSubjects.includes(s.id))) throw new ConvexError({ code: "RESET_NOT_EMPTY" });
    await ctx.db.patch(job._id, { status: "completed" });
    return null;
  },
});
