# S-26 disconnect-data-retention — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md`. Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Kolejność ma znaczenie.** Wiersz 1.7 (migracja) musi być zrobiony **przed**
wierszami z faz 3 i 4 — one klikają po ekranach, które zakładają nowy kształt
bazy. Kod, który potwierdza „zachowaj dane", uruchomiony na niezmigrowanej
bazie, dalej je kasuje kaskadą.

---

## Faza 1

- [ ] **1.7 — migracja `0021` trafia na bazę produkcyjną** *(faza 1)*

  **Gdzie:** terminal, główny checkout repo (nie worktree — wszystkie worktree
  dzielą jedną lokalną bazę). Potrzebny connection string do bazy produkcyjnej.

  **Co zrobić:**
  1. **Najpierw sprawdź, co już jest zaaplikowane** — `lessons.md:56-60`
     odnotowuje, że migracje `0019` i `0020` pojechały na produkcję razem z
     kodem, ale **nikt ich nie zaaplikował**. Nie zakładaj, że baza jest na
     `0020`:
     ```
     DATABASE_URL_OVERRIDE='<produkcyjny connection string>' \
       npx drizzle-kit up --config drizzle.config.ts
     ```
     albo po prostu zajrzyj do tabeli `drizzle.__drizzle_migrations` i zobacz
     ostatni wpis.
  2. Zaaplikuj migracje:
     ```
     DATABASE_URL_OVERRIDE='<produkcyjny connection string>' npm run db:migrate
     ```
  3. Sprawdź, że `0021` jest zapisana — ostatni wiersz
     `drizzle.__drizzle_migrations` odpowiada `0021_tricky_electro`.

  **Co musi być prawdą:** komenda kończy się `migrations applied successfully`,
  a w bazie produkcyjnej `absence.sprint_id` i `monitored_repo.credential_id`
  mają `ON DELETE SET NULL` (a nie `CASCADE`), oraz `monitored_repo.credential_id`
  jest `NULL`-owalna. Migracja **niczego nie kasuje** — liczba wierszy w
  `absence` i `monitored_repo` przed i po jest identyczna.

  **Dlaczego to ma znaczenie:** schemat i kod jadą tu dwoma osobnymi torami i
  tylko jeden z nich jest zautomatyzowany — CI migruje własną, tymczasową bazę,
  a Cloudflare Workers Builds deployuje wyłącznie kod. Zielony deploy **nie
  jest** dowodem na zmigrowaną bazę. Jeśli `0021` nie trafi na produkcję, cały
  ten slice jest tylko nowym tekstem na przycisku: użytkownik wybiera „zachowaj
  moje dane", a baza dalej kasuje nieobecności kaskadą.
