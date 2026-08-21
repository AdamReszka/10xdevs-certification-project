import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type {
  InboxAnomaly,
  InboxAnomalyType,
  InboxSeverity,
} from "@/components/organisms/anomaly/types";

const SEVERITY_VARIANT: Record<
  InboxSeverity,
  "destructive" | "default" | "secondary"
> = {
  HIGH: "destructive",
  MEDIUM: "default",
  LOW: "secondary",
};

const TYPE_LABEL: Record<InboxAnomalyType, string> = {
  PR_REVIEW_STALLED: "PR review stalled",
  TICKET_STATUS_AGING: "Ticket status aging",
  DEVELOPER_INACTIVE: "Developer inactive",
  TICKET_NO_COMMIT_LINK: "Ticket no-commit link",
  SPRINT_AT_RISK: "Sprint at risk",
  PR_TOO_BIG: "PR too big",
  SCOPE_CREEP: "Scope creep",
  PR_TICKET_DESYNC: "PR ↔ ticket desync",
};

/** UTC `YYYY-MM-DD HH:mm` — deterministic across server render + client hydration. */
function formatDetectedAt(iso: string | null): string | null {
  if (!iso) return null;
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * One Anomaly Inbox row (S-07) — the five FR-014 attributes plus the risk score:
 * severity (badge), description, contextual data (identity + chips + member +
 * when), one-line suggested action, and the source deep-link.
 */
export default function AnomalyRow({ anomaly }: { anomaly: InboxAnomaly }) {
  const detectedLabel = formatDetectedAt(anomaly.detectedAt);

  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={SEVERITY_VARIANT[anomaly.severity]}>{anomaly.severity}</Badge>
        <Badge variant="outline">{TYPE_LABEL[anomaly.type]}</Badge>
        {anomaly.identityLabel ? (
          <span className="font-mono text-sm text-muted-foreground">
            {anomaly.identityLabel}
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1.5 text-sm">
          <span className="text-muted-foreground">Risk</span>
          <span className="font-semibold tabular-nums">
            {anomaly.riskScore ?? "—"}
          </span>
        </span>
      </div>

      <p className="text-sm font-medium">{anomaly.description}</p>

      {anomaly.contextChips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {anomaly.contextChips.map((chip) => (
            <span
              key={chip}
              className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
            >
              {chip}
            </span>
          ))}
        </div>
      ) : null}

      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Suggested action: </span>
        {anomaly.suggestedAction}
      </p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{anomaly.memberName ?? "Team-level"}</span>
        {detectedLabel ? <span>Detected {detectedLabel}</span> : null}
        {anomaly.sourceUrl ? (
          <a
            href={anomaly.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              "inline-flex items-center gap-1 text-foreground underline-offset-4 hover:underline",
            )}
          >
            View source
            <ExternalLink className="size-3" aria-hidden />
          </a>
        ) : null}
      </div>
    </div>
  );
}
