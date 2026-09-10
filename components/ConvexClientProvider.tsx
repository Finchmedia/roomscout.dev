"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useState } from "react";
import { PortalIdentitySync } from "@/components/PortalIdentitySync";

export function ConvexClientProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => {
    const deploymentUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!deploymentUrl) {
      throw new Error("NEXT_PUBLIC_CONVEX_URL is required for realtime listings.");
    }
    return new ConvexReactClient(deploymentUrl);
  });

  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      <PortalIdentitySync />
      {children}
    </ConvexProviderWithClerk>
  );
}
