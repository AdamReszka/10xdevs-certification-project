# UI Component Foundation (F-03) — Plan Brief

> Full plan: `context/changes/ui-component-foundation/plan.md`
> Research: `context/changes/ui-component-foundation/research.md`

## What & Why

F-03 is the UI foundation slice. The shadcn/ui *infrastructure* is already wired (config, OKLCH tokens, `cn()`, atomic-design folders) but no UI has been built and no component has ever been rendered. This plan adds the shadcn component set, builds the app shell + base layout, and creates the three auth page shells — proving the shadcn + Tailwind CSS 4 wiring renders with no style regression (the roadmap's explicit gate) and unblocking S-01 (auth flow) and every later UI slice.

## Starting Point

`src/components/ui/` is empty; `layout.tsx` is the unmodified create-next-app default; `page.tsx` is a raw-Tailwind landing with no shadcn. The auth backend already exists from F-01 (`middleware.ts`, Better Auth, `/api/auth`), and `middleware.ts:21` already whitelists `/login`, `/signup`, `/reset` — but those pages don't exist yet (they 404), and the landing `/` is currently gated (redirects to a 404 `/login`).

## Desired End State

Visiting `/` shows the SprintFlow landing inside a full styled `AppShell` (branded nav + Sign in / Get started actions + footer) with real shadcn `Button`s styled correctly in light and dark. Visiting `/login`, `/signup`, `/reset` shows centered placeholder auth cards (Card/Input/Label/Button) — no redirect, no 404 — visibly ready for S-01 to wire. Build + lint pass.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Base layout scope | Full styled nav | User wants a finished-looking shell, not a placeholder stub | Plan |
| Nav auth state | Public actions (Sign in / Get started) on landing; sign-out deferred to S-01 | Full nav with no session would mean guessing session UI; this avoids throwaway code | Plan |
| baseColor discrepancy | Keep `zinc`, fix CLAUDE.md | Installed config + tokens are already zinc; cheaper than regenerating tokens | Research → Plan |
| Component set | Full form kit (Button, Input, Label, Card, Form, Sonner + nav primitives) | S-01 + shell need them; shells render as real forms, not empty divs | Plan |
| Verification | Build + lint + manual visual | Matches the roadmap gate; no test framework pulled into a UI scaffold | Plan |
| Auth page routing | `(auth)` route group with shared centered layout | Keeps URLs at `/login` etc. (matches middleware contract) without an app nav | Research → Plan |

## Scope

**In scope:** shadcn component install; `AppShell` template (nav/main/footer); brand atom + nav molecule; root-layout metadata + Sonner toaster; make `/` public; retrofit landing into the shell; `(auth)` layout + three placeholder auth forms + route pages; fix CLAUDE.md baseColor line.

**Out of scope:** auth wiring / submit handlers (S-01), authenticated sign-out/user-menu nav variant, dashboard/setup pages, test framework, any data/API/business logic, token regeneration.

## Architecture / Approach

Atomic design per CLAUDE.md: shadcn primitives → `ui/`; `Brand` → `atoms/`; `MainNav` → `molecules/`; auth forms → `organisms/auth/`; `AppShell` + auth layout → `templates/` / route-group layout. Landing `/` renders `<AppShell>`; auth pages use a `(auth)` route group (no URL segment) with a centered card layout. `middleware.ts` gains `"/"` in its public prefixes (exact-match safe) so the landing is reachable.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. shadcn components + config | `ui/` populated; baseColor doc fixed; build/lint green | shadcn add against TW4 path misbehaves (low — infra verified) |
| 2. App shell + base layout | Styled nav + landing in shell; metadata; toaster; `/` public | Touching F-01's `middleware.ts`; verifying no token/style regression |
| 3. Auth page shells | `/login` `/signup` `/reset` placeholder cards | Route-group URLs must match middleware contract exactly |

**Prerequisites:** F-01 (auth backend, done) and F-02 (done) already landed; shadcn infra already wired.
**Estimated effort:** ~1 session across 3 phases (small, no business logic).

## Open Risks & Assumptions

- `lucide-react@^1.17.0` is an unusual pin (mainline is `0.x`) — verify icons render on first use; non-blocking.
- Full styled nav on a not-yet-authenticated product means the sign-out/user-menu variant will be added (not reworked) in S-01 — accepted tradeoff.
- Adding `"/"` to `PUBLIC_PREFIXES` must not inadvertently open child routes — relies on `isPublic()` exact-match behavior (verified in research).

## Success Criteria (Summary)

- `/` renders the SprintFlow landing inside a styled nav shell with correctly-styled shadcn components in light + dark — no style regression.
- `/login`, `/signup`, `/reset` render centered placeholder auth cards (no redirect, no 404), ready for S-01.
- `npm run build` and `npm run lint` pass; tab title reads "SprintFlow".
