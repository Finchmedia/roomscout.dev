import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { appendThreadMessage } from "./messageStorage";
import { detectProviderLocale } from "./providerScenarioEngine";
import { getBerlinProviderScenario } from "./providerScenarios/berlin";
import { initialScenarioState } from "./providerScenarios/types";
import { simulatedProviderAgent } from "./simulatedProviderModel";
import { simulatedProviderWorkpool } from "./simulatedProviderWorkpool";

const PORTAL_SITE = "https://sensible-ladybug-38.eu-west-1.convex.site";
const CONFIGURATION_CONFIRMATION = "CONFIGURE_ROOMSCOUT_SIMULATED_PROVIDERS";
const MAX_REPLIES_PER_THREAD = 12;
const MAX_MANUAL_RETRIES = 1;
// Longer than an ordinary mutation, shorter than the Workpool action timeout.
// A retried action may reclaim the job after the previous worker disappeared;
// its new token prevents a late result from the old worker being committed.
const CLAIM_LEASE_MS = 1_500;

const jobStatusValidator = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("completed"),
  v.literal("failed"),
);

function engineEnabled(): boolean {
  return process.env.SIMULATED_PROVIDER_ENGINE_ENABLED === "true";
}

function assertPortalConfiguration(confirmation: string) {
  if (confirmation !== CONFIGURATION_CONFIRMATION || process.env.CONVEX_SITE_URL !== PORTAL_SITE) {
    throw new ConvexError({ code: "SIMULATED_PROVIDER_PORTAL_ONLY" });
  }
}

async function startNextForThread(ctx: MutationCtx, runtimeId: Id<"simulatedProviderThreads">) {
  const runtime = await ctx.db.get(runtimeId);
  if (!runtime || runtime.activeJobId) return;
  // A participant reset deletes the thread; nothing is left to reply to.
  if (!(await ctx.db.get(runtime.threadId))) return;
  const next = await ctx.db.query("simulatedProviderJobs")
    .withIndex("by_thread_id_and_status_and_created_at", (q) =>
      q.eq("threadId", runtime.threadId).eq("status", "queued"),
    )
    .order("asc")
    .first();
  if (!next) return;
  await ctx.db.patch(runtime._id, { activeJobId: next._id, updatedAt: Date.now() });
  const workId = await simulatedProviderWorkpool.enqueueAction(
    ctx,
    internal.simulatedProviderActions.processJob,
    { jobId: next._id },
    {
      onComplete: internal.simulatedProviderActions.jobCompleted,
      context: { jobId: next._id },
    },
  );
  await ctx.db.patch(next._id, { workId: String(workId), updatedAt: Date.now() });
}

/** Called only after appendThreadMessage has persisted an authenticated message. */
export async function enqueueSimulatedProviderReply(ctx: MutationCtx, args: {
  thread: Doc<"threads">;
  listing: Doc<"listings">;
  messageId: Id<"messages">;
  senderId: string;
  body: string;
}): Promise<Id<"simulatedProviderJobs"> | null> {
  if (!engineEnabled() || args.senderId !== args.thread.participantId || args.listing.ownerId !== args.thread.ownerId) return null;
  const binding = await ctx.db.query("simulatedProviderListings")
    .withIndex("by_listing_id", (q) => q.eq("listingId", args.listing._id))
    .unique();
  if (!binding?.enabled) return null;

  const existingJob = await ctx.db.query("simulatedProviderJobs")
    .withIndex("by_input_message_id", (q) => q.eq("inputMessageId", args.messageId))
    .unique();
  if (existingJob) return existingJob._id;

  let runtime = await ctx.db.query("simulatedProviderThreads")
    .withIndex("by_thread_id", (q) => q.eq("threadId", args.thread._id))
    .unique();
  const now = Date.now();
  if (!runtime) {
    const scenario = getBerlinProviderScenario(binding.scenarioId);
    if (!scenario || scenario.version !== binding.scenarioVersion) return null;
    const { threadId: agentThreadId } = await simulatedProviderAgent.createThread(ctx, {
      userId: args.thread.participantId,
      title: `Provider · ${scenario.publicListing.title}`.slice(0, 200),
    });
    const runtimeId = await ctx.db.insert("simulatedProviderThreads", {
      threadId: args.thread._id,
      listingId: args.listing._id,
      participantId: args.thread.participantId,
      scenarioId: binding.scenarioId,
      scenarioVersion: binding.scenarioVersion,
      agentThreadId,
      locale: detectProviderLocale(args.body),
      stateKey: initialScenarioState(scenario),
      replyCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    runtime = (await ctx.db.get(runtimeId))!;
  } else {
    if (runtime.listingId !== args.listing._id || runtime.participantId !== args.thread.participantId) {
      throw new ConvexError({ code: "SIMULATED_PROVIDER_THREAD_SCOPE_MISMATCH" });
    }
    const locale = detectProviderLocale(args.body, runtime.locale);
    if (locale !== runtime.locale) {
      await ctx.db.patch(runtime._id, { locale, updatedAt: now });
      runtime = { ...runtime, locale, updatedAt: now };
    }
  }

  const limited = runtime.replyCount >= MAX_REPLIES_PER_THREAD;
  const jobId = await ctx.db.insert("simulatedProviderJobs", {
    threadId: args.thread._id,
    inputMessageId: args.messageId,
    locale: runtime.locale,
    status: limited ? "failed" : "queued",
    attemptCount: 0,
    manualRetryCount: 0,
    errorCode: limited ? "SIMULATED_PROVIDER_REPLY_LIMIT" : undefined,
    createdAt: now,
    updatedAt: now,
    completedAt: limited ? now : undefined,
  });
  if (!limited) await startNextForThread(ctx, runtime._id);
  return jobId;
}

export const claimJob = internalMutation({
  args: { jobId: v.id("simulatedProviderJobs"), claimToken: v.string() },
  returns: v.union(v.object({
    scenarioId: v.string(), scenarioVersion: v.number(), stateKey: v.string(),
    agentThreadId: v.string(), promptMessageId: v.string(),
    locale: v.union(v.literal("en"), v.literal("de")),
    participantMessages: v.array(v.string()),
  }), v.null()),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    const now = Date.now();
    const expiredClaim = job?.status === "processing" && (job.leaseExpiresAt ?? 0) <= now;
    if (!job || (job.status !== "queued" && !expiredClaim) || !engineEnabled()) {
      if (job && (job.status === "queued" || job.status === "processing") && !engineEnabled()) {
        await ctx.db.patch(job._id, { status: "failed", errorCode: "SIMULATED_PROVIDER_ENGINE_DISABLED", completedAt: Date.now(), updatedAt: Date.now() });
      }
      return null;
    }
    const runtime = await ctx.db.query("simulatedProviderThreads").withIndex("by_thread_id", (q) => q.eq("threadId", job.threadId)).unique();
    const thread = await ctx.db.get(job.threadId);
    const inputMessage = await ctx.db.get(job.inputMessageId);
    if (!runtime || runtime.activeJobId !== job._id || !thread || !inputMessage || inputMessage.threadId !== thread._id || inputMessage.senderId !== thread.participantId ||
      runtime.participantId !== thread.participantId || runtime.listingId !== thread.listingId) {
      await ctx.db.patch(job._id, { status: "failed", errorCode: "SIMULATED_PROVIDER_CONTEXT_STALE", completedAt: Date.now(), updatedAt: Date.now() });
      return null;
    }
    if (runtime.replyCount >= MAX_REPLIES_PER_THREAD) {
      await ctx.db.patch(job._id, {
        status: "failed", errorCode: "SIMULATED_PROVIDER_REPLY_LIMIT",
        completedAt: now, updatedAt: now,
      });
      return null;
    }
    const binding = await ctx.db.query("simulatedProviderListings").withIndex("by_listing_id", (q) => q.eq("listingId", thread.listingId)).unique();
    if (!binding?.enabled || binding.scenarioId !== runtime.scenarioId || binding.scenarioVersion !== runtime.scenarioVersion) {
      await ctx.db.patch(job._id, { status: "failed", errorCode: "SIMULATED_PROVIDER_BINDING_DISABLED", completedAt: Date.now(), updatedAt: Date.now() });
      return null;
    }
    let promptMessageId = job.agentInputMessageId;
    if (!promptMessageId) {
      const saved = await simulatedProviderAgent.saveMessage(ctx, {
        threadId: runtime.agentThreadId,
        userId: runtime.participantId,
        prompt: inputMessage.body,
        skipEmbeddings: true,
      });
      promptMessageId = saved.messageId;
    }
    // Recent participant wording lets the validator accept echoed conversational times (e.g. a proposed viewing).
    // Anchored to the input message so later quick follow-ups neither push its time out of the window nor leak in.
    const recent = await ctx.db.query("messages")
      .withIndex("by_thread_and_created_at", (q) => q.eq("threadId", job.threadId).lte("createdAt", inputMessage.createdAt))
      .order("desc")
      .take(10);
    const participantMessages = recent
      .filter((message) => message.senderId === thread.participantId && message._creationTime <= inputMessage._creationTime)
      .slice(0, 3)
      .reverse()
      .map((message) => message.body.slice(0, 600));
    await ctx.db.patch(job._id, {
      status: "processing", attemptCount: job.attemptCount + 1, claimToken: args.claimToken,
      agentInputMessageId: promptMessageId,
      leaseExpiresAt: now + CLAIM_LEASE_MS, errorCode: undefined, updatedAt: now,
    });
    return {
      scenarioId: runtime.scenarioId, scenarioVersion: runtime.scenarioVersion,
      stateKey: runtime.stateKey, agentThreadId: runtime.agentThreadId,
      promptMessageId, locale: job.locale, participantMessages,
    };
  },
});

export const releaseAttempt = internalMutation({
  args: { jobId: v.id("simulatedProviderJobs"), claimToken: v.string(), errorCode: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "processing" || job.claimToken !== args.claimToken) return false;
    await ctx.db.patch(job._id, {
      status: "queued", claimToken: undefined, leaseExpiresAt: undefined,
      errorCode: args.errorCode.slice(0, 120), updatedAt: Date.now(),
    });
    return true;
  },
});

export const completeJob = internalMutation({
  args: {
    jobId: v.id("simulatedProviderJobs"), claimToken: v.string(), message: v.string(),
    proposedTransition: v.union(v.string(), v.null()), locale: v.union(v.literal("en"), v.literal("de")),
    qualityNote: v.optional(v.string()),
  },
  returns: v.union(v.object({ messageId: v.id("messages") }), v.null()),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.status !== "processing" || job.claimToken !== args.claimToken || !job.agentInputMessageId) return null;
    const runtime = await ctx.db.query("simulatedProviderThreads").withIndex("by_thread_id", (q) => q.eq("threadId", job.threadId)).unique();
    const thread = await ctx.db.get(job.threadId);
    const listing = thread ? await ctx.db.get(thread.listingId) : null;
    if (!runtime || runtime.activeJobId !== job._id || !thread || !listing) return null;
    const binding = await ctx.db.query("simulatedProviderListings")
      .withIndex("by_listing_id", (q) => q.eq("listingId", thread.listingId))
      .unique();
    if (!engineEnabled() || !binding?.enabled || binding.scenarioId !== runtime.scenarioId || binding.scenarioVersion !== runtime.scenarioVersion) {
      await ctx.db.patch(job._id, {
        status: "failed", errorCode: engineEnabled()
          ? "SIMULATED_PROVIDER_BINDING_DISABLED"
          : "SIMULATED_PROVIDER_ENGINE_DISABLED",
        claimToken: undefined, leaseExpiresAt: undefined,
        completedAt: Date.now(), updatedAt: Date.now(),
      });
      return null;
    }
    if (runtime.replyCount >= MAX_REPLIES_PER_THREAD) {
      await ctx.db.patch(job._id, {
        status: "failed", errorCode: "SIMULATED_PROVIDER_REPLY_LIMIT",
        claimToken: undefined, leaseExpiresAt: undefined,
        completedAt: Date.now(), updatedAt: Date.now(),
      });
      return null;
    }
    const scenario = getBerlinProviderScenario(runtime.scenarioId);
    if (!scenario || scenario.version !== runtime.scenarioVersion) return null;
    const nextState = args.proposedTransition
      ? scenario.dynamic?.transitions.find((transition) => transition.id === args.proposedTransition && transition.fromState === runtime.stateKey)?.toState
      : runtime.stateKey;
    if (!nextState) throw new ConvexError({ code: "SIMULATED_PROVIDER_TRANSITION_INVALID" });
    const result = await appendThreadMessage(ctx, { threadId: thread._id, senderId: listing.ownerId, body: args.message });
    const { messageId: agentResponseMessageId } = await simulatedProviderAgent.saveMessage(ctx, {
      threadId: runtime.agentThreadId,
      userId: runtime.participantId,
      promptMessageId: job.agentInputMessageId,
      message: { role: "assistant", content: args.message },
      skipEmbeddings: true,
    });
    const now = Date.now();
    await ctx.db.patch(job._id, {
      status: "completed", responseMessageId: result.messageId, agentResponseMessageId, claimToken: undefined,
      leaseExpiresAt: undefined, errorCode: undefined, qualityNote: args.qualityNote, completedAt: now, updatedAt: now,
    });
    await ctx.db.patch(runtime._id, {
      stateKey: nextState, locale: args.locale, replyCount: runtime.replyCount + 1, updatedAt: now,
    });
    return { messageId: result.messageId };
  },
});

export const finalizeWork = internalMutation({
  args: { jobId: v.id("simulatedProviderJobs"), succeeded: v.boolean(), errorCode: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) return null;
    const runtime = await ctx.db.query("simulatedProviderThreads").withIndex("by_thread_id", (q) => q.eq("threadId", job.threadId)).unique();
    const now = Date.now();
    if (!args.succeeded && job.status !== "completed") {
      await ctx.db.patch(job._id, {
        status: "failed", claimToken: undefined, leaseExpiresAt: undefined,
        errorCode: job.errorCode || args.errorCode?.slice(0, 120) || "SIMULATED_PROVIDER_GENERATION_FAILED",
        completedAt: now, updatedAt: now,
      });
    }
    if (runtime?.activeJobId === job._id) {
      await ctx.db.patch(runtime._id, { activeJobId: undefined, updatedAt: now });
      await startNextForThread(ctx, runtime._id);
    }
    return null;
  },
});

export const getThreadStatus = query({
  args: { threadId: v.id("threads") },
  returns: v.union(v.object({
    jobId: v.id("simulatedProviderJobs"), status: jobStatusValidator, errorCode: v.optional(v.string()), replyCount: v.number(), canRetry: v.boolean(),
  }), v.null()),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.participantId !== identity.subject) return null;
    const runtime = await ctx.db.query("simulatedProviderThreads").withIndex("by_thread_id", (q) => q.eq("threadId", thread._id)).unique();
    if (!runtime) return null;
    const binding = await ctx.db.query("simulatedProviderListings")
      .withIndex("by_listing_id", (q) => q.eq("listingId", thread.listingId))
      .unique();
    const jobs = await ctx.db.query("simulatedProviderJobs").withIndex("by_thread_id_and_created_at", (q) => q.eq("threadId", thread._id)).order("desc").take(1);
    const latest = jobs[0];
    if (!latest) return null;
    const active = engineEnabled() && binding?.enabled && binding.scenarioId === runtime.scenarioId && binding.scenarioVersion === runtime.scenarioVersion;
    return { jobId: latest._id, status: latest.status, errorCode: latest.errorCode, replyCount: runtime.replyCount, canRetry: Boolean(active) && latest.status === "failed" && latest.manualRetryCount < MAX_MANUAL_RETRIES && runtime.replyCount < MAX_REPLIES_PER_THREAD };
  },
});

export const retryMine = mutation({
  args: { jobId: v.id("simulatedProviderJobs") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const job = await ctx.db.get(args.jobId);
    const thread = job ? await ctx.db.get(job.threadId) : null;
    const runtime = thread ? await ctx.db.query("simulatedProviderThreads").withIndex("by_thread_id", (q) => q.eq("threadId", thread._id)).unique() : null;
    if (!job || !thread || !runtime || thread.participantId !== identity.subject || job.status !== "failed") return false;
    const binding = await ctx.db.query("simulatedProviderListings")
      .withIndex("by_listing_id", (q) => q.eq("listingId", thread.listingId))
      .unique();
    if (job.manualRetryCount >= MAX_MANUAL_RETRIES || runtime.replyCount >= MAX_REPLIES_PER_THREAD || !engineEnabled() || !binding?.enabled || binding.scenarioId !== runtime.scenarioId || binding.scenarioVersion !== runtime.scenarioVersion) return false;
    await ctx.db.patch(job._id, {
      status: "queued", attemptCount: 0, manualRetryCount: job.manualRetryCount + 1,
      claimToken: undefined, leaseExpiresAt: undefined, errorCode: undefined, completedAt: undefined, updatedAt: Date.now(),
    });
    await startNextForThread(ctx, runtime._id);
    return true;
  },
});

export const configureListings = internalMutation({
  args: { confirmation: v.string(), mode: v.union(v.literal("disabled"), v.literal("ber01"), v.literal("all")) },
  returns: v.object({ updated: v.number(), enabled: v.number() }),
  handler: async (ctx, args) => {
    assertPortalConfiguration(args.confirmation);
    const bindings = await ctx.db.query("simulatedProviderListings").take(100);
    let updated = 0;
    let enabled = 0;
    const now = Date.now();
    for (const binding of bindings) {
      const shouldEnable = args.mode === "all" || (args.mode === "ber01" && binding.scenarioId === "BER-01");
      if (shouldEnable) enabled++;
      if (binding.enabled !== shouldEnable) {
        await ctx.db.patch(binding._id, { enabled: shouldEnable, updatedAt: now });
        updated++;
      }
    }
    return { updated, enabled };
  },
});

export const internalStatus = internalQuery({
  args: {},
  returns: v.object({ configured: v.boolean(), mappings: v.number(), enabledMappings: v.number(), queued: v.number(), processing: v.number(), completed: v.number(), failed: v.number() }),
  handler: async (ctx) => {
    const [mappings, queued, processing, completed, failed] = await Promise.all([
      ctx.db.query("simulatedProviderListings").take(100),
      ctx.db.query("simulatedProviderJobs").withIndex("by_status_and_updated_at", (q) => q.eq("status", "queued")).take(500),
      ctx.db.query("simulatedProviderJobs").withIndex("by_status_and_updated_at", (q) => q.eq("status", "processing")).take(500),
      ctx.db.query("simulatedProviderJobs").withIndex("by_status_and_updated_at", (q) => q.eq("status", "completed")).take(500),
      ctx.db.query("simulatedProviderJobs").withIndex("by_status_and_updated_at", (q) => q.eq("status", "failed")).take(500),
    ]);
    return { configured: engineEnabled(), mappings: mappings.length, enabledMappings: mappings.filter((row) => row.enabled).length, queued: queued.length, processing: processing.length, completed: completed.length, failed: failed.length };
  },
});
