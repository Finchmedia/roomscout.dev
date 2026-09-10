/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";
import {
  createListing,
  getMyThread,
  getPublicListing,
  listMyThreads,
  listPublicListings,
  sendThreadMessage,
  startThread,
} from "../lib/convex";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const syncPortalIdentity = makeFunctionReference<
  "action",
  Record<string, never>,
  { emailAvailable: boolean }
>("portalIdentity:syncMe");
const retrySkippedRecipientNotification = makeFunctionReference<
  "mutation",
  { messageId: import("./_generated/dataModel").Id<"messages"> },
  boolean
>("email:retrySkippedRecipientNotification");
const legacySyncPortalIdentity = makeFunctionReference<
  "mutation",
  Record<string, never>,
  { emailAvailable: boolean }
>("portalUsers:syncMe");

describe("controlled portal authorization", () => {
  it("uses a verified JWT email claim without calling the Clerk backend", async () => {
    const previousFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("Clerk fetch must not run for a verified claim");
    };

    try {
      const t = convexTest(schema, modules);
      const user = t.withIdentity({
        subject: "user_claim_email",
        email: "Claim@AgentMail.to",
        emailVerified: true,
      });
      await expect(user.action(syncPortalIdentity, {})).resolves.toEqual({
        emailAvailable: true,
      });
      expect(fetchCalled).toBe(false);
      const stored = await t.run(async (ctx) =>
        ctx.db
          .query("portalUsers")
          .withIndex("by_auth_subject", (q) => q.eq("authSubject", "user_claim_email"))
          .unique(),
      );
      expect(stored?.emailAddress).toBe("claim@agentmail.to");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("resolves a verified primary email from Clerk when JWT claims omit it", async () => {
    const previousSecret = process.env.CLERK_SECRET_KEY;
    const previousFetch = globalThis.fetch;
    process.env.CLERK_SECRET_KEY = "test_clerk_secret";
    globalThis.fetch = async (input, init) => {
      expect(String(input)).toBe("https://api.clerk.com/v1/users/user_tokiohotel");
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer test_clerk_secret",
      );
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({
        primary_email_address_id: "email_primary",
        email_addresses: [
          {
            id: "email_primary",
            email_address: "TokioHotel@AgentMail.to",
            verification: { status: "verified" },
          },
        ],
      });
    };

    try {
      const t = convexTest(schema, modules);
      const user = t.withIdentity({ subject: "user_tokiohotel" });
      await expect(user.action(syncPortalIdentity, {})).resolves.toEqual({
        emailAvailable: true,
      });
      const stored = await t.run(async (ctx) =>
        ctx.db
          .query("portalUsers")
          .withIndex("by_auth_subject", (q) =>
            q.eq("authSubject", "user_tokiohotel"),
          )
          .unique(),
      );
      expect(stored?.emailAddress).toBe("tokiohotel@agentmail.to");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousSecret === undefined) delete process.env.CLERK_SECRET_KEY;
      else process.env.CLERK_SECRET_KEY = previousSecret;
    }
  });

  it("keeps the legacy JWT identity sync available to deployed clients", async () => {
    const t = convexTest(schema, modules);
    const withoutEmail = t.withIdentity({ subject: "user_without_email" });
    await expect(withoutEmail.mutation(legacySyncPortalIdentity, {})).resolves.toEqual({
      emailAvailable: false,
    });

    const withEmail = t.withIdentity({
      subject: "user_with_email",
      email: "Verified@Example.com",
      emailVerified: true,
    });
    await expect(withEmail.mutation(legacySyncPortalIdentity, {})).resolves.toEqual({
      emailAvailable: true,
    });
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("portalUsers")
        .withIndex("by_auth_subject", (q) => q.eq("authSubject", "user_with_email"))
        .unique(),
    );
    expect(stored?.emailAddress).toBe("verified@example.com");
  });

  it("retries only one skipped notification after its recipient is available", async () => {
    const t = convexTest(schema, modules);
    const messageId = await t.run(async (ctx) => {
      const now = Date.now();
      const listingId = await ctx.db.insert("listings", {
        ownerId: "user_owner",
        ownerLabel: "Studio West",
        side: "supply",
        title: "Evening room slot",
        city: "Stuttgart",
        description: "A controlled listing.",
        status: "published",
        createdAt: now,
        updatedAt: now,
      });
      const threadId = await ctx.db.insert("threads", {
        listingId,
        ownerId: "user_owner",
        participantId: "user_participant",
        participantLabel: "The Cooks",
        subject: "Re: Evening room slot",
        lastMessageAt: now,
        createdAt: now,
      });
      await ctx.db.insert("portalUsers", {
        authSubject: "user_participant",
        emailAddress: "participant@example.com",
        createdAt: now,
        updatedAt: now,
      });
      return await ctx.db.insert("messages", {
        threadId,
        senderId: "user_owner",
        senderLabel: "Studio West",
        body: "Tuesday is available.",
        notificationStatus: "skipped_recipient_unavailable",
        createdAt: now,
      });
    });

    await expect(
      t.mutation(retrySkippedRecipientNotification, { messageId }),
    ).resolves.toBe(true);
    await t.finishAllScheduledFunctions(() => undefined);
    const message = await t.run((ctx) => ctx.db.get(messageId));
    expect(message?.notificationStatus).toBe("skipped_unconfigured");
    await expect(
      t.mutation(retrySkippedRecipientNotification, { messageId }),
    ).resolves.toBe(false);
  });

  it("renders public listing data without exposing the Clerk owner subject", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "clerk_owner" });
    const listingId = await owner.mutation(createListing, {
      ownerLabel: "Studio West",
      side: "supply",
      title: "Evening room slot",
      city: "Stuttgart",
      description: "A controlled listing for the monitor proof.",
      priceEur: 180,
      pricePeriod: "month",
    });
    const publicListing = await t.query(getPublicListing, { listingId });
    expect(publicListing).toMatchObject({
      ownerLabel: "Studio West",
      title: "Evening room slot",
    });
    expect(publicListing).not.toHaveProperty("ownerId");
    const publicRows = await t.query(listPublicListings, { limit: 10 });
    expect(publicRows).toHaveLength(1);
    expect(publicRows[0]).not.toHaveProperty("ownerId");
  });

  it("publishes and filters both room offers and room requests", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "clerk_owner" });
    const supplyId = await owner.mutation(createListing, {
      ownerLabel: "Studio West",
      side: "supply",
      title: "Evening room slot",
      city: "Stuttgart",
      description: "A controlled room offer.",
    });
    const demandId = await owner.mutation(createListing, {
      ownerLabel: "The Cooks",
      side: "demand",
      title: "Band needs a monthly room",
      city: "Stuttgart",
      description: "A controlled rehearsal-room request.",
    });

    expect(await t.query(listPublicListings, { side: "supply", limit: 10 })).toMatchObject([
      { _id: supplyId, side: "supply" },
    ]);
    expect(await t.query(listPublicListings, { side: "demand", limit: 10 })).toMatchObject([
      { _id: demandId, side: "demand" },
    ]);
    expect(await t.query(listPublicListings, { limit: 10 })).toHaveLength(2);
  });

  it("keeps native threads visible only to their two Clerk identities", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "clerk_owner" });
    const musician = t.withIdentity({ subject: "clerk_musician" });
    const outsider = t.withIdentity({ subject: "clerk_outsider" });
    const listingId = await owner.mutation(createListing, {
      ownerLabel: "Studio West",
      side: "supply",
      title: "Evening room slot",
      city: "Stuttgart",
      description: "A controlled listing for the Browserbase proof.",
    });
    const started = await musician.mutation(startThread, {
      listingId,
      participantLabel: "The Cooks",
      body: "Is Tuesday still available?",
    });
    await owner.mutation(sendThreadMessage, {
      threadId: started.threadId,
      body: "Yes, Tuesday is available.",
    });

    const musicianDetail = await musician.query(getMyThread, { threadId: started.threadId });
    const ownerDetail = await owner.query(getMyThread, { threadId: started.threadId });
    expect(musicianDetail).toMatchObject({
      thread: { _id: started.threadId, counterparty: "Studio West" },
      messages: [
        { senderLabel: "The Cooks", mine: true },
        { senderLabel: "Studio West", mine: false },
      ],
    });
    expect(ownerDetail).toMatchObject({
      thread: { _id: started.threadId, counterparty: "The Cooks" },
      messages: [
        { senderLabel: "The Cooks", mine: false },
        { senderLabel: "Studio West", mine: true },
      ],
    });
    expect(await outsider.query(getMyThread, { threadId: started.threadId })).toBeNull();
    expect(await owner.query(listMyThreads, {})).toMatchObject([{ counterparty: "The Cooks" }]);
    expect(await musician.query(listMyThreads, {})).toMatchObject([{ counterparty: "Studio West" }]);
    expect(await outsider.query(listMyThreads, {})).toHaveLength(0);
  });

  it("keeps the persisted portal identity when a participant sends again", async () => {
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "clerk_owner" });
    const musician = t.withIdentity({ subject: "clerk_musician" });
    const listingId = await owner.mutation(createListing, {
      ownerLabel: "Studio West",
      side: "supply",
      title: "Evening room slot",
      city: "Stuttgart",
      description: "A controlled listing for the Browserbase proof.",
    });
    const started = await musician.mutation(startThread, {
      listingId,
      participantLabel: "The Cooks",
      body: "Is Tuesday still available?",
    });

    await musician.mutation(startThread, {
      listingId,
      participantLabel: "Impersonated name",
      body: "Following up from the listing page.",
    });
    await musician.mutation(sendThreadMessage, {
      threadId: started.threadId,
      body: "Following up from the inbox.",
    });

    const detail = await owner.query(getMyThread, { threadId: started.threadId });
    expect(detail?.messages).toHaveLength(3);
    expect(detail?.messages.map((message) => message.senderLabel)).toEqual([
      "The Cooks",
      "The Cooks",
      "The Cooks",
    ]);
  });

  it("stores notification addresses privately and schedules one email per message", async () => {
    const previousApiKey = process.env.AGENTMAIL_API_KEY;
    const previousInboxId = process.env.AGENTMAIL_NOTIFICATION_INBOX_ID;
    delete process.env.AGENTMAIL_API_KEY;
    delete process.env.AGENTMAIL_NOTIFICATION_INBOX_ID;

    try {
      const t = convexTest(schema, modules);
      const owner = t.withIdentity({
        subject: "clerk_owner",
        email: "owner@example.com",
        emailVerified: true,
      });
      const musician = t.withIdentity({
        subject: "clerk_musician",
        email: "musician@example.com",
        emailVerified: true,
      });
      const listingId = await owner.mutation(createListing, {
        ownerLabel: "Studio West",
        side: "supply",
        title: "Evening room slot",
        city: "Stuttgart",
        description: "A controlled listing for notification testing.",
      });
      const started = await musician.mutation(startThread, {
        listingId,
        participantLabel: "The Cooks",
        body: "Is Tuesday still available?",
      });

      await t.finishAllScheduledFunctions(() => undefined);

      const state = await t.run(async (ctx) => {
        const message = await ctx.db.get(started.messageId);
        const users = await ctx.db.query("portalUsers").collect();
        return { message, users };
      });
      expect(state.message?.notificationStatus).toBe("skipped_unconfigured");
      expect(state.users.map((user) => user.emailAddress).sort()).toEqual([
        "musician@example.com",
        "owner@example.com",
      ]);
      expect(await t.query(getPublicListing, { listingId })).not.toHaveProperty(
        "emailAddress",
      );
      expect(await owner.query(getMyThread, { threadId: started.threadId })).not.toHaveProperty(
        "emailAddress",
      );
    } finally {
      if (previousApiKey === undefined) delete process.env.AGENTMAIL_API_KEY;
      else process.env.AGENTMAIL_API_KEY = previousApiKey;
      if (previousInboxId === undefined) delete process.env.AGENTMAIL_NOTIFICATION_INBOX_ID;
      else process.env.AGENTMAIL_NOTIFICATION_INBOX_ID = previousInboxId;
    }
  });
});
