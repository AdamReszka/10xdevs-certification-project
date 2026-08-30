"use client";

import ConfirmDialog from "@/components/molecules/confirm-dialog";
import {
  disconnectClearLabel,
  disconnectDescription,
  disconnectKeepLabel,
  disconnectTitle,
  type DisconnectIntegration,
} from "@/components/molecules/disconnect-confirm-copy";
import type { DisconnectMode } from "@/lib/validations/disconnect";

/**
 * The confirmation in front of every Disconnect (S-24).
 *
 * One component for all four paths — GitHub and Jira, wizard and settings — so
 * they cannot drift apart the way the four cascade docstrings did. It wraps the
 * house `ConfirmDialog` rather than replacing it: the shell already holds itself
 * open through the async Server Action, focuses Cancel first, and carries the
 * destructive variant.
 *
 * The words live in the pure sibling `disconnect-confirm-copy.ts`, which is
 * unit-tested — this repo has no component-test harness, so copy assembled
 * inside a `.tsx` could not be asserted at all (`CLAUDE.md`). Those words in
 * turn come from `DISCONNECT_IMPACT`, which a hermetic test holds equal to the
 * schema's actual foreign-key graph — so this dialog cannot quietly become a lie
 * when a later slice hangs a new cascading child upstream of it.
 */

export type { DisconnectIntegration };

export default function DisconnectConfirmDialog({
  integration,
  open,
  onOpenChange,
  onConfirm,
}: {
  integration: DisconnectIntegration;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the outcome the lead picked. S-26: a disconnect no longer has
   *  one meaning, so the dialog reports WHICH completion was chosen. */
  onConfirm: (mode: DisconnectMode) => Promise<void>;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={disconnectTitle(integration)}
      // A plain string, like all three existing consumers: the description
      // renders inside `AlertDialogDescription` → Radix `Primitive.p`, so a
      // `<ul>` or `<div>` here would be invalid nesting — React warns and the
      // browser breaks the list out of the paragraph, taking the accessible
      // description with it.
      description={disconnectDescription(integration)}
      // The primary action KEEPS, so it is not the destructive variant — the
      // shape `roster-editor.tsx` already uses for Deactivate beside Delete
      // permanently. Until S-26 this component passed no `secondary` at all,
      // with a comment asserting there was no safer alternative to offer. There
      // is one now: it is the default, and the irreversible branch is the one
      // the lead has to reach for by name.
      confirmLabel={disconnectKeepLabel(integration)}
      variant="default"
      onConfirm={() => onConfirm("keep")}
      secondary={{
        label: disconnectClearLabel(integration),
        variant: "destructive",
        onConfirm: () => onConfirm("clear"),
      }}
    />
  );
}
