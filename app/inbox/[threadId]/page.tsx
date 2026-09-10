import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { getConvexToken } from "@/lib/auth";
import { getMyThread } from "@/lib/convex";
import { ThreadConversation } from "@/components/ThreadConversation";

export const dynamic = "force-dynamic";

export default async function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  await auth.protect();
  const { threadId: rawThreadId } = await params;
  const threadId = rawThreadId as Id<"threads">;
  const token = await getConvexToken();
  const detail = await fetchQuery(getMyThread, { threadId }, { token });
  if (!detail) notFound();
  return <main className="narrow"><Link className="back" href="/inbox">← Inbox</Link><ThreadConversation initialDetail={detail} threadId={threadId} /></main>;
}
