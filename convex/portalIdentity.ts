"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { action } from "./_generated/server";

type ClerkEmailAddress = {
  id?: unknown;
  email_address?: unknown;
  verification?: { status?: unknown } | null;
};

type ClerkUser = {
  email_addresses?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  primary_email_address_id?: unknown;
  username?: unknown;
};

function verifiedPrimaryEmail(user: ClerkUser): string | null {
  if (!Array.isArray(user.email_addresses) || typeof user.primary_email_address_id !== "string") {
    return null;
  }
  const primary = (user.email_addresses as ClerkEmailAddress[]).find(
    (candidate) => candidate.id === user.primary_email_address_id,
  );
  if (
    typeof primary?.email_address !== "string" ||
    primary.verification?.status !== "verified"
  ) {
    return null;
  }
  const normalized = primary.email_address.trim().toLowerCase();
  return normalized.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
}

function normalizedVerifiedClaim(identity: {
  email?: unknown;
  emailVerified?: unknown;
}): string | null {
  if (identity.emailVerified !== true || typeof identity.email !== "string") {
    return null;
  }
  const normalized = identity.email.trim().toLowerCase();
  return normalized.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : null;
}

function clerkDisplayName(user: ClerkUser): string | undefined {
  const fullName = [user.first_name, user.last_name]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .join(" ")
    .trim();
  const value = fullName || (typeof user.username === "string" ? user.username.trim() : "");
  return value ? value.slice(0, 100) : undefined;
}

export const syncMe = action({
  args: {},
  returns: v.object({ emailAvailable: v.boolean() }),
  handler: async (ctx): Promise<{ emailAvailable: boolean }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });

    const claimedEmail = normalizedVerifiedClaim(identity);
    if (claimedEmail) {
      return await ctx.runMutation(internal.portalUsers.syncVerifiedIdentity, {
        authSubject: identity.subject,
        emailAddress: claimedEmail,
        displayName:
          typeof identity.name === "string" && identity.name.trim()
            ? identity.name.trim().slice(0, 100)
            : undefined,
      });
    }

    const secretKey = process.env.CLERK_SECRET_KEY?.trim();
    if (!secretKey) {
      throw new ConvexError({ code: "IDENTITY_SYNC_UNCONFIGURED" });
    }

    let response: Response;
    try {
      response = await fetch(
        `https://api.clerk.com/v1/users/${encodeURIComponent(identity.subject)}`,
        {
          headers: { Authorization: `Bearer ${secretKey}` },
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new ConvexError({ code: "IDENTITY_SYNC_UNAVAILABLE" });
    }
    if (!response.ok) {
      throw new ConvexError({ code: "IDENTITY_SYNC_UNAVAILABLE" });
    }

    const user = (await response.json()) as ClerkUser;
    const emailAddress = verifiedPrimaryEmail(user);
    if (!emailAddress) {
      throw new ConvexError({ code: "VERIFIED_EMAIL_UNAVAILABLE" });
    }

    return await ctx.runMutation(internal.portalUsers.syncVerifiedIdentity, {
      authSubject: identity.subject,
      emailAddress,
      displayName: clerkDisplayName(user),
    });
  },
});
