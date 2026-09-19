"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { listPublicListings, type PublicListing } from "@/lib/convex";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "UTC",
});

function ListingCard({ listing }: { listing: PublicListing }) {
  return (
    <article
      className="listing-card"
      data-roomscout-listing-id={listing._id}
    >
      {listing.imageUrl ? <img alt={`${listing.title}, rehearsal room in ${listing.city}`} className="listing-image" loading="lazy" src={listing.imageUrl} /> : null}
      <div className="listing-meta">
        <span className={`tag ${listing.side}`} data-roomscout-side>
          {listing.side === "supply" ? "Room available" : "Room wanted"}
        </span>
        <time dateTime={new Date(listing.updatedAt).toISOString()}>
          {dateFormatter.format(new Date(listing.updatedAt))}
        </time>
      </div>
      <h3 data-roomscout-title>
        <Link href={`/listings/${listing._id}`}>{listing.title}</Link>
      </h3>
      <p className="location" data-roomscout-location>
        {listing.city}
        {listing.district ? ` · ${listing.district}` : ""}
        {listing.street ? ` · ${listing.street}` : ""}
      </p>
      <p data-roomscout-description>{listing.description}</p>
      <div className="listing-footer">
        <strong data-roomscout-price>
          {listing.priceEur === undefined
            ? "Price open"
            : `€${listing.priceEur} / ${listing.pricePeriod}`}
        </strong>
        <span>by {listing.ownerLabel}</span>
      </div>
    </article>
  );
}

export function LiveListings({
  initialListings,
  side,
}: {
  initialListings: PublicListing[];
  side?: "supply" | "demand";
}) {
  const liveListings = useQuery(listPublicListings, { side, limit: 100 });
  const listings = liveListings ?? initialListings;

  return (
    <div data-roomscout-listings data-realtime={liveListings === undefined ? "connecting" : "live"}>
      <p className="sr-only" aria-live="polite">
        {liveListings === undefined
          ? "Connecting to live listing updates."
          : `Live listing index connected. ${listings.length} listings shown.`}
      </p>
      {listings.length ? (
        <div className="listing-grid">
          {listings.map((listing) => (
            <ListingCard listing={listing} key={listing._id} />
          ))}
        </div>
      ) : (
        <div className="empty">
          <h3>No listings yet</h3>
          <p>Sign in and post the first controlled listing for the monitoring proof.</p>
        </div>
      )}
    </div>
  );
}
