import { makeFunctionReference } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";

export type PublicListing = {
  _id: Id<"listings">;
  ownerLabel: string;
  side: "supply" | "demand";
  title: string;
  city: string;
  district?: string;
  description: string;
  priceEur?: number;
  pricePeriod?: "hour" | "month";
  status: "published" | "closed";
  createdAt: number;
  updatedAt: number;
};

export const listPublicListings = makeFunctionReference<
  "query",
  { side?: "supply" | "demand"; limit?: number },
  PublicListing[]
>("listings:listPublic");

export const getPublicListing = makeFunctionReference<
  "query",
  { listingId: Id<"listings"> },
  PublicListing | null
>("listings:getPublic");

export const createListing = makeFunctionReference<
  "mutation",
  {
    ownerLabel: string;
    side: "supply" | "demand";
    title: string;
    city: string;
    district?: string;
    description: string;
    priceEur?: number;
    pricePeriod?: "hour" | "month";
  },
  Id<"listings">
>("listings:create");

export const startThread = makeFunctionReference<
  "mutation",
  { listingId: Id<"listings">; participantLabel: string; body: string },
  { threadId: Id<"threads">; messageId: Id<"messages"> }
>("messages:start");

export const sendThreadMessage = makeFunctionReference<
  "mutation",
  { threadId: Id<"threads">; body: string },
  { threadId: Id<"threads">; messageId: Id<"messages"> }
>("messages:send");

export type ThreadSummary = {
  _id: Id<"threads">;
  listingId: Id<"listings">;
  subject: string;
  counterparty: string;
  lastMessageAt: number;
};

export const listMyThreads = makeFunctionReference<"query", Record<string, never>, ThreadSummary[]>("messages:listMine");

export type ThreadDetail = {
  thread: { _id: Id<"threads">; subject: string; listingId: Id<"listings">; counterparty: string; lastMessageAt: number };
  listing: { title: string; ownerLabel: string };
  messages: Array<{ _id: Id<"messages">; senderLabel: string; mine: boolean; body: string; createdAt: number }>;
};

export const getMyThread = makeFunctionReference<"query", { threadId: Id<"threads"> }, ThreadDetail | null>("messages:getMine");
