import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { upsertPortalUser } from "./portalUsers";

const listingValidator = v.object({
  _id: v.id("listings"),
  ownerLabel: v.string(),
  side: v.union(v.literal("supply"), v.literal("demand")),
  title: v.string(),
  city: v.string(),
  district: v.optional(v.string()),
  street: v.optional(v.string()),
  description: v.string(),
  imageUrl: v.optional(v.string()),
  priceEur: v.optional(v.number()),
  pricePeriod: v.optional(v.union(v.literal("hour"), v.literal("month"))),
  status: v.union(v.literal("published"), v.literal("closed")),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

const LEGACY_STUTTGART_IMAGE = "https://roomscout.dev/demo-rooms/spare-rehearsal-room-stuttgart.webp";

function publicImageUrl(row: Doc<"listings">): string | undefined {
  if (row.imageUrl) return row.imageUrl;
  return row.title === "Spare Rehearsal Room" && row.city === "Stuttgart"
    ? LEGACY_STUTTGART_IMAGE
    : undefined;
}

function toPublicListing(row: Doc<"listings">) {
  return {
    _id: row._id,
    ownerLabel: row.ownerLabel,
    side: row.side,
    title: row.title,
    city: row.city,
    district: row.district,
    street: row.street,
    description: row.description,
    imageUrl: publicImageUrl(row),
    priceEur: row.priceEur,
    pricePeriod: row.pricePeriod,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function toPublicListings(ctx: QueryCtx, rows: Doc<"listings">[]) {
  return await Promise.all(rows.map(async (row) => {
    return toPublicListing(row);
  }));
}

export const listPublic = query({
  args: { side: v.optional(v.union(v.literal("supply"), v.literal("demand"))), limit: v.optional(v.number()) },
  returns: v.array(listingValidator),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    const rows = args.side
      ? await ctx.db
          .query("listings")
          .withIndex("by_status_and_side_and_updated_at", (q) =>
            q.eq("status", "published").eq("side", args.side!),
          )
          .order("desc")
          .take(limit)
      : await ctx.db
          .query("listings")
          .withIndex("by_status_and_updated_at", (q) => q.eq("status", "published"))
          .order("desc")
          .take(limit);
    return await toPublicListings(ctx, rows);
  },
});

export const getPublic = query({
  args: { listingId: v.id("listings") },
  returns: v.union(listingValidator, v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.listingId);
    if (!row || row.status !== "published") return null;
    return toPublicListing(row);
  },
});

export const create = mutation({
  args: {
    ownerLabel: v.string(),
    side: v.union(v.literal("supply"), v.literal("demand")),
    title: v.string(),
    city: v.string(),
    district: v.optional(v.string()),
    description: v.string(),
    priceEur: v.optional(v.number()),
    pricePeriod: v.optional(v.union(v.literal("hour"), v.literal("month"))),
  },
  returns: v.id("listings"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    await upsertPortalUser(ctx, identity);
    const title = clean(args.title, 180);
    const city = clean(args.city, 100);
    const description = clean(args.description, 5_000);
    const ownerLabel = clean(args.ownerLabel, 100);
    if (!title || !city || !description || !ownerLabel) throw new ConvexError({ code: "INVALID_LISTING" });
    if (args.priceEur !== undefined && (!Number.isFinite(args.priceEur) || args.priceEur < 0 || args.priceEur > 100_000)) throw new ConvexError({ code: "INVALID_PRICE" });
    const now = Date.now();
    return await ctx.db.insert("listings", {
      ownerId: identity.subject,
      ownerLabel,
      side: args.side,
      title,
      city,
      district: args.district ? clean(args.district, 100) : undefined,
      description,
      priceEur: args.priceEur,
      pricePeriod: args.pricePeriod,
      status: "published",
      createdAt: now,
      updatedAt: now,
    });
  },
});
