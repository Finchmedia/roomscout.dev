import { NonRetryableError, vOnCompleteArgs } from "@convex-dev/workpool";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";
import {
  buildProviderTurnPrompt,
  fallbackProviderReply,
  repairInstruction,
  sanitizeProviderTurnOutput,
  validateProviderTurnOutput,
} from "./providerScenarioEngine";
import { getBerlinProviderScenario } from "./providerScenarios/berlin";
import type { ProviderTurnOutput } from "./providerScenarios/types";
import { generateSimulatedProviderTurn } from "./simulatedProviderModel";

const processResultValidator = v.object({
  outcome: v.union(v.literal("completed"), v.literal("stale")),
});

function errorCode(error: unknown): string {
  const text = error instanceof Error ? error.message : "SIMULATED_PROVIDER_GENERATION_FAILED";
  const match = text.match(/SIMULATED_PROVIDER_[A-Z0-9_]+/);
  return match?.[0] ?? "SIMULATED_PROVIDER_GENERATION_FAILED";
}

/** Content the model got wrong: repaired once, then replaced by a safe reply. Never a permanent failure. */
function contentFailure(code: string): boolean {
  return [
    "SIMULATED_PROVIDER_EMPTY_REPLY",
    "SIMULATED_PROVIDER_LOCALE_MISMATCH",
    "SIMULATED_PROVIDER_PRICE_INVENTED",
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
      const turn = { scenario, stateKey: input.stateKey, locale: input.locale, participantMessages: input.participantMessages };
      const prompt = buildProviderTurnPrompt(turn);
      const attempt = async (instructions: string) => {
        const generated = await generateSimulatedProviderTurn(ctx, {
          agentThreadId: input.agentThreadId,
          promptMessageId: input.promptMessageId,
          instructions,
        });
        const sanitized = sanitizeProviderTurnOutput(scenario, input.stateKey, generated);
        return validateProviderTurnOutput(scenario, input.stateKey, input.locale, sanitized, { participantMessages: input.participantMessages });
      };
      let output: ProviderTurnOutput;
      let qualityNote: string | undefined;
      try {
        output = await attempt(prompt.instructions);
      } catch (error) {
        const code = errorCode(error);
        if (!contentFailure(code)) throw error;
        console.log(JSON.stringify({ event: "simulated_provider_repair", jobId: args.jobId, code }));
        try {
          output = await attempt(`${prompt.instructions} ${repairInstruction(code, turn)}`);
          qualityNote = `REPAIRED:${code}`;
        } catch (repairError) {
          const lastCode = errorCode(repairError);
          if (!contentFailure(lastCode)) throw repairError;
          console.log(JSON.stringify({ event: "simulated_provider_fallback", jobId: args.jobId, code: lastCode }));
          output = fallbackProviderReply(input.locale);
          qualityNote = `FALLBACK:${lastCode}`;
        }
      }
      const committed: { messageId: import("./_generated/dataModel").Id<"messages"> } | null = await ctx.runMutation(internal.simulatedProviders.completeJob, {
        jobId: args.jobId,
        claimToken,
        message: output.message,
        proposedTransition: output.proposedTransition,
        locale: output.locale,
        qualityNote,
      });
      return { outcome: committed ? "completed" as const : "stale" as const };
    } catch (error) {
      const code = errorCode(error);
      await ctx.runMutation(internal.simulatedProviders.releaseAttempt, {
        jobId: args.jobId,
        claimToken,
        errorCode: code,
      });
      if (code === "SIMULATED_PROVIDER_SCENARIO_NOT_FOUND") throw new NonRetryableError(code);
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
