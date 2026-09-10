import { describe, expect, it } from "vitest";
import { toSendPayload } from "@agentmail/convex";
import {
  notificationStatusForEvent,
  portalNotificationStatus,
  providerMessageIdForEvent,
  shouldApplyEventStatus,
} from "./email";
import { newMessageEmail } from "./emailTemplates";

describe("AgentMail portal notifications", () => {
  it("preserves the canonical template and exact RoomScout headers", () => {
    const content = newMessageEmail({
      counterpartyLabel: "The Cooks",
      listingTitle: "Evening room slot",
      threadUrl: "https://roomscout.dev/inbox/thread-123",
    });
    expect(toSendPayload({
      to: "band@agentmail.to",
      ...content,
      headers: {
        "X-RoomScout-Event": "portal.message.created",
        "X-RoomScout-Thread-Id": "thread-123",
        "X-RoomScout-Listing-Id": "listing-456",
      },
    })).toEqual({
      to: "band@agentmail.to",
      ...content,
      headers: {
        "X-RoomScout-Event": "portal.message.created",
        "X-RoomScout-Thread-Id": "thread-123",
        "X-RoomScout-Listing-Id": "listing-456",
      },
    });
    expect(content.text).toContain("https://roomscout.dev/inbox/thread-123");
    expect(content.html).toContain("https://roomscout.dev/inbox/thread-123");
  });

  it("maps every component status without inventing delivery", () => {
    expect(portalNotificationStatus("pending")).toBe("queued");
    for (const status of ["sent", "delivered", "bounced", "complained", "rejected", "failed"] as const) {
      expect(portalNotificationStatus(status)).toBe(status);
    }
  });

  it("correlates webhook events and preserves monotonic terminal states", () => {
    const complaint = {
      type: "event",
      event_type: "message.complained",
      event_id: "event-1",
      complaint: { message_id: "agentmail-message-1" },
    } as const;
    expect(providerMessageIdForEvent(complaint)).toBe("agentmail-message-1");
    expect(notificationStatusForEvent(complaint)).toBe("complained");
    expect(shouldApplyEventStatus("delivered", "complained")).toBe(true);
    expect(shouldApplyEventStatus("complained", "delivered")).toBe(false);
    expect(shouldApplyEventStatus("bounced", "sent")).toBe(false);
  });
});
