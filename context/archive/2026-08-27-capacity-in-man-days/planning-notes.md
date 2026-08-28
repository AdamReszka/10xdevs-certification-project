# Notatki z rozmowy planistycznej — 2026-08-27

> Zapis rozmowy właściciela z `/10x-plan`, PRZED napisaniem `plan.md`.
> Po polsku, precedens: `context/foundation/capacity-model-notes.md`.
> Rozstrzygnięcia stąd są wiążące dla planu.

## 1. Rozstrzygnięte

### Kolumna etatu zamiast `sp_capacity`

- `team_member.sp_capacity` **znika w całości**, nie jest przemianowywana. „SP"
  w tej nazwie to story points — czyli dokładnie ta jednostka, której w capacity
  nie ma.
- Zastępuje ją `team_member.fte` — `numeric(3,2)`, NOT NULL DEFAULT `1.00`.
- Wprowadzana listą wyboru: **1.0 / 0.75 / 0.5 / 0.25** (nie polem liczbowym —
  dziś `0.5` jest niewpisywalne na czterech warstwach naraz).
- Stare wartości giną świadomie: `8` jest nieodróżnialne jako 8 SP i jako
  8 etatów, więc nie da się ich przenieść.
- Znika razem z tym cała ścieżka `membersWithoutCapacity` (kolumna jest NOT NULL,
  więc nie ma stanu „nie odpowiedziano").

### Zasada: roster to fakty o zespole, capacity to artefakt sprintu

Słowa właściciela: *„Prawdziwe capacity w team roster to nie jest właściwe
miejsce. Story pointy to jest artefakt sprintowy."*

- W rosterze siedzi **etat** — fakt stabilny, wpisywany raz.
- **Capacity w MD** powstaje per sprint: etaty × dni robocze − absencje − dni
  wolne zespołu. Nigdzie nie jest wpisywane ręcznie w rosterze.
- Konsekwencja dla FR-022: per-sprintowe nadpisanie capacity przez leada **nie
  może** trafić do rostera. Siada przy sprincie.

### Rekord pomiarowy sprintu

- **Osobna tabela**, nie kolumny na `sprint`. Powód: wiersze `sprint` kasują się
  kaskadowo przy przełączeniu projektu Jira i podlegają retencji „bieżący + 2".
  Rekord pomiarowy ma żyć przez całe życie zespołu, więc nie może od nich zależeć.
- **Bez backfillu.** Seria startuje od pierwszego zamknięcia sprintu po wdrożeniu.
  Historyczne capacity jest fizycznie nieodtwarzalne — roster nie ma wymiaru
  czasu. Zgodne z zapisaną zasadą właściciela: „uczciwe brak danych, żadnych
  domyślnych przeliczników".

### Reliability liczy się bez zmian

`dowiezione SP ÷ zaciągnięte SP`. Capacity **nie wchodzi** do ilorazu (FR-016
mówi to wprost) — stoi obok jako druga liczba:
`Reliability 100% · Capacity 60 z 120 MD`.

### Kiedy zaciągać SP

Rozdzielić dwie rzeczy:

- **Wyceny pojedynczych ticketów** — co sync. Estymaty zmieniają się w trakcie
  refinementu i chcemy aktualne.
- **Dwie sumy sprintowe** — dziś obie są przeliczane co cykl i to jest defekt:
  - *zaciągnięte* rosną razem ze scope creepem, więc reliability zawsze wygląda
    dobrze → **zamrozić na starcie sprintu**;
  - *dowiezione* to snapshot „co jest teraz w Done", przepisywany także PO
    zamknięciu sprintu → **zamrozić na końcu**.
- SprintFlow dowiaduje się o starcie sprintu z Jiry przy każdym cyklu (S-16),
  czyli w ciągu ~15 minut. „Zamrożenie na starcie" to w praktyce pierwszy sync po
  starcie — przy stojącym cronie albo wygasłym tokenie może to być dzień później
  i zamrozi już stan po zmianach. Do obsłużenia w planie.

## 2. Poszerzenie zakresu — świadome, zaakceptowane 2026-08-27

Słowa właściciela: *„Rośnie nam scope, no ale to nie było przewidziane a jest
ważne."*

### Powód — reliability z jednego sprintu jest bezużyteczne

*„Informacja z reliability z jednego sprintu jest nieużyteczna, bo nie da się jej
z niczym porównać. 100% to nie jest idealne reliability. Dla jakiegoś zespołu to
może być 90%. Bez porównywania tego w czasie pokazywanie tego to tylko gadżet."*

Zespół, który zawsze bierze z zapasem, ma 100% co sprint — i to jest sygnał, że
bierze za mało, a nie że jest wzorowy. Dopiero szereg pokazuje, gdzie ten zespół
normalnie siedzi i kiedy z tego wypadł.

**Wniosek: reliability jest użyteczne wyłącznie jako seria.** Ekran historii nie
jest dodatkiem do tej zmiany — jest tym, co czyni reliability czymkolwiek poza
gadżetem.

### Co dochodzi do zakresu

1. **Miejsce wprowadzania informacji per-sprint** — dla sprintu bieżącego /
   rozpoczynanego. Kandydaci na zawartość: dni wolne całego zespołu,
   nadpisanie capacity (FR-022), korekta dowiezionych SP (FR-023).
2. **Miejsce oglądania sprintów zamkniętych** — z ich capacity, velocity
   i reliability, żeby dało się je porównać.

### Konsekwencja dla dokumentów

Odwraca zapis z tego samego dnia: `roadmap.md` parkował „inter-sprint trend
dashboards" na fazę 2, zawężając powód do *powierzchni* (dane przestały być
zabronione przy framingu). Teraz odblokowana jest też część powierzchni.
**Do zapisania jawnie w `roadmap.md` i `prd.md`**, nie przemycenia.

## 3. Rozstrzygnięte 2026-08-28 (druga runda `/10x-plan`)

Wszystkie sześć punktów z poprzedniego §3 („Otwarte") zostało zamkniętych, plus
trzy z sekcji „Still open for /10x-plan" we `frame.md`. Poniżej decyzje wraz
z powodem — **to jest materiał wejściowy do `plan.md`, nie do ponownego pytania.**

| # | Pytanie | Decyzja |
| --- | --- | --- |
| 1 | Zakres slice'u (§3.5) | **Całość** — FR-022, FR-023 i FR-024, z ekranem historii jako ostatnią, wycinalną fazą |
| 2 | Kształt ekranu historii (§3.2) | **Przełącznik sprintu na `/dashboard/sprint-detail`**, nie osobna lista |
| 3 | Dni wolne zespołu (§3.3) | **Jako daty na koncie**, nie per sprint |
| 4 | Moment zapisu rekordu (§3.4) | **Idempotentny sweep w każdym cyklu sync** |
| 5 | Migracja etatów (frame #1) | **Banner na `/settings/team`** do jednorazowego potwierdzenia |
| 6 | Zmiana projektu Jiry (frame #3) | Rekord **przeżywa** i niesie `jira_project_id`; seria filtruje po bieżącym projekcie |
| 7 | „Wzięliście za dużo" (§3.1) | **Nie w tym slice** — zapisać jako kandydat na czwarty warunek `SPRINT_AT_RISK` |
| 8 | `story_points` (§3.6) | Kolumna **zostaje `integer`**; strażnik zaokrągla przy odczycie z Jiry |
| 9 | `added_after_sprint_start` (§3.6) | **Naprawiamy** — ze zmian pola `Sprint` w changelogu |

### Uzasadnienia, które muszą trafić do planu

**2 — przełącznik zamiast osobnej listy.** Wybrane świadomie mimo ostrzeżenia:
`/dashboard/sprint-detail` jest dziś przypięty do `getActiveSprintRow`, a jego
trzy reduktory (aging, matrix, burndown) czytają surowe dane ograniczone do
„bieżący + 2". Starszy sprint pokaże **poprawne liczby obok pustych zakładek
szczegółowych** — ekran musi to napisać wprost, to nie jest bug do ukrycia.

**3 — daty, nie per sprint.** Święto wpisane raz działa w każdym sprincie, który
je obejmuje, i jest dokładnie tym kształtem, który S-17 wygeneruje z kraju — S-17
dopisze wiersze zamiast przepisywać model. Wpina się wprost w pusty szew
`nonWorkingDays: ReadonlySet<DayKey>` (`helpers.ts:88`). Odchodzi od dosłownego
„for a given sprint" w FR-007 — **do zapisania w PRD, nie przemycenia.**

**4 — sweep, nie hook.** Zapis wyłącznie w `reconcileActiveSprint` przy
`switched` znaczyłby, że stojący cron albo wygasły token w momencie rolloveru
gubi ten sprint NA ZAWSZE — czyli dokładnie ta klasa cichej utraty, którą frame
nazwał sednem problemu. Sweep („każdy sprint `CLOSED` bez rekordu — policz
i zapisz") opóźnia rekord zamiast go gubić. Zaciągnięte SP zamrażane przy
pierwszym zobaczeniu sprintu jako `ACTIVE`, **ze znacznikiem czasu zamrożenia**,
żeby spóźnione zamrożenie było widoczne, a nie ciche.

**6 — `jira_project_id` na rekordzie.** Bez tego średnia mieszałaby pomiary
dwóch różnych zespołów, co jest gorsze niż brak danych, który FR-023 nakazuje
pokazać uczciwie. Skutek uboczny do opisania na ekranie: zaraz po przełączeniu
projektu historia jest pusta mimo istniejących wierszy.

**7 — brak ostrzeżenia.** Próg alertu wymaga minimalnej historii i marginesu
tolerancji, których nie da się dobrać, zanim historia istnieje. Próg z sufitu
zostanie wyciszony po pierwszym fałszywym alarmie i reguła umrze.

### ⚠️ Korekta faktyczna — „połówki punktów giną" jest NIEPRAWDĄ

Poprzedni §3.6 oraz `roadmap.md` opisują `story_points integer` jako defekt
precyzji: „połówki punktów giną". **Zmierzone 2026-08-28 na lokalnej bazie
prawdziwym sterownikiem `pg` — nic się nie gubi i nic nie zaokrągla:**

```
insert 0.5 -> ERROR: invalid input syntax for type integer: "0.5"
insert 1.5 -> ERROR: invalid input syntax for type integer: "1.5"
insert 3   -> OK
```

Ścieżka: Jira zwraca JSON-owy `number` → `extractStoryPoints` (`jira.ts:815-822`)
sprawdza wyłącznie `typeof raw === "number"` i przepuszcza cokolwiek → insert do
`jira_ticket.story_points` (`schema.ts:600`) rzuca błąd → jest wewnątrz
`db.transaction` (`run-sync.ts:735`), więc **cała transakcja Jiry się cofa** →
`catch` (`run-sync.ts:842`) stempluje `sync_state` jako `ERROR`.

Skutek dla leada: dashboard nie pada (graceful degradation działa — ostatni cache
plus banner), ale **sync Jiry nie przejdzie już nigdy**, co 15 minut ten sam błąd,
bez ścieżki samonaprawy i z przyczyną nieodgadywalną z dashboardu.

To **nie jest defekt jednostki, tylko defekt dostępności** na wejściu, którego
SprintFlow nie kontroluje. Uśpiony, bo projekt FM ma dziś wszystkie
`story_points = NULL` (backlog testów, wiersz 1.8).

**Dlaczego kolumna zostaje `integer`:** FR-009 wypisuje progi dla 1/2, 3, 5, 8/13,
21 — to Fibonacci. **0.5 SP nie istnieje w domenie tego produktu**, więc `integer`
jest zgodny z domeną, a nie wadliwy. Migracja na `numeric` byłaby modelowaniem
wielkości, której produkt nie zna. Strażnik zaokrąglający w `extractStoryPoints`
zamyka lukę dostępności bez zmiany modelu.

**Do poprawienia w `roadmap.md`** przy okazji tego slice'u: opis defektu jest tam
błędny co do skutku.

### ⚠️ Druga korekta — `fte` i `story_points` nie mają ze sobą nic wspólnego

Zostało to w rozmowie raz połączone (bo obie kolumny byłyby `numeric`) i było to
mylące. `team_member.fte` to etat i wchodzi WYŁĄCZNIE do capacity w man-dayach.
`jira_ticket.story_points` to wycena i wchodzi WYŁĄCZNIE do velocity. Zero
wspólnego rachunku. Jedyne, co je łączyło, to typ kolumny — a `story_points`
typu nie zmienia.

## 4. Zatwierdzona struktura faz (2026-08-28)

```
1. Etat zamiast SP w rosterze
   migracja fte + konwersja numeric→number + lista wyboru + banner potwierdzenia

2. Capacity w man-dayach
   tabela dni wolnych zespołu → pusty szew nonWorkingDays → nowy kształt reduktora
   (fte × dostępne dni) → zakładka Availability pokazuje MD i dni robocze

3. Uczciwe sumy sprintowe
   zaciągnięte zamrażane przy pierwszym zobaczeniu sprintu (ze znacznikiem kiedy),
   mianownik z changelogu pola Sprint, strażnik na wartość spoza domeny,
   dowiezione z pierwszego wejścia w DONE — wspólny prymityw z burndownem

4. Rekord pomiarowy sprintu
   osobna tabela + idempotentny sweep w każdym cyklu sync

5. Ręczne poprawki per sprint
   nadpisanie capacity (FR-022) i korekta dowiezionych SP (FR-023) — obie
   przy sprincie, na zakładce Availability, nie w rosterze

6. Relacja i estymata
   capacity obok Reliability KPI (NIE w ilorazie) + FR-024 z historii

7. Przełącznik sprintu na Sprint Detail   ← wycinalna pod termin
```

Fazy 1–4 są ścieżką zapisu. Po fazie 4 historia narasta niezależnie od tego, czy
powstaną 5–7. Faza 7 jest ostatnia świadomie: nie ma czego pokazać przed dwoma
zamkniętymi sprintami, więc jej pozycja na końcu nic nie kosztuje.

## 5. Ryzyka do zapisania w planie jawnie

1. **Szew `nonWorkingDays` ma pięć wywołań**, nie jedno: `capacity.ts:83,120`,
   `sprint-at-risk.ts:125,152`, `ticket-status-aging.ts:64`. Święto logicznie nie
   jest też dniem starzenia ticketu. **Podpiąć wszędzie** — pół-podpięty szew to
   dwa liczniki, które się nie zgadzają, a `lessons.md` ma tę porażkę zapisaną raz.
2. **Faza 7 pokaże starszy sprint z poprawnymi liczbami obok pustych zakładek**
   (retencja „bieżący + 2"). Ekran musi to napisać.
3. **Migracja robi z każdego pełny etat.** `NOT NULL DEFAULT 1.00` znaczy, że
   zespół z part-timerami dostaje po cichu zawyżone capacity — stąd banner (#5).

## 6. Grounding z kodu (zmierzone, nie zgadnięte — nie powtarzać eksploracji)

- `spCapacity` ma **21 wystąpień** w `src/` poza testami: `schema.ts:318`,
  `validations/roster.ts:42`, `roster.ts:66,83`, `roster-store.ts:246,318,452,475,489`,
  `roster-merge.ts:31,87`, `roster-editor.tsx:99,615,736`, `setup/team/actions.ts:56,140`,
  `capacity.ts:30,101,106,124,164`, `availability.tsx:128`, plus `scripts/seed-dashboard.mjs:271`
  i `lib/anomaly/test-support.ts:57`.
- **Reduktor zmienia KSZTAŁT, nie tylko jednostkę.** Dziś
  `spCapacity × (available ÷ sprintWorkingDays)` (`capacity.ts:124`) — iloraz
  skraca wymiar dnia. MD to `fte × availableDays`; dzielnik znika.
- **`numeric` wraca ze sterownika jako STRING.** Zmierzone: `0.50::numeric(3,2)`
  → `'0.50'`, `typeof === "string"`, `'0.50' === 0.5` to `false`. Łamie
  `isUnchanged` (`roster-store.ts:489`, porównanie przez `===`) — każdy zapis
  rostera wyglądałby na zmianę. Konwersja przy odczycie jest obowiązkowa.
- **Changelog pola `Sprint` już ściągamy i wyrzucamy.** `expand: "changelog"` jest
  w zapytaniu (`jira.ts:863`), a `parseStatusHistory` (`jira.ts:799`) odrzuca
  wszystko poza `field === "status"`. Naprawa mianownika to rozszerzenie parsera,
  **nie nowe wywołanie API**. Przypadek brzegowy: brak przejścia `Sprint` może
  znaczyć „był od startu" ALBO „utworzony wprost w sprincie" — fallback na
  `createdAt` vs `sprintStart` (dzisiejsza reguła) rozstrzyga.
- **`completedSp` i `committedSp` przeliczane co cykl** (`run-sync.ts:817-831`),
  także po zamknięciu sprintu. Prawidłowy prymityw „pierwsze wejście w DONE" stoi
  dwadzieścia linijek dalej: `burndown-series.ts:144-153`.
- **Hook rolloveru:** `reconcileActiveSprint` zwraca `switched`
  (`reconcile-sprint.ts:288`) i nie zapisuje nic o sprincie, który zamknął.
- **`absence` ma już nullable `sprint_id`** (`schema.ts:456`) — ale dni wolne
  zespołu idą osobną tabelą (decyzja #3), bo `team_member_id` jest NOT NULL.
- **Trasy:** `/settings/{connections,team,absences,recap}` (tabbed shell,
  `settings/layout.tsx`), `/dashboard` (5 zakładek, `today-tabs`),
  `/dashboard/sprint-detail` (przypięty do `getActiveSprintRow`).
- `ReliabilityKpi` (`reliability-kpi.tsx:31-37`) bierze dokładnie dwa skalary,
  bez capacity — nie potrafi rozróżnić dwóch przypadków 100% z framingu.

## 7. Stan testów manualnych na 2026-08-28

**Nic nie zostało zamknięte** od poprzedniej sesji. Otwarte i istotne dla tego
slice'u: **wiersz 1.8** (realny sync zapisuje `committed_sp`/`completed_sp` zgodne
z Jirą) — wymaga wpisania estymat SP w projekcie FM, który ma dziś same NULL-e.
Bez niego relacja capacity↔velocity nie ma czego mierzyć na żywych danych.
Pozostałe otwarte: 6.6, 11.15 (S-10) oraz 2.7, 3.7, 4.6 (S-16, wymagają
przeglądarki).
