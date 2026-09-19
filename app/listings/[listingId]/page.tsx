import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Id } from "@/convex/_generated/dataModel";
import { getPublicListing } from "@/lib/convex";
import { MessageComposer } from "@/components/MessageComposer";

export const dynamic = "force-dynamic";

type ListingRoute = { params: Promise<{ listingId: string }> };

async function loadListing(params: ListingRoute["params"]) {
  const { listingId } = await params;
  return await fetchQuery(getPublicListing, { listingId: listingId as Id<"listings"> });
}

export async function generateMetadata({ params }: ListingRoute): Promise<Metadata> {
  const listing = await loadListing(params);
  if (!listing) return { title: "Listing not found · RoomScout Community" };
  const description = listing.description.slice(0, 180);
  return {
    title: `${listing.title} · RoomScout Community`,
    description,
    openGraph: {
      title: listing.title,
      description,
      type: "article",
      ...(listing.imageUrl ? { images: [{ url: listing.imageUrl, alt: `${listing.title}, rehearsal room in ${listing.city}` }] } : {}),
    },
  };
}

export default async function ListingPage({ params }: ListingRoute) {
  const listing = await loadListing(params);
  if (!listing) notFound();
  const session = await auth();
  return (
    <main className="narrow">
      <Link className="back" href="/">← All listings</Link>
      <article className="detail-card" data-roomscout-listing-id={listing._id}>
        {listing.imageUrl ? <img alt={`${listing.title}, rehearsal room in ${listing.city}`} className="detail-image" src={listing.imageUrl} /> : null}
        <div className="listing-meta">
          <span className={`tag ${listing.side}`} data-roomscout-side>{listing.side === "supply" ? "Room available" : "Room wanted"}</span>
          <time>{new Date(listing.updatedAt).toLocaleString("en-GB")}</time>
        </div>
        <h1 data-roomscout-title>{listing.title}</h1>
        <p className="location" data-roomscout-location>{listing.city}{listing.district ? ` · ${listing.district}` : ""}{listing.street ? ` · ${listing.street}` : ""}</p>
        <p className="detail-copy" data-roomscout-description>{listing.description}</p>
        <dl>
          <div><dt>Price</dt><dd data-roomscout-price>{listing.priceEur === undefined ? "Open" : `€${listing.priceEur} per ${listing.pricePeriod}`}</dd></div>
          <div><dt>Posted by</dt><dd>{listing.ownerLabel}</dd></div>
          <div><dt>Source</dt><dd>roomscout.dev</dd></div>
        </dl>
      </article>
      {session.isAuthenticated ? (
        <MessageComposer description="Your verified portal account and session cookie are required. This message is stored in the portal's own Convex backend." heading="Message the listing owner" listingId={listing._id} />
      ) : (
        <section className="message-card"><h2>Sign in to message</h2><p>Registration requires email verification before native messaging becomes available.</p><Link className="button" href={`/sign-in?redirect_url=/listings/${listing._id}`}>Sign in</Link></section>
      )}
    </main>
  );
}
