"use client";

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { Button } from "@/components/ui/button";

/**
 * One reusable confirmation shell (S-15) so every destructive action in the app
 * reads the same: it NAMES what it is about to destroy before doing it.
 *
 * `onConfirm` is async and the dialog stays open with the action disabled while
 * it runs, so a slow Server Action cannot be double-submitted and a failure can
 * surface through the caller's own error path with the dialog already closed.
 *
 * Cancel is the default focus (Radix focuses the first tabbable element in the
 * footer), which is the right default for a destructive prompt.
 */
/** A footer action. The primary one is required; a secondary one sits beside it. */
type ConfirmAction = {
  label: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  onConfirm: () => Promise<void>;
};

export default function ConfirmDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  title,
  description,
  confirmLabel,
  variant = "default",
  onConfirm,
  secondary,
}: {
  /** The control that opens the dialog — rendered via `asChild`. Omit when
   *  driving the dialog with `open` / `onOpenChange`, which is what a caller
   *  needs when the copy depends on data fetched at open time. */
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  /** Say what disappears and what survives; the counts belong here. */
  description: React.ReactNode;
  confirmLabel: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  onConfirm: () => Promise<void>;
  /** An alternative, usually less destructive, way out — e.g. Deactivate beside
   *  a refused Delete. */
  secondary?: ConfirmAction;
}) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  /**
   * WHICH action is running, not merely THAT one is (S-26 plan-review F7).
   *
   * A boolean was enough while the pending label sat only on the primary
   * action. The disconnect dialog makes `secondary` the irreversible branch, so
   * it needs the same progress signal — and rendering "Working…" on both at
   * once would leave two footer buttons with one accessible name, which is
   * exactly the ambiguity `disconnect-confirm-copy.ts` keeps the labels apart
   * to avoid. Both stay disabled either way; only the running one changes its
   * label.
   */
  const [pending, setPending] = useState<"primary" | "secondary" | null>(null);
  const isPending = pending !== null;

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  function setOpen(next: boolean) {
    if (isControlled) onOpenChange?.(next);
    else setUncontrolledOpen(next);
  }

  function runAction(which: "primary" | "secondary", action: () => Promise<void>) {
    return async (event: React.MouseEvent) => {
      // Radix closes on Action click by default; hold it open for the await so
      // the pending state is visible and a second click cannot land.
      event.preventDefault();
      setPending(which);
      try {
        await action();
        setOpen(false);
      } finally {
        setPending(null);
      }
    };
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
      {trigger ? <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger> : null}
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          {secondary ? (
            <AlertDialogAction
              variant={secondary.variant ?? "outline"}
              onClick={runAction("secondary", secondary.onConfirm)}
              disabled={isPending}
            >
              {/* The pending label belongs on BOTH actions, not only the
                  primary one (S-26 plan-review F7). `secondary` started life as
                  the SAFER of the two (Deactivate beside Delete permanently),
                  where being merely disabled was survivable. The disconnect
                  dialog inverts that — its secondary is the irreversible
                  branch — so leaving it silent would give the more dangerous
                  button the weaker feedback while a slow Server Action runs. */}
              {pending === "secondary" ? "Working…" : secondary.label}
            </AlertDialogAction>
          ) : null}
          <AlertDialogAction
            variant={variant}
            onClick={runAction("primary", onConfirm)}
            disabled={isPending}
          >
            {pending === "primary" ? "Working…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
