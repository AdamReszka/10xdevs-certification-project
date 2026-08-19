---
change_id: onboarding-routing
title: First-run routing into the setup wizard + entry point for returning users
status: new
created: 2026-08-19
updated: 2026-08-19
archived_at: null
---

## Notes

Surfaced while manually exercising S-02: `/setup` is reachable only by typing the URL — it has no entry point in the UI.

**Intended design (PRD line 191):** "Sign-up: on success, the user lands in the setup wizard." Setup is a one-time onboarding flow, NOT a permanent nav item — so it correctly should not appear in `main-nav.tsx`.

**The gap (not wired):**
- Sign-up (`signup-form.tsx:60`) and sign-in (`login-form.tsx:56`) both `router.push("/dashboard")`; `(auth)/layout` also redirects authenticated users to `/dashboard`.
- `/dashboard` is a placeholder ("coming in S-07", 22 lines) and does not link to `/setup`.
- No first-run detection exists: nothing routes an un-onboarded user to `/setup`.

Result: `/setup` is orphaned in the UI today — you reach it only by hand-typing the URL.

**Scope to decide/build:**
1. **First-run routing** — after sign-up (and on sign-in while onboarding is incomplete), land the user in `/setup` instead of `/dashboard`; once onboarding is complete, land in `/dashboard`. Needs an "onboarding complete?" signal, which only becomes meaningful once the wizard steps exist (S-03 Jira, S-04 roster/cadence) — so this likely sequences after S-04, or ships incrementally with a partial completeness check.
2. **Returning-user entry to integration management** — reconnecting GitHub / changing repos happens today inside `/setup/github` (the "Connected as… / Disconnect" card), but that lives in the onboarding wizard, not a persistent "Settings" surface. Decide whether integration management gets its own settings entry (distinct from S-14 anomaly settings) or a persistent nav/menu affordance. This is the unpinned "setup-as-onboarding vs settings-as-ongoing-management" question.

Do NOT add "Setup" as a standalone nav item — that contradicts the onboarding-flow intent. Prefer post-signup routing + a "Complete setup" prompt on the dashboard until onboarding is done.

Related: S-04 (`setup-team-roster-cadence`) completes the wizard; S-07 (`dashboard-today`) builds the real dashboard; S-14 (`anomaly-settings-page`) is the anomaly settings surface (not integration management).
