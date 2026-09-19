import { Agent } from "@convex-dev/agent";
import { Output } from "ai";
import { components } from "./_generated/api";
import type { ActionCtx } from "./_generated/server";
import { structuredConvexGateway } from "./integrations/structuredConvexGateway";
import { providerTurnOutputSchema } from "./providerScenarioEngine";
import type { ProviderTurnOutput } from "./providerScenarios/types";

export const SIMULATED_PROVIDER_MODEL_ID = "openai/gpt-5.6-luna" as const;

/** One durable Agent component thread is attached to each portal thread. */
export const simulatedProviderAgent = new Agent(components.agent, {
  name: "Rehearsal-room provider",
  languageModel: structuredConvexGateway(SIMULATED_PROVIDER_MODEL_ID),
  instructions: "Speak naturally as the rehearsal-room provider described by the current server-owned scenario. Never add demo or simulation disclaimers to a reply.",
});

export async function generateSimulatedProviderTurn(
  ctx: ActionCtx,
  args: { agentThreadId: string; promptMessageId: string; instructions: string },
): Promise<ProviderTurnOutput> {
  const result = await simulatedProviderAgent.generateText(
    ctx,
    { threadId: args.agentThreadId },
    {
      instructions: args.instructions,
      promptMessageId: args.promptMessageId,
      output: Output.object({ schema: providerTurnOutputSchema }),
      abortSignal: AbortSignal.timeout(90_000),
      // Workpool owns the bounded retry policy, so one worker attempt maps to
      // one model request and the total never exceeds the configured tries.
      maxRetries: 0,
    },
    {
      storageOptions: { saveMessages: "none" },
    },
  );
  return providerTurnOutputSchema.parse(result.output);
}
