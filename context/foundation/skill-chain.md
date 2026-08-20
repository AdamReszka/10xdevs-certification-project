# Łańcuch skilli 10x — proces wytwarzania oprogramowania

Kolejność „co po czym" — od pomysłu do zarchiwizowanej zmiany. Każdy skill z jednym zdaniem opisu.
Łańcuch rozgałęzia się na **greenfield** (nowy projekt) i **brownfield** (istniejący system) po fazie 1.

## Faza 0 — Inicjalizacja

1. **`/10x-init`** — tworzy szkielet katalogu `context/` (`changes/`, `archive/`, `foundation/`); robisz to raz na projekt.

## Faza 1 — Odkrycie i definicja produktu

2. **`/10x-shape`** — prowadzi rozmowę odkrywczą i zamienia pomysł (lub zmianę) w `shape-notes.md`.
3. **`/10x-prd`** — generuje z notatek schematyczny `prd.md`, kierując braki do Open Questions.

> Tu łańcuch rozgałęzia się na greenfield i brownfield.

## Faza 2 — Technologia i fundament (greenfield)

4. **`/10x-tech-stack-selector`** — wybiera starter i stack pod PRD, zapisuje `tech-stack.md`.
5. **`/10x-infra-research`** — bada i rekomenduje platformę wdrożeniową → `infrastructure.md`.
6. **`/10x-bootstrapper`** — scaffolduje faktyczny kod aplikacji na wybranym starterze.

## Faza 2′ — Ocena fundamentu (brownfield)

4b. **`/10x-stack-assess`** — ocenia istniejący stack pod kątem „agent-friendliness" → `stack-assessment.md`.
5b. **`/10x-health-check`** — audytuje zdrowie projektu (zależności, testy, CI) → `health-check.md`.

## Faza 3 — Onboarding agentów i reguły

7. **`/10x-agents-md`** — generuje `AGENTS.md` (przewodnik dla agentów po repo).
8. **`/10x-rule-review`** — recenzuje plik reguł (`CLAUDE.md`/`AGENTS.md`) i daje scorecard z poprawkami.

## Faza 4 — Roadmapa i strategia testów

9. **`/10x-roadmap`** — rozbija PRD na uporządkowane, pionowe slice'y end-to-end → `roadmap.md`.
10. **`/10x-test-plan`** — (brownfield) tworzy fazowy plan wdrażania testów → `test-plan.md`.

## Faza 5 — Pętla pojedynczej zmiany (powtarzana dla każdego slice'a z roadmapy)

11. **`/10x-new`** — zakłada folder `context/changes/<change-id>/` z plikiem tożsamości `change.md`.
12. **`/10x-frame`** — kwestionuje ramowanie problemu (obserwacja vs przyczyna) → `frame.md`. *(opcjonalny)*
13. **`/10x-research`** — bada bazę kodu równoległymi sub-agentami → `research.md`. *(opcjonalny dla małych zmian)*
14. **`/10x-plan`** — tworzy szczegółowy, fazowy plan wdrożenia → `plan.md` + `plan-brief.md`.
15. **`/10x-plan-review`** — recenzuje plan pod kątem substancji, wykonalności i architektury.
16. **`/10x-implement`** — realizuje plan faza po fazie z weryfikacją (główna ścieżka wykonania).
17. **`/10x-tdd`** — alternatywa dla faz nadających się do TDD: red → green → refactor.
18. **`/10x-e2e`** — dla ryzyk wymagających przeglądarki: pisze i weryfikuje testy Playwright.
19. **`/10x-impl-review`** — porównuje implementację z planem (dryf, ryzykowne decyzje, zgodność wzorców).
20. **`/10x-archive`** — przenosi ukończoną zmianę do `context/archive/` i stempluje status.

## Skille przekrojowe (w dowolnym momencie)

21. **`/10x-lesson`** — zapisuje powracającą regułę/pułapkę do `lessons.md`, żeby zasilała przyszłe plany i review.

---

## Skrót — jedna ścieżka „happy path"

**Greenfield:**
`init → shape → prd → tech-stack-selector → infra-research → bootstrapper → agents-md → roadmap →`
*(dla każdego slice'a)* `new → frame → research → plan → plan-review → implement/tdd → e2e → impl-review → archive`

**Brownfield:**
`(init) → shape → prd → stack-assess → health-check → test-plan → roadmap →`
*(dla każdego slice'a)* `new → frame → research → plan → plan-review → implement/tdd → e2e → impl-review → archive`

## Uwagi praktyczne

- **`frame` jest opcjonalny** — używasz go, gdy problem jest podany jako „bug + gotowy fix" albo gdy nie masz pewności *co* właściwie budować; przy jasno zdefiniowanym slice'ie pomijasz go i idziesz od razu do `research`/`plan`.
- **`research` też bywa pomijalny** dla małych, dobrze znanych zmian.
- **`implement` vs `tdd` vs `e2e`** to nie kolejność, tylko wybór narzędzia do danej fazy planu (logika biznesowa → tdd, ścieżka przeglądarkowa → e2e, reszta → implement).
- **`lesson`** odpalasz reaktywnie, kiedy natrafisz na wartą zapamiętania klasę błędu.
