"use client";

import ConfirmDialog from "@/components/molecules/confirm-dialog";
import {
  disconnectConfirmLabel,
  disconnectDescription,
  disconnectTitle,
  type DisconnectIntegration,
} from "@/components/molecules/disconnect-confirm-copy";

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
  onConfirm: () => Promise<void>;
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
      confirmLabel={disconnectConfirmLabel(integration)}
      variant="destructive"
      // No `secondary`: unlike a member delete, there is no safer alternative to
      // offer here. Reconnect is a different button, not a way out of this one.
      onConfirm={onConfirm}
    />
  );
}
