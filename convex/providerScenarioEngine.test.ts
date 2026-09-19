import { describe, expect, it } from "vitest";
import { buildProviderTurnPrompt, detectProviderLocale, validateProviderTurnOutput } from "./providerScenarioEngine";
import { getBerlinProviderScenario } from "./providerScenarios/berlin";

describe("provider locale detection", () => {
  it("recognizes an ordinary German listing question without an explicit language command", () => {
    expect(detectProviderLocale(
      "Hallo, dies ist eine synthetische Demo-Anfrage. Ist der Mittwochabend noch frei und wie hoch ist der vollständige monatliche Preis?",
    )).toBe("de");
  });

  it("keeps an ordinary English listing question in English", () => {
    expect(detectProviderLocale(
      "Hello, is the Wednesday evening slot still free and what is the exact monthly price?",
    )).toBe("en");
  });

  it("prompts a natural provider reply without repeating portal disclosure or participant budgets", () => {
    const scenario = getBerlinProviderScenario("BER-01")!;
    const { instructions } = buildProviderTurnPrompt({ scenario, stateKey: "default", locale: "de" });
    expect(instructions).toContain("set the structured locale field to exactly de");
    expect(instructions).toContain("Never repeat or discuss a participant's budget");
    expect(instructions).not.toContain("You are a fictional");
    expect(instructions).not.toContain("clearly disclosed interactive demo");
    expect(instructions).toContain("continue toward arranging the viewing");
  });

  it("does not mistake contract durations for unsupported clock times", () => {
    const scenario = getBerlinProviderScenario("BER-01")!;
    expect(() => validateProviderTurnOutput(scenario, "default", "en", {
      message: "The minimum commitment is 3 months, and a viewing is possible first.",
      referencedFactIds: ["contract_minimum", "viewing_path"], proposedTransition: null, locale: "en",
    })).not.toThrow();
  });
});
