import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { getPublicListing } from "@/lib/convex";
import { MessageComposer } from "@/components/MessageComposer";

export const dynamic = "force-dynamic";

export default async function ListingPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId: rawListingId } = await params;
  const listingId = rawListingId as Id<"listings">;
  const listing = await fetchQuery(getPublicListing, { listingId });
  if (!listing) notFound();
  const session = await auth();
  return <main className="narrow"><Link className="back" href="/">← All listings</Link><article className="detail-card" data-roomscout-listing-id={listing._id}><div className="listing-meta"><span className={`tag ${listing.side}`} data-roomscout-side>{listing.side === "supply" ? "Room available" : "Room wanted"}</span><time>{new Date(listing.updatedAt).toLocaleString("en-GB")}</time></div><h1 data-roomscout-title>{listing.title}</h1><p className="location" data-roomscout-location>{listing.city}{listing.district ? ` · ${listing.district}` : ""}</p><p className="detail-copy" data-roomscout-description>{listing.description}</p><dl><div><dt>Price</dt><dd data-roomscout-price>{listing.priceEur === undefined ? "Open" : `€${listing.priceEur} per ${listing.pricePeriod}`}</dd></div><div><dt>Posted by</dt><dd>{listing.ownerLabel}</dd></div><div><dt>Source</dt><dd>roomscout.dev controlled demo portal</dd></div></dl></article>{session.isAuthenticated ? <MessageComposer description="Your verified portal account and session cookie are required. This message is stored in the portal's own Convex backend." heading="Message the listing owner" listingId={listingId} /> : <section className="message-card"><h2>Sign in to message</h2><p>Registration requires email verification before native messaging becomes available.</p><Link className="button" href={`/sign-in?redirect_url=/listings/${listing._id}`}>Sign in</Link></section>}</main>;
}
