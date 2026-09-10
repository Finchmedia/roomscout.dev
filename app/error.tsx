"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="narrow empty"><h1>The portal hit an error</h1><p>The controlled flow stopped without guessing or replaying a write.</p><button className="button" onClick={reset} type="button">Try again</button></main>;
}
