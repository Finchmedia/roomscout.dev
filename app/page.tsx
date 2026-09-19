import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import Form from "next/form";
import { listPublicListings } from "@/lib/convex";
import { LiveListings } from "@/components/LiveListings";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ side?: string }> }) {
  const requested = (await searchParams).side;
  const side = requested === "supply" || requested === "demand" ? requested : undefined;
  const listings = await fetchQuery(listPublicListings, { side, limit: 100 });
  return (
    <main>
      <section className="hero">
        <img alt="Fictional Berlin rehearsal room with drums and amplifiers" className="hero-room-image" src="/demo-rooms/kanalwerk-a.webp" />
        <p className="eyebrow">Independent rehearsal-room classifieds</p>
        <h1>Rooms and bands,<br />in one public index.</h1>
        <p>Post an available rehearsal space or a room request. Account verification and native messages behave like a real community portal.</p>
        <div className="hero-actions"><Link className="button" href="/listings/new">Post a listing</Link><Link className="button secondary" href="/sign-up">Create verified account</Link></div>
      </section>
      <section className="section">
        <div className="section-head"><div><p className="eyebrow">Server-rendered public source</p><h2>Latest listings</h2></div><Form action="/"><label className="filter">Show<select defaultValue={side ?? "all"} name="side"><option value="all">All</option><option value="supply">Rooms available</option><option value="demand">Rooms wanted</option></select></label><button className="button secondary" type="submit">Apply</button></Form></div>
        <LiveListings initialListings={listings} side={side} />
      </section>
    </main>
  );
}
