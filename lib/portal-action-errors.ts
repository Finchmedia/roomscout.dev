import { ZodError } from "zod";

export type PortalActionError = {
  code: string;
  message: string;
};

function nestedCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const data = "data" in error ? error.data : undefined;
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && "code" in data && typeof data.code === "string") {
    return data.code;
  }
  return undefined;
}

export function portalActionError(error: unknown): PortalActionError {
  if (error instanceof ZodError) {
    return {
      code: "INVALID_FORM",
      message: "Please check the highlighted fields and try again.",
    };
  }

  const rawMessage = error instanceof Error ? error.message : String(error);
  const code = nestedCode(error) ?? [
    "UNAUTHENTICATED",
    "CONVEX_TOKEN_UNAVAILABLE",
    "CANNOT_MESSAGE_OWN_LISTING",
    "LISTING_NOT_FOUND",
    "THREAD_NOT_FOUND",
    "INVALID_MESSAGE",
  ].find((candidate) => rawMessage.includes(candidate));

  switch (code) {
    case "UNAUTHENTICATED":
    case "CONVEX_TOKEN_UNAVAILABLE":
      return {
        code: "SESSION_EXPIRED",
        message: "Your portal session expired. Sign in again, then retry the message.",
      };
    case "CANNOT_MESSAGE_OWN_LISTING":
      return {
        code,
        message: "You cannot message your own listing from the same portal account.",
      };
    case "LISTING_NOT_FOUND":
      return {
        code,
        message: "This listing is no longer available.",
      };
    case "THREAD_NOT_FOUND":
      return {
        code,
        message: "This conversation is unavailable for the current portal account.",
      };
    case "INVALID_MESSAGE":
      return {
        code,
        message: "Add your name and a non-empty message before sending.",
      };
    default:
      return {
        code: "MESSAGE_SEND_FAILED",
        message: "The portal could not confirm the message. Nothing will be retried automatically; please try again once.",
      };
  }
}
