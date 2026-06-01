import Link from "next/link";
import { Radar } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * SprintFlow wordmark lockup — a lucide icon + "SprintFlow" text linking to `/`.
 * Stateless; reused by the app-shell nav and the auth layout.
 */
export default function Brand({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "inline-flex items-center gap-2 font-semibold tracking-tight transition-colors hover:opacity-90",
        className,
      )}
    >
      <Radar className="size-5 text-primary" aria-hidden />
      <span className="text-lg">SprintFlow</span>
    </Link>
  );
}
