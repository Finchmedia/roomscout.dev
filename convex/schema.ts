import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  testResets: defineTable({
    key: v.string(),
    keepListingId: v.id("listings"),
    keepOwnerId: v.string(),
    status: v.union(v.literal("deleting_accounts"), v.literal("deleting_data"), v.literal("completed")),
    subjects: v.array(v.object({ id: v.string(), email: v.string() })),
    deletedSubjects: v.array(v.string()),
    createdAt: v.number(),
  }).index("by_key", ["key"]).index("by_status", ["status"]),
  retiredTestIdentities: defineTable({
    authSubject: v.string(),
  }).index("by_auth_subject", ["authSubject"]),
  controlledRuns: defineTable({
    runKey: v.string(),
    scenario: v.union(v.literal("happy_path"), v.literal("changed_conditions"), v.literal("notification_recovery")),
    listingId: v.id("listings"),
    expectedInbox: v.string(),
    expiresAt: v.number(),
    closedAt: v.optional(v.number()),
    replyCount: v.number(),
  }).index("by_run_key", ["runKey"]),

  controlledReceipts: defineTable({
    runId: v.id("controlledRuns"),
    requestKey: v.string(),
    threadId: v.id("threads"),
    messageId: v.id("messages"),
    body: v.string(),
  }).index("by_run_and_request", ["runId", "requestKey"]),

  portalUsers: defineTable({
    authSubject: v.string(),
    emailAddress: v.string(),
    displayName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_auth_subject", ["authSubject"]),

  listings: defineTable({
    ownerId: v.string(),
    ownerLabel: v.string(),
    side: v.union(v.literal("supply"), v.literal("demand")),
    title: v.string(),
    city: v.string(),
    district: v.optional(v.string()),
    description: v.string(),
    priceEur: v.optional(v.number()),
    pricePeriod: v.optional(v.union(v.literal("hour"), v.literal("month"))),
    status: v.union(v.literal("published"), v.literal("closed")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status_and_updated_at", ["status", "updatedAt"])
    .index("by_status_and_side_and_updated_at", ["status", "side", "updatedAt"])
    .index("by_owner_and_updated_at", ["ownerId", "updatedAt"]),

  threads: defineTable({
    listingId: v.id("listings"),
    ownerId: v.string(),
    participantId: v.string(),
    participantLabel: v.string(),
    subject: v.string(),
    lastMessageAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_listing_and_participant", ["listingId", "participantId"])
    .index("by_owner_and_last_message_at", ["ownerId", "lastMessageAt"])
    .index("by_participant_and_last_message_at", ["participantId", "lastMessageAt"]),

  messages: defineTable({
    threadId: v.id("threads"),
    senderId: v.string(),
    senderLabel: v.string(),
    body: v.string(),
    notificationEmailId: v.optional(v.string()),
    notificationProvider: v.optional(v.union(v.literal("resend"), v.literal("agentmail"))),
    notificationProviderMessageId: v.optional(v.string()),
    notificationStatus: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("queued"),
        v.literal("sent"),
        v.literal("delivered"),
        v.literal("delivery_delayed"),
        v.literal("bounced"),
        v.literal("complained"),
        v.literal("rejected"),
        v.literal("failed"),
        v.literal("skipped_unconfigured"),
        v.literal("skipped_recipient_unavailable"),
      ),
    ),
    createdAt: v.number(),
  })
    .index("by_thread_and_created_at", ["threadId", "createdAt"])
    .index("by_notification_email_id", ["notificationEmailId"])
    .index("by_notification_provider_message_id", ["notificationProviderMessageId"])
    .index("by_notification_provider_and_status", ["notificationProvider", "notificationStatus"]),
});
