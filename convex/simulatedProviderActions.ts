import { NonRetryableError, vOnCompleteArgs } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import {
  buildProviderTurnPrompt,
  validateProviderTurnOutput,
} from "./providerScenarioEngine";
import { getBerlinProviderScenario } from "./providerScenarios/berlin";
import { generateSimulatedProviderTurn } from "./simulatedProviderModel";

const processResultValidator = v.object({
  outcome: v.union(v.literal("completed"), v.literal("stale")),
});

function errorCode(error: unknown): string {
  const text = error instanceof Error ? error.message : "SIMULATED_PROVIDER_GENERATION_FAILED";
  const match = text.match(/SIMULATED_PROVIDER_[A-Z0-9_]+/);
  return match?.[0] ?? "SIMULATED_PROVIDER_GENERATION_FAILED";
}

function deterministicFailure(code: string): boolean {
  return [
    "SIMULATED_PROVIDER_SCENARIO_NOT_FOUND",
    "SIMULATED_PROVIDER_EMPTY_REPLY",
    "SIMULATED_PROVIDER_FACT_REFERENCE_INVALID",
    "SIMULATED_PROVIDER_TRANSITION_INVALID",
    "SIMULATED_PROVIDER_TIME_INVENTED",
  ].includes(code);
}

export const processJob = internalAction({
  args: { jobId: v.id("simulatedProviderJobs") },
  returns: processResultValidator,
  handler: async (ctx, args): Promise<{ outcome: "completed" | "stale" }> => {
    const claimToken = crypto.randomUUID();
    const input = await ctx.runMutation(internal.simulatedProviders.claimJob, {
      jobId: args.jobId,
      claimToken,
    });
    if (!input) return { outcome: "stale" as const };
    try {
      const scenario = getBerlinProviderScenario(input.scenarioId);
      if (scenario?.version !== input.scenarioVersion) throw new Error("SIMULATED_PROVIDER_SCENARIO_NOT_FOUND");
      if (!scenario) throw new Error("SIMULATED_PROVIDER_SCENARIO_NOT_FOUND");
      const prompt = buildProviderTurnPrompt({
        scenario,
        stateKey: input.stateKey,
        locale: input.locale,
      });
      const generated = await generateSimulatedProviderTurn(ctx, {
        agentThreadId: input.agentThreadId,
        promptMessageId: input.promptMessageId,
        instructions: prompt.instructions,
      });
      const output = validateProviderTurnOutput(scenario, input.stateKey, input.locale, generated);
      const committed: { messageId: import("./_generated/dataModel").Id<"messages"> } | null = await ctx.runMutation(internal.simulatedProviders.completeJob, {
        jobId: args.jobId,
        claimToken,
        message: output.message,
        proposedTransition: output.proposedTransition,
        locale: output.locale,
      });
      return { outcome: committed ? "completed" as const : "stale" as const };
    } catch (error) {
      const code = errorCode(error);
      await ctx.runMutation(internal.simulatedProviders.releaseAttempt, {
        jobId: args.jobId,
        claimToken,
        errorCode: code,
      });
      if (deterministicFailure(code)) throw new NonRetryableError(code);
      throw error;
    }
  },
});

export const jobCompleted = internalMutation({
  args: vOnCompleteArgs(v.object({ jobId: v.id("simulatedProviderJobs") }), processResultValidator),
  returns: v.null(),
  handler: async (ctx, { context, result }) => {
    const succeeded = result.kind === "success";
    await ctx.runMutation(internal.simulatedProviders.finalizeWork, {
      jobId: context.jobId,
      succeeded,
      errorCode: succeeded ? undefined : "SIMULATED_PROVIDER_GENERATION_FAILED",
    });
    return null;
  },
});
