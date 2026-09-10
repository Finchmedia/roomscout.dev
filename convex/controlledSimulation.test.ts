/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { startThread, sendThreadMessage } from "../lib/convex";

const modules = import.meta.glob("./**/*.ts");
const prepare = makeFunctionReference<"mutation", {
  confirmation: string; runKey: string; scenario: "happy_path"; expectedInbox: string;
}, { runId: Id<"controlledRuns">; listingId: Id<"listings">; reused: boolean }>("controlledSimulation:prepare");
const reply = makeFunctionReference<"mutation", {
  confirmation: string; runId: Id<"controlledRuns">; threadId: Id<"threads">; requestKey: string; body: string;
}, { messageId: Id<"messages">; reused: boolean }>("controlledSimulation:reply");
const close = makeFunctionReference<"mutation", { confirmation: string; runId: Id<"controlledRuns"> }, null>("controlledSimulation:close");
const confirmation = "CONTROLLED_ROOMSCOUT_PORTAL_PROOF";
const setup = { confirmation, runKey: "proof-test-00000001", scenario: "happy_path" as const, expectedInbox: "controlled-proof@agentmail.to" };

beforeEach(() => vi.stubEnv("CONVEX_SITE_URL", "https://sensible-ladybug-38.eu-west-1.convex.site"));
afterEach(() => vi.unstubAllEnvs());

async function fixture() {
  const t = convexTest(schema, modules);
  const run = await t.mutation(prepare, setup);
  const musician = t.withIdentity({ subject: "controlled-clerk-participant", email: setup.expectedInbox, emailVerified: true });
  const thread = await musician.mutation(startThread, { listingId: run.listingId, participantLabel: "Controlled musician", body: "Is Tuesday available?" });
  return { t, run, thread, musician, args: { confirmation, runId: run.runId, threadId: thread.threadId, requestKey: "reply-1", body: "Tuesday is available for EUR 260 total monthly." } };
}

describe("run-scoped provider simulation", () => {
  it("creates a labelled, idempotent listing without borrowing an existing owner", async () => {
    const { t, run } = await fixture();
    expect(await t.mutation(prepare, setup)).toMatchObject({ ...run, reused: true });
    const listing = await t.run(ctx => ctx.db.get(run.listingId));
    expect(listing?.title).toContain("[DEMO — no real room]");
    expect(listing?.ownerId).toBe(`controlled-owner:${setup.runKey}`);
    await expect(t.mutation(prepare, { ...setup, expectedInbox: "another@agentmail.to" })).rejects.toThrow("PROOF_SCOPE_MISMATCH");
  });

  it("uses the UI message storage and notification schedule path exactly once", async () => {
    const f = await fixture();
    const first = await f.t.mutation(reply, f.args);
    expect(await f.t.mutation(reply, f.args)).toEqual({ ...first, reused: true });
    const state = await f.t.run(async ctx => ({
      messages: await ctx.db.query("messages").withIndex("by_thread_and_created_at", q => q.eq("threadId", f.thread.threadId)).collect(),
      jobs: await ctx.db.system.query("_scheduled_functions").collect(),
      run: await ctx.db.get(f.run.runId),
    }));
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1]).toMatchObject({ senderLabel: "RoomScout simulated provider (TEST)", body: f.args.body, notificationStatus: "pending" });
    expect(state.jobs.filter(job => job.name === "email:enqueueMessageNotification")).toHaveLength(2);
    expect(state.run?.replyCount).toBe(1);
    await expect(f.t.mutation(reply, { ...f.args, body: "Changed replay" })).rejects.toThrow("PROOF_REPLAY_MISMATCH");
  });

  it("rejects other participants, other listings and public sender impersonation", async () => {
    const f = await fixture();
    const outsider = f.t.withIdentity({ subject: "outsider", email: "outsider@agentmail.to", emailVerified: true });
    const strangerThread = await outsider.mutation(startThread, { listingId: f.run.listingId, participantLabel: "Outsider", body: "Hi" });
    await expect(f.t.mutation(reply, { ...f.args, threadId: strangerThread.threadId })).rejects.toThrow("PROOF_PARTICIPANT_MISMATCH");
    await expect(outsider.mutation(sendThreadMessage, { threadId: f.thread.threadId, body: "Impersonation" })).rejects.toThrow("THREAD_NOT_FOUND");
    const other = await f.t.mutation(prepare, { ...setup, runKey: "proof-test-00000002" });
    await expect(f.t.mutation(reply, { ...f.args, runId: other.runId })).rejects.toThrow("PROOF_SCOPE_MISMATCH");
  });

  it("bounds replies, closes its own listing and rejects expired runs", async () => {
    const f = await fixture();
    for (let i = 0; i < 8; i++) await f.t.mutation(reply, { ...f.args, requestKey: `reply-${i}` });
    await expect(f.t.mutation(reply, { ...f.args, requestKey: "reply-9" })).rejects.toThrow("PROOF_ROUND_LIMIT");
    await f.t.mutation(close, { confirmation, runId: f.run.runId });
    expect(await f.t.run(ctx => ctx.db.get(f.run.listingId))).toMatchObject({ status: "closed" });
    await expect(f.t.mutation(reply, f.args)).rejects.toThrow("PROOF_EXPIRED");
    await expect(f.t.mutation(prepare, setup)).rejects.toThrow("PROOF_EXPIRED");
  });

  it("requires the exact controlled deployment, confirmation and test inbox domain", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(prepare, { ...setup, confirmation: "wrong" })).rejects.toThrow("CONTROLLED_PORTAL_ONLY");
    await expect(t.mutation(prepare, { ...setup, expectedInbox: "real@example.com" })).rejects.toThrow("CONTROLLED_INBOX_REQUIRED");
    vi.stubEnv("CONVEX_SITE_URL", "https://unrelated.convex.site");
    await expect(t.mutation(prepare, setup)).rejects.toThrow("CONTROLLED_PORTAL_ONLY");
    expect(await t.run(ctx => ctx.db.query("listings").collect())).toHaveLength(0);
  });
});
