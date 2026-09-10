import { describe, expect, it } from "vitest";
import { newMessageEmail } from "./emailTemplates";

describe("new message email", () => {
  it("renders a useful agent trigger without leaking a message body", () => {
    const result = newMessageEmail({
      counterpartyLabel: "The Cooks",
      listingTitle: "Tuesday rehearsal slot",
      threadUrl: "https://roomscout.dev/inbox/thread-123",
    });

    expect(result.subject).toBe("New message about Tuesday rehearsal slot");
    expect(result.text).toContain("https://roomscout.dev/inbox/thread-123");
    expect(result.html).toContain("Open conversation");
    expect(result.text).toContain("intentionally not copied");
  });

  it("escapes untrusted portal labels in HTML", () => {
    const result = newMessageEmail({
      counterpartyLabel: '<script>alert("sender")</script>',
      listingTitle: "Room & drums",
      threadUrl: "https://roomscout.dev/inbox/thread-123",
    });

    expect(result.html).not.toContain("<script>");
    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("Room &amp; drums");
  });
});
