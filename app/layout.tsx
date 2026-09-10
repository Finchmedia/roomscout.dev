import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ClerkProvider, Show, SignInButton, UserButton } from "@clerk/nextjs";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoomScout Community Portal",
  description: "A controlled rehearsal-room portal used to test public discovery and consent-based messaging.",
  icons: { icon: "/favicon.png", apple: "/apple-touch-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <ClerkProvider>
          <ConvexClientProvider>
            <header className="site-header">
              <Link className="brand" href="/"><Image alt="" className="brand-mark" height={22} priority src="/logo.png" width={22} />RoomScout Community</Link>
              <nav aria-label="Primary navigation">
                <Link href="/">Listings</Link>
                <Show when="signed-in"><Link href="/listings/new">Post listing</Link><Link href="/inbox">Messages</Link><UserButton /></Show>
                <Show when="signed-out"><SignInButton><button className="button secondary" type="button">Sign in</button></SignInButton><Link className="button" href="/sign-up">Join</Link></Show>
              </nav>
            </header>
            <div className="demo-banner"><strong>Controlled demo source.</strong> Public listings are crawlable; messages require a real verified portal account.</div>
            {children}
          </ConvexClientProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
