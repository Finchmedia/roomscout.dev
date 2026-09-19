import { Workpool } from "@convex-dev/workpool";
import { components } from "./_generated/api";

export const simulatedProviderWorkpool = new Workpool(
  components.simulatedProviderWorkpool,
  {
    maxParallelism: 3,
    retryActionsByDefault: true,
    defaultRetryBehavior: {
      maxAttempts: 3,
      initialBackoffMs: 2_000,
      base: 2,
    },
  },
);
