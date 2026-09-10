import { ConvexError, v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { appendThreadMessage } from "./messageStorage";
import { assertTestResetAllowsWrite } from "./testReset";

const scenarioValidator = v.union(v.literal("happy_path"), v.literal("changed_conditions"), v.literal("notification_recovery"));
const confirmation = "CONTROLLED_ROOMSCOUT_PORTAL_PROOF";

function assertPortal(value: string) {
  if (value !== confirmation || process.env.CONVEX_SITE_URL !== "https://sensible-ladybug-38.eu-west-1.convex.site") {
    throw new ConvexError({ code: "CONTROLLED_PORTAL_ONLY" });
  }
}

/** Operator tooling only, never reachable by the Scout or the public UI.
 * A run creates its OWN clearly labelled listing; existing owners are not reused. */
export const prepare = internalMutation({
  args: { confirmation: v.string(), runKey: v.string(), scenario: scenarioValidator, expectedInbox: v.string() },
  returns: v.object({ runId: v.id("controlledRuns"), listingId: v.id("listings"), reused: v.boolean() }),
  handler: async (ctx, args) => {
    assertPortal(args.confirmation);
    await assertTestResetAllowsWrite(ctx);
    if (!/^proof-[a-z0-9-]{8,64}$/.test(args.runKey)) throw new ConvexError({ code: "INVALID_PROOF_KEY" });
    const expectedInbox = args.expectedInbox.trim().toLowerCase();
    // These controlled actors use the provider's default domain. No arbitrary
    // private/customer mailbox may be targeted by the simulator.
    if (expectedInbox.length > 320 || !/^[a-z0-9._+-]+@agentmail\.to$/.test(expectedInbox)) {
      throw new ConvexError({ code: "CONTROLLED_INBOX_REQUIRED" });
    }
    const existing = await ctx.db.query("controlledRuns").withIndex("by_run_key", q => q.eq("runKey", args.runKey)).unique();
    if (existing) {
      if (existing.expectedInbox !== expectedInbox || existing.scenario !== args.scenario) throw new ConvexError({ code: "PROOF_SCOPE_MISMATCH" });
      if (existing.closedAt || existing.expiresAt <= Date.now()) throw new ConvexError({ code: "PROOF_EXPIRED" });
      return { runId: existing._id, listingId: existing.listingId, reused: true };
    }
    const now = Date.now();
    const listingId = await ctx.db.insert("listings", {
      ownerId: `controlled-owner:${args.runKey}`, ownerLabel: "RoomScout simulated provider (TEST)",
      side: "supply", title: `[DEMO — no real room] ${args.scenario.replaceAll("_", " ")}`,
      city: "Stuttgart", description: "Controlled RoomScout test listing. No actual rental is available. Shared rehearsal room; Tuesday evenings, drums and secure storage; conditions confirmed in conversation.",
      priceEur: 260, pricePeriod: "month", status: "published", createdAt: now, updatedAt: now,
    });
    const runId = await ctx.db.insert("controlledRuns", {
      runKey: args.runKey, scenario: args.scenario, listingId, expectedInbox, replyCount: 0, expiresAt: now + 2 * 60 * 60 * 1_000,
    });
    return { runId, listingId, reused: false };
  },
});

/** The simulator emulates only the provider. The musician must create its
 * thread through Clerk/the real portal UI, then read this reply in Browserbase. */
export const reply = internalMutation({
  args: { confirmation: v.string(), runId: v.id("controlledRuns"), threadId: v.id("threads"), requestKey: v.string(), body: v.string() },
  returns: v.object({ messageId: v.id("messages"), reused: v.boolean() }),
  handler: async (ctx, args) => {
    assertPortal(args.confirmation);
    if (!/^[a-z0-9-]{1,64}$/.test(args.requestKey) || !args.body.trim() || args.body.length > 5_000) throw new ConvexError({ code: "INVALID_PROOF_MESSAGE" });
    const run = await ctx.db.get(args.runId);
    if (!run || run.closedAt || run.expiresAt <= Date.now()) throw new ConvexError({ code: "PROOF_EXPIRED" });
    const [thread, listing, receipt] = await Promise.all([
      ctx.db.get(args.threadId), ctx.db.get(run.listingId),
      ctx.db.query("controlledReceipts").withIndex("by_run_and_request", q => q.eq("runId", run._id).eq("requestKey", args.requestKey)).unique(),
    ]);
    if (!thread || thread.listingId !== run.listingId || !listing || listing.ownerId !== `controlled-owner:${run.runKey}` ||
      thread.ownerId !== listing.ownerId || listing.status !== "published") throw new ConvexError({ code: "PROOF_SCOPE_MISMATCH" });
    const participant = await ctx.db.query("portalUsers").withIndex("by_auth_subject", q => q.eq("authSubject", thread.participantId)).unique();
    if (participant?.emailAddress !== run.expectedInbox) throw new ConvexError({ code: "PROOF_PARTICIPANT_MISMATCH" });
    if (receipt) {
      if (receipt.threadId !== args.threadId || receipt.body !== args.body) throw new ConvexError({ code: "PROOF_REPLAY_MISMATCH" });
      return { messageId: receipt.messageId, reused: true };
    }
    if (run.replyCount >= 8) throw new ConvexError({ code: "PROOF_ROUND_LIMIT" });
    const { messageId } = await appendThreadMessage(ctx, { threadId: thread._id, senderId: listing.ownerId, body: args.body });
    await ctx.db.insert("controlledReceipts", { runId: run._id, requestKey: args.requestKey, threadId: thread._id, messageId, body: args.body });
    await ctx.db.patch(run._id, { replyCount: run.replyCount + 1 });
    return { messageId, reused: false };
  },
});

export const close = internalMutation({
  args: { confirmation: v.string(), runId: v.id("controlledRuns") }, returns: v.null(),
  handler: async (ctx, args) => {
    assertPortal(args.confirmation);
    await assertTestResetAllowsWrite(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.closedAt) return null;
    const listing = await ctx.db.get(run.listingId);
    if (!listing || listing.ownerId !== `controlled-owner:${run.runKey}`) throw new ConvexError({ code: "PROOF_SCOPE_MISMATCH" });
    await ctx.db.patch(listing._id, { status: "closed", updatedAt: Date.now() });
    await ctx.db.patch(run._id, { closedAt: Date.now() });
    return null;
  },
});
