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

  simulatedProviderListings: defineTable({
    listingId: v.id("listings"),
    seedKey: v.string(),
    scenarioId: v.string(),
    scenarioVersion: v.number(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_listing_id", ["listingId"])
    .index("by_seed_key", ["seedKey"]),

  simulatedProviderThreads: defineTable({
    threadId: v.id("threads"),
    listingId: v.id("listings"),
    participantId: v.string(),
    scenarioId: v.string(),
    scenarioVersion: v.number(),
    agentThreadId: v.string(),
    locale: v.union(v.literal("en"), v.literal("de")),
    stateKey: v.string(),
    replyCount: v.number(),
    activeJobId: v.optional(v.id("simulatedProviderJobs")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread_id", ["threadId"])
    .index("by_listing_id_and_participant_id", ["listingId", "participantId"]),

  simulatedProviderJobs: defineTable({
    threadId: v.id("threads"),
    inputMessageId: v.id("messages"),
    locale: v.union(v.literal("en"), v.literal("de")),
    agentInputMessageId: v.optional(v.string()),
    agentResponseMessageId: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    attemptCount: v.number(),
    manualRetryCount: v.number(),
    workId: v.optional(v.string()),
    claimToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    responseMessageId: v.optional(v.id("messages")),
    errorCode: v.optional(v.string()),
    /** "REPAIRED:<code>" or "FALLBACK:<code>" on a completed job whose first draft failed content validation. */
    qualityNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_input_message_id", ["inputMessageId"])
    .index("by_thread_id_and_created_at", ["threadId", "createdAt"])
    .index("by_thread_id_and_status_and_created_at", ["threadId", "status", "createdAt"])
    .index("by_status_and_updated_at", ["status", "updatedAt"]),

  /** One participant's conversation wipe on this portal, requested by the RoomScout
   * app over POST /participant-reset. The pager deletes in bounded pages; the row
   * is the progress checkpoint and the idempotency key while it is not completed. */
  participantResets: defineTable({
    participantId: v.string(),
    status: v.union(v.literal("scheduled"), v.literal("running"), v.literal("completed")),
    /** The last kind of document a page worked on; "done" once nothing is left. */
    stage: v.union(
      v.literal("pending"),
      v.literal("jobs"),
      v.literal("runtime"),
      v.literal("messages"),
      v.literal("threads"),
      v.literal("done"),
    ),
    deletedDocumentCount: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  }).index("by_participant_and_created_at", ["participantId", "createdAt"]),

  portalUsers: defineTable({
    authSubject: v.string(),
    /** Always stored lowercased (see portalUsers.ts), so equality lookups are case-insensitive. */
    emailAddress: v.string(),
    displayName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_auth_subject", ["authSubject"])
    .index("by_email_address", ["emailAddress"]),

  listings: defineTable({
    ownerId: v.string(),
    ownerLabel: v.string(),
    side: v.union(v.literal("supply"), v.literal("demand")),
    title: v.string(),
    city: v.string(),
    district: v.optional(v.string()),
    street: v.optional(v.string()),
    description: v.string(),
    imageUrl: v.optional(v.string()),
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
