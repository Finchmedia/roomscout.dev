import { auth } from "@clerk/nextjs/server";

export async function getConvexToken(): Promise<string> {
  const session = await auth();
  if (!session.isAuthenticated) throw new Error("UNAUTHENTICATED");
  const token = await session.getToken({ template: "convex" });
  if (!token) throw new Error("CONVEX_TOKEN_UNAVAILABLE");
  return token;
}
