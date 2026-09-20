import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { agentmail } from "./email";
import { normalizeResetEmailAddresses } from "./participantReset";

const http = httpRouter();

http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    return await agentmail.handleWebhook(
      ctx as unknown as Parameters<typeof agentmail.handleWebhook>[0],
      request,
    );
  }),
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Constant-time comparison without Node's crypto: both values are hashed to a
 * fixed length first, so neither the length nor an early mismatch leaks timing. */
async function secretMatches(provided: string | null, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [providedDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided ?? "")),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedDigest);
  const right = new Uint8Array(expectedDigest);
  let difference = provided === null ? 1 : 0;
  for (let index = 0; index < left.length; index++) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

/** Called by the RoomScout app when a band resets its portal history. Wipes the
 * matched participants' conversations asynchronously; accounts and listings stay. */
http.route({
  path: "/participant-reset",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.PORTAL_RESET_SECRET?.trim();
    if (!secret) return json(503, { error: "PORTAL_RESET_UNCONFIGURED" });
    if (!(await secretMatches(request.headers.get("X-RoomScout-Reset-Secret"), secret))) {
      console.warn(JSON.stringify({ event: "participant_reset_rejected", reason: "unauthorized" }));
      return json(401, { error: "UNAUTHORIZED" });
    }
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return json(400, { error: "INVALID_JSON" });
    }
    const emailAddresses = normalizeResetEmailAddresses(payload);
    if (!emailAddresses) return json(400, { error: "INVALID_EMAIL_ADDRESSES" });
    const result = await ctx.runMutation(internal.participantReset.startByEmailAddresses, { emailAddresses });
    // Never log the addresses: only how many accounts matched and which resets run.
    console.log(JSON.stringify({ event: "participant_reset_requested", matched: result.matched, resetIds: result.resetIds }));
    return json(result.matched > 0 ? 202 : 200, result);
  }),
});

export default http;
