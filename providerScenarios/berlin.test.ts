import { describe, expect, it } from "vitest";
import {
  BERLIN_PROVIDER_SCENARIOS,
  LEGACY_STUTTGART_PROVIDER_SCENARIO,
  getBerlinProviderScenario,
  publicScenarioProjection,
  validateBerlinProviderCatalog,
} from "./berlin";

describe("Berlin provider scenario catalog", () => {
  it("contains 24 valid, stable fictional room definitions", () => {
    expect(() => validateBerlinProviderCatalog()).not.toThrow();
    expect(BERLIN_PROVIDER_SCENARIOS).toHaveLength(24);
    expect(new Set(BERLIN_PROVIDER_SCENARIOS.map((item) => item.seedKey)).size).toBe(24);
    expect(BERLIN_PROVIDER_SCENARIOS.every((item) => item.catalog.disclosure.includes("Fictional room"))).toBe(true);
  });

  it("keeps the main fits and budget correction path explicit", () => {
    for (const id of ["BER-01", "BER-02", "BER-03"]) {
      expect(getBerlinProviderScenario(id)?.catalog.demoTags).toContain("main_fit");
    }
    expect(getBerlinProviderScenario("BER-04")).toMatchObject({
      publicListing: { priceEur: 320, pricePeriod: "month" },
      catalog: { demoTags: expect.arrayContaining(["budget_250_to_400"]) },
    });
  });

  it("represents prices, slots, capacity and obvious equipment as typed facts", () => {
    const mainFit = getBerlinProviderScenario("BER-01")!;
    expect(mainFit.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "price", amountEur: 350, component: "total" }),
      expect.objectContaining({ kind: "slot", weekday: "wednesday", startTime: "18:00", endTime: "22:00", status: "available" }),
      expect.objectContaining({ kind: "capacity", maximumPeople: 5 }),
      expect.objectContaining({ kind: "feature", feature: "drum_kit", status: "provided" }),
    ]));
    expect(getBerlinProviderScenario("BER-05")?.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "price", amountEur: 210, component: "base" }),
      expect.objectContaining({ kind: "price", amountEur: 55, component: "mandatory_extra" }),
      expect.objectContaining({ kind: "price", amountEur: 265, component: "total" }),
    ]));
    expect(getBerlinProviderScenario("BER-14")?.facts).toContainEqual(expect.objectContaining({
      kind: "price", amountEur: 280, component: "base", recurringCostsKnown: false,
    }));
  });

  it("gives every provider stable internal start, minimum-term, notice and viewing knowledge", () => {
    const earlyStart = new Set(["BER-04", "BER-16", "BER-23"]);
    for (const scenario of [...BERLIN_PROVIDER_SCENARIOS, LEGACY_STUTTGART_PROVIDER_SCENARIO]) {
      expect(scenario.facts).toEqual(expect.arrayContaining([
        earlyStart.has(scenario.scenarioId)
          ? expect.objectContaining({ id: "contract_start", visibility: "private", disclosure: "when_relevant", value: expect.objectContaining({ en: expect.stringContaining("free right away") }) })
          : expect.objectContaining({ id: "contract_start", visibility: "private", disclosure: "on_request" }),
        expect.objectContaining({ id: "contract_minimum", kind: "term", term: "minimum_commitment" }),
        expect.objectContaining({ id: "contract_notice", kind: "term", term: "notice_period" }),
        expect.objectContaining({ id: "viewing_path", disclosure: "when_relevant" }),
      ]));
    }
    expect(getBerlinProviderScenario("STU-LEGACY-01")).toBe(LEGACY_STUTTGART_PROVIDER_SCENARIO);
    const withdrawn = getBerlinProviderScenario("BER-18")!;
    expect(withdrawn.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "slot_1", kind: "slot", status: "unavailable" }),
      expect.objectContaining({ id: "contract_start", value: expect.objectContaining({ en: expect.stringContaining("no start date") }) }),
      expect.objectContaining({ id: "viewing_path", value: expect.objectContaining({ en: expect.stringContaining("No viewing") }) }),
    ]));
  });

  it("gives every room exactly one private exact-address fact and leaves the public facts alone", () => {
    for (const item of BERLIN_PROVIDER_SCENARIOS) {
      const addressFacts = item.facts.filter((fact) => fact.id === "address");
      expect(addressFacts, item.scenarioId).toHaveLength(1);
      const addressFact = addressFacts[0]!;
      expect(addressFact).toMatchObject({ visibility: "private", disclosure: "when_relevant", kind: "term" });
      if (addressFact.kind !== "term") throw new Error("address fact must be a term fact");
      for (const text of [addressFact.value.en, addressFact.value.de]) {
        expect(text, item.scenarioId).toContain(item.catalog.street);
        expect(text, item.scenarioId).toMatch(/\b\d{5}\b/);
        // No clock time and no euro amount, so the provider can quote it without tripping the validator.
        expect(text, item.scenarioId).not.toMatch(/\d{1,2}:\d{2}/);
        expect(text, item.scenarioId).not.toMatch(/€|\beuros?\b|\beur\b/i);
      }
      expect(item.publicListing.publicFactIds).not.toContain("address");
      expect(item.catalog.street).not.toMatch(/\d/);
    }
    expect(getBerlinProviderScenario("BER-23")?.facts).toContainEqual(expect.objectContaining({
      id: "address",
      value: expect.objectContaining({ en: expect.stringContaining("Alt-Marzahn 23, 12685 Berlin") }),
    }));
  });

  it("keeps the public fact ids of the main fit unchanged", () => {
    expect(getBerlinProviderScenario("BER-01")?.publicListing.publicFactIds).toEqual([
      "price_monthly", "slot_1", "feature_drum_kit", "feature_pa", "feature_backline",
      "feature_acoustic_drums", "feature_storage", "feature_step_free", "listing_capacity",
      "public_1", "public_2",
    ]);
    for (const item of BERLIN_PROVIDER_SCENARIOS) {
      const publicIds = item.facts.filter((fact) => fact.visibility === "public").map((fact) => fact.id);
      expect(item.publicListing.publicFactIds, item.scenarioId).toEqual(publicIds);
    }
  });

  it("accepts numeric versions and rejects catalog version mismatches", () => {
    expect(getBerlinProviderScenario("BER-01", 1)?.scenarioId).toBe("BER-01");
    expect(getBerlinProviderScenario("BER-01", 2)).toBeUndefined();
  });

  it("projects no provider profile, hidden facts or transitions to public consumers", () => {
    const projection = publicScenarioProjection(BERLIN_PROVIDER_SCENARIOS[0]!);
    expect(projection).not.toHaveProperty("providerProfile");
    expect(projection).not.toHaveProperty("facts");
    expect(projection).not.toHaveProperty("dynamic");
    expect(JSON.stringify(projection)).not.toContain("Mara Levin");
    expect(projection.publicListing).toMatchObject({
      title: "Kanalwerk A",
      street: "Reichenberger Straße",
      imageUrl: "https://roomscout.dev/demo-rooms/kanalwerk-a.webp",
      priceEur: 350,
    });
  });
});
