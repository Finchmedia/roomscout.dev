import type { UserIdentity } from "convex/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import { internalMutation, mutation } from "./_generated/server";
import { assertTestResetAllowsWrite } from "./testReset";

function normalizedEmail(identity: UserIdentity): string | undefined {
  if (identity.emailVerified === false || typeof identity.email !== "string") {
    return undefined;
  }

  const emailAddress = identity.email.trim().toLowerCase();
  if (
    emailAddress.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAddress)
  ) {
    return undefined;
  }
  return emailAddress;
}

function displayName(identity: UserIdentity): string | undefined {
  const value = identity.name ?? identity.preferredUsername;
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 100)
    : undefined;
}

export async function upsertPortalUser(
  ctx: MutationCtx,
  identity: UserIdentity,
): Promise<{ emailAvailable: boolean }> {
  await assertTestResetAllowsWrite(ctx, identity.subject);
  const emailAddress = normalizedEmail(identity);
  const name = displayName(identity);
  const existing = await ctx.db
    .query("portalUsers")
    .withIndex("by_auth_subject", (q) => q.eq("authSubject", identity.subject))
    .unique();

  if (!emailAddress) {
    return { emailAvailable: existing?.emailAddress !== undefined };
  }

  const now = Date.now();
  if (!existing) {
    await ctx.db.insert("portalUsers", {
      authSubject: identity.subject,
      emailAddress,
      displayName: name,
      createdAt: now,
      updatedAt: now,
    });
  } else if (
    existing.emailAddress !== emailAddress ||
    existing.displayName !== name
  ) {
    await ctx.db.patch(existing._id, {
      emailAddress,
      displayName: name,
      updatedAt: now,
    });
  }

  return { emailAvailable: true };
}

export const syncVerifiedIdentity = internalMutation({
  args: {
    authSubject: v.string(),
    emailAddress: v.string(),
    displayName: v.optional(v.string()),
  },
  returns: v.object({ emailAvailable: v.boolean() }),
  handler: async (ctx, args) => {
    return await upsertPortalUser(ctx, {
      subject: args.authSubject,
      tokenIdentifier: args.authSubject,
      issuer: "clerk-server-lookup",
      email: args.emailAddress,
      emailVerified: true,
      name: args.displayName,
    });
  },
});

// Kept for compatibility with clients deployed before server-side Clerk lookup.
// It remains useful when the configured JWT contains a verified email claim.
export const syncMe = mutation({
  args: {},
  returns: v.object({ emailAvailable: v.boolean() }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { emailAvailable: false };
    return await upsertPortalUser(ctx, identity);
  },
});
