import { describe, expect, it } from "vitest";
import {
  buildProviderTurnPrompt,
  detectProviderLocale,
  fallbackProviderReply,
  repairInstruction,
  sanitizeProviderTurnOutput,
  validateProviderTurnOutput,
} from "./providerScenarioEngine";
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

  it("steers the provider toward agreeing to proposed viewing times while keeping room facts locked, in both locales", () => {
    const scenario = getBerlinProviderScenario("BER-23")!;
    for (const locale of ["en", "de"] as const) {
      const { instructions } = buildProviderTurnPrompt({ scenario, stateKey: "default", locale });
      expect(instructions).toContain("Your goal is a viewing and then a firm commitment");
      expect(instructions).toContain("never say you cannot confirm a viewing time, never postpone the viewing to the slot's start date");
      expect(instructions).toContain("unless an active fact explicitly rules that viewing time out");
      expect(instructions).toContain("Hard facts stay exactly as supplied and are never conceded or softened");
      expect(instructions).toContain("never with I cannot answer that");
      // The closing guidance sits after the strictness sentence so room facts stay scenario-locked.
      expect(instructions.indexOf("Do not invent prices, times")).toBeLessThan(instructions.indexOf("Your goal is a viewing"));
      expect(instructions).toContain("can be confirmed at the viewing");
    }
  });

  it("supplies the exact address and tells the provider to state it", () => {
    const scenario = getBerlinProviderScenario("BER-23")!;
    for (const locale of ["en", "de"] as const) {
      const { instructions } = buildProviderTurnPrompt({ scenario, stateKey: "default", locale });
      expect(instructions).toContain("soft logistics such as viewing dates, the exact address");
      expect(instructions).toContain("state the exact address from the active facts if one is supplied");
      expect(instructions).toContain("Alt-Marzahn 23, 12685 Berlin");
    }
    expect(buildProviderTurnPrompt({ scenario, stateKey: "default", locale: "de" }).instructions)
      .toContain("Die genaue Adresse ist");
  });

  it("does not mistake contract durations for unsupported clock times", () => {
    const scenario = getBerlinProviderScenario("BER-01")!;
    expect(() => validateProviderTurnOutput(scenario, "default", "en", {
      message: "The minimum commitment is 3 months, and a viewing is possible first.",
      referencedFactIds: ["contract_minimum", "viewing_path"], proposedTransition: null, locale: "en",
    })).not.toThrow();
  });
});

describe("provider reply validation, repair and fallback", () => {
  const scenario = getBerlinProviderScenario("BER-01")!;
  const viewingReply = {
    message: "Sure, tomorrow at 17:00 works for me. See you at the room.",
    referencedFactIds: ["viewing_path"], proposedTransition: null, locale: "en" as const,
  };

  it("accepts a viewing time the participant proposed as conversation, not as a room fact", () => {
    expect(() => validateProviderTurnOutput(scenario, "default", "en", viewingReply, {
      participantMessages: ["Can we meet tomorrow at 17:00?"],
    })).not.toThrow();
  });

  it("does not read the minutes of a German slot time as a second clock time", () => {
    expect(() => validateProviderTurnOutput(scenario, "default", "de", {
      message: "Ja, mittwochs von 18:00 bis 22:00 Uhr ist der Raum frei, für 350 Euro im Monat.",
      referencedFactIds: ["slot_1", "price_monthly"], proposedTransition: null, locale: "de",
    })).not.toThrow();
    expect(() => validateProviderTurnOutput(scenario, "default", "de", {
      message: "Mittwoch 18:00–22:00 Uhr passt.", referencedFactIds: ["slot_1"], proposedTransition: null, locale: "de",
    })).not.toThrow();
    expect(() => validateProviderTurnOutput(scenario, "default", "de", {
      message: "Kommen Sie um 19 Uhr vorbei.", referencedFactIds: [], proposedTransition: null, locale: "de",
    })).toThrow("SIMULATED_PROVIDER_TIME_INVENTED");
  });

  it("still rejects a clock time nobody in the conversation wrote", () => {
    expect(() => validateProviderTurnOutput(scenario, "default", "en", viewingReply)).toThrow("SIMULATED_PROVIDER_TIME_INVENTED");
    expect(() => validateProviderTurnOutput(scenario, "default", "en", viewingReply, { participantMessages: ["Is Wednesday free?"] }))
      .toThrow("SIMULATED_PROVIDER_TIME_INVENTED");
  });

  it("keeps prices scenario-locked even when the participant wrote the amount", () => {
    expect(() => validateProviderTurnOutput(scenario, "default", "en", {
      message: "Yes, €300 per month is fine.", referencedFactIds: ["price_monthly"], proposedTransition: null, locale: "en",
    }, { participantMessages: ["Would you take €300 per month?"] })).toThrow("SIMULATED_PROVIDER_PRICE_INVENTED");
  });

  it("accepts a reply that names the exact address while a viewing is agreed", () => {
    const modulOst = getBerlinProviderScenario("BER-23")!;
    expect(() => validateProviderTurnOutput(modulOst, "default", "en", {
      message: "Sure, the room is at Alt-Marzahn 23, 12685 Berlin. Friday works, see you then.",
      referencedFactIds: ["address", "viewing_path"], proposedTransition: null, locale: "en",
    })).not.toThrow();
    expect(() => validateProviderTurnOutput(modulOst, "default", "de", {
      message: "Gern, die genaue Adresse ist Alt-Marzahn 23, 12685 Berlin. Freitag passt, bis dann.",
      referencedFactIds: ["address"], proposedTransition: null, locale: "de",
    })).not.toThrow();
    expect(sanitizeProviderTurnOutput(modulOst, "default", {
      message: "The room is at Alt-Marzahn 23, 12685 Berlin.",
      referencedFactIds: ["address"], proposedTransition: null, locale: "en",
    }).referencedFactIds).toEqual(["address"]);
  });

  it("still rejects an invented euro amount in an address reply", () => {
    const modulOst = getBerlinProviderScenario("BER-23")!;
    expect(() => validateProviderTurnOutput(modulOst, "default", "en", {
      message: "The room is at Alt-Marzahn 23, 12685 Berlin and costs €199 per month.",
      referencedFactIds: ["address"], proposedTransition: null, locale: "en",
    })).toThrow("SIMULATED_PROVIDER_PRICE_INVENTED");
  });

  it("lists the slot times and participant times in the time repair instruction", () => {
    const text = repairInstruction("SIMULATED_PROVIDER_TIME_INVENTED", {
      scenario, stateKey: "default", locale: "en", participantMessages: ["Can we meet tomorrow at 17:00?"],
    });
    expect(text).toContain("Only use these clock times: 18:00, 22:00, and times the participant wrote: 17:00");
    expect(repairInstruction("SIMULATED_PROVIDER_PRICE_INVENTED", { scenario, stateKey: "default", locale: "en" })).toContain("Only mention these amounts: €350");
    expect(repairInstruction("SIMULATED_PROVIDER_LOCALE_MISMATCH", { scenario, stateKey: "default", locale: "de" }))
      .toContain("Write the entire message in German and set the structured locale field to exactly de");
    expect(repairInstruction("SIMULATED_PROVIDER_EMPTY_REPLY", { scenario, stateKey: "default", locale: "en" })).toContain("at least one full sentence");
  });

  it("falls back to a neutral reply in the thread language", () => {
    expect(fallbackProviderReply("de")).toEqual({
      message: "Danke, das prüfe ich kurz auf meiner Seite und melde mich in Kürze.",
      referencedFactIds: [], proposedTransition: null, locale: "de",
    });
    expect(fallbackProviderReply("en").message).toBe("Thanks, let me double-check that on my side and get back to you shortly.");
    expect(() => validateProviderTurnOutput(scenario, "default", "de", fallbackProviderReply("de"))).not.toThrow();
  });

  it("sanitizes bookkeeping fields instead of rejecting the reply", () => {
    const sanitized = sanitizeProviderTurnOutput(scenario, "default", {
      message: "Yes, Wednesday works.", referencedFactIds: ["slot_1", "made_up", "slot_1"], proposedTransition: "confirm-storage", locale: "en",
    });
    expect(sanitized).toMatchObject({ referencedFactIds: ["slot_1"], proposedTransition: null });
    expect(sanitizeProviderTurnOutput(scenario, "default", { ...sanitized, proposedTransition: "confirm-fit" }).proposedTransition).toBe("confirm-fit");
    expect(() => validateProviderTurnOutput(scenario, "default", "en", sanitized)).not.toThrow();
  });
});
