# S-07 Dashboard „Today" — plan testów manualnych (wszystkie fazy)

Ten dokument zbiera **wszystkie kroki weryfikacji manualnej** z `plan.md` (pozycje
`#### Manual` faz 1–5). Automatyczne bramki (typecheck, lint, unit 212, integration
42, build) są już zielone i podbite w `## Progress`. Poniżej zostają rzeczy do
klliknięcia ręcznie.

## Przygotowanie środowiska (raz, przed testami UI)

1. Lokalna baza Supabase (port `54322`) uruchomiona: `npx supabase start`.
2. Migracje zastosowane lokalnie: `npm run db:migrate`.
3. Dwa tryby uruchomienia aplikacji:
   - **`npm run dev`** (Next dev, `localhost:3000`) — wystarcza do faz 3 i 4
     (render, nawigacja, sort/filter, empty states, symulowany błąd sync). **Cron
     NIE działa** w `next dev` — dane trzeba mieć już w bazie.
   - **`npm run preview`** (`wrangler dev`) — potrzebne do fazy 5, bo dopiero
     runtime Workera odpala scheduled handler (`syncOwner` + `detectAnomalies`).

> W trybie `next dev` inbox pokaże anomalie tylko, jeśli w bazie są wiersze w
> tabeli `anomaly` dla aktywnego sprintu. Jeśli baza jest pusta, użyj fazy 5
> (realny sync) albo zseeduj dane demo (poniżej), żeby przetestować fazy 3–4.

### Seed danych demo (fazy 3–4 bez realnych API)

Aby przeklikać inbox bez podłączania Jiry/GitHuba: załóż konto przez UI (albo
`POST /api/auth/sign-up/email`), potem zseeduj przez ownera:

```
EMAIL=<twój-email> npm run db:seed:demo      # lookup ownera po mailu
# albo: OWNER_ID=<user.id> npm run db:seed:demo
```

Wstawia ACTIVE „Sprint 24" + 5-osobowy zespół + `sync_state` (Jira OK, GitHub w
błędzie → demo bannera) + **9 anomalii pokrywających wszystkie 8 typów** (oba
warianty `SPRINT_AT_RISK`), z rozłożoną severity i częścią bez przypisanego
członka (bucket „Unassigned / team-level"). Skrypt jest idempotentny — ponowne
uruchomienie resetuje demo. Warianty empty-state:

- „No anomalies detected" (zdrowy): `delete from anomaly where owner_id='<id>';`
- „No active sprint": dodatkowo `delete from sprint where owner_id='<id>';`

---

## Faza 1 — współdzielone readery (owner-scoped)

**1.5 — `run-sync` nadal SKIPuje `no_sprint`, a `load-snapshot` nadal zwraca `null`
po scaleniu duplikatów.**

- Charakter: weryfikacja przez czytanie kodu (refaktor zachowujący zachowanie).
- Co sprawdzić:
  - `src/lib/integrations/sync/run-sync.ts` — `chosenSprint = await getActiveSprintRow(...)`,
    a niżej niezmieniony strażnik `if (!chosenSprint) { finalizeSyncState(...OK); return { status: "SKIPPED", reason: "no_sprint" } }`.
  - `src/lib/anomaly/load-snapshot.ts` — `const chosen = await getActiveSprintRow(...)`,
    a niżej niezmienione `if (!chosen) return null`.
- Dodatkowe potwierdzenie automatyczne: testy `dashboard-readers.integration.test.ts`
  potwierdzają regułę „prefer ACTIVE → most-recent by startDate → null" oraz
  izolację między kontami. ✅ już zielone.

---

## Faza 2 — typowany union kontekstu anomalii

**2.5 — każdy z 8 typów anomalii zawęża się do typowanego kontekstu, bez wycieku
`unknown`.**

- Charakter: weryfikacja przez czytanie kodu + testy jednostkowe.
- Co sprawdzić: `src/lib/anomaly/context.ts` — warianty unii pokrywają dokładnie
  to, co wypisują detektory w `context: { ... }` (w tym `SPRINT_AT_RISK` z
  wewnętrznym dyskryminatorem `condition`). Test `context.test.ts` sprawdza
  narrowing i helper `anomalyIdentity`. ✅ już zielone.

---

## Faza 3 — render inboxa (potrzebne dane w bazie lub faza 5)

Uruchom `npm run dev`, zaloguj się na konto z aktywnym sprintem i anomaliami.

**3.4 — `/dashboard` renderuje inbox z 5 atrybutami FR-014 + risk score.**

- Wejdź na `http://localhost:3000/dashboard`.
- Dla każdego wiersza anomalii potwierdź obecność **wszystkich pięciu**:
  1. **Severity** — badge (HIGH = czerwony/destructive, MEDIUM = default, LOW =
     secondary).
  2. **Description** — czytelny opis.
  3. **Contextual data** — identyfikator (`#123` dla PR / klucz Jira dla ticketu),
     „chipsy" kontekstu (np. `30h open`, `threshold 24h`), nazwisko członka zespołu
     lub „Team-level", znacznik „Detected …".
  4. **Suggested action** — jednolinijkowa sugestia po „Suggested action:".
  5. **Source link** — „View source" otwiera Jira/GitHub w nowej karcie.
  - Oraz **Risk** (liczba) po prawej stronie nagłówka wiersza.
- Kolejność domyślna: HIGH → MEDIUM → LOW, w obrębie severity nowsze wyżej.

**3.5 — nieuwierzytelniony `/dashboard` przekierowuje na `/login`.**

- W trybie incognito (bez sesji) wejdź na `/dashboard` → następuje redirect na
  `/login`.

**3.6 — link „Dashboard" w nawigacji prowadzi do `/dashboard`.**

- Kliknij „Dashboard" w górnej nawigacji → ląduje na `/dashboard` (nie na `#`).

---

## Faza 4 — interaktywność, świeżość, empty states

**4.5 — re-sort (severity / age / ticket / developer) + filtry (typ / członek, w
tym „Unassigned").**

- **Sort by**:
  - `Severity (default)` — HIGH → MEDIUM → LOW.
  - `Age (newest first)` — najnowsze `detectedAt` na górze, wiersze bez daty na
    końcu.
  - `Ticket / PR` — wiersze z identyfikatorem (PR/ticket) posortowane leksykalnie,
    anomalie sprint-/zespołowe (SCOPE_CREEP, SPRINT_AT_RISK, DEVELOPER_INACTIVE)
    **na końcu**.
  - `Developer` — alfabetycznie po nazwisku; „Team-level" (bez członka) na końcu.
- **Type** — wybór jednego z typów obecnych w inboxie zawęża listę; „All types"
  przywraca.
- **Team member** — wybór członka zawęża do jego anomalii; **„Unassigned /
  team-level"** pokazuje wyłącznie anomalie bez przypisanego członka
  (`relatedTeamMemberId = null`); „All members" przywraca.
- Gdy kombinacja filtrów nie pasuje do niczego → komunikat „No anomalies match the
  current filters." (to NIE jest jeden z trzech empty states — patrz 4.7).

**4.6 — znaczniki świeżości per-integracja + banner błędu + ostatni cache inboxa.**

- Nad inboxem widoczne **dwa** znaczniki: „Jira last synced: …" oraz „GitHub last
  synced: …" (osobno). Brak synchronizacji → „never synced".
- Symulacja błędu (bez realnych API): w bazie ustaw dla wiersza `sync_state`
  danego ownera `status = 'ERROR'` (lub `'RATE_LIMITED'`) i wpisz `last_error`,
  np.:
  ```sql
  update sync_state set status = 'ERROR', last_error = 'invalid token'
  where owner_id = '<TWÓJ_OWNER_ID>' and integration = 'JIRA';
  ```
- Odśwież `/dashboard`. Oczekiwane: czerwony **Alert** nazywający integrację
  („Jira sync error"), a **inbox z ostatnimi anomaliami nadal widoczny pod
  bannerem** (nigdy biały ekran / crash).

**4.7 — trzy empty states renderują się rozróżnialnie.**

- **(a) Brak aktywnego sprintu** — konto bez wiersza sprintu (lub sprint bez
  ACTIVE i bez żadnego wiersza). Oczekiwane: „No active sprint" + instrukcja
  wskazania projektu z aktywnym sprintem. Bez kontrolek sort/filter.
- **(b) Aktywny sprint, zero anomalii (stan zdrowy)** — konto z aktywnym sprintem,
  ale bez wierszy `anomaly` ACTIVE. Oczekiwane: „No anomalies detected" (stan
  zdrowy). Inbox pusty **wyłącznie** w tym przypadku.
- **(c) Błąd sync** — jak w 4.6: banner + ostatni cache. Pustka NIE pojawia się z
  powodu błędu fetcha.

---

## Faza 5 — smoke-test na realnych danych (walidacja US-01)

Wymaga realnego GitHub PAT + Jira (token + projekt ze **sprintem aktywnym z datami
start i end** — inaczej nie powstanie wiersz sprintu).

1. Supabase `54322` up + `npm run db:migrate`.
2. Sign up → kreator: podłącz GitHub (≥1 monitorowane repo) → podłącz Jira
   (projekt + mapowanie statusów) → uzupełnij zespół/kadencję tak, by zapisał się
   wiersz sprintu.
3. `npm run preview` (`wrangler dev`). Zamiast czekać na 15-minutowy cron, odpal
   scheduled handler ręcznie:
   ```
   curl "http://localhost:<port>/__scheduled"
   ```
   (`<port>` z outputu `npm run preview`) — uruchamia `syncOwner` +
   `detectAnomalies` natychmiast.
4. Otwórz `/dashboard`.

**5.2 — realny sync+detect renderuje ≥1 anomalię z 5 atrybutami + działającym
deep-linkiem.**

- Inbox pokazuje przynajmniej jedną realnie wykrytą anomalię; „View source"
  otwiera właściwy ticket Jira / PR GitHub.

**5.3 — realne znaczniki świeżości per-integracja (Jira osobno od GitHub).**

- „Jira last synced" i „GitHub last synced" odzwierciedlają czasy realnych
  synchronizacji.

**5.4 — wymuszony błąd integracji: banner + ostatni cache (nigdy pusto).**

- Zepsuj token jednej integracji (np. podmień na nieprawidłowy) i odpal `curl`
  `/__scheduled` ponownie. Oczekiwane: banner nazywający integrację + poprzednio
  zsynchronizowany inbox wciąż widoczny.

**5.5 — „Brak aktywnego sprintu" renderuje swój odrębny stan.**

- Konto/projekt bez aktywnego, datowanego sprintu → dedykowany komunikat „No
  active sprint" (nie mylony z „zero anomalii").

---

## Zakres świadomie pominięty (nie testować w S-07)

Sprint Pulse (burndown), Yesterday's Activity, Reliability KPI, zakładki
progressive-disclosure (FR-016), dane demo (FR-008), re-tiering severity /
ustawienia progów, resolve/dismiss anomalii — to osobne slice'y. S-07 zamyka
**rdzeń Anomaly Inbox** z US-01, nie całe US-01.
