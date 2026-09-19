import { beforeEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Id } from "../convex/_generated/dataModel";
import { InboxThreads } from "./InboxThreads";
import { ThreadConversation } from "./ThreadConversation";

const mocks = vi.hoisted(() => ({ authenticated: false, query: vi.fn(), mutation: vi.fn(), retry: vi.fn() }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: mocks.authenticated, isLoading: !mocks.authenticated }),
  useQuery: mocks.query,
  useMutation: mocks.mutation,
}));
vi.mock("@/convex/_generated/api", () => ({ api: {
  messages: { listMine: "list", getMine: "get" },
  simulatedProviders: { getThreadStatus: "provider-status", retryMine: "provider-retry" },
} }));
vi.mock("@/components/MessageComposer", () => ({ MessageComposer: () => null }));

beforeEach(() => {
  mocks.authenticated = false;
  mocks.query.mockReset();
  mocks.retry.mockReset();
  mocks.mutation.mockReset().mockReturnValue(mocks.retry);
});

test("private inbox waits for Convex authentication and keeps server-rendered state", () => {
  const html = renderToStaticMarkup(<InboxThreads initialThreads={[]} />);
  expect(mocks.query).toHaveBeenCalledWith("list", "skip");
  expect(html).toContain('data-roomscout-inbox-state="empty"');
});

test("inbox subscribes after authentication", () => {
  mocks.authenticated = true;
  renderToStaticMarkup(<InboxThreads initialThreads={[]} />);
  expect(mocks.query).toHaveBeenCalledWith("list", {});
});

test("thread waits for authentication without discarding the server-rendered messages", () => {
  const threadId = "test-thread" as Id<"threads">;
  const listingId = "test-listing" as Id<"listings">;
  const html = renderToStaticMarkup(<ThreadConversation threadId={threadId} initialDetail={{
    thread: { _id: threadId, listingId, subject: "Test conversation", counterparty: "Test owner", lastMessageAt: 0 },
    listing: { title: "Test room", ownerLabel: "Test owner" },
    messages: [{ _id: "test-message" as Id<"messages">, senderLabel: "Test owner", mine: false, body: "Test reply", createdAt: 0 }],
  }} />);
  expect(mocks.query).toHaveBeenCalledWith("get", "skip");
  expect(mocks.query).toHaveBeenCalledWith("provider-status", "skip");
  expect(mocks.mutation).toHaveBeenCalledWith("provider-retry");
  expect(html).toContain('data-roomscout-thread-state="ready"');
  expect(html).toContain("Test reply");
  expect(html).toContain('dateTime="1970-01-01T00:00:00.000Z"');
});

test("thread shows a retryable provider failure outside the provider message receipts", () => {
  mocks.authenticated = true;
  const threadId = "test-thread" as Id<"threads">;
  const listingId = "test-listing" as Id<"listings">;
  const detail = {
    thread: { _id: threadId, listingId, subject: "Test conversation", counterparty: "Test owner", lastMessageAt: 0 },
    listing: { title: "Test room", ownerLabel: "Test owner" },
    messages: [{ _id: "test-message" as Id<"messages">, senderLabel: "You", mine: true, body: "Can we visit?", createdAt: 0 }],
  };
  mocks.query.mockImplementation((reference: string) => reference === "get" ? detail : {
    jobId: "test-job",
    status: "failed",
    errorCode: "SIMULATED_PROVIDER_GENERATION_FAILED",
    replyCount: 0,
    canRetry: true,
  });

  const html = renderToStaticMarkup(<ThreadConversation threadId={threadId} initialDetail={detail} />);
  expect(html).toContain('data-roomscout-provider-automation-state="failed"');
  expect(html).toContain("No provider message was delivered.");
  expect(html).toContain("Retry provider reply");
  const messageList = html.match(/<div class="messages"[\s\S]*?<\/div>/)?.[0];
  expect(messageList).not.toContain("Provider reply unavailable");
});

test("thread explains the hard conversation limit without offering a retry", () => {
  mocks.authenticated = true;
  const threadId = "test-thread" as Id<"threads">;
  const listingId = "test-listing" as Id<"listings">;
  const detail = {
    thread: { _id: threadId, listingId, subject: "Test conversation", counterparty: "Test owner", lastMessageAt: 0 },
    listing: { title: "Test room", ownerLabel: "Test owner" },
    messages: [],
  };
  mocks.query.mockImplementation((reference: string) => reference === "get" ? detail : {
    jobId: "test-job",
    status: "failed",
    errorCode: "SIMULATED_PROVIDER_REPLY_LIMIT",
    replyCount: 12,
    canRetry: false,
  });

  const html = renderToStaticMarkup(<ThreadConversation threadId={threadId} initialDetail={detail} />);
  expect(html).toContain("reached its 12-reply limit");
  expect(html).not.toContain("Retry provider reply");
});
