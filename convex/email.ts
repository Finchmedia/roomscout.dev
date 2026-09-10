import {
  AgentMail,
  vEvent,
  type AgentMailEvent,
  type OutboundId,
  type OutboundStatus,
} from "@agentmail/convex";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { newMessageEmail } from "./emailTemplates";
import { assertTestResetAllowsWrite } from "./testReset";

export const agentmail: AgentMail = new AgentMail(components.agentmail, {
  onEvent: internal.email.handleAgentMailEvent,
});

const terminalStatuses = new Set([
  "delivered",
  "bounced",
  "complained",
  "rejected",
  "failed",
]);

type EventNotificationStatus = "sent" | "delivered" | "bounced" | "complained" | "rejected";
const eventNotificationStatusValidator = v.union(
  v.literal("sent"),
  v.literal("delivered"),
  v.literal("bounced"),
  v.literal("complained"),
  v.literal("rejected"),
);

export function notificationStatusForEvent(event: AgentMailEvent): EventNotificationStatus | null {
  switch (event.event_type) {
    case "message.sent": return "sent";
    case "message.delivered": return "delivered";
    case "message.bounced": return "bounced";
    case "message.complained": return "complained";
    case "message.rejected": return "rejected";
    case "message.received":
    case "domain.verified": return null;
  }
}

export function providerMessageIdForEvent(event: AgentMailEvent): string | null {
  const payload = event.message ?? event.send ?? event.delivery ?? event.bounce ?? event.complaint ?? event.reject;
  if (!payload || typeof payload !== "object" || !("message_id" in payload)) return null;
  return typeof payload.message_id === "string" ? payload.message_id : null;
}

export function shouldApplyEventStatus(current: string | undefined, next: EventNotificationStatus): boolean {
  if (current === "failed" || current === "bounced" || current === "complained" || current === "rejected") return false;
  if (next === "sent") return current === "queued" || current === "pending";
  if (next === "delivered") return current === "queued" || current === "pending" || current === "sent";
  // A late provider failure event must supersede a prior delivery.
  return true;
}

export function portalNotificationStatus(
  status: OutboundStatus,
): "queued" | "sent" | "delivered" | "bounced" | "complained" | "rejected" | "failed" {
  return status === "pending" ? "queued" : status;
}

function portalBaseUrl(): string {
  const configured = process.env.PORTAL_BASE_URL?.trim();
  if (!configured) return "https://roomscout.dev";
  try {
    const url = new URL(configured);
    if (url.protocol === "https:" || url.hostname === "localhost") return url.origin;
  } catch {
    // Invalid configuration falls back to the canonical controlled portal.
  }
  return "https://roomscout.dev";
}

async function refreshMessageStatus(ctx: MutationCtx, messageId: Id<"messages">): Promise<OutboundStatus | null> {
  const message = await ctx.db.get(messageId);
  if (!message || message.notificationProvider !== "agentmail" || !message.notificationEmailId) return null;
  const result = await agentmail.status(ctx, message.notificationEmailId as OutboundId);
  if (!result) return null;
  const status = portalNotificationStatus(result.status);
  if (terminalStatuses.has(message.notificationStatus ?? "") && message.notificationStatus !== status) return result.status;
  await ctx.db.patch(message._id, {
    notificationStatus: status,
    notificationProviderMessageId: result.agentmailMessageId ?? undefined,
  });
  return result.status;
}

export const enqueueMessageNotification = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.notificationEmailId) return null;
    try {
      await assertTestResetAllowsWrite(ctx, message.senderId);
    } catch {
      return null;
    }
    const thread = await ctx.db.get(message.threadId);
    if (!thread) return null;
    const listing = await ctx.db.get(thread.listingId);
    if (!listing) return null;
    const recipientId = message.senderId === thread.ownerId ? thread.participantId : thread.ownerId;
    const recipient = await ctx.db.query("portalUsers").withIndex("by_auth_subject", (q) => q.eq("authSubject", recipientId)).unique();
    if (!recipient?.emailAddress) {
      await ctx.db.patch(message._id, { notificationStatus: "skipped_recipient_unavailable" });
      return null;
    }
    const inboxId = process.env.AGENTMAIL_NOTIFICATION_INBOX_ID?.trim();
    if (!process.env.AGENTMAIL_API_KEY || !inboxId) {
      await ctx.db.patch(message._id, { notificationStatus: "skipped_unconfigured" });
      return null;
    }
    const content = newMessageEmail({
      counterpartyLabel: message.senderLabel,
      listingTitle: listing.title,
      threadUrl: `${portalBaseUrl()}/inbox/${thread._id}`,
    });
    try {
      const outboundId = await agentmail.sendMessage(ctx, inboxId, {
        to: recipient.emailAddress,
        subject: content.subject,
        html: content.html,
        text: content.text,
        headers: {
          "X-RoomScout-Event": "portal.message.created",
          "X-RoomScout-Thread-Id": String(thread._id),
          "X-RoomScout-Listing-Id": String(listing._id),
        },
      });
      await ctx.db.patch(message._id, {
        notificationEmailId: outboundId,
        notificationProvider: "agentmail",
        notificationStatus: "queued",
      });
      await ctx.scheduler.runAfter(30_000, internal.email.refreshNotificationStatus, {
        messageId: message._id,
        attempt: 1,
      });
    } catch (error) {
      console.error("Failed to enqueue portal message notification", {
        messageId: message._id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      await ctx.db.patch(message._id, { notificationStatus: "failed" });
    }
    return null;
  },
});

export const retrySkippedRecipientNotification = internalMutation({
  args: { messageId: v.id("messages") },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.notificationStatus !== "skipped_recipient_unavailable" || message.notificationEmailId) return false;
    const thread = await ctx.db.get(message.threadId);
    if (!thread) return false;
    const recipientId = message.senderId === thread.ownerId ? thread.participantId : thread.ownerId;
    const recipient = await ctx.db.query("portalUsers").withIndex("by_auth_subject", (q) => q.eq("authSubject", recipientId)).unique();
    if (!recipient?.emailAddress) return false;
    await ctx.db.patch(message._id, { notificationStatus: "pending" });
    await ctx.scheduler.runAfter(0, internal.email.enqueueMessageNotification, { messageId: message._id });
    return true;
  },
});

export const refreshNotificationStatus = internalMutation({
  args: { messageId: v.id("messages"), attempt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.attempt) || args.attempt < 1 || args.attempt > 40) return null;
    const status = await refreshMessageStatus(ctx, args.messageId);
    if ((status === "pending" || status === "sent") && args.attempt < 40) {
      await ctx.scheduler.runAfter(30_000, internal.email.refreshNotificationStatus, {
        messageId: args.messageId,
        attempt: args.attempt + 1,
      });
    }
    return null;
  },
});

export const handleAgentMailEvent = internalMutation({
  args: { event: vEvent },
  returns: v.null(),
  handler: async (ctx, args: { event: AgentMailEvent }) => {
    const providerMessageId = providerMessageIdForEvent(args.event);
    const status = notificationStatusForEvent(args.event);
    if (!providerMessageId || !status) return null;
    await ctx.scheduler.runAfter(0, internal.email.applyAgentMailEvent, {
      providerMessageId,
      status,
      attempt: 1,
    });
    return null;
  },
});

export const applyAgentMailEvent = internalMutation({
  args: {
    providerMessageId: v.string(),
    status: eventNotificationStatusValidator,
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.attempt) || args.attempt < 1 || args.attempt > 40) return null;
    const message = await ctx.db
      .query("messages")
      .withIndex("by_notification_provider_message_id", (q) => q.eq("notificationProviderMessageId", args.providerMessageId))
      .unique();
    if (!message) {
      // The provider webhook can race the component's send-completion callback.
      // Retry correlation only; the official component remains the sole send queue.
      if (args.attempt < 40) {
        await ctx.scheduler.runAfter(30_000, internal.email.applyAgentMailEvent, {
          ...args,
          attempt: args.attempt + 1,
        });
      }
      return null;
    }
    if (message.notificationProvider === "agentmail" && shouldApplyEventStatus(message.notificationStatus, args.status)) {
      await ctx.db.patch(message._id, { notificationStatus: args.status });
    }
    return null;
  },
});
