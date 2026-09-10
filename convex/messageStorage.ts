import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { assertTestResetAllowsWrite } from "./testReset";

/** Shared by the authenticated UI and the run-scoped provider simulator.
 * Authorization belongs to each caller; membership is checked again here. */
export async function appendThreadMessage(ctx: MutationCtx, args: {
  threadId: Id<"threads">; senderId: string; body: string;
}): Promise<{ threadId: Id<"threads">; messageId: Id<"messages"> }> {
  await assertTestResetAllowsWrite(ctx, args.senderId);
  const thread = await ctx.db.get(args.threadId);
  if (!thread || ![thread.ownerId, thread.participantId].includes(args.senderId)) {
    throw new ConvexError({ code: "THREAD_NOT_FOUND" });
  }
  const listing = await ctx.db.get(thread.listingId);
  if (!listing) throw new ConvexError({ code: "THREAD_NOT_FOUND" });
  const body = args.body.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 5_000);
  if (!body) throw new ConvexError({ code: "INVALID_MESSAGE" });
  const now = Date.now();
  const messageId = await ctx.db.insert("messages", {
    threadId: thread._id, senderId: args.senderId,
    senderLabel: args.senderId === thread.ownerId ? listing.ownerLabel : thread.participantLabel,
    body, notificationStatus: "pending", createdAt: now,
  });
  await ctx.db.patch(thread._id, { lastMessageAt: now });
  await ctx.scheduler.runAfter(0, internal.email.enqueueMessageNotification, { messageId });
  return { threadId: thread._id, messageId };
}
