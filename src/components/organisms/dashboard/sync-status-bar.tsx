import { AlertTriangle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import type {
  InboxIntegrationState,
  InboxSyncState,
} from "@/components/organisms/anomaly/types";

/**
 * Per-integration freshness + error surface (S-07, US-01). Always shows the last
 * successful sync time for Jira AND GitHub (separately). When an integration's most
 * recent sync errored (`status ∈ {ERROR, RATE_LIMITED}`), an `Alert` names the
 * failed integration — but the inbox itself is NEVER suppressed on error (the
 * caller still renders the last cached anomalies below this bar).
 */

const LABEL: Record<"GITHUB" | "JIRA", string> = {
  GITHUB: "GitHub",
  JIRA: "Jira",
};

const STATUS_LABEL: Record<"ERROR" | "RATE_LIMITED", string> = {
  ERROR: "error",
  RATE_LIMITED: "rate-limited",
};

/** Friendly, non-leaking guidance per failure status (no raw sync-error text). */
const STATUS_MESSAGE: Record<"ERROR" | "RATE_LIMITED", string> = {
  ERROR: "the connection failed — check that its token is still valid",
  RATE_LIMITED: "the API is rate-limited — SprintFlow will retry automatically",
};

/** UTC `YYYY-MM-DD HH:mm` — deterministic across server render + hydration. */
function formatSyncedAt(iso: string | null): string {
  if (!iso) return "never synced";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function isErrored(s: InboxIntegrationState): boolean {
  return s.status === "ERROR" || s.status === "RATE_LIMITED";
}

export default function SyncStatusBar({
  syncState,
}: {
  syncState: InboxSyncState;
}) {
  const integrations: InboxIntegrationState[] = [syncState.JIRA, syncState.GITHUB];
  const errored = integrations.filter(isErrored);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        {integrations.map((s) => (
          <span key={s.integration}>
            <span className="font-medium text-foreground">
              {LABEL[s.integration]}
            </span>{" "}
            last synced: {formatSyncedAt(s.lastSuccessfulSyncAt)}
          </span>
        ))}
      </div>

      {errored.map((s) => (
        <Alert key={s.integration} variant="destructive">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>
            {LABEL[s.integration]} sync {STATUS_LABEL[s.status as "ERROR" | "RATE_LIMITED"]}
          </AlertTitle>
          <AlertDescription>
            {LABEL[s.integration]}: {STATUS_MESSAGE[s.status as "ERROR" | "RATE_LIMITED"]}.
            Showing the last successfully cached data
            {s.lastSuccessfulSyncAt
              ? ` from ${formatSyncedAt(s.lastSuccessfulSyncAt)}`
              : ""}
            .
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
