/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as berlinCatalogSeed from "../berlinCatalogSeed.js";
import type * as controlledSimulation from "../controlledSimulation.js";
import type * as email from "../email.js";
import type * as emailTemplates from "../emailTemplates.js";
import type * as http from "../http.js";
import type * as integrations_structuredConvexGateway from "../integrations/structuredConvexGateway.js";
import type * as listings from "../listings.js";
import type * as messageStorage from "../messageStorage.js";
import type * as messages from "../messages.js";
import type * as portalIdentity from "../portalIdentity.js";
import type * as portalUsers from "../portalUsers.js";
import type * as providerScenarioEngine from "../providerScenarioEngine.js";
import type * as providerScenarios_berlin from "../providerScenarios/berlin.js";
import type * as providerScenarios_types from "../providerScenarios/types.js";
import type * as simulatedProviderActions from "../simulatedProviderActions.js";
import type * as simulatedProviderModel from "../simulatedProviderModel.js";
import type * as simulatedProviderWorkpool from "../simulatedProviderWorkpool.js";
import type * as simulatedProviders from "../simulatedProviders.js";
import type * as testReset from "../testReset.js";
import type * as testResetActions from "../testResetActions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  berlinCatalogSeed: typeof berlinCatalogSeed;
  controlledSimulation: typeof controlledSimulation;
  email: typeof email;
  emailTemplates: typeof emailTemplates;
  http: typeof http;
  "integrations/structuredConvexGateway": typeof integrations_structuredConvexGateway;
  listings: typeof listings;
  messageStorage: typeof messageStorage;
  messages: typeof messages;
  portalIdentity: typeof portalIdentity;
  portalUsers: typeof portalUsers;
  providerScenarioEngine: typeof providerScenarioEngine;
  "providerScenarios/berlin": typeof providerScenarios_berlin;
  "providerScenarios/types": typeof providerScenarios_types;
  simulatedProviderActions: typeof simulatedProviderActions;
  simulatedProviderModel: typeof simulatedProviderModel;
  simulatedProviderWorkpool: typeof simulatedProviderWorkpool;
  simulatedProviders: typeof simulatedProviders;
  testReset: typeof testReset;
  testResetActions: typeof testResetActions;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  agentmail: import("@agentmail/convex/_generated/component.js").ComponentApi<"agentmail">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
  simulatedProviderWorkpool: import("@convex-dev/workpool/_generated/component.js").ComponentApi<"simulatedProviderWorkpool">;
};
