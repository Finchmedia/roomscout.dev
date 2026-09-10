import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { agentmail } from "./email";

const http = httpRouter();

http.route({
  path: "/agentmail/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    return await agentmail.handleWebhook(
      ctx as unknown as Parameters<typeof agentmail.handleWebhook>[0],
      request,
    );
  }),
});

export default http;
