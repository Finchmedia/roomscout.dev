import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { InboxThreads } from "@/components/InboxThreads";
import { getConvexToken } from "@/lib/auth";
import { listMyThreads } from "@/lib/convex";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  await auth.protect();
  const token = await getConvexToken();
  const threads = await fetchQuery(listMyThreads, {}, { token });
  return <main className="narrow"><p className="eyebrow">Authenticated portal inbox</p><h1>Messages</h1><p className="lead">Threads are server-rendered for reliable automation, then stay live through Convex for the signed-in Clerk identity.</p><InboxThreads initialThreads={threads} /></main>;
}
