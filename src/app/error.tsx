"use client";

import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";

import Brand from "@/components/atoms/brand";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * The app's only error boundary (S-21 Phase 4). Before this file there was no
 * `error.tsx`, `global-error.tsx` or `not-found.tsx` anywhere in `src/app`: a
 * gated render that threw had nowhere to land, which is half of why
 * `requireSession` could only ever answer a failed session lookup by redirecting
 * to `/login`.
 *
 * ROOT-LEVEL, NOT `(app)`-LEVEL, and that placement is load-bearing. Next's rule
 * is that "error.js does not catch errors thrown in layout.js or template.js
 * within the same segment" — and `requireSession()` is called in
 * `(app)/layout.tsx`, so a boundary at `src/app/(app)/error.tsx` would never
 * fire for the case this phase exists to handle.
 *
 * `reset`, not `retry`: the installed Next is 16.2.6, whose boundary props are
 * `{ error, reset, unstable_retry }` (`next/dist/client/components/error-boundary.d.ts`).
 * The stable `retry` prop only lands in 16.3.
 *
 * Renders NEITHER `error.message` NOR the cause. A driver error quotes the
 * connection string, and the PRD guardrail is that no token or DSN material ever
 * reaches a client-facing payload. The server log already has the full error;
 * `digest` is Next's opaque hash and is the only thing that ties what the user
 * sees to what was logged.
 *
 * It must not call `getOptionalSession` — the boundary for a failed session
 * lookup cannot itself depend on one.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Message only, never the error object: `cause` carries the driver error.
    console.error("[error-boundary]", error.message);
  }, [error]);

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <Brand />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TriangleAlert className="size-5 text-destructive" aria-hidden />
            Something went wrong
          </CardTitle>
          <CardDescription>
            SprintFlow couldn&apos;t load this page. This is usually temporary —
            try again in a moment. You are still signed in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Button onClick={reset} className="w-fit">
            <RotateCw className="size-4" aria-hidden />
            Try again
          </Button>
          {error.digest ? (
            <p className="text-xs text-muted-foreground">
              Reference: {error.digest}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
