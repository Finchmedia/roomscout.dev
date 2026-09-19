export type ProviderLocale = "en" | "de";

export type LocalizedText = Readonly<Record<ProviderLocale, string>>;

type FactBase = {
  id: string;
  visibility: "public" | "private";
  disclosure: "public" | "on_request" | "when_relevant";
  /** Omit for facts that remain true in every scenario state. */
  states?: readonly string[];
  note?: LocalizedText;
};

export type ProviderScenarioFact =
  | (FactBase & {
      kind: "price";
      amountEur: number;
      cadence: "month" | "hour" | "one_time";
      component: "base" | "mandatory_extra" | "deposit" | "total";
      recurringCostsKnown?: boolean;
    })
  | (FactBase & {
      kind: "slot";
      weekday: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
      startTime: string;
      endTime: string;
      status: "available" | "unavailable" | "conditional";
    })
  | (FactBase & {
      kind: "capacity";
      maximumPeople: number;
    })
  | (FactBase & {
      kind: "feature";
      feature: "acoustic_drums" | "drum_kit" | "pa" | "backline" | "storage" | "key" | "step_free" | "parking" | "other";
      status: "provided" | "allowed" | "not_allowed" | "conditional" | "unknown";
    })
  | (FactBase & {
      kind: "term";
      term: "minimum_commitment" | "notice_period" | "access" | "noise" | "utilities" | "other";
      value: LocalizedText;
    });

export type ProviderScenarioTransition = {
  id: string;
  fromState: string;
  toState: string;
  /** Semantic condition for the model; the engine still validates the transition id and source state. */
  trigger: LocalizedText;
};

export type ScenarioDefinition = {
  schemaVersion: 1;
  scenarioId: string;
  version: number;
  publicListing: {
    title: string;
    city: string;
    district?: string;
    street?: string;
    description: string;
    imageUrl?: string;
    priceEur?: number;
    pricePeriod?: "hour" | "month";
    publicFactIds: readonly string[];
  };
  providerProfile: {
    fictionalName: string;
    shortBackstory: LocalizedText;
    tone: LocalizedText;
  };
  facts: readonly ProviderScenarioFact[];
  dynamic?: {
    initialState: string;
    transitions: readonly ProviderScenarioTransition[];
  };
};

export type ProviderTurnInput = {
  scenario: ScenarioDefinition;
  stateKey: string;
  locale: ProviderLocale;
};

export type ProviderTurnOutput = {
  message: string;
  referencedFactIds: string[];
  proposedTransition: string | null;
  locale: ProviderLocale;
};

export function initialScenarioState(scenario: ScenarioDefinition): string {
  return scenario.dynamic?.initialState ?? "default";
}

export function factsForState(
  scenario: ScenarioDefinition,
  stateKey: string,
): readonly ProviderScenarioFact[] {
  return scenario.facts.filter((fact) => !fact.states || fact.states.includes(stateKey));
}
