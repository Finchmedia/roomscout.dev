import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { getServiceToken } from "convex/server";

const productionGatewayHost = "https://ai-gateway.convex.dev";

/** Small structured-output adapter shared with the main RoomScout backend. */
export function structuredConvexGateway(modelId: string) {
  const provider = createOpenAICompatible({
    name: "convexGateway",
    baseURL: `${process.env.CONVEX_INTERNAL_AI_GATEWAY_HOST || productionGatewayHost}/v1`,
    supportsStructuredOutputs: true,
    fetch: async (input, init) => {
      const token = await getServiceToken("ai-gateway");
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${token}`);
      return await globalThis.fetch(input, { ...init, headers });
    },
  });
  return provider(modelId);
}
