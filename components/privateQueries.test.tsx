import { beforeEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Id } from "../convex/_generated/dataModel";
import { InboxThreads } from "./InboxThreads";
import { ThreadConversation } from "./ThreadConversation";

const mocks = vi.hoisted(() => ({ authenticated: false, query: vi.fn() }));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: mocks.authenticated, isLoading: !mocks.authenticated }),
  useQuery: mocks.query,
}));
vi.mock("@/convex/_generated/api", () => ({ api: { messages: { listMine: "list", getMine: "get" } } }));
vi.mock("@/components/MessageComposer", () => ({ MessageComposer: () => null }));

beforeEach(() => { mocks.authenticated = false; mocks.query.mockReset(); });

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
  expect(html).toContain('data-roomscout-thread-state="ready"');
  expect(html).toContain("Test reply");
  expect(html).toContain('dateTime="1970-01-01T00:00:00.000Z"');
});
