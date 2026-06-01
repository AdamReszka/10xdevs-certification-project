import type { ReactNode } from "react";

import Brand from "@/components/atoms/brand";

/**
 * Minimal centered layout for the auth pages — no app nav (auth pages shouldn't
 * show the dashboard shell). The `(auth)` route group adds no URL segment, so
 * children resolve to `/login`, `/signup`, `/reset` (matches middleware.ts).
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <Brand />
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
