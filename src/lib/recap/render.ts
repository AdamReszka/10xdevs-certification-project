import { escapeHtml } from "@/lib/recap/escape-html";
import type {
  RecapAnomaly,
  RecapIntegrationState,
  RecapPayload,
  RenderedEmail,
} from "@/lib/recap/types";

/**
 * Render the Daily Recap to HTML + plain text (S-11, FR-018). PURE.
 *
 * A `.ts` STRING BUILDER, not `react-dom/server`, for two reasons: the hermetic
 * unit project is `include: ["src/**\/*.test.ts"]` (`vitest.config.ts:19`) — `.ts`
 * only, so a `.tsx` renderer would be untestable here — and email HTML wants
 * table-based, inline-styled markup that React buys nothing for.
 *
 * NO EXTERNAL ASSETS, NO `<script>`, NO `<style>` BLOCK. Mail clients strip or
 * ignore all three, and a remote image would leak a read receipt.
 *
 * EVERY interpolated external string goes through `escapeHtml` — ticket
 * summaries, PR titles and developer names arrive from the team's Jira and
 * GitHub, and the renderer is the last place they can be neutralized.
 *
 * SEVERITY ORDER IS THE READER'S ORDER. `listAnomaliesForSprint` already sorts
 * HIGH → MEDIUM → LOW by leaning on the Postgres enum's declaration order
 * (`reader.ts:12-15`); re-sorting here alphabetically would put HIGH after LOW.
 * This module never sorts.
 */

const SEVERITY_COLOR: Record<RecapAnomaly["severity"], string> = {
  HIGH: "#b91c1c",
  MEDIUM: "#b45309",
  LOW: "#3f6212",
};

const INTEGRATION_LABEL = { GITHUB: "GitHub", JIRA: "Jira" } as const;

/** `null` churn renders as an em dash. NEVER as `0` — see `activity-grid.ts:18-24`. */
function churn(value: number | null): string {
  return value === null ? "—" : `${value >= 0 ? "+" : ""}${value}`;
}

function formatSyncLine(name: keyof typeof INTEGRATION_LABEL, state: RecapIntegrationState): string {
  const label = INTEGRATION_LABEL[name];
  if (!state.lastSuccessfulSyncAt) return `${label}: never synced`;
  return `${label}: last synced ${state.lastSuccessfulSyncAt}`;
}

/** The integrations that are not currently OK, so the email can name them. */
function failingIntegrations(payload: RecapPayload): string[] {
  return (["GITHUB", "JIRA"] as const)
    .filter((k) => payload.syncState[k].status !== null && payload.syncState[k].status !== "OK")
    .map((k) => INTEGRATION_LABEL[k]);
}

export function renderRecapEmail(payload: RecapPayload): RenderedEmail {
  const count = payload.anomalies.length;
  const sprintName = payload.sprint.name ?? "your sprint";
  const subject =
    count === 0
      ? `SprintFlow: no anomalies today — ${payload.dayKey}`
      : `SprintFlow: ${count} anomal${count === 1 ? "y" : "ies"} on ${sprintName} — ${payload.dayKey}`;

  return { subject, html: renderHtml(payload, subject), text: renderText(payload) };
}

// --- HTML -------------------------------------------------------------------

function renderHtml(payload: RecapPayload, subject: string): string {
  const failing = failingIntegrations(payload);

  const parts: string[] = [
    `<div style="margin:0;padding:24px 0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:8px">`,
    `<tr><td style="padding:24px 24px 8px 24px">`,
    `<h1 style="margin:0;font-size:18px;line-height:1.4">${escapeHtml(subject)}</h1>`,
    `<p style="margin:4px 0 0 0;font-size:13px;color:#52525b">Sprint day ${
      payload.sprint.dayNumber ?? "—"
    } of ${payload.sprint.totalDays ?? "—"}</p>`,
    `</td></tr>`,
  ];

  if (failing.length > 0) {
    // The recap now sends even on a tick where the sync threw, so an email with
    // no such banner would present cached data as current — the PRD's
    // graceful-degradation guardrail run backwards.
    parts.push(
      `<tr><td style="padding:8px 24px">`,
      `<p style="margin:0;padding:10px 12px;background:#fef2f2;border-left:3px solid #b91c1c;font-size:13px;color:#7f1d1d">`,
      `Heads up — ${escapeHtml(failing.join(" and "))} did not sync successfully, so some of this may be out of date.`,
      `</p></td></tr>`,
    );
  }

  parts.push(
    `<tr><td style="padding:16px 24px 0 24px">`,
    `<h2 style="margin:0 0 8px 0;font-size:15px">Anomalies</h2>`,
    payload.anomalies.length === 0 ? renderEmptyHtml() : payload.anomalies.map(renderAnomalyHtml).join(""),
    `</td></tr>`,
    renderSprintHtml(payload),
    renderActivityHtml(payload),
    renderFooterHtml(payload),
    `</table></div>`,
  );

  return parts.join("");
}

/**
 * The zero-anomaly block. NEVER an empty section: `lessons.md` #6 — an empty
 * result that reads as success is the failure mode, and the reader must be able
 * to tell "nothing found" from "we failed to look".
 */
function renderEmptyHtml(): string {
  return (
    `<p style="margin:0;padding:12px;background:#f0fdf4;border-left:3px solid #16a34a;font-size:14px;color:#14532d">` +
    `No anomalies detected today. SprintFlow checked every rule and none of them fired.` +
    `</p>`
  );
}

function renderAnomalyHtml(a: RecapAnomaly): string {
  const label = a.identityLabel ? `${escapeHtml(a.identityLabel)} · ` : "";
  const who = a.memberName ? ` <span style="color:#52525b">· ${escapeHtml(a.memberName)}</span>` : "";
  const risk = a.riskScore !== null ? ` <span style="color:#71717a">· risk ${a.riskScore}</span>` : "";

  // A null `sourceUrl` renders as PLAIN TEXT, not a dead link. Not theoretical:
  // 4 of the 10 emit branches produce null (`developer-inactive.ts:74`,
  // `scope-creep.ts:41`, `sprint-at-risk.ts:78/111/184`).
  const source = a.sourceUrl
    ? `<p style="margin:6px 0 0 0;font-size:13px"><a href="${escapeHtml(a.sourceUrl)}" style="color:#2563eb">Open in ${
        a.sourceUrl.includes("atlassian.net") ? "Jira" : "GitHub"
      }</a></p>`
    : `<p style="margin:6px 0 0 0;font-size:12px;color:#71717a">No direct link — this one is about the sprint or the team, not a single artifact.</p>`;

  return [
    `<div style="margin:0 0 12px 0;padding:12px;border:1px solid #e4e4e7;border-radius:6px">`,
    `<p style="margin:0;font-size:12px;font-weight:600;color:${SEVERITY_COLOR[a.severity]}">${a.severity}</p>`,
    `<p style="margin:2px 0 0 0;font-size:14px;font-weight:600">${label}${escapeHtml(a.description)}${who}${risk}</p>`,
    `<p style="margin:6px 0 0 0;font-size:14px;color:#3f3f46"><strong>Do this:</strong> ${escapeHtml(a.suggestedAction)}</p>`,
    source,
    `</div>`,
  ].join("");
}

function renderSprintHtml(payload: RecapPayload): string {
  const s = payload.sprint;
  const cells = [
    ["Committed SP", s.committedSp ?? "—"],
    ["Remaining SP", s.remainingSp ?? "—"],
    ["In progress", s.byCategory.IN_PROGRESS],
    ["Code review", s.byCategory.CODE_REVIEW],
    ["Testing", s.byCategory.TESTING],
    ["Done", s.byCategory.DONE],
  ];
  return [
    `<tr><td style="padding:8px 24px 0 24px">`,
    `<h2 style="margin:0 0 8px 0;font-size:15px">Sprint progress</h2>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:14px">`,
    cells
      .map(
        ([k, v]) =>
          `<tr><td style="padding:3px 0;color:#52525b">${escapeHtml(String(k))}</td><td style="padding:3px 0;text-align:right;font-weight:600">${escapeHtml(String(v))}</td></tr>`,
      )
      .join(""),
    `</table></td></tr>`,
  ].join("");
}

function renderActivityHtml(payload: RecapPayload): string {
  const a = payload.activity;
  const cells = [
    ["Commits", String(a.commits)],
    ["Lines changed", `${churn(a.additions)} / ${churn(a.deletions)}`],
    ["PRs opened", String(a.prsOpened)],
    ["PRs merged", String(a.prsMerged)],
    ["Reviews", String(a.reviews)],
    ["Tickets moved to Done", String(a.ticketsMovedToDone)],
  ];
  return [
    `<tr><td style="padding:16px 24px 0 24px">`,
    // Team totals only — the PRD Guardrail forbids per-developer framing, and a
    // per-person table in an email is exactly that.
    `<h2 style="margin:0 0 8px 0;font-size:15px">Yesterday's team activity</h2>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:14px">`,
    cells
      .map(
        ([k, v]) =>
          `<tr><td style="padding:3px 0;color:#52525b">${escapeHtml(k)}</td><td style="padding:3px 0;text-align:right;font-weight:600">${escapeHtml(v)}</td></tr>`,
      )
      .join(""),
    `</table></td></tr>`,
  ].join("");
}

function renderFooterHtml(payload: RecapPayload): string {
  return [
    `<tr><td style="padding:20px 24px 24px 24px;border-top:1px solid #e4e4e7">`,
    `<p style="margin:12px 0 0 0;font-size:12px;color:#71717a">`,
    // Freshness per integration, the same signal the dashboard's SyncStatusBar
    // carries. NEVER `lastError`.
    `${escapeHtml(formatSyncLine("GITHUB", payload.syncState.GITHUB))}<br>`,
    `${escapeHtml(formatSyncLine("JIRA", payload.syncState.JIRA))}<br>`,
    `Times in ${escapeHtml(payload.timeZone ?? "UTC")}. Change when this arrives, or turn it off, in SprintFlow → Settings → Daily recap.`,
    `</p></td></tr>`,
  ].join("");
}

// --- Plain text -------------------------------------------------------------

function renderText(payload: RecapPayload): string {
  const failing = failingIntegrations(payload);
  const lines: string[] = [
    `SprintFlow daily recap — ${payload.dayKey}`,
    `Sprint day ${payload.sprint.dayNumber ?? "—"} of ${payload.sprint.totalDays ?? "—"}`,
    "",
  ];

  if (failing.length > 0) {
    lines.push(
      `Heads up: ${failing.join(" and ")} did not sync successfully, so some of this may be out of date.`,
      "",
    );
  }

  lines.push("ANOMALIES");
  if (payload.anomalies.length === 0) {
    lines.push("No anomalies detected today. SprintFlow checked every rule and none of them fired.");
  } else {
    for (const a of payload.anomalies) {
      const head = [a.severity, a.identityLabel || null, a.description].filter(Boolean).join(" · ");
      lines.push(`- ${head}`);
      if (a.memberName) lines.push(`  who: ${a.memberName}`);
      lines.push(`  do this: ${a.suggestedAction}`);
      lines.push(a.sourceUrl ? `  link: ${a.sourceUrl}` : "  link: none — sprint- or team-scoped");
      lines.push("");
    }
  }

  const s = payload.sprint;
  const a = payload.activity;
  lines.push(
    "",
    "SPRINT PROGRESS",
    `  committed SP: ${s.committedSp ?? "—"}`,
    `  remaining SP: ${s.remainingSp ?? "—"}`,
    `  in progress / code review / testing / done: ${s.byCategory.IN_PROGRESS} / ${s.byCategory.CODE_REVIEW} / ${s.byCategory.TESTING} / ${s.byCategory.DONE}`,
    "",
    "YESTERDAY'S TEAM ACTIVITY",
    `  commits: ${a.commits}`,
    `  lines changed: ${churn(a.additions)} / ${churn(a.deletions)}`,
    `  PRs opened / merged: ${a.prsOpened} / ${a.prsMerged}`,
    `  reviews: ${a.reviews}`,
    `  tickets moved to Done: ${a.ticketsMovedToDone}`,
    "",
    formatSyncLine("GITHUB", payload.syncState.GITHUB),
    formatSyncLine("JIRA", payload.syncState.JIRA),
    `Times in ${payload.timeZone ?? "UTC"}. Change when this arrives, or turn it off, in SprintFlow → Settings → Daily recap.`,
  );

  return lines.join("\n");
}
