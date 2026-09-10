"use client";

import { useUser } from "@clerk/nextjs";
import { useAction, useConvexAuth } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";

export function PortalIdentitySync() {
  const { user } = useUser();
  const { isAuthenticated } = useConvexAuth();
  const syncMe = useAction(api.portalIdentity.syncMe);
  const syncedUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user?.id || syncedUserId.current === user.id) {
      return;
    }
    syncedUserId.current = user.id;
    void syncMe({}).catch((error: unknown) => {
      syncedUserId.current = null;
      console.error("Unable to sync the portal notification identity", error);
    });
  }, [isAuthenticated, syncMe, user?.id]);

  return null;
}
