import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import {
  BERLIN_CATALOG_SEED_PREFIX,
  BERLIN_PROVIDER_SCENARIOS,
  LEGACY_STUTTGART_PROVIDER_SCENARIO,
  type BerlinProviderScenarioDefinition,
} from "../providerScenarios/berlin";

const CONFIRMATION = `seed:${BERLIN_CATALOG_SEED_PREFIX}`;
const resultValidator = v.object({
  dryRun: v.boolean(),
  plannedListingsInserted: v.number(),
  plannedListingsUpdated: v.number(),
  plannedBindingsInserted: v.number(),
  plannedBindingsUpdated: v.number(),
  unchanged: v.number(),
});

type ListingFields = Pick<Doc<"listings">,
  "ownerId" | "ownerLabel" | "side" | "title" | "city" | "district" | "street" | "description" |
  "imageUrl" | "priceEur" | "pricePeriod" | "status"
>;

function listingFields(scenario: BerlinProviderScenarioDefinition): ListingFields {
  const listing = scenario.publicListing;
  return {
    ownerId: `simulated-provider:${scenario.scenarioId}`,
    ownerLabel: scenario.catalog.ownerLabel,
    side: "supply",
    title: listing.title,
    city: listing.city,
    district: listing.district,
    street: scenario.catalog.street,
    description: [
      listing.description,
      `${scenario.catalog.street}, ${listing.district}, Berlin.`,
      `${scenario.catalog.areaSquareMeters} m² · up to ${scenario.catalog.capacity} musicians.`,
      `Monthly price covers one fixed weekly slot: EUR ${listing.priceEur}.`,
      `Slots: ${scenario.catalog.weeklySlots.map((item) => `${item.weekday} ${item.start}–${item.end}`).join(", ")}.`,
      `Equipment: ${scenario.catalog.equipment.join(", ")}. Access: ${scenario.catalog.access.join(", ")}.`,
    ].join(" "),
    imageUrl: `https://roomscout.dev/demo-rooms/${scenario.catalog.slug}.webp`,
    priceEur: listing.priceEur,
    pricePeriod: "month",
    status: "published",
  };
}

function sameListing(row: Doc<"listings">, expected: ListingFields): boolean {
  return Object.entries(expected).every(([key, value]) => row[key as keyof ListingFields] === value);
}

function sameBinding(row: Doc<"simulatedProviderListings">, scenario: BerlinProviderScenarioDefinition): boolean {
  return row.seedKey === scenario.seedKey && row.scenarioId === scenario.scenarioId &&
    row.scenarioVersion === scenario.version;
}

function assertSeedScope(args: { confirmation: string; expectedSiteUrl: string }) {
  if (args.confirmation !== CONFIRMATION) throw new ConvexError({ code: "CATALOG_CONFIRMATION_MISMATCH" });
  const expected = args.expectedSiteUrl.trim().replace(/\/$/, "");
  const actual = process.env.CONVEX_SITE_URL?.trim().replace(/\/$/, "");
  if (!expected || !actual || expected !== actual) throw new ConvexError({ code: "CATALOG_TARGET_MISMATCH" });
}

async function currentBinding(ctx: MutationCtx, seedKey: string) {
  return await ctx.db.query("simulatedProviderListings").withIndex("by_seed_key", (q) => q.eq("seedKey", seedKey)).unique();
}

/** Internal-only, deployment-guarded and dry-runable. It never selects or edits user listings. */
export const seedBerlinCatalog = internalMutation({
  args: { dryRun: v.boolean(), confirmation: v.string(), expectedSiteUrl: v.string() },
  returns: resultValidator,
  handler: async (ctx, args) => {
    assertSeedScope(args);
    const result = {
      dryRun: args.dryRun,
      plannedListingsInserted: 0,
      plannedListingsUpdated: 0,
      plannedBindingsInserted: 0,
      plannedBindingsUpdated: 0,
      unchanged: 0,
    };
    for (const scenario of BERLIN_PROVIDER_SCENARIOS) {
      const binding = await currentBinding(ctx, scenario.seedKey);
      const expected = listingFields(scenario);
      const listing = binding ? await ctx.db.get(binding.listingId) : null;
      if (binding && (!listing || listing.ownerId !== expected.ownerId)) {
        throw new ConvexError({ code: "CATALOG_BINDING_CONFLICT", seedKey: scenario.seedKey });
      }
      const listingChanged = listing ? !sameListing(listing, expected) : true;
      const bindingChanged = binding ? !sameBinding(binding, scenario) : true;
      if (!listingChanged && !bindingChanged) {
        result.unchanged += 1;
        continue;
      }
      if (listing) result.plannedListingsUpdated += listingChanged ? 1 : 0;
      else result.plannedListingsInserted += 1;
      if (binding) result.plannedBindingsUpdated += bindingChanged ? 1 : 0;
      else result.plannedBindingsInserted += 1;
      if (args.dryRun) continue;
      const now = Date.now();
      const listingId = listing?._id ?? await ctx.db.insert("listings", { ...expected, createdAt: now, updatedAt: now });
      if (listing && listingChanged) await ctx.db.patch(listing._id, { ...expected, updatedAt: now });
      if (binding && bindingChanged) {
        await ctx.db.patch(binding._id, {
          scenarioId: scenario.scenarioId,
          scenarioVersion: scenario.version,
          updatedAt: now,
        });
      } else if (!binding) {
        await ctx.db.insert("simulatedProviderListings", {
          listingId,
          seedKey: scenario.seedKey,
          scenarioId: scenario.scenarioId,
          scenarioVersion: scenario.version,
          enabled: false,
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return result;
  },
});

export const berlinCatalogSeedConfirmation = CONFIRMATION;

/** Binds only the single approved legacy fixture and never edits its listing. */
export const bindLegacyStuttgartProvider = internalMutation({
  args: { dryRun: v.boolean(), confirmation: v.string(), expectedSiteUrl: v.string() },
  returns: v.object({ found: v.boolean(), inserted: v.boolean(), unchanged: v.boolean() }),
  handler: async (ctx, args) => {
    assertSeedScope(args);
    const published = await ctx.db.query("listings").withIndex("by_status_and_updated_at", (q) => q.eq("status", "published")).take(100);
    const matches = published.filter((row) => row.title === "Spare Rehearsal Room" && row.city === "Stuttgart");
    if (matches.length === 0) return { found: false, inserted: false, unchanged: false };
    if (matches.length !== 1) throw new ConvexError({ code: "LEGACY_STUTTGART_FIXTURE_AMBIGUOUS" });
    const existing = await ctx.db.query("simulatedProviderListings").withIndex("by_listing_id", (q) => q.eq("listingId", matches[0]!._id)).unique();
    if (existing) {
      if (existing.scenarioId !== LEGACY_STUTTGART_PROVIDER_SCENARIO.scenarioId || existing.scenarioVersion !== LEGACY_STUTTGART_PROVIDER_SCENARIO.version) throw new ConvexError({ code: "LEGACY_STUTTGART_BINDING_CONFLICT" });
      return { found: true, inserted: false, unchanged: existing.enabled };
    }
    if (!args.dryRun) {
      const now = Date.now();
      await ctx.db.insert("simulatedProviderListings", { listingId: matches[0]!._id, seedKey: LEGACY_STUTTGART_PROVIDER_SCENARIO.seedKey, scenarioId: LEGACY_STUTTGART_PROVIDER_SCENARIO.scenarioId, scenarioVersion: LEGACY_STUTTGART_PROVIDER_SCENARIO.version, enabled: true, createdAt: now, updatedAt: now });
    }
    return { found: true, inserted: true, unchanged: false };
  },
});
