"use node";

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { assertResetDeployment } from "./testReset";

type ClerkUser = { id: string; primary_email_address_id?: string; email_addresses?: Array<{ id: string; email_address: string }> };

export const preview = internalAction({
  args: { keepListingId: v.id("listings"), keepOwnerId: v.string() },
  returns: v.object({ hash: v.string(), counts: v.record(v.string(), v.number()), subjects: v.array(v.object({ id: v.string(), email: v.string() })), clerkSubjects: v.array(v.object({ id: v.string(), email: v.string() })) }),
  handler: async (ctx, args): Promise<{ hash: string; counts: Record<string, number>; subjects: Array<{ id: string; email: string }>; clerkSubjects: Array<{ id: string; email: string }> }> => {
    assertResetDeployment();
    const plan = await ctx.runQuery(internal.testReset.preview, args);
    const secret = process.env.CLERK_SECRET_KEY;
    if (!secret) throw new ConvexError({ code: "RESET_CLERK_NOT_CONFIGURED" });
    const clerkSubjects: Array<{ id: string; email: string }> = [];
    let foundOwner = false;
    for (let offset = 0; ; offset += 100) {
      const response = await fetch(`https://api.clerk.com/v1/users?limit=100&offset=${offset}&order_by=created_at`, { headers: { Authorization: `Bearer ${secret}` } });
      if (!response.ok) throw new ConvexError({ code: "RESET_CLERK_LIST_FAILED", status: response.status });
      const users = await response.json() as ClerkUser[];
      if (!Array.isArray(users)) throw new ConvexError({ code: "RESET_CLERK_LIST_INVALID" });
      for (const user of users) {
        if (user.id === args.keepOwnerId) { foundOwner = true; continue; }
        const email = user.email_addresses?.find(e => e.id === user.primary_email_address_id)?.email_address;
        if (!email) throw new ConvexError({ code: "RESET_CLERK_EMAIL_MISSING" });
        clerkSubjects.push({ id: user.id, email });
      }
      if (users.length < 100) break;
    }
    if (!foundOwner) throw new ConvexError({ code: "RESET_WRONG_CLERK_INSTANCE" });
    return { ...plan, clerkSubjects };
  },
});

export async function deleteVerifiedClerkTestAccount(input: { id: string; email: string; keepOwnerId: string; secret: string }) {
  if (input.id === input.keepOwnerId || !input.id.startsWith("user_")) throw new ConvexError({ code: "RESET_CLERK_TARGET_INVALID" });
  const url = `https://api.clerk.com/v1/users/${encodeURIComponent(input.id)}`;
  const headers = { Authorization: `Bearer ${input.secret}` };
  const existing = await fetch(url, { headers });
  if (existing.status === 404) return;
  if (!existing.ok) throw new ConvexError({ code: "RESET_CLERK_LOOKUP_FAILED", status: existing.status });
  const user = await existing.json() as { id?: string; primary_email_address_id?: string; email_addresses?: Array<{ id: string; email_address: string }> };
  const email = user.email_addresses?.find(e => e.id === user.primary_email_address_id)?.email_address;
  if (user.id !== input.id || email?.toLowerCase() !== input.email.toLowerCase()) throw new ConvexError({ code: "RESET_CLERK_IDENTITY_MISMATCH" });
  const removed = await fetch(url, { method: "DELETE", headers });
  if (!removed.ok && removed.status !== 404) throw new ConvexError({ code: "RESET_CLERK_DELETE_FAILED", status: removed.status });
}

export const resume = internalAction({
  args: { resetId: v.id("testResets") }, returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    assertResetDeployment();
    const job = await ctx.runQuery(internal.testReset.get, args);
    if (!job || job.completed) return null;
    const pending = job.subjects.filter(s => !job.deletedSubjects.includes(s.id));
    const secret = process.env.CLERK_SECRET_KEY;
    if (pending.some(s => s.id.startsWith("user_")) && !secret) throw new ConvexError({ code: "RESET_CLERK_NOT_CONFIGURED" });
    // Checkpoints survive action failures/timeouts. Never remove local identity
    // metadata before the external account deletion has succeeded.
    for (const subject of pending.slice(0, 20)) {
      if (subject.id.startsWith("user_")) {
        await deleteVerifiedClerkTestAccount({ ...subject, keepOwnerId: job.keepOwnerId, secret: secret! });
      } else if (!subject.id.startsWith("controlled-") && !subject.id.startsWith("proof-")) {
        throw new ConvexError({ code: "RESET_UNKNOWN_IDENTITY_PROVIDER" });
      }
      await ctx.runMutation(internal.testReset.accountDeleted, { resetId: args.resetId, subject: subject.id });
    }
    if (pending.length > 20) {
      await ctx.scheduler.runAfter(0, internal.testResetActions.resume, args);
      return null;
    }
    for (const table of ["messages", "threads", "controlledReceipts", "controlledRuns", "listings", "portalUsers"] as const) {
      let cursor: string | null = null;
      while (true) {
        const page: { isDone: boolean; continueCursor: string; deleted: number } = await ctx.runMutation(internal.testReset.deletePage, { ...args, table, cursor });
        if (page.isDone) break;
        cursor = page.continueCursor;
      }
    }
    await ctx.runMutation(internal.testReset.complete, args);
    return null;
  },
});
