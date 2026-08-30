"use client";

import ConfirmDialog from "@/components/molecules/confirm-dialog";
import {
  DISCONNECT_IMPACT,
  joinClauses,
} from "@/lib/integrations/disconnect-impact";

/**
 * The confirmation in front of every Disconnect (S-24).
 *
 * One component for all four paths — GitHub and Jira, wizard and settings — so
 * they cannot drift apart the way the four cascade docstrings did. It wraps the
 * house `ConfirmDialog` rather than replacing it: the shell already holds itself
 * open through the async Server Action, focuses Cancel first, and carries the
 * destructive variant.
 *
 * The copy comes from `DISCONNECT_IMPACT`, which a hermetic test holds equal to
 * the schema's actual foreign-key graph — so this dialog cannot quietly become a
 * lie when a later slice hangs a new cascading child upstream of it.
 */

const INTEGRATION_LABEL = {
  github: "GitHub",
  jira: "Jira",
} as const;

export type DisconnectIntegration = keyof typeof INTEGRATION_LABEL;

/**
 * The confirm label deliberately differs from the trigger label ("Disconnect"),
 * so the dialog's action and the button behind it are distinguishable — to a
 * screen-reader user and to Playwright alike. E2E locators additionally need
 * `{ exact: true }`, because `getByRole`'s name match is a case-insensitive
 * SUBSTRING: with the dialog open, "Disconnect" matches both nodes and
 * "Connect" matches three.
 */
export function disconnectConfirmLabel(integration: DisconnectIntegration): string {
  return `Disconnect ${INTEGRATION_LABEL[integration]}`;
}

/** The prose the dialog shows. Exported so a test can read it without a DOM. */
export function disconnectDescription(integration: DisconnectIntegration): string {
  const impact = DISCONNECT_IMPACT[integration];
  return (
    `This deletes ${joinClauses(impact.destroys)}. ` +
    `It keeps ${joinClauses(impact.keeps)}. ` +
    `Reconnecting re-syncs what ${INTEGRATION_LABEL[integration]} still holds, ` +
    `but nothing entered by hand comes back.`
  );
}

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
  const label = INTEGRATION_LABEL[integration];

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Disconnect ${label}?`}
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
