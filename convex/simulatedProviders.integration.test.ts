/// <reference types="vite/client" />
import { listMessages } from "@convex-dev/agent";
import agentTest from "@convex-dev/agent/test";
import workpoolTest from "@convex-dev/workpool/test";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, components, internal } from "./_generated/api";
import schema from "./schema";
import { simulatedProviderAgent } from "./simulatedProviderModel";

const modules = import.meta.glob("./**/*.ts");
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};
const originalModel = simulatedProviderAgent.options.languageModel;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("CONVEX_SITE_URL", "https://sensible-ladybug-38.eu-west-1.convex.site");
  vi.stubEnv("SIMULATED_PROVIDER_ENGINE_ENABLED", "true");
  vi.stubEnv("AGENTMAIL_API_KEY", "");
});

afterEach(() => {
  simulatedProviderAgent.options.languageModel = originalModel;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

async function withModel<T>(model: LanguageModelV4, run: () => Promise<T>): Promise<T> {
  simulatedProviderAgent.options.languageModel = model;
  return await run();
}

function response(message = "Yes. Wednesday 18:00–22:00 is available for €350 per month.") {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({
      message,
      referencedFactIds: ["price_monthly", "slot_1"],
      proposedTransition: null,
      locale: "en",
    }) }],
    finishReason: { unified: "stop" as const, raw: undefined },
    usage,
    warnings: [],
  };
}

async function fixture() {
  const t = convexTest(schema, modules);
  agentTest.register(t);
  workpoolTest.register(t, "simulatedProviderWorkpool");
  const listingId = await t.run(async (ctx) => {
    const now = Date.now();
    const id = await ctx.db.insert("listings", {
      ownerId: "simulated-provider:BER-01",
      ownerLabel: "Mara at Kanalwerk",
      side: "supply",
      title: "Kanalwerk A",
      city: "Berlin",
      district: "Kreuzberg",
      description: "Fictional room · AI-simulated provider · Interactive demo",
      priceEur: 350,
      pricePeriod: "month",
      status: "published",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("simulatedProviderListings", {
      listingId: id,
      seedKey: "berlin-demo-v1:BER-01",
      scenarioId: "BER-01",
      scenarioVersion: 1,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
  const musician = t.withIdentity({ subject: "juror-a", email: "juror-a@example.com", emailVerified: true });
  return { t, listingId, musician };
}

describe("AI-simulated provider transport", () => {
  it("persists a normal provider reply through the existing thread after the model turn", async () => {
    const f = await fixture();
    const started = await f.musician.mutation(api.messages.start, {
      listingId: f.listingId,
      participantLabel: "Neon Harbour via RoomScout",
      body: "Is Wednesday 18:00–22:00 still available?",
    });
    const before = await f.t.run((ctx) => ctx.db.query("simulatedProviderJobs").collect());
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ inputMessageId: started.messageId, status: "queued" });

    const model = new MockLanguageModelV4({ doGenerate: response() });
    await withModel(model, async () => {
      await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    });

    const detail = await f.musician.query(api.messages.getMine, { threadId: started.threadId });
    expect(detail?.messages).toHaveLength(2);
    expect(detail?.messages[1]).toMatchObject({
      senderLabel: "Mara at Kanalwerk",
      mine: false,
      body: "Yes. Wednesday 18:00–22:00 is available for €350 per month.",
    });
    const completedJob = await f.t.run((ctx) => ctx.db.query("simulatedProviderJobs").first());
    const runtime = await f.t.run((ctx) => ctx.db.query("simulatedProviderThreads").first());
    expect(completedJob).toMatchObject({ status: "completed", attemptCount: 1 });
    expect(completedJob?.agentInputMessageId).toBeTruthy();
    expect(completedJob?.agentResponseMessageId).toBeTruthy();
    expect(runtime).toMatchObject({ participantId: "juror-a", replyCount: 1 });
    expect(await f.t.run((ctx) => ctx.runQuery(components.agent.threads.getThread, { threadId: runtime!.agentThreadId })))
      .toMatchObject({ userId: "juror-a" });
    const agentHistory = await f.t.run((ctx) => listMessages(ctx, components.agent, {
      threadId: runtime!.agentThreadId,
      paginationOpts: { cursor: null, numItems: 10 },
    }));
    expect(agentHistory.page.map((message) => ({ role: message.message?.role, text: message.text })).reverse()).toEqual([
      { role: "user", text: "Is Wednesday 18:00–22:00 still available?" },
      { role: "assistant", text: "Yes. Wednesday 18:00–22:00 is available for €350 per month." },
    ]);

    await expect(f.t.action(internal.simulatedProviderActions.processJob, { jobId: completedJob!._id })).resolves.toEqual({ outcome: "stale" });
    expect((await f.musician.query(api.messages.getMine, { threadId: started.threadId }))?.messages).toHaveLength(2);
  });

  it("serializes two quick inputs with the prior reply and locale pinned to each turn", async () => {
    const f = await fixture();
    const started = await f.musician.mutation(api.messages.start, {
      listingId: f.listingId,
      participantLabel: "Band A",
      body: "Is Wednesday available?",
    });
    await f.musician.mutation(api.messages.send, {
      threadId: started.threadId,
      body: "Auf Deutsch bitte. Gibt es Lagerplatz?",
    });
    const seenPrompts: string[] = [];
    const model = new MockLanguageModelV4({
      doGenerate: async ({ prompt }) => {
        seenPrompts.push(JSON.stringify(prompt));
        return seenPrompts.length === 1
          ? response("Yes. Wednesday 18:00–22:00 is available for €350 per month.")
          : {
              ...response("Ja, Lagerung ist erlaubt."),
              content: [{ type: "text" as const, text: JSON.stringify({
                message: "Ja, Lagerung ist erlaubt.",
                referencedFactIds: ["storage"],
                proposedTransition: null,
                locale: "de",
              }) }],
            };
      },
    });
    await withModel(model, async () => {
      await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    });

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(seenPrompts[0]).toContain('\\"locale\\":\\"en\\"');
    expect(seenPrompts[1]).toContain('\\"locale\\":\\"de\\"');
    expect(seenPrompts[1]).toContain("Wednesday 18:00–22:00 is available");
    const detail = await f.musician.query(api.messages.getMine, { threadId: started.threadId });
    expect(detail?.messages.map((message) => message.body)).toEqual([
      "Is Wednesday available?",
      "Auf Deutsch bitte. Gibt es Lagerplatz?",
      "Yes. Wednesday 18:00–22:00 is available for €350 per month.",
      "Ja, Lagerung ist erlaubt.",
    ]);
  });

  it("keeps two jurors on the same room in separate thread state", async () => {
    const f = await fixture();
    const second = f.t.withIdentity({ subject: "juror-b", email: "juror-b@example.com", emailVerified: true });
    const firstThread = await f.musician.mutation(api.messages.start, { listingId: f.listingId, participantLabel: "Band A", body: "Is it available?" });
    const secondThread = await second.mutation(api.messages.start, { listingId: f.listingId, participantLabel: "Band B", body: "Ist der Raum frei?" });
    const states = await f.t.run((ctx) => ctx.db.query("simulatedProviderThreads").collect());
    expect(states).toHaveLength(2);
    expect(new Set(states.map((state) => state.agentThreadId)).size).toBe(2);
    expect(states.map((state) => ({ threadId: state.threadId, participantId: state.participantId, locale: state.locale }))).toEqual(expect.arrayContaining([
      { threadId: firstThread.threadId, participantId: "juror-a", locale: "en" },
      { threadId: secondThread.threadId, participantId: "juror-b", locale: "de" },
    ]));
  });

  it("retries transient model failures at most twice and stores one reply", async () => {
    const f = await fixture();
    const started = await f.musician.mutation(api.messages.start, { listingId: f.listingId, participantLabel: "Band A", body: "Is Wednesday available?" });
    let attempts = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        attempts++;
        if (attempts < 3) throw new Error("temporary gateway failure");
        return response();
      },
    });
    await withModel(model, async () => {
      await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    });
    expect(model.doGenerateCalls).toHaveLength(3);
    expect((await f.musician.query(api.messages.getMine, { threadId: started.threadId }))?.messages).toHaveLength(2);
    expect(await f.t.run((ctx) => ctx.db.query("simulatedProviderJobs").first())).toMatchObject({ status: "completed", attemptCount: 3 });
  });

  it("retries a fabricated price twice, then fails without persisting provider text", async () => {
    const f = await fixture();
    const started = await f.musician.mutation(api.messages.start, { listingId: f.listingId, participantLabel: "Band A", body: "What does it cost?" });
    const model = new MockLanguageModelV4({ doGenerate: response("The room costs €999 per month.") });
    await withModel(model, async () => {
      await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    });
    expect(model.doGenerateCalls).toHaveLength(3);
    expect((await f.musician.query(api.messages.getMine, { threadId: started.threadId }))?.messages).toHaveLength(1);
    expect(await f.t.run((ctx) => ctx.db.query("simulatedProviderJobs").first())).toMatchObject({ status: "failed", attemptCount: 3 });
    const runtime = await f.t.run((ctx) => ctx.db.query("simulatedProviderThreads").first());
    const agentHistory = await f.t.run((ctx) => listMessages(ctx, components.agent, {
      threadId: runtime!.agentThreadId,
      paginationOpts: { cursor: null, numItems: 10 },
    }));
    expect(agentHistory.page.map((message) => message.message?.role)).toEqual(["user"]);
  });

  it("allows the owning juror one controlled retry after a visible failure", async () => {
    const f = await fixture();
    const started = await f.musician.mutation(api.messages.start, { listingId: f.listingId, participantLabel: "Band A", body: "What does it cost?" });
    const invalidModel = new MockLanguageModelV4({ doGenerate: response("The room costs €999 per month.") });
    await withModel(invalidModel, async () => {
      await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    });
    const failed = await f.t.run((ctx) => ctx.db.query("simulatedProviderJobs").first());
    const outsider = f.t.withIdentity({ subject: "juror-b", email: "juror-b@example.com", emailVerified: true });
    await expect(outsider.mutation(api.simulatedProviders.retryMine, { jobId: failed!._id })).resolves.toBe(false);
    await expect(f.musician.mutation(api.simulatedProviders.retryMine, { jobId: failed!._id })).resolves.toBe(true);

    const validModel = new MockLanguageModelV4({ doGenerate: response("The room costs €350 per month.") });
    await withModel(validModel, async () => {
      await f.t.finishAllScheduledFunctions(() => vi.runAllTimers());
    });
    expect((await f.musician.query(api.messages.getMine, { threadId: started.threadId }))?.messages).toHaveLength(2);
    expect(await f.t.run((ctx) => ctx.db.get(failed!._id))).toMatchObject({ status: "completed", manualRetryCount: 1 });
    await expect(f.musician.mutation(api.simulatedProviders.retryMine, { jobId: failed!._id })).resolves.toBe(false);
  });

  it("reclaims an expired worker claim without accepting a duplicate reply", async () => {
    const f = await fixture();
    const started = await f.musician.mutation(api.messages.start, {
      listingId: f.listingId,
      participantLabel: "Band A",
      body: "Is Wednesday available?",
    });
    const job = await f.t.run((ctx) => ctx.db.query("simulatedProviderJobs").first());
    await f.t.run((ctx) => ctx.db.patch(job!._id, {
      status: "processing",
      claimToken: "abandoned-worker",
      leaseExpiresAt: Date.now() - 1,
    }));
    const model = new MockLanguageModelV4({ doGenerate: response() });
    await withModel(model, async () => {
      await expect(f.t.action(internal.simulatedProviderActions.processJob, { jobId: job!._id })).resolves.toEqual({ outcome: "completed" });
      await expect(f.t.action(internal.simulatedProviderActions.processJob, { jobId: job!._id })).resolves.toEqual({ outcome: "stale" });
    });
    expect((await f.musician.query(api.messages.getMine, { threadId: started.threadId }))?.messages).toHaveLength(2);
    expect(await f.t.run((ctx) => ctx.db.get(job!._id))).toMatchObject({ status: "completed", attemptCount: 1 });
  });

  it("does not queue when the global engine flag is off or when the provider replies", async () => {
    vi.stubEnv("SIMULATED_PROVIDER_ENGINE_ENABLED", "false");
    const f = await fixture();
    const started = await f.musician.mutation(api.messages.start, { listingId: f.listingId, participantLabel: "Band A", body: "Hello" });
    expect(await f.t.run((ctx) => ctx.db.query("simulatedProviderJobs").collect())).toEqual([]);

    vi.stubEnv("SIMULATED_PROVIDER_ENGINE_ENABLED", "true");
    const provider = f.t.withIdentity({ subject: "simulated-provider:BER-01" });
    await provider.mutation(api.messages.send, { threadId: started.threadId, body: "Manual provider reply" });
    expect(await f.t.run((ctx) => ctx.db.query("simulatedProviderJobs").collect())).toEqual([]);
  });

  it("stops at twelve provider replies for one thread", async () => {
    const f = await fixture();
    const started = await f.musician.mutation(api.messages.start, {
      listingId: f.listingId,
      participantLabel: "Band A",
      body: "Hello",
    });
    await f.t.run(async (ctx) => {
      const runtime = await ctx.db.query("simulatedProviderThreads").first();
      const firstJob = await ctx.db.query("simulatedProviderJobs").first();
      await ctx.db.patch(runtime!._id, { replyCount: 12, activeJobId: undefined });
      await ctx.db.patch(firstJob!._id, { status: "failed", completedAt: Date.now() });
    });

    await f.musician.mutation(api.messages.send, { threadId: started.threadId, body: "One more question" });
    const jobs = await f.t.run((ctx) => ctx.db.query("simulatedProviderJobs").order("asc").collect());
    expect(jobs.at(-1)).toMatchObject({
      status: "failed",
      attemptCount: 0,
      errorCode: "SIMULATED_PROVIDER_REPLY_LIMIT",
    });
  });

  it("guards staged activation to the exact portal deployment", async () => {
    const f = await fixture();
    const args = { confirmation: "CONFIGURE_ROOMSCOUT_SIMULATED_PROVIDERS", mode: "ber01" as const };
    await expect(f.t.mutation(internal.simulatedProviders.configureListings, args)).resolves.toEqual({ updated: 0, enabled: 1 });
    vi.stubEnv("CONVEX_SITE_URL", "https://other.convex.site");
    await expect(f.t.mutation(internal.simulatedProviders.configureListings, args)).rejects.toThrow("SIMULATED_PROVIDER_PORTAL_ONLY");
  });
});
