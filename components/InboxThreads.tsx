"use client";

import { useConvexAuth, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import type { ThreadSummary } from "@/lib/convex";

export function InboxThreads({ initialThreads }: { initialThreads: ThreadSummary[] }) {
  const { isAuthenticated } = useConvexAuth();
  const liveThreads = useQuery(api.messages.listMine, isAuthenticated ? {} : "skip");
  const threads = liveThreads ?? initialThreads;

  return threads.length ? (
    <div className="thread-list" data-roomscout-inbox-state="ready">
      {threads.map((thread) => (
        <Link
          data-roomscout-last-message-at={thread.lastMessageAt}
          data-roomscout-thread-id={thread._id}
          href={`/inbox/${thread._id}`}
          key={thread._id}
        >
          <strong data-roomscout-subject>{thread.subject}</strong>
          <span data-roomscout-participant>{thread.counterparty}</span>
          <time dateTime={new Date(thread.lastMessageAt).toISOString()}>{new Date(thread.lastMessageAt).toLocaleString("en-GB", { timeZone: "Europe/Berlin" })}</time>
        </Link>
      ))}
    </div>
  ) : (
    <div className="empty" data-roomscout-inbox-state="empty">
      <h2>No messages yet</h2>
      <p>Start a conversation from a public listing or wait for a reply to one of your listings.</p>
    </div>
  );
}
