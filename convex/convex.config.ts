import { defineApp } from "convex/server";
import { v } from "convex/values";
import agentmail from "@agentmail/convex/convex.config";
import agent from "@convex-dev/agent/convex.config";
import workpool from "@convex-dev/workpool/convex.config";

// Components run in their own environment and do not see the deployment's
// variables. The AgentMail component reads AGENTMAIL_API_KEY from its own
// process.env, so the app has to hand the values across explicitly.
const app = defineApp({
  env: {
    AGENTMAIL_API_KEY: v.string(),
    AGENTMAIL_BASE_URL: v.optional(v.string()),
    SIMULATED_PROVIDER_ENGINE_ENABLED: v.optional(v.string()),
  },
});

app.use(agentmail, {
  env: {
    AGENTMAIL_API_KEY: app.env.AGENTMAIL_API_KEY,
    AGENTMAIL_BASE_URL: app.env.AGENTMAIL_BASE_URL,
  },
});
app.use(agent);
app.use(workpool, { name: "simulatedProviderWorkpool" });

export default app;
