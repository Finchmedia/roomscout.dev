import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "./schema";
import { berlinCatalogSeedConfirmation } from "./berlinCatalogSeed";

const modules = import.meta.glob("./**/*.ts");
const seedBerlinCatalog = makeFunctionReference<"mutation", {
  dryRun: boolean; confirmation: string; expectedSiteUrl: string;
}, {
  dryRun: boolean; plannedListingsInserted: number; plannedListingsUpdated: number;
  plannedBindingsInserted: number; plannedBindingsUpdated: number; unchanged: number;
}>("berlinCatalogSeed:seedBerlinCatalog");
const bindLegacyStuttgartProvider = makeFunctionReference<"mutation", {
  dryRun: boolean; confirmation: string; expectedSiteUrl: string;
}, { found: boolean; inserted: boolean; unchanged: boolean }>("berlinCatalogSeed:bindLegacyStuttgartProvider");

describe("Berlin catalog seed", () => {
  const siteUrl = "https://portal-test.convex.site";
  const previousSiteUrl = process.env.CONVEX_SITE_URL;
  beforeEach(() => { process.env.CONVEX_SITE_URL = siteUrl; });
  afterEach(() => {
    if (previousSiteUrl === undefined) delete process.env.CONVEX_SITE_URL;
    else process.env.CONVEX_SITE_URL = previousSiteUrl;
  });

  it("previews all 24 inserts without writing", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(seedBerlinCatalog, { dryRun: true, confirmation: berlinCatalogSeedConfirmation, expectedSiteUrl: siteUrl });
    expect(result).toMatchObject({ dryRun: true, plannedListingsInserted: 24, plannedBindingsInserted: 24, unchanged: 0 });
    expect(await t.run((ctx) => ctx.db.query("listings").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("simulatedProviderListings").collect())).toHaveLength(0);
  });

  it("is idempotent and leaves unrelated user listings untouched", async () => {
    const t = convexTest(schema, modules);
    const userListingId = await t.run((ctx) => ctx.db.insert("listings", {
      ownerId: "real-user", ownerLabel: "Existing owner", side: "supply", title: "Existing room",
      city: "Stuttgart", description: "Must remain unchanged.", status: "published", createdAt: 1, updatedAt: 1,
    }));
    const args = { dryRun: false, confirmation: berlinCatalogSeedConfirmation, expectedSiteUrl: siteUrl };
    expect(await t.mutation(seedBerlinCatalog, args)).toMatchObject({ plannedListingsInserted: 24, plannedBindingsInserted: 24 });
    expect(await t.mutation(seedBerlinCatalog, args)).toMatchObject({ unchanged: 24, plannedListingsInserted: 0, plannedListingsUpdated: 0, plannedBindingsInserted: 0, plannedBindingsUpdated: 0 });
    expect(await t.run((ctx) => ctx.db.query("listings").collect())).toHaveLength(25);
    expect(await t.run((ctx) => ctx.db.get(userListingId))).toMatchObject({ ownerLabel: "Existing owner", updatedAt: 1 });
    const seeded = await t.run((ctx) => ctx.db.query("listings").withIndex("by_owner_and_updated_at", (q) => q.eq("ownerId", "simulated-provider:BER-01")).unique());
    expect(seeded).toMatchObject({
      street: "Reichenberger Straße",
      imageUrl: "https://roomscout.dev/demo-rooms/kanalwerk-a.webp",
    });
    expect(seeded?.description).not.toContain("Fictional room");
    expect(seeded?.description).not.toContain("Approximate fictional location");
    expect(seeded?.description).not.toMatch(/52\.\d+|13\.\d+/);
    const bindings = await t.run((ctx) => ctx.db.query("simulatedProviderListings").collect());
    expect(bindings).toHaveLength(24);
    expect(bindings.every((binding) => binding.enabled === false)).toBe(true);

    await t.run(async (ctx) => ctx.db.patch(bindings[0]!._id, { enabled: true }));
    expect(await t.mutation(seedBerlinCatalog, args)).toMatchObject({ unchanged: 24, plannedBindingsUpdated: 0 });
    expect(await t.run((ctx) => ctx.db.get(bindings[0]!._id))).toMatchObject({ enabled: true });
  });

  it("keeps the private exact address out of every seeded public listing", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(seedBerlinCatalog, { dryRun: false, confirmation: berlinCatalogSeedConfirmation, expectedSiteUrl: siteUrl });
    const rows = await t.run((ctx) => ctx.db.query("listings").collect());
    expect(rows).toHaveLength(24);
    for (const row of rows) {
      expect(row.street, row.title).not.toMatch(/\d/);
      expect(row.description, row.title).not.toMatch(/\b\d{5}\b/);
      expect(row.description, row.title).not.toContain("The exact address is");
    }
  });

  it("fails closed for the wrong deployment target", async () => {
    const t = convexTest(schema, modules);
    await expect(t.mutation(seedBerlinCatalog, {
      dryRun: true, confirmation: berlinCatalogSeedConfirmation, expectedSiteUrl: "https://wrong.convex.site",
    })).rejects.toThrow("CATALOG_TARGET_MISMATCH");
  });

  it("binds only one exact legacy Stuttgart fixture without editing it", async () => {
    const t = convexTest(schema, modules);
    const listingId = await t.run((ctx) => ctx.db.insert("listings", {
      ownerId: "legacy-owner", ownerLabel: "Legacy provider", side: "supply", title: "Spare Rehearsal Room",
      city: "Stuttgart", description: "Keep exactly this listing.", priceEur: 350, pricePeriod: "month", status: "published", createdAt: 1, updatedAt: 1,
    }));
    const args = { dryRun: false, confirmation: berlinCatalogSeedConfirmation, expectedSiteUrl: siteUrl };
    expect(await t.mutation(bindLegacyStuttgartProvider, args)).toEqual({ found: true, inserted: true, unchanged: false });
    expect(await t.mutation(bindLegacyStuttgartProvider, args)).toEqual({ found: true, inserted: false, unchanged: true });
    expect(await t.run((ctx) => ctx.db.get(listingId))).toMatchObject({ description: "Keep exactly this listing.", updatedAt: 1 });
    expect(await t.run((ctx) => ctx.db.query("simulatedProviderListings").withIndex("by_listing_id", (q) => q.eq("listingId", listingId)).unique())).toMatchObject({ scenarioId: "STU-LEGACY-01", enabled: true });
  });
});
