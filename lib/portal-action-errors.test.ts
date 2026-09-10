import { ConvexError } from "convex/values";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { portalActionError } from "./portal-action-errors";

describe("portal action errors", () => {
  it("maps structured Convex errors to specific safe guidance", () => {
    expect(portalActionError(new ConvexError({ code: "CANNOT_MESSAGE_OWN_LISTING" }))).toEqual({
      code: "CANNOT_MESSAGE_OWN_LISTING",
      message: "You cannot message your own listing from the same portal account.",
    });
  });

  it("maps expired auth without exposing provider details", () => {
    expect(portalActionError(new Error("CONVEX_TOKEN_UNAVAILABLE"))).toEqual({
      code: "SESSION_EXPIRED",
      message: "Your portal session expired. Sign in again, then retry the message.",
    });
  });

  it("maps invalid form data and unknown failures", () => {
    const invalid = z.object({ body: z.string().min(1) }).safeParse({ body: "" });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(portalActionError(invalid.error).code).toBe("INVALID_FORM");
    }
    expect(portalActionError(new Error("provider detail"))).toEqual({
      code: "MESSAGE_SEND_FAILED",
      message: "The portal could not confirm the message. Nothing will be retried automatically; please try again once.",
    });
  });
});
