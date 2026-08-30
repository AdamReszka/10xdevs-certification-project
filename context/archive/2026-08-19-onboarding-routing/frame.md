# Frame Brief: First-run destination for a new SprintFlow account

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

`/setup` is orphaned. The four wizard pages exist and are reachable only by
hand-typing the URL: `grep -rn '/setup' src --include='*.tsx'` returns **not one
`href`** — every hit is a module import from Settings reusing a wizard component.
A newly signed-up account is pushed to `/dashboard`
(`signup-form.tsx:60`, `login-form.tsx:56`, `(auth)/layout.tsx:36`), which today
renders the full S-07/S-10 surface against an empty account. Nothing consumes
`isOnboardingComplete` (`src/lib/onboarding.ts`) — its only reference is its own
integration test.

## Initial Framing (preserved)

- **User's stated cause or approach**: first-run *routing* is missing — post-signup
  (and on sign-in while onboarding is incomplete) the user should land in `/setup`
  instead of `/dashboard`.
- **User's proposed direction**: consume the existing predicate and redirect;
  the mechanical half (which owner id, which call site) deferred to `/10x-plan`.
- **Pre-dispatch narrowing** (2026-08-29):
  - Symptom: *"właściwie oba jako jeden objaw"* — unreachable wizard and
    dashboard-of-zeros are one hole. Position taken: *"jeśli nie ma na początku
    podpiętych GitHuba oraz Jiry, to pierwsze co się odpala, to kreator; potem już
    w settingsach się edytuje"*, plus an explicit ask for *"jakiś ekran powitalny —
    zaczynamy, podepnij to i to"*.
  - Scope: post-signup **and** the returning incomplete user; leaving setup should
    be *"świadome pytanie"*; also an open question raised as a question, not a
    claim: *"jeśli damy komuś możliwość opuszczenia setupu, to system będzie dobrze
    działał? Chyba nie"*.
  - Persona at risk: **the curious visitor without credentials** — the one the
    wizard's PAT/token wall bounces.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Un-onboarded degradation** — if gated surfaces break or lie on an empty
   account, a hard wizard gate is mandatory and an exit is unsafe.
2. **The predicate as a routing gate** — if `isOnboardingComplete` is a fit gate
   signal, "redirect while false" is the whole change.
3. **Demo as a second first-run destination** — if demo is genuinely usable with
   zero credentials, the PRD promises two entrances and routing must express both.
4. **The wizard's doorstep** — the wizard may be missing not a *route* but a
   *front door*: a step 0 that says what SprintFlow needs. ← part of initial framing

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| **1. Letting someone leave setup breaks the system** | No gated page throws on an empty account. `anomaly-inbox.tsx:85` renders `"No active sprint"` with honest copy; `sync-status-bar.tsx:35` prints `"never synced"`; `refinement/page.tsx:19-23` degrades a Jira failure to a banner *by design*; `settings/connections/page.tsx:59` has a not-connected branch; `sprint-detail/page.tsx:94` renders a null-sprint shape. The app un-onboarded is **empty and honest about it**, not broken. | **NONE (falsified)** |
| **2. The predicate is the routing gate** | Two breaks. (a) **Reversible on a healthy account**: `disconnectGithub` (`setup/github/actions.ts:163`) is wired into Settings (`settings/connections/page.tsx:11`), and `roster-store.ts:671,723` deletes members — a lead rotating a PAT flips the predicate false and a gate would eject them *out of the Settings page holding the reconnect button*. (b) **Blind to the visitor's choice**: at signup `active_workspace` defaults to `REAL`, so the predicate is false and a gate fires **before** the visitor can ever reach `/settings/demo` — the exact trap. | **STRONG (against a naive gate)** |
| **3. Demo is a real second entrance** | `loadDemoAction` (`settings/demo/actions.ts:53-62`) needs only `realOwnerId` — **no credentials at all** — then sets `active_workspace = 'DEMO'`. But it is signposted **nowhere**: the landing page offers only Sign in / Get started (`src/app/page.tsx:13,16`), `/settings/demo` is linked only from the Settings tab list (`settings/layout.tsx:28`) and from the demo banner, which renders only once you are *already* in demo (`demo-banner.tsx:47`). US-02's "signs up, clicks Load demo team" is four unlabelled steps away. | **STRONG** |
| **4. The wizard has no doorstep** | `/setup` is a bare `redirect("/setup/github")` (`setup/page.tsx:8`). Step 1 is `title="Connect GitHub"` / *"Connect a classic personal access token…"* (`setup/github/page.tsx:43-44`); the shell counts `totalSteps = 3` (`setup-wizard-shell.tsx:17`). There is no screen that says what to prepare, no mention of demo, no step 0. | **STRONG** |

## Narrowing Signals

- **The user's own hypothesis is falsified by the code.** "Chyba nie [zadziała]" is
  wrong in the crash sense: every surface already degrades to an honest empty state.
  What an un-onboarded account gets is a *useless* product, not a *broken* one —
  which makes a conscious exit safe to offer, and makes the gate a UX decision
  rather than a correctness one.
- **The dashboard already assumes a route that does not exist.** `anomaly-inbox.tsx:86`
  tells the lead to point SprintFlow at a project *"in setup"* — as plain prose,
  with no link. The copy was written against a wizard the UI never connected.
- **The two personas the owner named are already distinguished by a first-class
  column** — `user.active_workspace`, read by `resolveWorkspace()`
  (`src/lib/workspace.ts`). It is not the onboarding predicate, and it is set
  only *after* the visitor makes a choice the product currently gives them no
  place to make.
- **The redirect cannot live in middleware** (`src/middleware.ts` SECURITY NOTE:
  optimistic cookie check, no DB) — unchanged from the earlier note, and it
  further narrows this to a rendered surface rather than an edge rule.

## Cross-System Convention

Every comparable product that needs third-party credentials opens first-run on a
*welcome / what-you-will-need* screen and only then on the credential form; the
credential form as screen one is the outlier. This project already applies the
same instinct one layer down — the wizard's own forms branch on whether the caller
is the 3-step flow or a one-off Settings visit (`github-connect-form.tsx:59-66`),
i.e. context-awareness at the entry point is an established house pattern, just
never applied at the entrance to the wizard itself. S-09 shipped demo with no
first-run entry point and did not decide one (`context/archive/2026-08-28-demo-mode/`
records no first-run/discoverability decision) — the gap is inherited, not new.

## Reframed Problem Statement

> **The actual problem to plan around is**: SprintFlow has no first-run surface at
> all — no screen where a new account is told what the product needs, what to
> prepare, and that there are two ways in (connect real data, or explore the demo).
> "Missing routing" is a symptom of that absence, and routing alone cannot fix it,
> because a redirect can only ever name ONE destination while the PRD promises two.

The initial framing ("wire post-signup routing to `/setup`") is not wrong so much as
*insufficient*, and shipping only it forces the sacrifice the owner already
flinched at: a hard gate to `/setup/github` puts the person the owner is most
worried about losing — the curious visitor without credentials — in front of a PAT
field, with `/settings/demo` behind the same guard. Once the destination is a
doorstep rather than a credential form, the two PRD promises stop competing:
Access Control's *"on success, the user lands in the setup wizard"* is honoured
(the wizard is what they land in), and US-02's demo path is honoured (it is one of
the doorstep's two doors). The owner's "wyjście musi być świadome" instinct then
becomes cheap to satisfy rather than risky: hypothesis 1 is falsified, so leaving
costs the user an empty-but-honest product, not a broken one.

## Confidence

**HIGH** — hypothesis 1 is falsified by direct reads of every gated surface;
hypotheses 3 and 4 are confirmed by absence checks that would have failed loudly
if the reframe were wrong (zero `href` to `/setup`; demo linked only from inside
Settings and from a banner visible only in demo); hypothesis 2's two breaks are
each grounded in a specific wired call site. The inverse check — "if the product
had a first-run surface, what would we expect to see?" — returns nothing, in all
three places it would have to exist.

## What Changes for /10x-plan

Plan the **first-run destination**, not the redirect. The unit of work is a wizard
step 0 (owned by `/setup`, which is a bare redirect today) that states what
SprintFlow needs, what to prepare, and offers both doors — connect now, or load
the demo. The routing question then reduces to *who is sent to that doorstep and
how they leave it*, and the deferred mechanical questions inherit a sharper shape:

- The gate must not fire on `active_workspace = 'DEMO'` — the visitor's choice is
  already recorded there, and it is a better signal than the predicate.
- Whatever gate ships must not eject a lead from `/settings/**` when the predicate
  flips false mid-life (disconnect for a token rotation is a supported flow).
- Whether the predicate's 6 conditions match the owner's stated mental model
  ("GitHub i Jira podpięte") — it also requires ≥1 status mapping and ≥1 team
  member — is now a question the doorstep's copy has to answer honestly.

## References

- Orphaned wizard: `src/app/(app)/setup/page.tsx:8`, `src/app/(app)/setup/github/page.tsx:43`, `src/components/templates/setup-wizard-shell.tsx:17`
- Push targets: `src/components/organisms/auth/signup-form.tsx:60`, `login-form.tsx:56`, `src/app/(auth)/layout.tsx` → `redirect("/dashboard")`
- Predicate: `src/lib/onboarding.ts`; reversibility: `src/app/(app)/setup/github/actions.ts:163`, `src/lib/integrations/roster-store.ts:671,723`
- Demo: `src/app/(app)/settings/demo/actions.ts:53-62`, `src/lib/workspace.ts`, `src/app/(app)/settings/layout.tsx:28`, `src/components/organisms/demo/demo-banner.tsx:47`
- Degradation: `src/components/organisms/anomaly/anomaly-inbox.tsx:85`, `src/components/organisms/dashboard/sync-status-bar.tsx:35`, `src/app/(app)/refinement/page.tsx:19`
- Gate placement constraint: `src/middleware.ts` (SECURITY NOTE)
- Prior art (no first-run decision recorded): `context/archive/2026-08-28-demo-mode/`
- Investigation: direct reads (no sub-agents — surface is 5 files + 4 checks; research deliberately skipped for this change)
