import Link from "next/link";

export default function NotFound() {
  return <main className="narrow empty"><h1>Not found</h1><p>The listing or conversation is unavailable to this account.</p><Link className="button" href="/">Back to listings</Link></main>;
}
