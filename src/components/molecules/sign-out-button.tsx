"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * Sign-out trigger for the authenticated header. Composed into AppShell's
 * existing `actions` slot by `(app)/layout.tsx` — AppShell itself is untouched.
 *
 * After clearing the session cookie we both push to /login and refresh so the
 * server re-evaluates the now-absent session (the optimistic middleware cookie
 * is gone, the authoritative requireSession() will fail closed).
 */
export default function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await authClient.signOut();
      router.push("/login");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleSignOut}
      disabled={pending}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
