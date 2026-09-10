/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal, api } from "./_generated/api";
import schema from "./schema";
import { deleteVerifiedClerkTestAccount } from "./testResetActions";

const modules = import.meta.glob("./**/*.ts");
beforeEach(() => { vi.useFakeTimers(); vi.stubEnv("CONVEX_SITE_URL", "https://sensible-ladybug-38.eu-west-1.convex.site"); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function fixture() {
  const t = convexTest(schema, modules);
  const ids = await t.run(async ctx => {
    const keepOwnerId = "user_landlord";
    const keepListingId = await ctx.db.insert("listings", { ownerId: keepOwnerId, ownerLabel: "finchlandlord", side: "supply", title: "Room", city: "Stuttgart", description: "Room", status: "published", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("portalUsers", { authSubject: keepOwnerId, emailAddress: "landlord@example.com", createdAt: 1, updatedAt: 1 });
    await ctx.db.insert("portalUsers", { authSubject: "user_band", emailAddress: "band@agentmail.to", createdAt: 1, updatedAt: 1 });
    const threadId = await ctx.db.insert("threads", { listingId: keepListingId, ownerId: keepOwnerId, participantId: "user_band", participantLabel: "Band", subject: "Room", lastMessageAt: 1, createdAt: 1 });
    await ctx.db.insert("messages", { threadId, senderId: "user_band", senderLabel: "Band", body: "Hi", createdAt: 1 });
    return { keepListingId, keepOwnerId };
  });
  const plan = await t.query(internal.testReset.preview, ids);
  const args = { ...ids, key: "reset-1", expectedHash: plan.hash, confirmation: "RESET_TEST_PORTAL_KEEP_LANDLORD" as const, clerkSubjects: [{ id: "user_band", email: "band@agentmail.to" }] };
  return { t, ids, plan, args };
}

describe("controlled portal reset", () => {
  it("includes Clerk accounts missing from portalUsers but excludes the landlord", async () => {
    const f = await fixture();
    vi.stubEnv("CLERK_SECRET_KEY", "test-only");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify([
      { id: "user_landlord" },
      { id: "user_orphan", primary_email_address_id: "e", email_addresses: [{ id: "e", email_address: "orphan@agentmail.to" }] },
    ]), { status: 200 })));
    const plan = await f.t.action(internal.testResetActions.preview, f.ids);
    expect(plan.clerkSubjects).toEqual([{ id: "user_orphan", email: "orphan@agentmail.to" }]);
    const resetId = await f.t.mutation(internal.testReset.begin, { ...f.args, clerkSubjects: plan.clerkSubjects });
    expect((await f.t.query(internal.testReset.get, { resetId }))?.subjects.map(s => s.id)).toEqual(["user_band", "user_orphan"]);
  });

  it("previews without deleting and rejects changed preview", async () => {
    const f = await fixture();
    expect(f.plan.counts).toMatchObject({ messages: 1, threads: 1, listings: 0, portalUsers: 1 });
    await f.t.run(ctx => ctx.db.insert("portalUsers", { authSubject: "user_new", emailAddress: "new@agentmail.to", createdAt: 2, updatedAt: 2 }));
    await expect(f.t.mutation(internal.testReset.begin, f.args)).rejects.toThrow("RESET_PREVIEW_CHANGED");
  });

  it("cleans multiple pages and does not silently leave later messages", async () => {
    const f = await fixture();
    await f.t.run(async ctx => {
      const thread = await ctx.db.query("threads").first();
      for (let index = 0; index < 205; index++) await ctx.db.insert("messages", { threadId: thread!._id, senderId: "user_band", senderLabel: "Band", body: "Test", createdAt: index + 2 });
    });
    const plan = await f.t.query(internal.testReset.preview, f.ids);
    const resetId = await f.t.mutation(internal.testReset.begin, { ...f.args, expectedHash: plan.hash });
    vi.stubEnv("CLERK_SECRET_KEY", "test-only");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await f.t.action(internal.testResetActions.resume, { resetId });
    expect((await f.t.query(internal.testReset.get, { resetId }))?.completed).toBe(true);
    expect(await f.t.run(ctx => ctx.db.query("messages").first())).toBeNull();
  });

  it("preserves landlord, deletes history, and prevents stale identities from returning", async () => {
    const f = await fixture();
    const resetId = await f.t.mutation(internal.testReset.begin, f.args);
    expect(await f.t.mutation(internal.testReset.begin, f.args)).toBe(resetId);
    await expect(f.t.withIdentity({ subject: "user_landlord", email: "landlord@example.com" }).mutation(api.portalUsers.syncMe, {})).rejects.toThrow("TEST_RESET_IN_PROGRESS");
    await expect(f.t.mutation(internal.testReset.deletePage, { resetId, table: "messages", cursor: null })).rejects.toThrow("RESET_ACCOUNTS_NOT_FINISHED");
    await f.t.mutation(internal.testReset.accountDeleted, { resetId, subject: "user_band" });
    for (const table of ["messages", "threads", "controlledReceipts", "controlledRuns", "listings", "portalUsers"] as const) {
      await f.t.mutation(internal.testReset.deletePage, { resetId, table, cursor: null });
    }
    await f.t.mutation(internal.testReset.complete, { resetId });
    expect(await f.t.run(ctx => ctx.db.get(f.ids.keepListingId))).not.toBeNull();
    expect((await f.t.query(internal.testReset.preview, f.ids)).counts.portalUsers).toBe(0);
    await expect(f.t.withIdentity({ subject: "user_band", email: "band@agentmail.to" }).mutation(api.portalUsers.syncMe, {})).rejects.toThrow("TEST_IDENTITY_RETIRED");
    await expect(f.t.withIdentity({ subject: "user_fresh", email: "fresh@agentmail.to" }).mutation(api.portalUsers.syncMe, {})).resolves.toEqual({ emailAvailable: true });
  });

  it("rejects protected account as a deletion target and wrong deployments", async () => {
    const f = await fixture();
    await expect(f.t.mutation(internal.testReset.begin, { ...f.args, clerkSubjects: [{ id: f.ids.keepOwnerId, email: "landlord@example.com" }] })).rejects.toThrow("RESET_CLERK_TARGET_INVALID");
    vi.stubEnv("CONVEX_SITE_URL", "https://other.convex.site");
    await expect(f.t.mutation(internal.testReset.begin, f.args)).rejects.toThrow("RESET_CONTROLLED_PORTAL_ONLY");
  });

  it("keeps local records when Clerk deletion fails and can resume", async () => {
    const f = await fixture();
    const resetId = await f.t.mutation(internal.testReset.begin, f.args);
    vi.stubEnv("CLERK_SECRET_KEY", "test-only");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(f.t.action(internal.testResetActions.resume, { resetId })).rejects.toThrow("RESET_CLERK_LOOKUP_FAILED");
    expect((await f.t.query(internal.testReset.get, { resetId }))?.deletedSubjects).toEqual([]);
    expect((await f.t.query(internal.testReset.preview, f.ids)).counts.portalUsers).toBe(1);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })));
    await f.t.action(internal.testResetActions.resume, { resetId });
    expect((await f.t.query(internal.testReset.get, { resetId }))?.completed).toBe(true);
  });

  it("verifies Clerk identity before deletion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "user_band", primary_email_address_id: "e", email_addresses: [{ id: "e", email_address: "wrong@example.com" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(deleteVerifiedClerkTestAccount({ id: "user_band", email: "band@agentmail.to", keepOwnerId: "user_landlord", secret: "test" })).rejects.toThrow("RESET_CLERK_IDENTITY_MISMATCH");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
