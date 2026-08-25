# S-15 — manual checklist (owner side)

> Everything left that a human has to look at before PR #49 goes ready.
> Automated checks are all green at HEAD and are **not** repeated here:
> 350 unit tests, 121 integration tests, `typecheck`, `lint`, and a production
> build that lists `/settings/team` among the routes.

**How this file relates to `plan.md` `## Progress`** (which stays canonical):

- Every row below carries the number of the **phase it belongs to**. Tick it in
  that phase in `## Progress` as it passes.
- Rows **1.8, 1.9, 2.6–2.9, 3.5–3.7** are already ticked there. They were
  verified in-session by throwaway-account simulations that drove the real
  service functions and Server Actions against local Postgres, printing
  before/after state. They are listed here in **§E** so you can re-run them by
  hand if you want eyes on the UI rather than on a transcript — but they are not
  blocking.
- **Przycięte 2026-08-25 pod termin kursu.** Zamknięte w sesji: 2.6, 3.5, 3.6,
  4.4, 4.8. Pozostałe browser-only wiersze (4.6, 4.9, 5.5, 5.6, 5.7, 3.7)
  przeniesione do `context/foundation/manual-test-backlog.md` §7 z uzasadnieniem.
  Zostały **cztery** pozycje niżej — patrz `CLAUDE.md` → *Manual testing
  conventions*.

## Before you start

1. Local Supabase up (`npx supabase status`), migrations applied.
2. `npm run dev` (not `wrangler dev` — `next dev` is what points at local
   Supabase on `:54322`).
3. Sign in and go to `/settings/team`.

### ⚠️ Which account — they are not interchangeable

`demo@sprintflow.test` holds the **real** GitHub/Jira credentials on this
machine; `adam.reszka85@gmail.com` holds the seeded fakes. The naming is
inverted from what you would guess, so **identify the target by the token's
last4, never by the account name.**

`npm run db:seed:demo` **deletes both credential tables for its target account**.
Never point it at the account holding real credentials. Nothing in this checklist
requires re-seeding — every row below works on an account that already has a
roster, and the destructive rows create and remove their own members.

---

## Co zostało — 4 pozycje, ~25 minut

Reszta wierszy tej checklisty została **świadomie przeniesiona** do
`context/foundation/manual-test-backlog.md` §7 wraz z powodem. To nie jest
„niepotrzebne" — to jest odłożone pod termin kursu.

Konto: **`demo@sprintflow.test`** (to ono ma prawdziwe credentiale — nazwa myli,
patrz ostrzeżenie wyżej). `npm run dev`, potem `/settings/team`.

---

- [ ] **5.3 + 5.4 — dotarcie do zakładki Team** *(faza 5)*

  **Gdzie:** dowolna strona aplikacji, główna nawigacja.
  **Co zrobić:** kliknij **Settings** w głównej nawigacji. Potem kliknij zakładkę
  **Team**. Potem wejdź na `/settings/connections/github`.
  **Co musi być prawdą:**
  - Settings otwiera się na **Connections**, a obok niej stoi zakładka **Team**.
  - Kliknięcie **Team** pokazuje grid rosteru z Twoimi trzema osobami.
  - Aktywna zakładka jest wizualnie odróżnialna **na obu** — sprawdź stojąc na
    Connections i stojąc na Team.
  - Na `/settings/connections/github` podświetlona jest nadal **Connections**,
    nie Team.
  **Dlaczego to ma znaczenie:** to jedyna droga do całej fazy 5. Jeśli nawigacja
  nie działa, funkcja jest zbudowana i niedostępna — a tego żaden test
  automatyczny nie złapie, bo wszystkie wchodzą na route bezpośrednio.

- [x] **4.5 — trwałe usunięcie czystego członka** *(faza 4)*

  **Gdzie:** `/settings/team`. **Odśwież stronę (F5) zanim zaczniesz.**
  **Co zrobić:** kliknij kosz przy **`Rocky Testowy`** (0 absencji, 0 anomalii,
  nie jest ostatni — sprawdzone w psql). Przeczytaj dialog. Kliknij **Delete
  permanently**. Następnie **odśwież stronę (F5)**.
  **Co musi być prawdą:**
  - Dialog **otwiera się** (przed poprawką `646facf` kosz na świeżo zapisanym
    wierszu kasował go z gridu bez dialogu).
  - Dialog oferuje **obie** opcje: *Deactivate* **i** *Delete permanently*.
  - Opis mówi „0 recorded absences and 0 attributed anomalies".
  - Po F5 wiersza **nadal nie ma**.
  **Dlaczego to ma znaczenie:** to jedyna nieodwracalna ścieżka w całym slice.
  Weryfikuje też na żywo poprawkę `646facf` — że zwrócone `id` faktycznie dociera
  do serwera, a nie tylko znika z ekranu.

  > **Zaliczone 2026-08-25.** `Rocky Testowy` zniknął z bazy trwale; dialog się
  > otworzył, co potwierdza poprawkę `646facf` na żywo.

- [ ] **4.7 — merge dwóch wierszy** *(faza 4)*

  **Gdzie:** `/settings/team`.
  **Co zrobić:** dodaj dwa nowe wiersze — jeden z samym **GitHub username**
  (np. `merge-a`), drugi z samym **Jira account ID** (np. `acc-merge-b`), oba z
  nazwami. **Zapisz.** Odśwież (F5). Zaznacz oba checkboxami → **Merge selected**
  → potwierdź.
  **Co musi być prawdą:**
  - Dialog **nazywa po imieniu**, który wiersz znika i która nazwa zostaje.
  - Po potwierdzeniu zostaje **jeden** wiersz, niosący **oba** klucze.
  - Po F5 nadal jest jeden wiersz, nie dwa.
  **Dlaczego to ma znaczenie:** merge trwale usuwa wiersz z bazy. Jeśli zadziała
  tylko w gridzie, w bazie zostaną dwa wiersze z rozjechaną tożsamością — a to
  cicho psuje atrybucję anomalii (patrz `validations/roster.ts:54`).
  **Sprzątanie:** po teście usuń zmergowany wiersz (kosz → Delete permanently).

  > **Zaliczone 2026-08-25.** `Rocky Testowy` zniknął z bazy trwale; dialog się
  > otworzył, co potwierdza poprawkę `646facf` na żywo.

- [ ] **Sprzątanie po testach** *(nie jest wierszem fazy)*

  **Co musi być prawdą na koniec:** w rosterze zostają **`Adam Reszka`** i
  **`FoxyMind`**, oboje **aktywni**. Sprawdź w gridzie albo poproś mnie o `psql`.
  **Dlaczego:** `FoxyMind` to jedyne realne konto testowe z kompletem
  GitHub + Jira, a `Adam Reszka` niesie jedyną przypisaną anomalię. Oba są
  potrzebne w kolejnych slice'ach.

---

## When everything above is ticked

1. Tick the matching rows in `plan.md` `## Progress`.
2. Mark PR #49 ready for review.
3. After merge: flip the Linear **SPR-N** for S-15 to Done + `status:done` by
   hand — GitHub auto-closes the issue, Linear does not follow.
