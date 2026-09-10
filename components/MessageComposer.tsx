"use client";

import { useAction, useMutation } from "convex/react";
import Link from "next/link";
import { useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { portalActionError } from "@/lib/portal-action-errors";

type MessageActionState = {
  status: "idle" | "pending" | "error" | "sent";
  code?: string;
  message?: string;
  requestId?: string;
  threadId?: Id<"threads">;
  messageId?: Id<"messages">;
  notificationIdentityWarning?: boolean;
};

type MessageComposerProps = {
  description?: string;
  heading: string;
} & (
  | { listingId: Id<"listings">; reply?: false; threadId?: never }
  | { listingId?: never; reply: true; threadId: Id<"threads"> }
);

const initialState: MessageActionState = { status: "idle" };

export function MessageComposer(props: MessageComposerProps) {
  const { description, heading } = props;
  const reply = props.reply === true;
  const startThread = useMutation(api.messages.start);
  const sendReply = useMutation(api.messages.send);
  const syncPortalIdentity = useAction(api.portalIdentity.syncMe);
  const formRef = useRef<HTMLFormElement>(null);
  const [state, setState] = useState<MessageActionState>(initialState);
  const pending = state.status === "pending";

  async function submit(formData: FormData) {
    const requestId = crypto.randomUUID();
    setState({ status: "pending", requestId });
    try {
      const senderLabel = String(formData.get("senderLabel") ?? "");
      const body = String(formData.get("body") ?? "");
      let notificationIdentityWarning = false;
      try {
        await syncPortalIdentity({});
      } catch {
        notificationIdentityWarning = true;
      }
      const result = props.reply
        ? await sendReply({ threadId: props.threadId, body })
        : await startThread({ listingId: props.listingId, participantLabel: senderLabel, body });
      formRef.current?.reset();
      setState({
        status: "sent",
        requestId,
        threadId: result.threadId,
        messageId: result.messageId,
        notificationIdentityWarning,
      });
      console.info(JSON.stringify({ event: reply ? "portal_reply_sent" : "portal_message_started", requestId, threadId: result.threadId, messageId: result.messageId }));
    } catch (error) {
      const safe = portalActionError(error);
      console.error(JSON.stringify({ event: reply ? "portal_reply_failed" : "portal_message_failed", requestId, code: safe.code }));
      setState({ status: "error", ...safe, requestId });
    }
  }

  return (
    <section className={reply ? undefined : "message-card"}>
      {reply ? null : <p className="eyebrow">Native portal message</p>}
      <h2>{heading}</h2>
      {description ? <p>{description}</p> : null}
      <form
        action={submit}
        aria-describedby={state.status === "error" ? "message-action-error" : undefined}
        className={reply ? "reply-form" : undefined}
        data-roomscout-compose={reply ? "reply" : "new-message"}
        ref={formRef}
      >
        <label>
          {reply ? "Your portal identity" : "Your public name"}
          <input
            aria-describedby={reply ? "reply-identity-note" : undefined}
            data-roomscout-write="sender-label"
            disabled={pending}
            name={reply ? "senderLabelHint" : "senderLabel"}
            placeholder={reply ? "Managed by your signed-in account" : undefined}
            required={!reply}
            maxLength={100}
          />
        </label>
        {reply ? <p className="form-note" id="reply-identity-note">Replies always use the identity already stored for this portal thread.</p> : null}
        <label>
          {reply ? "Reply" : "Message"}
          <textarea data-roomscout-write="body" disabled={pending} name="body" required maxLength={5000} rows={reply ? 6 : 7} />
        </label>
        {state.status === "error" ? (
          <p className="form-error" data-roomscout-error-code={state.code} data-roomscout-write-result="error" id="message-action-error" role="alert">
            {state.message}
            {state.requestId ? <small> Reference: {state.requestId}</small> : null}
          </p>
        ) : null}
        {state.status === "sent" ? (
          <p
            className="form-success"
            data-roomscout-provider-message-id={state.messageId}
            data-roomscout-provider-thread-id={state.threadId}
            data-roomscout-write-result="sent"
            role="status"
          >
            Message stored in the portal.
            {state.threadId ? <Link href={`/inbox/${state.threadId}`}> Open conversation</Link> : null}
            {state.notificationIdentityWarning ? (
              <small> Email notification identity could not be refreshed; the portal message was still stored.</small>
            ) : null}
          </p>
        ) : null}
        <button className="button" data-roomscout-write="send" disabled={pending} type="submit">
          {pending ? "Sending…" : reply ? "Send reply" : "Send portal message"}
        </button>
      </form>
    </section>
  );
}
