# S-08 — manual checklist (owner side)

> Wszystko, co człowiek musi zobaczyć, zanim PR #50 pójdzie ready.
> Automaty są zielone na HEAD i **nie** są tu powtarzane: 433 testy unitowe,
> 154 integracyjne, `typecheck`, `lint`, mutacje 78.96% (próg break 70) oraz
> build produkcyjny listujący `/settings/absences`.

**Jak ten plik ma się do `plan.md` `## Progress`** (który zostaje kanoniczny):
każdy wiersz niesie numer fazy, do której należy. Odhaczasz tutaj → odhacz też
w tej fazie w `## Progress`, inaczej `## Progress` skłamie.

**Pięć pozycji, ~20 minut.** Zgodnie z `CLAUDE.md` → *Manual testing
conventions* to jest krótka lista rzeczy, które faktycznie blokują slice:
ścieżki niszczące dane nieodwracalnie i powierzchnie, które są nieosiągalne,
jeśli coś jest zepsute. Reszta (renderowanie siatki, wygląd kalendarza) jest
pokryta testami logiki albo należy do globalnego backlogu.

## Zanim zaczniesz

1. Lokalne Supabase wstało (`npx supabase status`), migracje zaaplikowane —
   S-08 dorzuca `0008_flawless_veda.sql` (`absence.is_planned` → NOT NULL
   DEFAULT true). Bez niej zapis absencji padnie.
2. `npm run dev` (**nie** `wrangler dev` — `next dev` celuje w lokalne
   Supabase na `:54322`).
3. Zaloguj się i wejdź na `/settings/absences`.

### ⚠️ Które konto — nie są wymienne

`demo@sprintflow.test` trzyma **prawdziwe** credentiale GitHub/Jira na tej
maszynie; `adam.reszka85@gmail.com` trzyma zaseedowane atrapy. Nazewnictwo jest
odwrotne do intuicji, więc **identyfikuj cel po last4 tokenu, nigdy po nazwie
konta.**

`npm run db:seed:demo` **kasuje obie tabele credentiali swojego ownera.** Nigdy
nie celuj nim w konto z prawdziwymi credentialami. Żaden wiersz poniżej poza
**6.5** nie wymaga seeda, a 6.5 mówi wprost, na jakim koncie go puścić.

---

## Pozycje

- [ ] **6.4 — bramka trwałego usunięcia uzbraja się po raz pierwszy** *(faza 6)*

  **Gdzie:** `/settings/absences`, potem `/settings/team`.
  **Co zrobić:** zapisz absencję dla dowolnej osoby (dowolny zakres, dowolny
  typ). Przejdź na zakładkę **Team**. Kliknij kosz przy **tej samej** osobie.
  **Co musi być prawdą:**
  - Dialog oferuje **wyłącznie Deactivate** — przycisku „Delete permanently"
    **nie ma**.
  - Dialog pisze „**1 recorded absence**" (liczba, nie ogólnik).
  - Kliknij kosz przy osobie **bez** absencji: tam „Delete permanently" nadal
    **jest**.
  **Dlaczego to ma znaczenie:** S-08 jest pierwszym slice'em, który realnie
  uzbraja bramkę usuwania z S-15 — do tej pory `absence` miała zero wierszy, więc
  `getMemberHistory` zawsze zwracała 0 i ta gałąź nigdy się nie wykonała.
  Regresja tutaj kasuje ręcznie wprowadzone dane bez ostrzeżenia i **żaden test
  automatyczny nie złapie jej jako widocznej dla użytkownika**.

- [ ] **4.5 — absencja gasi `DEVELOPER_INACTIVE` bez czekania na sync** *(faza 4)*

  **Gdzie:** `/dashboard` (zakładka **Anomaly Inbox**), potem `/settings/absences`.
  **Co zrobić:** znajdź w inboxie wiersz `DEVELOPER_INACTIVE` i zapamiętaj, kogo
  dotyczy. Wejdź na `/settings/absences`, zapisz absencję dla tej osoby na zakres
  obejmujący **dzisiaj**. Wróć na `/dashboard` i odśwież.
  **Co musi być prawdą:** ten wiersz zniknął z inboxu — **od razu**, bez
  czekania na kolejny cykl cron (15 min) i bez klikania „Sync now".
  **Dlaczego to ma znaczenie:** to jest decyzja D1 — każdy zapis absencji
  przelicza anomalie. Jeśli to nie działa, lead zapisuje urlop i patrzy na
  anomalię, którą właśnie wyjaśnił; produkt uczy go ignorować inbox. Testy
  integracyjne pokrywają pętlę reconcile, ale nie ścieżkę Server Action →
  `router.refresh()` → render.

- [ ] **2.3 — zapis absencji przeżywa odświeżenie** *(faza 2)*

  **Gdzie:** `/settings/absences`.
  **Co zrobić:** *Record an absence* → wybierz osobę, kliknij **dwa** dni w
  kalendarzu (początek i koniec zakresu), wybierz rodzaj → *Record absence*.
  Potem **F5**.
  **Co musi być prawdą:** wiersz jest po odświeżeniu, a kolumna **Dates** pokazuje
  **dokładnie te dni, które kliknąłeś** — nie o jeden wcześniej.
  **Dlaczego to ma znaczenie:** dzień z kalendarza jest lokalny dla przeglądarki,
  a `start_date` / `end_date` są instantami w strefie **zespołu**. Przesunięcie o
  jeden dzień jest cicho poprawne dla TypeScriptu i psuje wszystkie trzy efekty
  FR-010 naraz. Testy pinują konwersję, ale nie realną przeglądarkę.

- [ ] **2.4 + 2.5 — edycja i usuwanie trafiają we właściwy wiersz** *(faza 2)*

  **Gdzie:** `/settings/absences`, mając **co najmniej dwie** absencje.
  **Co zrobić:** kliknij ołówek przy pierwszej, zmień zakres → *Save changes*.
  Potem kliknij kosz przy drugiej.
  **Co musi być prawdą:**
  - Po edycji wierszy jest **tyle samo** co przed (zmienił się istniejący, nie
    doszedł drugi).
  - Dialog usuwania **cytuje konkretną absencję**: „Mia Krystof — vacation,
    5 May 2026 – 9 May 2026", a nie ogólne „this item".
  **Dlaczego to ma znaczenie:** edycja gubiąca `id` degraduje się do wstawienia
  duplikatu, którego magazyn nie odrzuci (to inne okno). Dialog, który nie nazywa
  tego, co niszczy, to dokładnie ta klasa błędu, którą zamykał S-15.

- [ ] **6.5 — seed demo pokazuje wszystkie trzy efekty** *(faza 6)*

  **Gdzie:** terminal, potem `/dashboard`.
  **Co zrobić:** `OWNER_ID=<id konta z atrapami> npm run db:seed:demo`.
  ⚠️ **Sprawdź last4 przed uruchomieniem** — patrz ostrzeżenie wyżej. Potem
  `/dashboard` → zakładka **Availability**, potem zakładka **Anomaly Inbox**.
  **Co musi być prawdą:**
  - Availability: **Erik Lund**, **Bob Rivera** i **Chen Wu** mają zaznaczone
    dni; sekcja „Next window" istnieje i **nie zachodzi** na „This sprint" —
    ostatnia kolumna pierwszej siatki i pierwsza kolumna drugiej to **różne
    daty** (to była realna regresja, naprawiona po impl-review).
  - Widać liczbę pojemności w SP, i jest **niższa** niż suma `sp_capacity`
    rosteru (5 × 10 = 50 SP).
  - Inbox: jest wiersz `SPRINT_AT_RISK` o **Bobie** („unexpectedly away for …
    working day(s)"), a **`DEVELOPER_INACTIVE` nie dotyczy Erika** — dotyczy
    **Alice**, która jako jedyna trzyma ticket `IN_PROGRESS` i nie ma absencji.
  - Nigdzie w inboxie nie pada słowo **sickness / vacation / training**.
  **Dlaczego to ma znaczenie:** dwie rzeczy naraz. Po pierwsze — czy trzy efekty
  FR-010 są w ogóle widoczne bez prawdziwych integracji (to wejście dla S-09).
  Po drugie — **typ absencji to informacja o zdrowiu nazwanej osoby**, a FR-018
  wysyła każdą anomalię mailem. Testy pilnują tego w kodzie reguły; ten wiersz
  pilnuje tego na ekranie.

---

## Czego tu świadomie nie ma

- **Renderowanie siatki dostępności dzień po dniu** — pokryte przez
  `availability-view.test.ts` (oś dni, oba końce zakresu, przycinanie do okna,
  strefa czasowa). Oczy potrzebne tylko na 6.5 powyżej.
- **Ostrzeżenie o nakładających się oknach w formularzu** — to kopia doradcza;
  autorytatywne odrzucenie jest w magazynie i ma test integracyjny z parą
  kolizja / brak self-kolizji przy edycji.
- **Wygląd kalendarza, tablet, ciemny motyw** — należą do globalnego backlogu
  (`context/foundation/manual-test-backlog.md`), nie do bramki tego slice'a.
