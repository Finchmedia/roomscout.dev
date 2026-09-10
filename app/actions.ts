"use server";

import { fetchMutation } from "convex/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getConvexToken } from "@/lib/auth";
import { createListing } from "@/lib/convex";

const optionalText = (max: number) => z.string().trim().max(max).optional().transform((value) => value || undefined);

const listingSchema = z.object({
  ownerLabel: z.string().trim().min(1).max(100),
  side: z.enum(["supply", "demand"]),
  title: z.string().trim().min(1).max(180),
  city: z.string().trim().min(1).max(100),
  district: optionalText(100),
  description: z.string().trim().min(1).max(5_000),
  priceEur: z.string().trim().optional().transform((value) => value ? Number(value) : undefined).refine((value) => value === undefined || (Number.isFinite(value) && value >= 0 && value <= 100_000), "Invalid price"),
  pricePeriod: z.enum(["hour", "month"]).optional(),
});

export async function createListingAction(formData: FormData) {
  const input = listingSchema.parse(Object.fromEntries(formData));
  const token = await getConvexToken();
  const listingId = await fetchMutation(createListing, input, { token });
  revalidatePath("/");
  redirect(`/listings/${listingId}`);
}
