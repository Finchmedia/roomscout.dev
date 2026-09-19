"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ThreadDetail } from "@/lib/convex";
import { MessageComposer } from "@/components/MessageComposer";

export function ThreadConversation({ initialDetail, threadId }: { initialDetail: ThreadDetail; threadId: Id<"threads"> }) {
  const { isAuthenticated } = useConvexAuth();
  const liveDetail = useQuery(api.messages.getMine, isAuthenticated ? { threadId } : "skip");
  const providerStatus = useQuery(api.simulatedProviders.getThreadStatus, isAuthenticated ? { threadId } : "skip");
  const retryProvider = useMutation(api.simulatedProviders.retryMine);
  const [retryState, setRetryState] = useState<"idle" | "pending" | "unavailable">("idle");
  const detail = liveDetail === undefined ? initialDetail : liveDetail;

  async function retry() {
    if (!providerStatus?.canRetry || retryState === "pending") return;
    setRetryState("pending");
    try {
      const accepted = await retryProvider({ jobId: providerStatus.jobId });
      setRetryState(accepted ? "idle" : "unavailable");
    } catch {
      setRetryState("unavailable");
    }
  }

  if (!detail) {
    return <section className="thread-card" data-roomscout-thread-state="unavailable"><h1>Conversation unavailable</h1><p>This thread is no longer available for the current portal account.</p></section>;
  }

  const latestMessage = detail.messages.at(-1);
  return (
    <section className="thread-card" data-roomscout-last-message-at={detail.thread.lastMessageAt} data-roomscout-thread-id={detail.thread._id} data-roomscout-thread-state="ready">
      <span className="provider-receipt" data-roomscout-provider-message-id={latestMessage?._id} data-roomscout-provider-thread-id={detail.thread._id}>Thread stored by the controlled portal</span>
      <p className="eyebrow">Native thread · {detail.listing.title}</p>
      <h1 data-roomscout-subject>{detail.thread.subject}</h1>
      <span data-roomscout-participant>{detail.thread.counterparty}</span>
      <div className="messages" data-roomscout-message-list>
        {detail.messages.map((message) => (
          <article className={message.mine ? "mine" : "theirs"} data-roomscout-direction={message.mine ? "outbound" : "inbound"} data-roomscout-message-id={message._id} data-roomscout-sent-at={message.createdAt} key={message._id}>
            <header><strong data-roomscout-sender>{message.mine ? "You" : message.senderLabel}</strong><time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleString("en-GB", { timeZone: "Europe/Berlin" })}</time></header>
            <p data-roomscout-body>{message.body}</p>
          </article>
        ))}
      </div>
      {providerStatus?.status === "queued" ? (
        <p className="provider-receipt" data-roomscout-provider-automation-state="queued" role="status">
          Your message is queued for the fictional provider.
        </p>
      ) : providerStatus?.status === "processing" ? (
        <p className="provider-receipt" data-roomscout-provider-automation-state="processing" role="status">
          The fictional provider is preparing a reply.
        </p>
      ) : providerStatus?.status === "failed" ? (
        <section
          className="form-error"
          data-roomscout-provider-automation-state="failed"
          data-roomscout-provider-error-code={providerStatus.errorCode}
          role="alert"
        >
          <strong>Provider reply unavailable</strong>
          <p>
            {providerStatus.errorCode === "SIMULATED_PROVIDER_REPLY_LIMIT"
              ? "This demo conversation has reached its 12-reply limit. Continue with another fictional room."
              : providerStatus.errorCode === "SIMULATED_PROVIDER_ENGINE_DISABLED" || providerStatus.errorCode === "SIMULATED_PROVIDER_BINDING_DISABLED"
                ? "AI replies are currently unavailable for this demo room."
                : "The fictional provider could not finish this reply. No provider message was delivered."}
          </p>
          {providerStatus.canRetry ? (
            <button className="button secondary" disabled={retryState === "pending"} onClick={retry} type="button">
              {retryState === "pending" ? "Retrying…" : "Retry provider reply"}
            </button>
          ) : null}
          {retryState === "unavailable" ? <small>The retry is no longer available. Refresh the conversation status before trying again.</small> : null}
        </section>
      ) : null}
      <MessageComposer heading="Reply" reply threadId={threadId} />
    </section>
  );
}
