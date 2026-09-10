import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { upsertPortalUser } from "./portalUsers";
import { appendThreadMessage } from "./messageStorage";

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

async function identitySubject(ctx: { auth: { getUserIdentity: () => Promise<{ subject: string } | null> } }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

export const start = mutation({
  args: { listingId: v.id("listings"), participantLabel: v.string(), body: v.string() },
  returns: v.object({ threadId: v.id("threads"), messageId: v.id("messages") }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const participantId = identity.subject;
    await upsertPortalUser(ctx, identity);
    const listing = await ctx.db.get(args.listingId);
    if (!listing || listing.status !== "published") throw new ConvexError({ code: "LISTING_NOT_FOUND" });
    if (listing.ownerId === participantId) throw new ConvexError({ code: "CANNOT_MESSAGE_OWN_LISTING" });
    const body = clean(args.body, 5_000);
    const participantLabel = clean(args.participantLabel, 100);
    if (!body || !participantLabel) throw new ConvexError({ code: "INVALID_MESSAGE" });
    const existing = await ctx.db.query("threads").withIndex("by_listing_and_participant", (q) => q.eq("listingId", listing._id).eq("participantId", participantId)).unique();
    const now = Date.now();
    const threadId = existing?._id ?? await ctx.db.insert("threads", {
      listingId: listing._id,
      ownerId: listing.ownerId,
      participantId,
      participantLabel,
      subject: `Re: ${listing.title}`.slice(0, 200),
      lastMessageAt: now,
      createdAt: now,
    });
    // The first message establishes the participant's portal identity for the
    // thread. Re-entering through the listing page must not let the same Clerk
    // identity replace that persisted label on later messages.
    return await appendThreadMessage(ctx, { threadId, senderId: participantId, body });
  },
});

export const send = mutation({
  args: { threadId: v.id("threads"), body: v.string() },
  returns: v.object({ threadId: v.id("threads"), messageId: v.id("messages") }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const senderId = identity.subject;
    await upsertPortalUser(ctx, identity);
    return await appendThreadMessage(ctx, { threadId: args.threadId, senderId, body: args.body });
  },
});

export const listMine = query({
  args: {},
  returns: v.array(v.object({ _id: v.id("threads"), listingId: v.id("listings"), subject: v.string(), counterparty: v.string(), lastMessageAt: v.number() })),
  handler: async (ctx) => {
    const userId = await identitySubject(ctx);
    const [owned, participating] = await Promise.all([
      ctx.db.query("threads").withIndex("by_owner_and_last_message_at", (q) => q.eq("ownerId", userId)).order("desc").take(50),
      ctx.db.query("threads").withIndex("by_participant_and_last_message_at", (q) => q.eq("participantId", userId)).order("desc").take(50),
    ]);
    const threads = [...owned, ...participating].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return await Promise.all(threads.map(async (thread) => {
      const listing = await ctx.db.get(thread.listingId);
      return {
        _id: thread._id,
        listingId: thread.listingId,
        subject: thread.subject,
        counterparty: thread.ownerId === userId ? thread.participantLabel : (listing?.ownerLabel ?? "Listing owner"),
        lastMessageAt: thread.lastMessageAt,
      };
    }));
  },
});

export const getMine = query({
  args: { threadId: v.id("threads") },
  returns: v.union(v.object({
    thread: v.object({ _id: v.id("threads"), subject: v.string(), listingId: v.id("listings"), counterparty: v.string(), lastMessageAt: v.number() }),
    listing: v.object({ title: v.string(), ownerLabel: v.string() }),
    messages: v.array(v.object({ _id: v.id("messages"), senderLabel: v.string(), mine: v.boolean(), body: v.string(), createdAt: v.number() })),
  }), v.null()),
  handler: async (ctx, args) => {
    const userId = await identitySubject(ctx);
    const thread = await ctx.db.get(args.threadId);
    if (!thread || (thread.ownerId !== userId && thread.participantId !== userId)) return null;
    const listing = await ctx.db.get(thread.listingId);
    if (!listing) return null;
    const messages = await ctx.db.query("messages").withIndex("by_thread_and_created_at", (q) => q.eq("threadId", thread._id)).order("asc").take(200);
    return {
      thread: {
        _id: thread._id,
        subject: thread.subject,
        listingId: thread.listingId,
        counterparty: thread.ownerId === userId ? thread.participantLabel : listing.ownerLabel,
        lastMessageAt: thread.lastMessageAt,
      },
      listing: { title: listing.title, ownerLabel: listing.ownerLabel },
      messages: messages.map((message) => ({ _id: message._id, senderLabel: message.senderLabel, mine: message.senderId === userId, body: message.body, createdAt: message.createdAt })),
    };
  },
});
