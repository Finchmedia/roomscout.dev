"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ThreadDetail } from "@/lib/convex";
import { MessageComposer } from "@/components/MessageComposer";

export function ThreadConversation({ initialDetail, threadId }: { initialDetail: ThreadDetail; threadId: Id<"threads"> }) {
  const { isAuthenticated } = useConvexAuth();
  const liveDetail = useQuery(api.messages.getMine, isAuthenticated ? { threadId } : "skip");
  const detail = liveDetail === undefined ? initialDetail : liveDetail;

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
      <MessageComposer heading="Reply" reply threadId={threadId} />
    </section>
  );
}
