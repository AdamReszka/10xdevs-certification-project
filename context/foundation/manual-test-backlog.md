# SprintFlow — globalny backlog testów manualnych

Jedno miejsce na wszystko, co wymaga człowieka przy klawiaturze i **nie jest**
pokryte automatyką. Zebrane 2026-08-23 przez przeskanowanie każdej sekcji
`#### Manual` w `context/**/plan.md` plus checklisty zmian.

**Plany pozostają kanoniczne.** Ten plik jest indeksem — odhaczając coś tutaj,
odhacz też w źródłowym `plan.md`, inaczej `## Progress` skłamie. Kolumna
„źródło" wskazuje, gdzie.

> **Zmiana adresów 2026-08-31 (S-19).** Roster i nieobecności wyprowadziły się z
> Settings do własnej sekcji **Team** w górnym menu. Jeśli trzymasz starszy
> wydruk tego pliku: `/settings/team` → **`/team/roster`**, `/settings/absences`
> → **`/team/absences`**, a dni wolne całego zespołu mają teraz własną, trzecią
> zakładkę **`/team/days-off`** (wcześniej dolna połowa strony nieobecności).
> Stare adresy nadal działają — przekierowują — więc jeśli wpiszesz je z
> przyzwyczajenia i wylądujesz gdzie indziej, **to nie jest błąd**.

> ## 🔁 Zasada zrównania — przeczytaj, zanim dopiszesz cokolwiek do tego pliku
>
> **Ten plik musi zawierać KAŻDY otwarty wiersz manualny, jaki istnieje w
> repozytorium.** Nie jest to spis „ciekawszych" pozycji ani skrót — jeśli
> czegoś tu nie ma, dla osoby testującej to nie istnieje.
>
> Prawda o stanie leży w **trzech** miejscach i one się rozjeżdżają same z
> siebie:
>
> 1. `context/**/plan.md` → sekcja `## Progress`, wiersze `- [ ]` pod
>    `#### Manual` — **kanoniczne**;
> 2. `context/changes/<id>/MANUAL-CHECKLIST.md` i
>    `context/archive/<data>-<id>/MANUAL-CHECKLIST.md` — pełne opisy;
> 3. **ten plik** — jedna lista dla osoby, która wykonuje testy.
>
> **Rozjazd wykryty 2026-08-29:** archiwalne plany miały 68 nieodhaczonych
> wierszy manualnych, a ten plik znał 27 z nich. Brakowało w całości dwóch
> slice'ów (`capacity-in-man-days`, `demo-mode`) oraz wiersza S-15 **4.7**, czyli
> jedynej pozycji w tamtej checkliście, która **trwale kasuje wiersz z bazy**.
> Archiwizacja slice'a nie zamyka jego testów manualnych — to dwie różne rzeczy.
>
> **Procedura, za każdym razem** (przy `/10x-implement` fazy końcowej,
> przy `/10x-archive` i zawsze, gdy ktoś pyta „co zostało do przetestowania"):
>
> ```bash
> # 1. ile wierszy manualnych jest otwartych w planach (kanon)
> grep -rc "^- \[ \]" context/*/*/plan.md | grep -v ":0"
> # 2. wszystkie checklisty, także archiwalne
> find context -name "MANUAL-CHECKLIST.md"
> # 3. ile zna ten plik
> grep -c "^- \[ \]" context/foundation/manual-test-backlog.md
> ```
>
> Każdy wiersz z (1) i (2) MUSI mieć swój odpowiednik tutaj. Jeśli wiersz jest
> nieaktualny — nie kasuj go po cichu, przenieś do **§6** z powodem. Nowa sekcja
> per slice, numerowana kolejno; wiersz nosi komplet czterech rzeczy z
> `CLAUDE.md`: **gdzie / co zrobić / co musi być prawdą / dlaczego to łapie**.

**Po polsku, bo to Twój roboczy dokument.** Precedens: `manual-test-plan.md`
z S-07 też jest po polsku; reszta `context/` (PRD, roadmapa, plany) jest po
angielsku i taka zostaje.

---

## 1. ✅ ZAMKNIĘTA 2026-08-29 — blokada domknięcia S-10 (PR #46)

Te trzy pozycje zostały otwarte świadomie — merge bez nich był decyzją, nie
przeoczeniem. **Wszystkie trzy padły 2026-08-29** w sesjach manualnych: 6.6 i
11.15 na danych demo, 1.8 po tym, jak owner wpisał wyceny w Jirze i dodał piąty
ticket, co zniosło blokadę „pusto po obu stronach" z 2026-08-26. Sekcja zostaje
w pliku jako zapis dowodu — nie dopisuj tu nowych wierszy.

- [x] **1.8** Realny sync zapisuje `sprint.committed_sp` / `completed_sp`
      zgodne z ręcznym przeliczeniem w Jirze. **ZALICZONE 2026-08-29.**
      *Źródło:* `context/changes/dashboard-sprint-detail/plan.md:1140`
      *Jak:* konto z prawdziwymi credentialami → „Sync now" w `/settings/connections`
      → porównaj `select committed_sp, completed_sp from sprint` z sumą SP w Jirze.
      *Dlaczego to ma znaczenie:* przed Phase 1 §3 nic poza seedem nie zapisywało
      tych skalarów, więc Reliability KPI był dla realnego ownera permanentnie
      pusty. To jedyny dowód, że zapis faktycznie działa na żywych danych.
      ⚠️ **Ustalenie 2026-08-26: tego wiersza NIE DA SIĘ zamknąć na obecnym
      koncie.** Prawdziwy cykl `syncOwner` na `demo@sprintflow.test` zapisał
      `committed_sp/completed_sp = 0/0`, i to jest arytmetycznie poprawne —
      wszystkie 4 tickety projektu FM (FM-1, FM-2, FM-3, FM-6) mają
      `story_points = NULL`, bo ta Jira nie ma żadnych estymat. Ścieżka zapisu
      **działa** (skalary zostały zapisane, nie zostawione jako NULL), ale
      porównanie „z sumą SP w Jirze" jest puste po obu stronach. Żeby wiersz miał
      sens, potrzeba projektu Jira z wypełnionymi story pointami — albo trzeba go
      przepisać na „skalary są zapisywane, nie NULL", co jest już potwierdzone.

      ✅ **Droga wyjścia (ustalone 2026-08-26): wpisać estymaty w Jirze.**
      Kod nie wymaga żadnej zmiany — `storyPointFieldId` jest rozwiązywany na
      żywo w każdym cyklu (`src/lib/integrations/sync/run-sync.ts:635`), nie jest
      zapisaną konfiguracją konta, a skalary liczą się `SUM`-em po **tabeli**
      `jira_ticket`, nie po delcie (`run-sync.ts:817-822`), więc jeden „Sync now"
      po wpisaniu wycen daje pełny obraz. Edycja SP bumpuje `updated`, więc
      kursor delty te tickety ponownie zaciągnie.

      ⚠️ **Pułapka przy wypełnianiu — wybór pola.**
      `resolveStoryPointFieldId` (`src/lib/jira.ts:969-980`) zwraca **pierwsze**
      pole custom, którego `schema.custom` zawiera `story-point` albo którego
      nazwa pasuje do `/story point/`. Bez tie-breaka i bez logu, które wybrał.
      Jeśli site ma i „Story Points" (company-managed), i „Story point estimate"
      (team-managed), bierze to, które `/rest/api/3/field` wyliczy pierwsze.
      Wpisanie wyceny w to drugie da **ponownie `0/0`** — arytmetycznie poprawne,
      bo `story_points` zostaną NULL-ami. To ten sam kształt co `lessons.md`
      „narrowing predicate": zawężenie na złej wartości zwraca pustkę, która
      czyta się jak sukces.

      *Kolejność kroków:* wpisz wyceny w **jednym** polu → „Sync now" →
      `select key, story_points, added_after_sprint_start, current_category from
      jira_ticket where owner_id = '<owner FM>' order by key;` → dopiero potem
      porównuj sumy. Liczby w Jirze + NULL-e w tabeli = przypadek złego pola
      (poprawka jednolinijkowa: preferować pole, które faktycznie niesie
      wartości, zamiast pierwszego z brzegu).

      *Przy samym porównaniu:* `committed_sp` **wyklucza** tickety z
      `added_after_sprint_start = true`, a `completed_sp` liczy tylko kategorię
      `DONE`. Ręczna suma w Jirze musi iść tą samą regułą, inaczej rozjazd nie
      będzie bugiem.

      ✅ **Zamknięte 2026-08-29 — blokada z 2026-08-26 zniesiona.** Owner wpisał
      wyceny w Jirze i dodał piąty ticket. Dwa cykle „Sync now" na koncie z
      prawdziwymi credentialami (projekt FM):

      | ticket | SP | dodany po starcie | kategoria po 2. cyklu |
      |--------|----|-------------------|------------------------|
      | FM-1   | 3  | nie               | IN_PROGRESS |
      | FM-2   | 1  | nie               | TODO |
      | FM-3   | 1  | nie               | TODO |
      | FM-6   | 13 | nie               | TODO |
      | FM-8   | 8  | **tak**           | **DONE** |

      Zapisane skalary: `committed_sp = 18`, `completed_sp = 8`. Przeliczenie
      ręczne tą samą regułą: 3+1+1+13 = **18** (FM-8 wyłączony jako dosypany),
      DONE = **8**. Zgodność co do jednego, po obu stronach niezerowa — czyli
      pułapka „pusto = pusto", która blokowała ten wiersz, przestała obowiązywać.

      **Pułapka z wyborem pola NIE wystąpiła:** po syncu 0 z 5 ticketów miało
      `story_points = NULL`, więc `resolveStoryPointFieldId` trafił w to pole, w
      które owner wpisywał. Gdyby trafił w drugie, dostalibyśmy `0/0` czytające
      się jak sukces — sprawdzone wprost, a nie założone.

      **Drugi cykl był konieczny.** Po pierwszym `completed_sp = 0`, bo nic nie
      było w Done — to samo „zero po obu stronach" co przed odblokowaniem, tylko
      węższe. Dopiero przeniesienie ticketu do Done dało niezerowy dowód na
      drugą połowę skalara. `committed_sp` przy tym nie drgnęło (18 → 18), co
      potwierdza, że zamraża stan startowy zamiast przeliczać się przy każdym
      ruchu.

      ⚠️ **Obserwacja produktowa, nie defekt.** Do Done trafił FM-8 — jedyny
      ticket dosypany po starcie. Wyszło `completed = 8` liczące zadanie,
      którego `committed = 18` nie zawiera, więc Reliability pokaże „8 z 18",
      gdzie ósemka nie jest częścią osiemnastki. Zgodne z regułą zapisaną w tym
      wierszu, ale warte świadomej decyzji ownera.

- [x] **6.6** Reset seeda i ponowne uruchomienie dają spójną historię sprintu na
      obu dashboardach. **Zaliczone 2026-08-29** (sesja manualna, Ania):
      wczytanie demo → Today 14 anomalii / Sprint Pulse 40 / Reliability 18 z 40,
      Sprint Detail te same 40 i 18 → „Usuń dane demo" → baza potwierdza 0 kont
      demo i 0 anomalii demo, credentiale GitHub i Jira nietknięte → ponowne
      wczytanie odtwarza identyczne liczby na obu dashboardach.
      *Źródło:* `plan.md:1288` + `MANUAL-CHECKLIST.md` sekcja G
      **Zaktualizowane 2026-08-29 (S-09).** `npm run db:seed:demo` **już nie
      istnieje** — skrypt `scripts/seed-dashboard.mjs` został usunięty razem z
      wpisem w `package.json`. Dane demo wczytuje się teraz z aplikacji:
      Ustawienia → Demo → „Zobacz demo". Dawne ostrzeżenie o kasowaniu
      credentiali **przestało obowiązywać**: demo leży pod osobnym właścicielem
      (`user.demo_of`), a „Usuń dane demo" kasuje wyłącznie jego wiersze —
      prawdziwe tokeny są nietykalne, co pilnuje test integracyjny
      `src/lib/demo/load.integration.test.ts`.

- [x] **11.15** Parasol manualnej weryfikacji — **zamknięty 2026-08-29** wraz z
      6.6. Zweryfikowano przed odhaczeniem: `MANUAL-CHECKLIST.md` slice'u miał
      21 z 22 wierszy zamkniętych, a 6.6 był jedynym otwartym.

---

## 1a. S-16 sprint-reconciliation — zmergowane (PR #52) i zarchiwizowane

Kod dowieziony, PR #52 zmergowany, slice zarchiwizowany. Wszystkie 16 kryteriów
automatycznych zielone. Instrukcje krok po kroku:
`context/archive/2026-08-26-sprint-reconciliation/MANUAL-CHECKLIST.md`.

> ✅ **3.6 i 3.8 zamknięte 2026-08-26 dowodem na żywych danych** — bez klikania,
> przez jednorazowy runner `syncOwner` przeciwko prawdziwej Jirze. Szczegóły przy
> wierszach niżej. **FR-007 ma teraz dowód na żywych danych**, czego nie miał od
> początku projektu.
>
> Zostają **3 wiersze wymagające przeglądarki** (2.7, 3.7, 4.6) — tych z CLI
> zasymulować się nie da. **2.7 i 3.7 zaliczone 2026-08-29**; otwarty zostaje
> sam **4.6**.

- [x] **2.7** Kreator `/setup/team` nadal działa po przepięciu na
      `reconcile-sprint.ts` (nazwa aktywnego sprintu + chooser tablic).
      **Zaliczone 2026-08-29** (sesja manualna, Ania) — na ŚWIEŻYM koncie, co jest
      mocniejszym przebiegiem niż zakładała instrukcja: bez wiersza `sprint`
      `initialCadence` jest `null`, więc `CadenceForm` odpala auto-pull sam
      (`cadence-form.tsx:126`) i przechodzi całą ścieżkę Server Action → formularz.
      Na koncie z istniejącym sprintem formularz tylko prefilluje z bazy i tej
      ścieżki NIE dotyka. Wynik: „SCRUM Sprint 1", 14 dni, pon–pt — zgodne z
      aktywnym sprintem Jiry (`jira_sprint_id=1`); po zapisie wiersz `sprint`
      nowego konta jest co do wartości identyczny z wierszem właściciela.
      Chooser tablic się nie pojawił — projekt FM ma jedną tablicę scrumową,
      więc warunek „przy wielu tablicach" jest spełniony pusto, nie sprawdzony.
      *Źródło:* `context/changes/sprint-reconciliation/plan.md:809`
      *Dlaczego:* faza 2 wypatroszyła `importCadence`; testy integracyjne
      pokrywają serwis, ale nie spięcie Server Action → formularz → chooser.
      To jedyna ścieżka kadencji, jaka dziś istnieje w produkcie.

- [x] **3.6** Realny „Sync now" tworzy wiersz `sprint` zgodny z aktywnym
      sprintem w Jirze. **Zamknięte 2026-08-26 dowodem na żywych danych** —
      zamiast czekać na prawdziwy rollover zainscenizowano jego *skutek*:
      na koncie `demo@sprintflow.test` (prawdziwe credentiale, last4 `B9D0`)
      wstawiono lewy wiersz `jira_sprint_id=999999` ACTIVE z późniejszą
      `start_date`, żeby wygrywał `getActiveSprintRow` — czyli dokładnie kształt
      incydentu `1001`. Jeden prawdziwy cykl `syncOwner` przeciwko żywej Jirze:
      phantom → `CLOSED`, sprint Jiry (`jira_sprint_id=1`) → `ACTIVE`, 4 tickety
      na właściwym sprincie, `cadence_overridden=true` i `length_days=14`
      nietknięte, wynik `OK`. Konto przywrócone do stanu wyjściowego.
      ⚠️ **Czego to NIE dowodzi:** gałąź INSERT. Jira miała ten sam sprint, więc
      upsert poszedł gałęzią CONFLICT. Nadpisana kadencja na **nowo utworzonym**
      wierszu jest pokryta tylko testem integracyjnym (case (i)), nie na żywo.

- [x] **3.7** Dashboard „Today" renderuje ticket'y i anomalie **nowego**
      sprintu, ze świeżym timestampem. **Zaliczone 2026-08-29** (sesja manualna,
      Ania) — na koncie `anna.jozwiak19@gmail.com` (prawdziwe credentiale, GitHub
      `AdamLisek`, Jira `foxmind`), które przed testem miało 0 ticketów i 0
      anomalii, więc różnica „przed / po" jest widoczna, a nie założona.
      Jeden „Sync now" z `/settings/connections` → Today: **3 anomalie**
      (`TICKET_STATUS_AGING`, `TICKET_NO_COMMIT_LINK`, `SCOPE_CREEP`), wszystkie
      z `sprint_id` aktywnego sprintu; Sprint Pulse: „18 committed SP", rozkład
      To Do 3 / In Progress 1 / Code Review 0 / Testing 0 / Done 1 — co do sztuki
      te same 5 ticketów (FM-1/2/3/6/8), które sync zapisał. Timestamp
      `2026-08-29 21:20 UTC` = moment kliknięcia (23:20 CEST).
      *Źródło:* `plan.md:824`
      *Wymaga przeglądarki* — nie da się zasymulować z CLI.

      ⚠️ **Czego to NIE dowodzi: „nowego, a nie starego".** Konto ma dokładnie
      **jeden** wiersz `sprint`, więc `getActiveSprintRow` nie miał z czego
      wybierać — warunek spełnił się pusto, tak samo jak chooser tablic w 2.7.
      Dowiedzione jest „nie pusto i z aktywnego sprintu", nie „nie z
      poprzedniego". Rozstrzygnięcie tej połowy wymaga drugiego wiersza `sprint`
      (rollover w Jirze albo inscenizacja jak przy 3.6).

      ℹ️ **Fałszywy trop, na który nie warto tracić czasu drugi raz.** Timestamp
      wygląda na „spóźniony o 2 h", bo UI świadomie renderuje **UTC**
      (`sync-status-bar.tsx:34`, `integration-card.tsx:45` — string slice zamiast
      `toLocaleString`, żeby SSR i hydracja nie rozjechały się). Polska latem to
      UTC+2. Uwaga na własne skrypty diagnostyczne: kolumny `sync_state.*_at` są
      `timestamp without time zone`, a `node-postgres` parsuje je w **strefie
      procesu**, więc `psql`/node na macu pokaże wartość przesuniętą o 2 h w
      drugą stronę niż aplikacja (runtime Workers stoi na UTC). Zapis w bazie
      jest poprawnym UTC — porównuj przez `::text`, nie przez JS-owy `Date`.

      🔵 **Obserwacja produktowa dla ownera (nie defekt, zgłoszone przez
      testerkę).** Sprint Pulse podaje `committed`, ale `completed` nigdzie nie
      pada, choć aplikacja tę liczbę zna (`sprint.completed_sp = 8`) — trzeba ją
      wywnioskować z wykresu. Osobna pułapka czytelności na tym koncie: baseline
      burndownu to suma SP **wszystkich** ticketów sprintu (26), a `committed_sp`
      wyklucza dosypane po starcie (18), więc po odjęciu zrobionego FM-8
      „Remaining SP" wychodzi **18** — ta sama liczba co „committed 18", licząca
      zupełnie co innego. Zbieżność przypadkowa, ale czyta się jak „zespół nic
      nie zrobił". Ten sam kształt co obserwacja przy wierszu **1.8**.

- [x] **3.8** `select count(*) from sprint where owner_id = $1 and state = 'ACTIVE'`
      zwraca 1. **Zamknięte 2026-08-26** tym samym przebiegiem co 3.6: przed
      cyklem 2 wiersze ACTIVE, po cyklu 1.

- [x] **4.6** Zmiana projektu Jiry w kreatorze nie zostawia starego sprintu.
      **Zaliczone 2026-08-30** (sesja manualna, Ania) — pełną ścieżką, nie tylko
      nośnym krokiem 2.
      *Źródło:* `plan.md:839`
      ⚠️ **Wiersz zmienił sens** — patrz checklista. Ustalenie z fazy 4:
      `/setup/jira` nie pokazuje pickera projektu, dopóki istnieje
      `jira_credential`, a Disconnect i tak kasuje sprint kaskadą. Nośną
      połową jest teraz **krok 2** (potwierdź, że widzisz kartę statusu, a nie
      picker) — pilnuje założenia, na którym oparto brak confirmation dialogu.

      **Krok 2** — konto `anna.jozwiak19@gmail.com` (prawdziwe credentiale, Jira
      `foxmind`, projekt FM): `/setup/jira` pokazuje kartę „Jira connected" z
      projektem FM, **bez** listy ani pola wyboru projektu; na stronie są tylko
      przyciski **Disconnect** i **Continue**. Założenie z fazy 4 trzyma się.

      **Kroki 3–4 wykonane na żywo**, na drugim projekcie Jiry (`PT`) założonym
      przez testerkę na potrzeby tego wiersza. Przebieg: Disconnect → konto
      zostaje z 0 wierszy `jira_credential` / `jira_project` / `sprint` /
      `jira_ticket` / `anomaly`, przy nietkniętych 6 wierszach `team_member` i
      integracji GitHub (1 credential, 1 repo) → ponowne połączenie tymi samymi
      credentialami → picker pokazuje **dwa** projekty (FM, PT) → wybór PT →
      mapowanie 5 statusów → zapis. Stan końcowy: `project_key = 'PT'`,
      5 mapowań z PT, **0 sprintów** — ani jednego wiersza po FM. Warunek
      zaliczenia z checklisty spełniony **obserwacją**, nie wnioskowaniem z
      kluczy obcych (te potwierdzono osobno, przed kliknięciem).

      ℹ️ **Przy okazji ustalone, przydatne przy kolejnych przebiegach kreatora:**
      credential zapisuje się dopiero w `storeJiraIntegration` — na końcu kroku 3
      — a `fetchProjectStatuses` pobiera statusy w momencie wyboru projektu.
      Status dodany w Jirze **w trakcie** kreatora nie pojawi się więc na liście
      mapowania; trzeba przejść krok wyboru projektu jeszcze raz (odświeżenie
      strony wystarcza, nic nie jest jeszcze zapisane). Testerka trafiła na to,
      dokładając w Jirze kolumnę „In Tests" już po wybraniu PT.

      ✅ **Znalezisko poboczne, zgłoszone przez testerkę — NAPRAWIONE 2026-08-30
      (S-24).** Żadna z czterech ścieżek **Disconnect** (kreator ×2, ustawienia
      ×2) nie pytała o potwierdzenie, mimo że kasuje sprint, ticket'y, anomalie,
      ręcznie wpisane nieobecności, a po stronie GitHuba całą historię commitów,
      PR-ów i recenzji. Wszystkie cztery mają teraz wspólny `ConfirmDialog`;
      opis znaleziska żyje w pozycji **S-24** w `context/foundation/roadmap.md`
      (notatka źródłowa skasowana razem z naprawą, zgodnie z `CLAUDE.md`).
      Argument z checklisty („odpowiednik jest w `/settings/connections`")
      wskazuje na ostrzeżenie, które faktycznie istnieje, ale zabezpiecza
      **zmianę projektu**, nie odłączenie. Decyzja właściciela, nie defekt do
      naprawy w sesji manualnej.

      🔵 **Druga obserwacja produktowa (ta sama sesja):** auto-mapowanie statusów
      rozpoznaje wyłącznie **angielskie** nazwy (`suggestCategory`,
      `src/lib/jira.ts:435-452`). Na polskim projekcie PT trafiło 3 z 4 nazw, ale
      nie dzięki nazwie — dzięki `nativeCategoryKey` z Jiry (`new` → To Do,
      `indeterminate` → In Progress, `done` → Done). Pomyliło się dokładnie tam,
      gdzie Jira nie rozstrzyga: „W trakcie weryfikacji" dostało *In Progress*,
      bo Code Review i Testing są dla Jiry tym samym `indeterminate` i rozróżnia
      je tylko nazwa. Angielskie „In Tests" trafiło do *Testing* bez pudła. Dla
      polskojęzycznego zespołu oznacza to ręczną poprawkę przy każdym statusie
      przeglądu i testów. Podpowiedź jest edytowalna, więc to nie jest defekt —
      ale FR-005 opiera całą detekcję anomalii na tym mapowaniu.

      🔵 **Trzecia obserwacja produktowa (ta sama sesja):** ✅ **ZAMKNIĘTA
      2026-08-30 przez S-25** (`sprint-identity-visibility`, §18 poniżej);
      notatka źródłowa skasowana razem z naprawą, opis żyje w pozycji S-25
      roadmapy. Było tak: nigdzie
      nie widać wprost, **którego sprintu** dotyczy to, na co się patrzy. W kroku
      kadencji nazwa jest wpleciona w zdanie w `CardDescription`
      (`cadence-form.tsx:156`); na „Today" pada wyłącznie w opisie panelu
      *Estimated velocity* (`velocity-estimate.tsx:42`), który przy mniej niż
      dwóch zamkniętych sprintach i tak renderuje „brak danych" — więc na świeżo
      skonfigurowanym koncie nazwa może nie paść ani razu; na Sprint Detail jest
      `Badge variant="secondary"`. Daty (`sprint.start_date` / `end_date`) są
      pobrane z Jiry i nieużyte w UI. Zgłoszone przez testerkę po przepięciu
      FM → PT, czyli w tym samym momencie, w którym incydent `1001` był
      niewykrywalny.

**Nie pokryte automatyką z innego powodu:** „okno pustki" po rollowerze
(checklista, faza 3) — udokumentowane i zaakceptowane przy planowaniu, ale
warto zobaczyć na oczy, że trwa sekundy, a nie minuty.

**Uwaga o kanoniczności.** S-16 jest już zarchiwizowany, a
`context/archive/**` jest read-only z konwencji, więc kratek w jego `plan.md`
nie odhaczamy — **ten plik jest teraz jedynym aktualnym rejestrem** dla S-16.
Zarchiwizowany plan pokazuje 5 pustych kratek i tak zostanie.

---

## 2. Zaległości z wcześniejszych slice'ów

Wszystkie poniższe zostały **zarchiwizowane z niezaznaczonymi kratkami**. Nie
wiadomo, czy ich nie wykonano, czy wykonano i nie odhaczono — plany nie niosą
adnotacji „verified in-session", której używa S-10. Traktuj jako **nieznane**,
nie jako „na pewno niezrobione".

### S-07 `dashboard-today` — 12 pozycji

*Źródło:* `context/archive/2026-08-21-dashboard-today/plan.md`
*Instrukcja krok po kroku już istnieje:* `…/manual-test-plan.md` (po polsku,
z przygotowaniem środowiska; nie ma kratek, więc odhaczaj w `plan.md`).

**Część jest już nieaktualna** — S-10 przebudował „Today" na taby i te
powierzchnie zweryfikowałeś w `MANUAL-CHECKLIST.md` sekcja B (5.6–5.10):

| S-07 | temat | stan |
|---|---|---|
| 3.4 | inbox z 5 atrybutami FR-014 + risk score | pokryte przez S-10 **5.6** ✅ |
| 4.5 | re-sort i filtrowanie | pokryte przez S-10 **5.6** ✅ |
| 4.6 | freshness per integracja + baner błędu | pokryte przez S-10 **5.7** i **4.10** ✅ |

Realnie otwarte zostają: **1.5, 2.5, 3.5, 3.6, 4.7, 5.2, 5.3, 5.4, 5.5**.

> 🔴 **S-07 5.2 to nie jest zwykły wiersz.** „Realny sync + detect pod
> `wrangler dev` renderuje ≥1 anomalię z 5 atrybutami i deep-linkiem" jest
> dosłownie **pierwszym kryterium sukcesu z PRD** („Real-integration flow proves
> the product works"). Dopóki nikt tego nie potwierdził na prawdziwym koncie,
> produkt nie ma dowodu, że działa end-to-end. To najważniejsza pozycja w całym
> tym pliku — ważniejsza niż cokolwiek z S-10.

### S-04 `setup-team-roster-cadence` — 11 pozycji

*Źródło:* `context/archive/2026-08-20-setup-team-roster-cadence/plan.md`
Otwarte: **1.5, 2.7, 2.8, 3.4, 4.3, 4.4, 4.5, 4.6, 5.5, 5.6** + nota
koordynacyjna z `onboarding-routing`.

> ✅ **4.3 i 4.6 — odblokowane przez S-15 (PR #49), ale przepisane.**
>
> **4.3** w starym brzmieniu („roster auto-importuje z obu źródeł, merge scala
> wiersze, edycje przeżywają re-import") jest **nieaktualne**: import już nie
> zapisuje. Reprodukcja w S-15 potwierdziła wektor — seed demo wpisuje klucze
> `alice-kim` / `acc-alice-kim`, których żaden prawdziwy import nie dopasuje,
> więc 5 wierszy rosło do 5 + liczba tożsamości z upstreamu (zmierzone: 9).
> **Nowe brzmienie 4.3:** re-import *proponuje* — nowi ludzie pojawiają się jako
> niezapisane wiersze z plakietką „New — unsaved", osoby znikłe u źródła dostają
> znacznik „Not in GitHub/Jira any more" i jednoklikowy Deactivate, a **w bazie
> nie przybywa ani jeden wiersz, dopóki nie naciśniesz Save**. Edycje i wiersze
> `MANUAL` nadal przeżywają re-import. Testuj to na powierzchni S-15
> (`context/changes/team-management-surface/MANUAL-CHECKLIST.md`, sekcja C), nie
> na starym opisie.
>
> **4.6** (szerokość na tablecie) naprawił S-10, a S-15 domyka jego weryfikację —
> ale **jeszcze nie odhaczone**: to wiersz 5.7 w checkliście S-15 i wymaga oczu w
> przeglądarce. Odhaczaj tam, nie tutaj.

### F-03 `ui-component-foundation` — 9 pozycji

*Źródło:* `context/changes/ui-component-foundation/plan.md`
Render landingu i stron auth, nawigacja między nimi, tytuł taba, brak nav-baru
na `(auth)`, spójność tokenów w light i dark.

> Jedna z tych pozycji — „ręczne dodanie `class="dark"` do `<html>` przełącza na
> ciemną paletę OKLCH" — jest **de facto potwierdzona** dowodowo przy S-10 4.8 /
> 3.5 / 8.12: paleta ciemna działa poprawnie na czterech powierzchniach.
> Zostaje do sprawdzenia strona landingowa i strony auth.

### F-01 `auth-provider-scaffold` — 1 pozycja

- [ ] **1.8** (opcjonalne de-risk) trywialny redirect z `proxy.ts` odpala się na
      zdeployowanym Workerze. *Źródło:* `context/changes/auth-provider-scaffold/plan.md`
      Wymaga realnego deployu — sensowne dopiero przy pierwszym wdrożeniu.

---

## 3. Zobowiązania dokumentacyjne (nie testy aplikacji)

`context/changes/testing-harness-credential-security/plan.md` — 3.6, 3.7, 3.8.
To przegląd spójności dokumentów (czy folder zmiany S-02 niesie odroczone
obowiązki testowe, czy `test-plan §3` odzwierciedla stan faktyczny, czy recenzent
doda test z §6.1 bez dopytywania). Do zrobienia czytając, nie klikając.

**S-20 `absence-sprint-scoping`** — wiersze 2.6 i 2.7 z
`context/changes/absence-sprint-scoping/plan.md`. **Nie oddawaj ich osobie
testującej**: to czytanie dokumentów, nie klikanie w aplikacji, i wymaga
znajomości historii decyzji. Zamyka je implementujący na końcu fazy 2.

- [x] **2.6** **ZALICZONE 2026-08-30 (14338d8).** Przeczytaj sekcję **S-20** w `context/foundation/roadmap.md` od
      początku do końca oraz wiersz **S-26** w tabeli szczegółowej.
      **Co musi być prawdą:** sekcja S-20 nie zostawia wrażenia, że pogodzenie
      trzech konsumentów jest wciąż otwarte (jest rozstrzygnięte: liczą się
      daty), a S-26 nie czyta się już jako zablokowany.
      *Dlaczego to łapie:* sekcja była napisana jako pytanie („nic nie mówi,
      która interpretacja jest kanoniczna"). Zostawiona tak, każe następnej
      osobie rozstrzygać po raz drugi coś, co właściciel już rozstrzygnął.

- [x] **2.7** **ZALICZONE 2026-08-30 (d8b2eeb).** Przeczytaj rekomendację **A** w
      `context/archive/2026-08-26-sprint-reconciliation/research.md` (tabela
      „Separable — recommendation, owner decides").
      **Co musi być prawdą:** czytelnik trafia na datowany znacznik odwrócenia
      **wewnątrz** tej samej komórki, zanim zdąży potraktować rekomendację jako
      obowiązującą; ten sam znacznik stoi przy akapicie o trzech niezgodnych
      konsumentach (§ „Two nuances…").
      *Dlaczego to łapie:* to jest dokładnie to zdanie, którym raz już odłożono
      tę zmianę. Bez znacznika następna osoba zacytuje je i odłoży ją ponownie.

**S-26 `disconnect-data-retention`** — wiersz 6.6 z
`context/changes/disconnect-data-retention/plan.md`. **Nie oddawaj go osobie
testującej**: to czytanie dokumentów, nie klikanie w aplikacji. Zamyka go
implementujący na końcu fazy 6.

- [ ] **6.6** Przejrzyj zdania, które opisują, co ginie przy rozłączeniu
      integracji: `context/foundation/roadmap.md` (sekcja **S-26**, wiersz S-26 w
      tabeli szczegółowej, **Open Roadmap Question 4**),
      `context/changes/disconnect-data-retention/change.md`, §16 tego pliku oraz
      `src/lib/integrations/disconnect-impact.ts`.
      **Co musi być prawdą:** żaden z nich nie twierdzi już, że **potwierdzone**
      rozłączenie kasuje nieobecności — wszędzie jest to warunkowe („tylko przy
      wyborze «Delete my … data»"). Nigdzie też nie zostało zdanie, że
      `anomaly.status` to ręczna triage leada. Stare brzmienia mogą zostać, ale
      **wyłącznie** oznaczone datą i powodem zmiany, nie jako obowiązujący opis.
      *Dlaczego to łapie:* ten slice zmienia zachowanie **i** kilkanaście zdań,
      które je opisują. Zdanie, które przeżyje zmianę zachowania, jest gorsze niż
      brak zdania: mówi leadowi, że traci coś, czego nie traci, i wypycha go z
      bezpiecznej ścieżki. Dokładnie tak powstał błąd, który S-24 znalazł w
      `jira-project-editor.tsx` — wymieniał raporty dzienne, które przeżywają, a
      pomijał nieobecności, które ginęły.

**S-28 `working-day-aging` — dług przekrojowy znaleziony przy impl-review (F9).**
Nie jest to test do wyklikania ani zobowiązanie dokumentacyjne — to defekt kodu,
odłożony świadomie, bo powstał przed S-28 i nie należy do jego zakresu.

- [ ] **28.A** Zmiana monitorowanego projektu Jira zeruje `jira_project.time_zone`
      i cały zegar godzin roboczych przechodzi na UTC.
      **Gdzie:** `src/lib/integrations/jira-store.ts:233` —
      `...(projectChanged ? { boardId: null, timeZone: null } : {})`.
      **Co się dzieje:** dopóki krok zespołu nie przeliczy strefy z Jiry
      (`/myself`), `safeZone` degraduje do UTC, więc okno robocze to 08:00–16:00
      **UTC**. Dla zespołu z US-Pacific to 01:00–09:00 czasu lokalnego: weekendy
      dalej są wyłączone, więc główna obietnica S-28 się broni, ale **faza**
      zegara jest przesunięta nawet o ~16 godzin i ticket może zestarzeć się o
      prawie dobę za wcześnie albo za późno.
      **Co musi być prawdą po naprawie:** albo strefa przeżywa zmianę projektu,
      albo użytkownik jest o jej utracie poinformowany, albo reguły czasowe
      wstrzymują się do czasu jej odtworzenia. Dziś nie ma ani bannera, ani logu.
      **Dlaczego to ma znaczenie:** defekt jest sprzed S-28, ale to S-28 dał mu
      zęby — wcześniej strefa wpływała tylko na kubełkowanie dni na dashboardzie,
      teraz decyduje, kiedy każda z pięciu reguł czasowych się odzywa. Cichość
      jest tu najgorszą częścią: nic nie odróżnia „strefa zespołu" od „UTC, bo
      zgubiliśmy strefę".

## 4. Osobna kategoria: deploy

`context/deployment/deploy-plan.md` ma **19** niezaznaczonych kroków, ale to
runbook wdrożeniowy (utworzenie Hyperdrive, sekrety, rozmiar bundle'a), nie
testy produktu. Odhaczasz je, wykonując pierwszy deploy — nie wcześniej.
Przypomnienie z pamięci projektu: przed pierwszym deployem są **3 twarde
prerekwizyty** (migracja adaptera, sterownik DB, flaga CI).

- [ ] **4.1** (F-01 wiersz 1.8) Trywialne przekierowanie z `proxy.ts` odpala się na
      **wdrożonym** Workerze.
      *Gdzie:* wdrożony Worker, nie `next dev`.
      *Co zrobić:* po pierwszym deployu wejdź na gated route bez sesji.
      *Co musi być prawdą:* następuje przekierowanie na `/login`, a nie 500 ani
      biała strona.
      *Dlaczego to łapie:* middleware pod `@opennextjs/cloudflare` zachowuje się
      inaczej niż lokalnie; plan F-01 opisał to jako „optional de-risk" i wiersz
      został nieodhaczony od 2026-05-30. Wykonalne **dopiero po deployu** — stąd
      ta sekcja, a nie §1. *Dopisane 2026-08-29.*

---

## 5. Środowisko i pułapki — przeczytaj, zanim zaczniesz

Wiedza kupiona czasem podczas sesji 2026-08-23. Każdy z tych punktów kosztował
co najmniej jedno fałszywe rozpoznanie.

**Konta na lokalnej bazie mają mylące nazwy.** `demo@sprintflow.test` trzyma
**prawdziwe** tokeny (GitHub `AdamLisek`, Jira `foxmind.atlassian.net`), a
`adam.reszka85@gmail.com` — seedowane atrapy (`last4 = 0000`). Identyfikuj cel
przez `token_last4` / `github_login` / `workspace_url`, **nigdy po nazwie konta**:

```sql
select u.email, gc.token_last4, gc.github_login, jc.token_last4, jc.workspace_url
from "user" u
left join github_credential gc on gc.owner_id = u.id
left join jira_credential  jc on jc.owner_id = u.id;
```

**Dark mode nie ma przełącznika.** `globals.css` używa wariantu klasowego
(`&:is(.dark *)`), a nic nie nakłada klasy `dark` na `<html>` — ustawienie
systemu/przeglądarki nie robi nic. Do testów: `document.documentElement.classList.toggle('dark')`
w konsoli. **Poczekaj ~200 ms przed oceną** — komponenty shadcn mają
`transition-all`, więc przełączenie *animuje* kolory przez ~150 ms i zrzut zrobiony
od razu pokazuje jasne kontrolki na ciemnej stronie, co wygląda jak zepsuty motyw.

**Wykresy Recharts animują wejście** przez `stroke-dasharray`, nie przez geometrię.
Zaraz po wejściu na zakładkę linie są 40-pikselowymi kikutami przy lewej krawędzi.
To nie jest bug danych.

**Cron lokalnie:** `/cdn-cgi/handler/scheduled` **nie działa** w tym projekcie
(router assetów zwraca `exception` / HTTP 500 — sprawdzone aż do pustego handlera).
Działa: `npx wrangler dev --test-scheduled`, potem
`curl "http://localhost:8787/__scheduled?cron=*%2F15+*+*+*+*"`.

**Cron enumeruje WSZYSTKICH onboardowanych ownerów** (`scheduled.ts:42`).
Odpalenie go na lokalnej bazie ruszy też konto z prawdziwymi credentialami. Do
testów cronowych użyj osobnej bazy:
`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` **nadpisuje**
`localConnectionString` z `wrangler.jsonc`, więc nie trzeba edytować śledzonego
pliku.

**`wrangler dev` czyta sekrety z `.dev.vars`, którego NIE ma w `.gitignore`**
(wzorzec `.env*` go nie łapie). Utwórz, użyj, skasuj — albo dopisz do
`.gitignore`.

**Nie da się uruchomić drugiego `next dev`** w tym samym katalogu (Next 16
blokuje), a worktree z symlinkiem do `node_modules` wywraca Turbopack.

**Brak `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` w `.env.local`
kładzie CAŁE logowanie i rejestrację, a UI raportuje to jako złe hasło.**
Zdiagnozowane 2026-08-29 w sesji manualnej — kosztowało pół sesji i dwa fałszywe
rozpoznania („zapomniane hasło do demo", potem „nie da się założyć konta").

*Objaw:* każdy endpoint `/api/auth/*`, który dotyka bazy, zwraca **500** —
`sign-in/email`, `sign-up/email`, `request-password-reset`. Logowanie na
**nieistniejące** konto też zwraca 500 (poprawna aplikacja odpowiedziałaby
odmową), i to jest najtańszy test odróżniający tę awarię od złego hasła.
`get-session` bez ciasteczka zwraca 200 (nie dotyka bazy), `/login` zwraca 200
(`getOptionalSession` jest fail-open), `/dashboard` zwraca 307 — czyli
**„aplikacja odpowiada" z Fazy 0 tej awarii NIE wykrywa.**

*W logu `next dev`:* `Failed query: select ... from "user" where email = $1`
z `[cause] AggregateError { code: 'ECONNREFUSED' }` (dwa podbłędy = próba na
`::1` i `127.0.0.1`).

*Przyczyna:* `getDb()` (`src/lib/db.ts:12`) bierze
`env.HYPERDRIVE.connectionString` **przed** `process.env.DATABASE_URL`. Pod
`next dev` binding HYPERDRIVE dostarcza platform proxy OpenNexta, a bez tej
zmiennej środowiskowej wpada `localConnectionString` z `wrangler.jsonc:32` —
czyli atrapa `postgresql://user:password@localhost:5432/db`. Na porcie 5432 nic
nie słucha (lokalna baza stoi na **54322**), stąd ECONNREFUSED. `DATABASE_URL`
może być przy tym całkowicie poprawny i baza w pełni sprawna — nie ma to
znaczenia, bo ta gałąź nigdy się nie wykona.

*Kiedy to wraca:* przy każdym przepisaniu `.env.local` — zmienna jest
udokumentowana w `.env.example:17`, ale łatwo ją zgubić, bo poza `wrangler dev`
nic o niej nie przypomina. Tak stało się przy rotacji sekretów 2026-08-29
(`.env.local` przepisany o 19:44).

*Diagnoza w jednej komendzie* — 500 zamiast 401 przesądza sprawę:
```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:3000/api/auth/sign-in/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"nie-ma-takiego@example.test","password":"cokolwiek123"}'
```

🔴 **Osobna obserwacja produktowa dla ownera — decyzja, nie defekt do naprawy
przez testerkę.** `login-form.tsx:50` i `signup-form.tsx:56` robią
`error.message ?? "…Check your email and password."`. Odpowiedź 500 nie niesie
`message`, więc **awaria bazy renderuje się jako „sprawdź login i hasło"**. To
dokładnie ten kształt, przed którym ostrzega guardrail PRD o czytelnym banerze
błędu zamiast cichej degradacji — tam napisany dla Jiry i GitHuba, tu trafiony
przez własną bazę.

✅ *Potwierdzone jednym ruchem 2026-08-29:* dopisanie zmiennej (wartość = ta sama
co `DATABASE_URL`) + **restart** `next dev` — sam hot-reload `.env.local` NIE
wystarcza, bo binding czyta się przy starcie platform proxy. Po restarcie log
mówi wprost: *„Found a non-empty CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE
variable for binding"*, a `sign-in` na nieistniejące konto wraca **401
`INVALID_EMAIL_OR_PASSWORD`** zamiast 500. Brak tej linijki w logu startowym to
najszybszy sygnał, że pułapka wróciła.

---

## 6. Nie powtarzaj tego — już zweryfikowane dowodowo

`context/changes/dashboard-sprint-detail/MANUAL-CHECKLIST.md` — 18 z 19 wierszy
zamkniętych, każdy z zapisaną metodą i wynikiem. W szczególności nie ma potrzeby
ponownie sprawdzać: czytelności wykresów w obu motywach (4.8, 3.5, 8.12),
arytmetyki burndownu (2.5, 2.6), braku wycieków w payloadach akcji (7.7) i w
logach Workera (1.7), guardu seeda (F5) oraz niedestrukcyjności edycji repo i
projektu Jiry (F1, F2).

### Zamknięte w całości — `refinement-helper-ai` (S-13, 2026-08-26)

`context/archive/2026-08-26-refinement-helper-ai/MANUAL-CHECKLIST.md` — **wszystkie
9 wierszy odhaczonych** z datami (2026-08-26/27): brak klucza daje błąd
konfiguracji zamiast 401, ścieżka boardu zwraca BACKLOG a nie aktywny sprint,
prawdziwy ADF spłaszcza się do czytelnego tekstu, kompletny ticket nie generuje
żadnego braku, `MAX_TICKETS_PER_RUN` ustawiony z pomiaru, `/refinement` pokazuje
prawdziwy backlog, braki nazywają coś z konkretnego ticketu, brak klucza
degraduje z bannerem i nic nie zapisuje. **Nie ma tu nic do zrobienia** — wpis
istnieje po to, żeby przegląd zgodności nie zgłaszał tej checklisty jako zgubionej.

### Nieaktualne — `ui-component-foundation` (F-03, 2026-06-01), 9 wierszy

`context/archive/2026-06-01-ui-component-foundation/plan.md` ma **9**
nieodhaczonych wierszy manualnych: landing renderuje się w pasku nawigacji,
`Button` ma style shadcn, `/login` `/signup` `/reset` renderują wyśrodkowaną
kartę, linki między nimi działają, strony auth nie pokazują paska aplikacji,
spójność w obu motywach, tytuł karty przeglądarki, brak dryfu w `CLAUDE.md`,
ręczne dodanie `class="dark"` przełącza paletę OKLCH.

**Nie wykonuj ich w tej formie.** Wszystkie te powierzchnie zostały od czerwca
przebudowane i są przechodzone mimochodem przy **każdym** innym wierszu z tego
pliku — logowanie jest warunkiem wstępnym niemal wszystkich. Jedyny wciąż żywy
fragment to przełączanie motywu, i on **ma własny opis w §5** („Dark mode nie ma
przełącznika") razem z pułapką animacji `transition-all`.

Zostawione tutaj świadomie, żeby kolejny przegląd zgodności nie zgłosił ich
jako „zgubione". *Ustalone 2026-08-29.*

### Wycofane — S-22 wiersz 15.C (2026-08-31, przez S-31)

**Nie wykonuj 15.C w zapisanej formie.** Wiersz kazał kliknąć w oknie
potwierdzenia przycisk **„Disconnect GitHub"**. Ten przycisk **nie istnieje** od
S-26: okno oferuje dziś `Cancel`, `Keep my GitHub data` i `Delete my GitHub
data`, a jego **brak** jest wprost warunkiem zaliczenia wiersza **16.A**. Dwa
wiersze tego samego pliku wymagały więc rzeczy przeciwnych — jeden nie do
wykonania, drugi zaprzeczający pierwszemu.

Wycofany jest **tylko krok pośredni**. Sprawdzana rzecz — że odłączenie
GitHuba z `/settings/connections/github` zostawia leada na tej stronie z
formularzem ponownego podłączenia, a **nie** wyrzuca go na `/setup` — jest nadal
żywa i ważniejsza niż była: od S-31 to właśnie ta strona jest celem wyróżnionego
przycisku **Reconnect**, i to na obu kartach Ustawień oraz w obu kartach
kreatora. Wraca jako wiersz **24.C** w §24, z krokiem 2 przepisanym na dzisiejsze
okno.

Wiersz nie jest kasowany, tylko przekreślony w §15 z odsyłaczem tutaj, żeby ktoś
czytający starszą checklistę S-22 wiedział, dlaczego jej treść i ekran się
rozjeżdżają. *Ustalone 2026-08-31 przy S-31.*

---

## 7. S-15 `team-management-surface` — przeniesione pod termin (2026-08-25)

`context/changes/team-management-surface/MANUAL-CHECKLIST.md` została przycięta
do blokujących pozycji (nawigacja do zakładki Team + dwie ścieżki nieodwracalnie
kasujące dane + sprzątanie). Wiersze poniżej zostały **odłożone, nie
odpuszczone** — każdy z powodem, dla którego dało się go zdjąć ze ścieżki
krytycznej. Konwencja: `CLAUDE.md` → *Manual testing conventions*.

**Zamknięte w sesji 2026-08-25** (nie powtarzaj): 2.6, 3.5, 3.6, 4.4, 4.5, 4.8 —
każdy zweryfikowany na ekranie plus kontrola w `psql`. Wcześniej dowodowo:
1.8, 1.9, 2.7–2.9, 3.7 (symulacje na kontach jednorazowych, `724e2bc`, `1da8b24`).

### 7.1 — 4.6 Trwałe usunięcie ostatniego członka

*Źródło:* `context/changes/team-management-surface/plan.md` faza 4, wiersz 4.6
*Jak:* `/team/roster` na koncie z **jednym** członkiem → kosz → przeczytaj
dialog → **Cancel**.
*Co musi być prawdą:* brak przycisku *Delete permanently*; opis mówi, że roster
nie może zostać opróżniony.
*Dlaczego odłożone:* gate siedzi w serwisie i **ma test integracyjny**
(`roster-store.integration.test.ts` → „refuses the last remaining member").
Warstwa UI tylko go odzwierciedla. Scenariusz wymaga rozebrania rosteru do jednej
osoby, co niszczy stan potrzebny gdzie indziej.

### 7.2 — 4.9 Obsługa klawiatury w dialogu

*Źródło:* `plan.md` faza 4, wiersz 4.9
*Jak:* otwórz dowolny dialog potwierdzenia → Tab w kółko → Escape.
*Co musi być prawdą:* focus nie wychodzi poza dialog; Escape anuluje; **Cancel**
ma focus domyślny, nie akcja destrukcyjna.
*Dlaczego odłożone:* trap focusa i Escape to zachowanie `shadcn/ui` Dialog
(Radix), nie nasz kod. Naszą decyzją jest wyłącznie to, który przycisk dostaje
focus domyślny — jednolinijkowe, widoczne w kodzie.
*Ryzyko:* realne, ale dotyczy dostępności, nie poprawności danych.

### 7.3 — 5.5 Technology track dociera do sub-burndownów

*Źródło:* `plan.md` faza 5, wiersz 5.5
*Jak:* Settings → Team → zmień komuś **technology track** → Save → „Sync now"
w `/settings/connections` → Dashboard → **Sprint Detail** → sub-burndowny.
*Co musi być prawdą:* SP tej osoby liczą się w nowym torze.
*Dlaczego odłożone:* **zapis** kolumny potwierdzony w `psql`. Niesprawdzona
zostaje tylko konsumpcja po stronie dashboardu, wspólna z S-10 i tam
weryfikowana. Wymaga pełnego cyklu synca — najdroższy test w puli.

### 7.4 — 5.6 `/setup/team` na świeżym koncie

*Źródło:* `plan.md` faza 5, wiersz 5.6
*Jak:* załóż nowe konto → przejdź kreator do kroku Team.
*Co musi być prawdą:* auto-import odpala się sam na pustym rosterze, grid się
wypełnia, Save zapisuje.
✅ **Zaliczone 2026-08-29** (sesja manualna, Ania). Auto-import odpalił się sam,
siatka wypełniła się 6 osobami, Save zapisał 6 wierszy `team_member`
(`fte = 1.00`, `is_active = true`).
⚠️ **Do protokołu, bo wygląda jak defekt, a nie jest:** żaden wiersz nie ma
kompletu GitHub + Jira — 3 wiersze mają sam `github_username`, 3 sam
`jira_account_id`. Auto-import **nie scala tożsamości między źródłami** (brak
wspólnego klucza; scalanie jest ręczne — §7.7), a `role` i `technology_track`
zostają NULL, bo żadne źródło ich nie zna. Oba stany są oczekiwane.
*Dlaczego odłożone:* auto-import na pustym rosterze ma test integracyjny
(„fresh import proposes members from both sources"), a **oba** mounty edytora
czytają przez `listRosterForEditor`, więc nie mogą się rozjechać (komentarz w
`src/lib/roster.ts`). Koszt: pełny setup nowego konta z credentialami.
*Jeśli będzie czas na jeden dodatkowy test — wybierz ten.* To jedyny wiersz
dotykający kreatora, a nie zakładki Settings.

### 7.5 — 5.7 Szerokość tabletu (NFR, podłoga 10 cali)

*Źródło:* `plan.md` faza 5, wiersz 5.7 — **zamyka zaparkowany wiersz 4.6 z S-04**
*Jak:* DevTools → 1024 px → `/team/roster`.
*Co musi być prawdą:* grid scrolluje się poziomo, każda kontrolka osiągalna,
`body` nie scrolluje się w poziomie.
*Dlaczego odłożone:* czysto wizualne, zero ryzyka dla danych.
*Ale:* to **NFR z PRD**, więc formalnie należy do zakresu MVP — odhacz przed
oddaniem projektu, choćby na samym końcu.

### 7.6 — 3.7 Degradacja GitHuba bez `read:org`

*Źródło:* `plan.md` faza 3, wiersz 3.7
*Jak:* wygeneruj drugi PAT **bez** scope'u `read:org`, podłącz, zrób Re-import.
*Co musi być prawdą:* pokazuje się baner degradacji; **nikt** nie dostaje flagi
„Not in GitHub/Jira any more".
*Dlaczego odłożone:* pokryte testem integracyjnym („flags NOTHING GitHub-sourced
when the GitHub read degraded"); odtworzenie wymaga podmiany prawdziwych
credentiali na koncie, które używa ich do wszystkiego innego.
*Pułapka:* po teście **przywróć pełny token**, inaczej kolejne sesje pracują na
zdegradowanym GitHubie i nie jest to oczywiste na pierwszy rzut oka.

---

### 7.7 — 4.7 🔴 Merge dwóch wierszy rosteru

- [x] **7.7** Scalenie dwóch członków zespołu w jeden wiersz. **Zaliczone 2026-08-30** (sesja manualna).
      *Gdzie:* `/team/roster`, konto z prawdziwymi tokenami (identyfikuj po
      `token_last4`, nie po nazwie — §5).
      *Co zrobić:* dodaj dwa nowe wiersze — jeden z samym **GitHub username**
      (np. `merge-a`), drugi z samym **Jira account ID** (np. `acc-merge-b`),
      oba z nazwami. **Zapisz.** Odśwież (F5). Zaznacz oba checkboxami →
      **Merge selected** → potwierdź.
      *Co musi być prawdą:* dialog **nazywa po imieniu**, który wiersz znika i
      która nazwa zostaje; po potwierdzeniu zostaje **jeden** wiersz niosący
      **oba** klucze; po F5 nadal jeden, nie dwa.
      *Dlaczego to łapie:* merge **trwale usuwa wiersz z bazy**. Jeśli zadziała
      tylko w gridzie, w bazie zostaną dwa wiersze z rozjechaną tożsamością — a
      to cicho psuje atrybucję anomalii (`validations/roster.ts:54`).
      *Sprzątanie:* po teście usuń zmergowany wiersz (kosz → Delete permanently).
      *Źródło:* `context/archive/2026-08-23-team-management-surface/MANUAL-CHECKLIST.md`
      wiersz 4.7. **Zgubione przy przenoszeniu S-15 do tego pliku; przywrócone
      2026-08-29.**

### 7.8 — Sprzątanie po testach S-15

- [x] **7.8** Roster wraca do stanu wyjściowego po wierszach 7.1–7.7.
      **Zaliczone 2026-08-30** (sesja manualna, Ania) na koncie
      `anna.jozwiak19@gmail.com` (prawdziwe credentiale, GitHub `AdamLisek`,
      Jira `foxmind`). Roster: 6 wierszy, wszystkie aktywne — `Adam Reszka`,
      `Liseusz Testowy`, `Rocky Testowy` (`source = JIRA`), `AdamLisek`,
      `AniaReszka`, `FoxyMind` (`source = GITHUB`). **Ani jednego wiersza
      `source = MANUAL`**, a tylko taki zostawiają po sobie testy §7 — wczorajsze
      `merge-a` / `acc-merge-b` zniknęły. `Adam Reszka` i `FoxyMind` obecni i
      aktywni, czyli warunek zaliczenia spełniony.
      ⚠️ **Warunek „zostają dokładnie DWA wiersze" jest nieaktualny** — pisano go
      dla konta `demo@sprintflow.test`, które nadal ma dokładnie te dwie osoby.
      Konto testerki importuje 6 tożsamości z żywych źródeł i to jest jego
      poprawny stan wyjściowy. Rozstrzygające jest `source`, nie liczba wierszy
      ani słowo „Testowy" w nazwisku (Liseusz i Rocky to prawdziwe konta Jiry,
      `712020:…`).
      *Gdzie:* `/team/roster` (albo `psql`).
      *Co zrobić:* po zakończeniu wierszy S-15 przejrzyj roster.
      *Co musi być prawdą:* zostają **`Adam Reszka`** i **`FoxyMind`**, oboje
      **aktywni**; żadnych wierszy testowych (`merge-a`, `acc-merge-b` itp.).
      *Dlaczego to łapie:* `FoxyMind` to jedyne realne konto testowe z kompletem
      GitHub + Jira, a `Adam Reszka` niesie jedyną przypisaną anomalię. Oba są
      potrzebne w kolejnych slice'ach — wiersze S-14 §10 i S-23 §11 zakładają, że
      tam są.
      *Źródło:* ta sama checklista, wiersz „Sprzątanie po testach". Przywrócone
      2026-08-29.

---

## 8. S-08 `absence-calendar` — przeniesione pod termin (2026-08-25/26)

**Cała checklista S-08 jest tutaj. Slice idzie do merge'a bez ani jednej
weryfikacji manualnej** — decyzja właściciela z 2026-08-26 („teraz ich nie
wykonam"), podjęta świadomie pod termin kursu, nie przeoczenie.

Co to znaczy w praktyce: automaty pokrywają logikę (433 unit, 154 integracyjne,
mutacje 78.96%, review implementacji z 7 naprawionymi znaleziskami), ale **żadna
z pięciu ścieżek przeglądarkowych nie została przeklikana przez człowieka.**
Ryzyko jest skoncentrowane w **8.4**, bo to jedyny wiersz dotykający ścieżki,
która **nieodwracalnie kasuje dane**.

Kolejność niżej to kolejność, w jakiej warto to nadrobić: 8.4 → 8.5 → 8.6 → 8.7
→ 8.8, potem 8.1–8.3.

### 8.4 — 6.4 🔴 Bramka trwałego usunięcia uzbraja się po raz pierwszy

*Źródło:* `context/changes/absence-calendar/MANUAL-CHECKLIST.md`, faza 6
*Gdzie:* `/team/absences`, potem `/team/roster`.
*Jak:* zapisz absencję dla dowolnej osoby → zakładka **Team** → kosz przy **tej
samej** osobie.
*Co musi być prawdą:*
  - dialog oferuje **wyłącznie Deactivate**, przycisku „Delete permanently" **nie ma**;
  - dialog pisze „**1 recorded absence**" (liczba, nie ogólnik);
  - przy osobie **bez** absencji „Delete permanently" nadal **jest**.
*Dlaczego to najważniejszy wiersz S-08:* to jedyna pozycja pilnująca ścieżki
**niszczącej dane nieodwracalnie**. S-08 jest pierwszym slice'em, który realnie
uzbraja bramkę z S-15 — do tej pory `absence` miała zero wierszy, więc
`getMemberHistory` zawsze zwracała 0 i ta gałąź **nigdy się nie wykonała na
produkcyjnej ścieżce**. Regresja kasuje ręcznie wprowadzone dane bez ostrzeżenia,
a żaden test automatyczny nie złapie tego jako widocznego dla użytkownika.
*Koszt:* ~3 minuty.

### 8.5 — 4.5 Absencja gasi `DEVELOPER_INACTIVE` bez czekania na sync

*Źródło:* `MANUAL-CHECKLIST.md`, faza 4
*Gdzie:* `/dashboard` (zakładka **Anomaly Inbox**), potem `/team/absences`.
*Jak:* znajdź w inboxie wiersz `DEVELOPER_INACTIVE`, zapisz absencję dla tej
osoby na zakres obejmujący **dzisiaj**, wróć na `/dashboard` i odśwież.
*Co musi być prawdą:* wiersz zniknął **od razu**, bez czekania na cykl cron
(15 min) i bez „Sync now".
*Dlaczego:* to decyzja D1. Testy integracyjne pokrywają pętlę reconcile, ale nie
ścieżkę Server Action → `router.refresh()` → render. Jeśli to nie działa, lead
zapisuje urlop i patrzy na anomalię, którą właśnie wyjaśnił.

### 8.6 — 2.3 Zapis absencji przeżywa odświeżenie, z właściwymi dniami

*Źródło:* `MANUAL-CHECKLIST.md`, faza 2
*Gdzie:* `/team/absences`.
*Jak:* *Record an absence* → osoba → **dwa** kliknięcia w kalendarzu → rodzaj →
*Record absence* → **F5**.
*Co musi być prawdą:* wiersz jest po odświeżeniu, a kolumna **Dates** pokazuje
**dokładnie te dni, które kliknąłeś** — nie o jeden wcześniej.
*Dlaczego:* dzień z kalendarza jest lokalny dla przeglądarki, a kolumny są
instantami w strefie **zespołu**. Przesunięcie o dzień jest cicho poprawne dla
TypeScriptu i psuje wszystkie trzy efekty FR-010 naraz.
*Kontekst:* dokładnie ta klasa błędu wyszła w impl-review w seedzie (F2) — tam
helper stref był zależny od strefy hosta. Kod aplikacji idzie inną ścieżką i ma
testy, ale to jedyne miejsce, gdzie realna przeglądarka to potwierdza.

### 8.7 — 2.4 + 2.5 Edycja i usuwanie trafiają we właściwy wiersz

*Źródło:* `MANUAL-CHECKLIST.md`, faza 2
*Gdzie:* `/team/absences`, mając **co najmniej dwie** absencje.
*Jak:* ołówek przy pierwszej → zmień zakres → *Save changes*; potem kosz przy drugiej.
*Co musi być prawdą:*
  - po edycji wierszy jest **tyle samo** co przed;
  - dialog usuwania **cytuje konkretną absencję** („Mia Krystof — vacation,
    5 May 2026 – 9 May 2026"), a nie ogólne „this item".
*Dlaczego:* edycja gubiąca `id` degraduje się do wstawienia duplikatu, którego
magazyn nie odrzuci (to inne okno). Dialog nienazywający tego, co niszczy, to
klasa błędu, którą zamykał S-15.

### 8.8 — 6.5 Seed demo pokazuje wszystkie trzy efekty

*Źródło:* `MANUAL-CHECKLIST.md`, faza 6
*Gdzie:* `/settings/demo`, potem `/dashboard`.
*Jak:* zaloguj się i kliknij „Zobacz demo".
**Zaktualizowane 2026-08-29 (S-09).** Skrypt `db:seed:demo` został usunięty;
ostrzeżenie o last4 i o kasowaniu credentiali **nie dotyczy** nowej ścieżki —
demo ma własnego właściciela i nie sięga do prawdziwych danych konta.
*Co musi być prawdą:*
  - Availability: **Erik Lund**, **Bob Rivera** i **Chen Wu** mają zaznaczone dni;
    „Next window" **nie zachodzi** na „This sprint" (ostatnia kolumna pierwszej
    siatki i pierwsza kolumna drugiej to różne daty — to była realna regresja F1,
    naprawiona);
  - liczba pojemności w SP jest **niższa** niż 50 SP (5 × 10 z rosteru);
  - inbox: `SPRINT_AT_RISK` o **Bobie**, `DEVELOPER_INACTIVE` o **Alice**, nie o Eriku;
  - nigdzie w inboxie nie pada **sickness / vacation / training**.
*Dlaczego:* dwie rzeczy naraz — czy trzy efekty FR-010 są widoczne bez prawdziwych
integracji (wejście dla **S-09**), i czy typ absencji nie wycieka na ekran. Typ to
informacja o zdrowiu nazwanej osoby, a FR-018 wysyła każdą anomalię mailem.

---

Poniższe trzy (8.1–8.3) zostały przeniesione tutaj **wcześniej**, przy cięciu
checklisty do pięciu pozycji — nie są niepotrzebne, są odłożone.

### 8.1 — 5.5 Zakładka Availability pokazuje właściwych ludzi we właściwych dniach

*Źródło:* `context/changes/absence-calendar/plan.md` faza 5, wiersz 5.5
*Jak:* `/dashboard` → zakładka **Availability**; porównaj zaznaczone komórki z
wierszami na `/team/absences`.
*Co musi być prawdą:* każda absencja jest zaznaczona na **dokładnie** tych dniach,
które pokazuje kolumna **Dates**, w obu sekcjach („This sprint" i „Next window").
*Dlaczego odłożone:* logika budowania siatki jest w całości pokryta przez
`availability-view.test.ts` — oś dni, oba końce zakresu, przycinanie do okna,
pominięcie absencji spoza okna, strefa czasowa zespołu. Zostaje samo
renderowanie, a **wiersz 6.5 z krótkiej listy i tak każe spojrzeć na tę zakładkę**
na danych z seeda.
*Kiedy zrobić:* przy okazji 6.5, jeśli będzie chwila.

### 8.2 — 5.6 Zapis absencji obniża liczbę pojemności

*Źródło:* `plan.md` faza 5, wiersz 5.6
*Jak:* zapamiętaj liczbę SP na zakładce Availability → dodaj absencję na kilka
dni roboczych → wróć i odśwież.
*Co musi być prawdą:* liczba spadła, i spadła **proporcjonalnie** — osoba z
`sp_capacity` 10 nieobecna przez połowę dni roboczych sprintu zabiera ~5 SP,
nie 10 i nie 0.
*Dlaczego odłożone:* `capacity.test.ts` pinuje dokładnie tę arytmetykę
(nieobecność przez pół sprintu, przez cały sprint, przycięta do krawędzi
sprintu, weekend kosztujący zero). Wiersz 6.5 sprawdza kierunek zmiany
(pojemność < 50 SP na seedzie), więc niepokryta zostaje tylko proporcja.

### 8.3 — 5.7 Zespół bez ustawionego `sp_capacity` widzi wyjaśnienie, nie „0 SP"

*Źródło:* `plan.md` faza 5, wiersz 5.7
*Jak:* na koncie testowym wyczyść `sp_capacity` **wszystkim** aktywnym członkom
(`/team/roster`, pole Capacity na puste, zapisz) → `/dashboard` → Availability.
*Co musi być prawdą:* widać zdanie „No story-point capacity set for anyone on
the team yet…", a **nie** liczba „0 SP".
*Dlaczego odłożone:* `NULL` jest tu jawnie wykluczony i policzony osobno
(`membersWithoutCapacity`), i ma własny test unitowy („excludes a member with no
capacity set and counts them separately"). Przygotowanie stanu wymaga
zdemolowania rosteru konta testowego, co jest droższe niż samo sprawdzenie.
*Dlaczego mimo to warto:* `NULL` czytany jako zero to dokładnie ta klasa błędu,
która daje leadowi liczbę wyglądającą na prawdziwą — a on nie ma jak poznać, że
jest zaniżona.

---

## 9. S-11 `daily-recap-email` — otwarte (2026-08-26)

Kod dowieziony w 6 fazach (`1478a80` → `38f049d`), wszystkie **57** kryteriów
automatycznych zielone: 550 unit, 210 integration, 11/11 E2E, `typecheck`,
`lint`. Otwarte zostaje **13 wierszy manualnych**. Krótka lista dla operatora:
`context/changes/daily-recap-email/MANUAL-CHECKLIST.md` (5 pozycji).

> ⚠️ **Twarda zależność: konto Resend + zweryfikowana domena `sprintflow.pl`.**
> Wiersze 3.7–3.9, 5.15 i 5.16 są **nieosiągalne**, dopóki nie powstanie konto,
> rekordy SPF/DKIM/DMARC nie wylądują w Cloudflare DNS, a `RESEND_API_KEY` +
> `RESEND_FROM_ADDRESS` nie zostaną wrzucone przez `wrangler secret put`. To
> zadanie operatorskie, nie programistyczne — instrukcja krok po kroku jest w
> `MANUAL-CHECKLIST.md` na górze. **Bez tego kod działa i wszystkie bramki
> przechodzą** (lokalny dev używa transportu konsolowego), ale żaden mail nie
> wychodzi.

> ⚠️ **Obserwacja produktowa 2026-08-30 — dni wolne.**
> `context/manual-tests/S-11-obserwacja-recap-dni-wolne.md`. Wysyłka nie patrzy
> w kalendarz (`due.ts` zna tylko `enabled` + godzinę), „wczorajsza aktywność" to
> poprzedni dzień **kalendarzowy** (`build.ts:66`), więc poniedziałkowy mail
> opisuje niedzielę i gubi piątek; a `DEVELOPER_INACTIVE` nie czyta
> `nonWorkingDays`, choć `SPRINT_AT_RISK` i kubełek 21 SP już tak. **To nie jest
> nieudany wiersz** — nikt tego nie uruchomił, hipoteza pochodzi z kodu. Do
> potwierdzenia przy 5.15/5.16. Decyzja: właściciel.

### Osiągalne od razu — nie wymagają Resenda

- [x] **1.9** `\d daily_recap` i `\d recap_settings` na lokalnym Supabase
      pokazują zamierzony kształt.
      *Źródło:* `context/changes/daily-recap-email/plan.md` faza 1
      *Co musi być prawdą:* brak kolumny `recap_date`; `recap_day text NOT NULL`;
      `daily_recap_owner_day_uq UNIQUE (owner_id, recap_day)`; `send_status NOT
      NULL DEFAULT 'PENDING'`; kolumny `attempt_count`, `last_attempt_at`,
      `rendered_message`; `recap_settings` z `recap_settings_owner_uq`.
      *Status:* **Zaliczone 2026-08-30** (sesja manualna) — wszystkie siedem
      warunków potwierdzone odczytem `information_schema` / `pg_constraint`
      przeciwko `:54322`. Wcześniejsze sprawdzenie z sesji 2026-08-26 dało ten
      sam wynik; odhaczone dopiero teraz, bo checklisty manualne zamyka
      użytkownik, nie agent.
      *Dlaczego to ma znaczenie:* cała gwarancja exactly-once opiera się na tym
      unique key. Nullowalny człon klucza nie kolidowałby nigdy (lessons.md #1).

- [x] **4.13** Dashboard „Today" renderuje się identycznie po wyciągnięciu
      mapowania anomalii z RSC do `lib/anomaly/inbox-view.ts`.
      *Jak:* `/dashboard` → Anomaly Inbox. Porównaj z tym, co pamiętasz sprzed
      slice'a: te same anomalie, ta sama kolejność, te same context chips,
      działające sortowanie i filtry.
      *Dlaczego:* to refaktor bez zmiany zachowania, ale dotyka jedynej ścieżki
      renderującej nagłówkową powierzchnię produktu. Test integracyjny dowodzi,
      że mail i inbox wołają tę samą funkcję — nie że komponent nadal ją dobrze
      konsumuje.
      *Status:* **Zaliczone 2026-08-30** (sesja manualna, Ania). Wykonane w
      trybie demo — konto realne ma zero anomalii, więc pusty inbox nie
      pozwoliłby ocenić kolejności ani kontrolek. Potwierdzone: 14 pozycji,
      kolejność HIGH (3× `SPRINT_AT_RISK`) → MEDIUM → LOW, komplet pięciu
      atrybutów FR-014 na pozycji (opis, kontekst z osobą i datą, suggested
      action, „View source" prowadzący do Jiry; `SPRINT_AT_RISK` bez linku —
      poprawnie, `source_url IS NULL`), cztery sortowania (severity / age /
      ticket / developer) zmieniają kolejność, oba filtry zawężają i czyszczą
      się. Liczby zweryfikowane przeciwko bazie: Alice Kim = 3, Sprint at risk
      = 3 — zgodne z ekranem co do sztuki.

- [x] **6.10** Ostrzeżenie przy zmianie projektu Jira wymienia „daily recaps".
      **Zaliczone 2026-08-30** (sesja manualna, Ania).
      *Jak:* `/settings/connections` → zmiana projektu Jira → **przeczytaj
      ostrzeżenie, nie potwierdzaj**.
      *Dlaczego:* potwierdzenie, które niedomawia, co kasuje, jest defektem.
      *Uwaga — pierwotne uzasadnienie tego wiersza było błędne.* Brzmiało
      „`daily_recap` kaskaduje po `sprint`, więc przełączenie projektu kasuje
      archiwum recapów". S-24 wykazał coś przeciwnego: `daily_recap.sprint_id`
      jest `ON DELETE SET NULL`, więc recapy **przeżywają**, tracąc tylko
      powiązanie ze sprintem. Ostrzeżenie wymienia je zatem po stronie *keeps*,
      i to jest poprawne — wiersz zalicza się mimo innego niż zakładano znaku.
      *Zaobserwowane:* nagłówek „This discards synced sprint data"; po stronie
      strat — sprinty, ich tickety i historia statusów, anomalie oraz
      **ręcznie wpisane nieobecności, których żaden sync nie odtworzy**; po
      stronie zachowanych — token i workspace Jiry, roster, dni wolne zespołu,
      capacity/velocity zamkniętych sprintów, status mapping (do ponownego
      wpisania, nie do stracenia) i „past daily recaps, which stay readable but
      stop being linked to a sprint". Dwa przyciski: destrukcyjny za jawnym
      „I understand — choose a project" plus „Cancel"; kliknięto Cancel, nic nie
      zmieniono.

- [x] **6.11** `/settings/recap` osiągalne z zakładek i pokazuje bieżące wartości.
      **Zaliczone 2026-08-30** (sesja manualna, Ania).
      *Zaobserwowane* (konto `anna.jozwiak19@gmail.com`, brak wiersza
      `recap_settings` → domyślne): sześć zakładek w kolejności Connections /
      Team / Absences / Daily recap / Anomaly rules / Demo; przełącznik
      włączony, godzina **15:00**; podpowiedź „SprintFlow has no time zone for
      your team yet, so this is UTC until the next Jira sync picks one up"
      (zgodne z `jira_project.time_zone = NULL` mimo wybranego projektu `PT`);
      „Last send" → „No recap has been sent yet…" (zgodne z zerem wierszy
      `daily_recap` dla tego ownera).
- [x] **6.12** Zmiana godziny zapisuje się, toastuje i przeżywa reload.
      **Zaliczone 2026-08-30** (sesja manualna, Ania) — na koncie
      `anna.jozwiak19@gmail.com`, poza demem. Przebieg mocniejszy niż zakładała
      instrukcja: `recap_settings` nie miała **ani jednego** wiersza dla żadnego
      ownera, więc zapis poszedł ścieżką INSERT (pierwszy zapis konta), nie
      UPDATE istniejącej wartości.
      *Zaobserwowane:* pole startowało na domyślnych `15:00`; ustawione `09:30`
      (celowo różne i godziną, i minutami — gubione minuty wyszłyby od razu);
      po **Save** toast „Daily recap settings saved." na dole ekranu; po
      przeładowaniu pole nadal `09:30`. W bazie **dokładnie jeden** wiersz:
      `send_hour=9`, `send_minute=30`, `enabled=true`, `disabled_reason=NULL`,
      `created_at = updated_at` — czyli wstawienie, nie nadpisanie.
      *Stan po teście:* wiersz zostaje z `09:30`; nie przywracano `15:00`, bo
      6.13 i 6.14 i tak potrzebują istniejącego wiersza.
- [ ] **6.13** Linia „Last send" odzwierciedla ostatni recap.
      *Dlaczego (6.11–6.13):* to jedyne miejsce w produkcie, gdzie owner w ogóle
      widzi, czy wysyłka zadziałała — świadomie *pull*, nie banner na
      dashboardzie, żeby awaria recapa nie rozcieńczała bannera US-01 o
      nieświeżych danych z integracji.

### ✅ ODBLOKOWANE 2026-08-29 — Resend skonfigurowany

**Do wykonania, nie „zaliczone".** Owner podpiął konto Resend: `RESEND_API_KEY`
i `RESEND_FROM_ADDRESS` (`SprintFlow <no-reply@sprintflow.pl>`) są ustawione
lokalnie **i** jako sekrety na Cloudflare, więc `email-transport.ts` przestaje
schodzić na wypisywanie treści do logu i faktycznie wysyła.

⚠️ **Dwie konsekwencje, zanim ktoś tknie te wiersze:**

1. **Maile wychodzą naprawdę.** Od tej chwili każdy test dotykający resetu hasła
   albo recapa trafia do prawdziwej skrzynki. Używaj własnego adresu.
2. **Klucz nie dowodzi weryfikacji domeny.** Wiersz **3.7** (SPF/DKIM/DMARC w
   panelu Resenda) trzeba wykonać jako pierwszy — dopóki domena nie jest
   zweryfikowana, 3.8, 5.15 i 6.14 mogą paść z powodu, który nie ma nic
   wspólnego z kodem SprintFlow, i zmarnują notatkę na nieistniejący defekt.

- [ ] **3.7** Panel Resend pokazuje `sprintflow.pl` zweryfikowaną (SPF, DKIM, DMARC).
      🔒 **Tylko ręcznie, w panelu — API tego nie powie.** Sprawdzone 2026-08-29:
      `GET https://api.resend.com/domains` zwraca `401 restricted_api_key`
      („This API key is restricted to only send emails"). Klucz jest celowo
      ograniczony do wysyłki, więc nie odczyta ani listy domen, ani statusu
      rekordów DNS. To zaleta, nie usterka — wyciek takiego klucza nie odsłania
      konfiguracji konta. **Nie próbuj ponownie przez API**; zaloguj się do
      panelu Resenda i odczytaj status trzech rekordów tam.
- [ ] **3.8** Prawdziwy request resetu dowozi maila, którego link loguje na
      `/reset/confirm`.
- [ ] **3.9** Log Workera z tego requestu **nie zawiera URL-a resetu**.
      *Dlaczego:* URL resetu jest sekretem na okaziciela — wyciek do logu to
      przejęcie konta przez każdego z dostępem do logów. To też najtańszy
      konsument transportu: jeśli tu działa, klucz i DKIM są dobrze ustawione,
      zanim zależy od nich recap.

- [ ] **5.15** Prawdziwy recap przychodzi i zgadza się z `/dashboard` co do
      znaku, łącznie z anomalią o `source_url = NULL` renderowaną jako tekst.
      *Dlaczego:* rozbieżność inbox↔mail to nagłówkowe ryzyko slice'a, a gałąź
      NULL-owego linku jest w **pierwszym mailu, jaki ten system wyśle** —
      konto projektu ma dziś żywą anomalię `DEVELOPER_INACTIVE` bez linku.

- [ ] **5.16** Kolejny tick crona nie wysyła drugiego maila.
      *Dlaczego:* dowód, że na produkcji cron faktycznie wchodzi w ścieżkę
      claimu, a nie omija ją np. przez inną strefę czasową.

- [ ] **6.14** Wyłączenie recapa (`enabled: false`) zatrzymuje wysyłkę nazajutrz.
      *Co musi być prawdą:* brak maila **i brak nowego wiersza** `daily_recap` —
      skip następuje przed claimem.

- [ ] **6.15** Parasol — `MANUAL-CHECKLIST.md` podpisany w całości.
      *Nie odhaczaj ręcznie, dopóki 5 wierszy checklisty nie padnie.*

### Świadomie NIE zrobione w tym slice'ie

**Obsługa bounce'ów i skarg nie istnieje** (plan §What We're NOT Doing, F6 z
review planu). 200 od Resenda znaczy „przyjęte", nie „dostarczone", więc wiersz
`SENT` niczego nie dowodzi o doręczeniu. Przy `requireEmailVerification: false`
(`auth.ts:52`) i `enabled` domyślnie włączonym literówka w adresie rejestracji
dostaje maila codziennie i codziennie twardo odbija — tak umiera reputacja
świeżej domeny i tak zawiesza się konto Resend. Zamknięcie = webhook Resenda +
ścieżka bounce → `enabled: false`; zapisane jako zakres **S-12**, obok historii
recapów, która i tak by to renderowała. **Do tego czasu: jeśli w panelu Resend
pojawią się bounce'y, wyłącz recap dla tego konta ręcznie.**

---

## 10. S-14 `anomaly-settings-page` — otwarte (2026-08-29)

Cztery wiersze blokujące (10.A–10.D) są **tutaj w całości**, a nie tylko
wskaźnikiem — pełna, rozpisana wersja tych samych czterech leży w
`context/changes/anomaly-settings-page/MANUAL-CHECKLIST.md`. Dalej (10.1–10.7)
reszta: nic nie zostało wyrzucone, tylko odłożone, każdy wiersz z powodem.

### Blokujące (odpowiadają wierszom 3.5–3.11 w `plan.md`)

- [ ] **10.A** (3.5 + 3.6) Zakładka **Anomaly rules** istnieje i pokazuje osiem reguł.
      *Gdzie:* `/settings` → **Anomaly rules** (piąta w kolejności, tuż przed
      **Demo**). Dowolne zalogowane konto.
      *Co zrobić:* Ustawienia → kliknij **Anomaly rules**.
      *Co musi być prawdą:* zakładka stoi **przed** **Demo**; strona pokazuje
      **osiem kart** (PR review stalled, Ticket ageing in a status, Developer
      inactive, Ticket with no commits, Sprint at risk, Pull request too big,
      Scope creep, PR / ticket desync); *Pull request too big* pokazuje **500**;
      *Ticket ageing in a status* pokazuje **siedem** kubełków SP — od S-28
      (2026-08-30) **wszystkie siedem to pola liczbowe**, także 21 SP, które
      pokazuje **64**; lista dwupozycyjna zniknęła razem z sentinelem
      `"8_WORKING_DAYS"`. Każde pole czasu nazywa jednostkę **„working hours"**
      / **„working days"**. *PR / ticket desync* pokazuje **tylko** Severity, bez
      pola liczbowego; **żadna** karta nie ma odznaki „Modified".
      *Dlaczego to łapie:* bez wpisu w zakładkach strona istnieje pod adresem,
      ale nikt jej nie znajdzie — a to powierzchnia, którą FR-009 obiecał,
      przenosząc strojenie progów **poza** kreator setupu. Osiem kart dowodzi, że
      odczyt jest wyczerpujący: konto bez ani jednego wiersza w
      `anomaly_settings` musi zobaczyć komplet domyślnych, nie pustą listę.

- [ ] **10.B** (3.7) Zapis przeżywa przeładowanie i oznacza **dokładnie jedną** kartę.
      *Gdzie:* `/settings/anomalies`, karta **Pull request too big**.
      *Co zrobić:* zmień **PR size limit** z `500` na `50` → **Save** → F5.
      *Co musi być prawdą:* zielony toast „Pull request too big saved."; po F5 w
      polu nadal **50**; odznaka **„Modified"** **wyłącznie** na tej karcie;
      **Reset to defaults** aktywny tu, wyszarzony na pozostałych siedmiu.
      *Dlaczego to łapie:* zapis jest per-reguła, przez `ON CONFLICT` po
      `(owner_id, anomaly_type)`. Odznaka na więcej niż jednej karcie znaczyłaby,
      że zapis napisał wiersze dla reguł, których nikt nie ruszał; brak odznaki po
      F5 — że nie zapisał nic, a toast skłamał.

- [ ] **10.C** (3.8) 🔴 Zmiana progu widać w Anomaly Inbox **natychmiast**, bez „Sync now".
      ⚠️ **KONIECZNIE w trybie demo.** Na koncie **bez aktywnego sprintu**
      `detectAnomalies` kończy się cichym `skipped: no_sprint`, a akcja połyka ten
      wynik — więc zapis pokaże zielony toast przy nieruszonym inboxie,
      **nieodróżnialnie** od zepsutego przeliczania. Fixture demo gwarantuje
      aktywny sprint z pull requestami.
      *Co zrobić:* Ustawienia → **Demo** → „Zobacz demo"; otwórz `/dashboard` i
      **zapamiętaj liczbę anomalii „Pull request too big"** (może być zero);
      Ustawienia → **Anomaly rules** → *Pull request too big* → `50` → **Save**;
      wróć na `/dashboard` **samym przejściem**.
      *Co musi być prawdą:* w inboxie jest **więcej** anomalii „Pull request too
      big" niż przedtem; nie kliknięto **„Sync now"** i nie czekano na cykl.
      *Dlaczego to łapie:* to jedyny dowód na decyzję **D1** — próg i severity są
      stemplowane na wierszu `anomaly` w momencie detekcji, więc bez ponownego
      uruchomienia detekcji lead zmieniłby liczbę i przez kwadrans nie widziałby
      różnicy. Roadmapa mówiła kiedyś coś przeciwnego (poprawione 2026-08-29).

- [ ] **10.D** (3.10) Wartość `0` jest odrzucana i **nic** nie zostaje zapisane.
      *Gdzie:* `/settings/anomalies`, karta *Pull request too big*.
      *Co zrobić:* najpierw **Reset to defaults**, jeśli karta ma odznakę po
      10.B; potem wpisz `0` → **Save**; potem `-5` → **Save**; F5.
      *Co musi być prawdą:* w obu przypadkach czerwony komunikat pod polem (np.
      „The PR size limit must be at least 1.") i **żadnego** zielonego toasta; po
      F5 w polu **500**, karta **bez** odznaki.
      *Dlaczego to łapie:* kolumna `thresholds` jest `jsonb`, a każdy detektor
      czyta ją niesprawdzonym rzutowaniem `as`. Zapisane `0` nie wybucha przy
      zapisie — dopiero przy detekcji: albo reguła trafia w **każdy** wiersz
      (zalew fałszywych alarmów), albo `NaN` w `risk_score` (kolumna `integer`)
      przerywa **całą** transakcję detekcji.
      ➕ **Dopisane 2026-08-30 (S-28):** powtórz to samo na kubełku **21 SP**
      karty *Ticket ageing in a status*, który przestał być listą i jest polem
      liczbowym — czyli nową powierzchnią dla dokładnie tej samej awarii.

### Odłożone

Kontekst, który zmienia priorytety: **jedyna bariera runtime między formularzem
a kolumną `jsonb` to `src/lib/validations/anomaly-settings.ts`**, a stoi ona po
**obu** stronach kolumny (zapis w akcji, odczyt w `mergeRule`). Detektory czytają
ciało progu niesprawdzonym rzutowaniem `as`, więc każdy wiersz niżej, który
dotyka kształtu ciała, chroni przed awarią detekcji, a nie przed brzydkim UI.

- [ ] **10.1** Formularz jest używalny przy szerokości **1024 px** (podłoga
      tabletowa z NFR w PRD — poniżej niej wsparcie jest poza zakresem MVP).
      *Co musi być prawdą:* siatka pól nie wychodzi poza ekran, przyciski
      **Save** / **Reset to defaults** są klikalne bez przewijania w poziomie,
      a siatka siedmiu kubełków SP nie nachodzi na sąsiednie pola.
      *Dlaczego odłożone:* to samo ryzyko co §7.5 — układ, nie dane.

- [ ] **10.2** **Reset to defaults** przywraca wartość i gasi odznakę na każdej
      z ośmiu kart, nie tylko na *Pull request too big* (wiersz D checklisty
      pokrywa jedną kartę).
      *Co musi być prawdą:* po resecie pole wraca do wartości z
      `src/db/defaults.ts`, odznaka **„Modified"** znika, a sam przycisk staje
      się wyszarzony.
      *Dlaczego:* reset kasuje wiersz `anomaly_settings`; przycisk aktywny przy
      braku wiersza to cicha operacja pusta udająca sukces.

- [ ] **10.3** Każda z ośmiu kart renderuje **swoje prawdziwe pola**, zgodne z
      `DEFAULT_THRESHOLDS`. ⚠️ **Wartości przeliczone przez S-28 (2026-08-30)** —
      poprzednia wersja tego wiersza pinowała liczby sprzed zmiany jednostki i
      oblałaby się na poprawnym kodzie: PR review stalled → **8 working hours**;
      Developer inactive i Ticket with no commits → **2 working days**; Ticket
      ageing in a status → **8 / 8 / 16 / 24 / 40 / 40 / 64 working hours** dla
      1/2/3/5/8/13/21 SP, Code review **8**, Testing **16**; Sprint at risk →
      2 / 2 / 3 równolegle + **16 working hours** przed końcem sprintu; Scope
      creep → 20 %; PR / ticket desync → samo Severity.
      *Dlaczego:* pole przemianowane po jednej stronie daje detektorowi
      `undefined`, a to jest właśnie ścieżka `NaN` → `risk_score`. Jednostka jest
      częścią tego wiersza, bo od S-28 „8" znaczy jeden dzień pracy zespołu, a
      nie osiem godzin zegarowych — karta bez słowa „working" opisuje produkt,
      który już nie istnieje.

- [ ] **10.4** Edycja **jednego** kubełka SP w karcie *Ticket ageing in a status*
      zostawia w bazie **wszystkie siedem**.
      *Co zrobić:* zmień 3 SP na `32`, zapisz, odśwież — sprawdź, że 1, 2, 5, 8,
      13 i 21 SP mają nadal swoje wartości (**21 SP dalej `64`**; do S-28 stała
      tam dwupozycyjna lista z „8 working days").
      *Dlaczego:* scalanie nadpisania jest **jednopoziomowe**, więc częściowa mapa
      **zastępuje** domyślną i kasuje resztę kubełków. `inProgressBudget` spada
      wtedy do najbliższego niższego progu albo — dla pustej mapy — zwraca `null`
      i pomija **każde** zadanie In Progress, co na ekranie wygląda jak zdrowy
      sprint. To dokładnie lekcja „zawężający predykat zamienia złą wartość w
      pusty wynik" z `lessons.md`.

- [ ] **10.5** Kubełek 21 SP jest zwykłym polem liczbowym i przeżywa
      przeładowanie (**przepisane 2026-08-30 przez S-28** — do tego dnia była to
      lista dwupozycyjna „120 hours (5 days)" / „8 working days", a ten wiersz
      kazał ją przełączać w obie strony; taka kontrolka już nie istnieje).
      *Gdzie:* `/settings/anomalies`, karta *Ticket ageing in a status*.
      *Co zrobić:* zmień 21 SP z `64` na `72`, **Save**, F5; potem **Reset to
      defaults**, F5.
      *Co musi być prawdą:* po pierwszym F5 w polu **72** i odznaka „Modified" na
      tej jednej karcie; po resecie **64** i brak odznaki. W żadnym momencie nie
      pojawia się na wejściu na stronę komunikat „Unsaved changes.".
      *Dlaczego:* sentinel `"8_WORKING_DAYS"` istniał tylko dlatego, że pole było
      denominowane w godzinach zegarowych i „osiem dni roboczych" było w nim
      niewyrażalne. Od S-28 jednostką są godziny robocze, więc to po prostu 64.
      Sam literał **nadal jest akceptowany przy odczycie** (konta, które zapisały
      go przed zmianą), a walidacja `.strict()` w `mergeRule` odrzuca CAŁE
      nadpisanie razem z severity, gdy kształt się nie zgadza — dlatego brak
      „Unsaved changes." jest tu równie ważny jak sama liczba.

- [ ] **10.6** W trybie demo zapis progu **ląduje pod właścicielem demo** i jest
      cofany przez **„Zresetuj dane demo"**.
      *Co zrobić:* w demie zmień próg, zapisz, wróć do trybu realnego i sprawdź,
      że karta w realnym workspace ma nadal wartość domyślną; potem w demie
      kliknij **„Zresetuj dane demo"** i sprawdź, że nadpisanie zniknęło.
      *Dlaczego:* zakładka celowo **nie** odmawia zapisu w demie (inaczej niż
      `/settings/recap`) — bo tylko demo ma gwarantowany aktywny sprint, więc
      tylko tam widać efekt D1. Cena tej decyzji to izolacja demo↔real, którą ten
      wiersz sprawdza.

- [ ] **10.7** Zmiana progu potrafi naruszyć **wciąż otwarte** wiersze S-07:
      1.5, 2.5, 3.5, 3.6, 4.7 i 5.2–5.5 dotyczą zawartości Anomaly Inbox.
      *Co musi być prawdą:* jeśli robisz te wiersze po S-14, **najpierw** upewnij
      się, że reguły są na domyślnych (brak odznak „Modified" na
      `/settings/anomalies`) — inaczej porównujesz inbox z innym progiem niż ten,
      pod który wiersze S-07 były pisane.
      ⚠️ **Od S-28 (2026-08-30) „domyślne" to inne liczby i inna jednostka.**
      Same domyślne zostały przeliczone (patrz 10.3), a każdy wiek w inboxie jest
      teraz liczony w godzinach roboczych — więc wiersze S-07, które pinują
      konkretny wiek albo liczbę anomalii, trzeba czytać przeciw §21, a nie
      przeciw pamięci sprzed tej zmiany.

### Świadomie NIE zrobione w tym slice'ie

**Sentinel `"8_WORKING_DAYS"` nie stał się danymi.** ~~Kubełek 21 SP pozostaje
wyborem dwupozycyjnym (`120 h` albo `8 dni roboczych`); „10 dni roboczych" jest
niewyrażalne.~~ **NIEAKTUALNE od 2026-08-30 (S-28).** Ten akapit sam wskazał
cenę: „zmiana wymagałaby ruszenia `src/db/defaults.ts`, `ticket-status-aging.ts`
**i** założeń fixture'a demo naraz" — i dokładnie to zrobił S-28, bo jednostką
całego silnika stały się godziny robocze. „Osiem dni roboczych" to teraz 64,
„dziesięć" to 80; sentinel zniknął z detektora, a literał jest utrzymywany
wyłącznie po stronie odczytu, dla kont, które zapisały go wcześniej.

**Severity nie ma poziomu ponad `HIGH`.** `SPRINT_AT_RISK` startuje z `HIGH`, a
`riskScore` nie ma wyższego stopnia — więc tę jedną regułę da się przesunąć
wyłącznie w dół. To ograniczenie modelu, nie brak w formularzu; karta mówi o tym
wprost.

**Wiersze `RESOLVED` zachowują stary próg i stare severity na zawsze.** Świadomie
nie ma o tym ani słowa w UI: `reader.ts` filtruje `status = ACTIVE`, a Daily Recap
czyta przez ten sam reader — więc taki wiersz nie jest renderowany **nigdzie**.
Ostrzeżenie o stanie niewidocznym zjadłoby budżet tekstu na karcie.

---

## 11. S-23 `capacity-in-man-days` — otwarte w całości (2026-08-27, dopisane 2026-08-29)

**Ten slice nie miał tu ani jednego wiersza aż do 2026-08-29** — zmiana została
zarchiwizowana z 18 nieodhaczonymi wierszami manualnymi w `plan.md`, a ten plik
o nich nie wiedział. Pełne uzasadnienia (po kilkanaście linii na wiersz) są w
`context/archive/2026-08-27-capacity-in-man-days/MANUAL-CHECKLIST.md`; niżej
komplet, w formie wystarczającej do wykonania.

**Konto:** wszędzie `demo@sprintflow.test` — to ono ma prawdziwe tokeny (§5,
identyfikuj po `token_last4`, nie po nazwie).

**Kolejność:** 1.7 → 1.8 → 1.9 → 2.7 → 2.9 → 5.7 → 5.8 → 6.5 → 6.6, potem
reszta. **2.8, 3.8, 4.8, 7.5, 7.9 mają twarde zależności** — opisane przy nich.

### Faza 1 — etat zamiast SP w rosterze

- [ ] **11.1** (1.7) Banner migracji na `/team/roster` znika na dobre.
      *Co zrobić:* wejdź na `/team/roster`, policz członków, kliknij
      **„Confirm availability"**, F5, przejdź na `/dashboard` i wróć.
      *Co musi być prawdą:* przed kliknięciem banner mówi „Check N people's
      availability", gdzie **N = liczba członków**; po kliknięciu znika
      natychmiast i **nie wraca** ani po F5, ani po powrocie z dashboardu.
      *Dlaczego:* migracja po cichu zrobiła z każdego part-timera pełny etat
      (`sp_capacity = 8` jest nieodróżnialne jako 8 SP i 8 etatów). Banner jest
      **jedynym** sygnałem, że capacity zespołu jest zawyżone.

- [ ] **11.2** (1.8) Lista **Availability** ma cztery pozycje, a `0.5` przeżywa reload.
      *Co zrobić:* rozwiń listę przy dowolnej osobie, ustaw **Half time (0.5)**,
      zapisz roster, F5.
      *Co musi być prawdą:* dokładnie **cztery** pozycje (1.0 / 0.75 / 0.5 /
      0.25), żadnej pustej ani „—"; po przeładowaniu ta osoba **nadal ma 0.5**.
      *Dlaczego:* `0.5` było niewpisywalne na czterech warstwach naraz. Zapis
      idzie przez `numeric`, który wraca ze sterownika jako **string** `'0.50'`,
      więc dopiero przeładowanie jest sprawdzianem.

- [ ] **11.3** (1.9) Capacity na dashboardzie jest w MD i zgadza się z rachunkiem.
      *Gdzie:* `/dashboard` → zakładka **Availability**.
      *Co zrobić:* odczytaj MD i liczbę dni roboczych, policz ręcznie
      `Σ (etat aktywnej osoby) × dni robocze`. Sprint musi mieć **zero
      absencji** — jeśli są, usuń na czas testu albo odejmij ręcznie.
      *Co musi być prawdą:* liczba **równa się** rachunkowi, jednostka to **MD**
      (nie SP), pod spodem „over N working days", zniknął komunikat „No
      story-point capacity set for anyone".
      *Dlaczego:* stary reduktor liczył `SP × (dostępne ÷ wszystkie dni)` —
      iloraz skracał wymiar dnia, więc zły dzielnik był niewidoczny. Teraz dni są
      mnożnikiem i skalują wszystko, co zbudowała faza 4.

### Faza 2 — dni wolne całego zespołu

- [ ] **11.4** (2.7) Dzień wolny obniża capacity i liczbę dni roboczych.
      *Gdzie:* `/team/days-off` (od S-19 osobna zakładka **Team days off** w
      sekcji Team — wcześniej dolna połowa `/settings/absences`), potem
      `/dashboard` → **Availability**.
      *Co zrobić:* zapisz obecne MD i „over N working days". Dodaj **dzień
      roboczy (pon–pt) leżący WEWNĄTRZ aktywnego sprintu**, z etykietą. Wróć na
      dashboard.
      *Co musi być prawdą:* dni robocze spadły **dokładnie o 1**, pojawiła się
      linia „− 1 team day off already subtracted", a MD spadło o **sumę etatów**
      (sześć pełnych etatów → −6 MD; z jedną osobą na 0.5 → −5.5). Sobota lub
      niedziela → plakietka **„Not a working day anyway"** i **żadna liczba się
      nie zmienia** — to też jest poprawny wynik.
      *Dlaczego:* jedyny dowód, że kalendarz wchodzi do **mnożnika** capacity, a
      nie tylko do bazy. Jeśli MD nie drgnie, zamrożone rekordy pomiaru będą
      fałszywe na zawsze.

- [ ] **11.5** (2.8) Ten sam dzień wolny zatrzymuje zegar starzenia ticketa.
      ⚠️ **ODWRÓCONE 2026-08-30 przez S-28.** Ten wiersz mówił: „⚠️ tylko kubełek
      21 SP … test na 3 SP pokaże «brak reakcji» — **to nie jest błąd**". Od S-28
      **każdy** budżet czasowy jest liczony w godzinach roboczych, więc dzień
      wolny zatrzymuje zegar **wszystkich** kubełków, a „brak reakcji" na 3 SP
      jest teraz **błędem**. Wiersz jest przez to łatwiejszy: nie trzeba szukać
      ticketa 21 SP.
      *Gdzie:* `/team/days-off` (dni wolne zespołu), potem `/dashboard`.
      *Co zrobić:* znajdź ticket **3 SP** w **In Progress**, który stoi bez ruchu
      niewiele ponad **16 godzin roboczych** (dwa dni pracy) i jest w inboxie
      jako `TICKET_STATUS_AGING`. Dodaj dzień wolny całego zespołu **w środku
      tego okna** i przeładuj `/dashboard`.
      *Co musi być prawdą:* anomalia dla tego ticketa **znika** bez czekania na
      cykl crona — dzień wolny odjął zespołowi osiem godzin roboczych, więc
      ticket wrócił pod budżet. Usunięcie dnia wolnego przywraca anomalię.
      *Dlaczego to łapie:* to jedyny ręczny dowód, że kalendarz dni wolnych wchodzi
      do **zegara reguł**, a nie tylko do liczby capacity — i że oba liczniki
      czytają ten sam kalendarz.

- [ ] **11.6** (2.9) Usunięcie dnia wolnego przywraca **obie** liczby.
      *Co zrobić:* usuń dzień dodany w 11.4, potwierdź, wróć na **Availability**.
      *Co musi być prawdą:* dialog **nazywa konkretną datę i etykietę** (nie „this
      item"); dni robocze i MD wracają **dokładnie** do wartości z początku 11.4;
      linia „− N team days off" znika.
      *Dlaczego:* kalendarz jest wspólnym wejściem capacity i dwóch reguł
      anomalii. Dwa liczniki, które się nie zgadzają, to awaria, którą
      `lessons.md` już raz zapisało.

### Faza 3 — uczciwe sumy sprintu

⚠️ **Wiersz 1.8 z §1 blokuje 11.7** — bez wpisanych estymat SP w projekcie FM
relacja capacity↔velocity nie ma czego mierzyć. 11.8 i 11.9 są niezależne.

- [ ] **11.7** (3.8) Realny sync zapisuje sumy zgodne z Jirą.
      *Co zrobić:* wpisz estymaty SP kilku ticketom aktywnego sprintu — **w jednym
      polu** (site może mieć i „Story Points", i „Story point estimate" — patrz
      §1 wiersz 1.8). „Sync now", potem:
      `select key, story_points, added_after_sprint_start, current_category from jira_ticket where owner_id = '<owner FM>' order by key;`
      oraz `select committed_sp, completed_sp, committed_frozen_at from sprint where owner_id = '<owner FM>';`
      *Co musi być prawdą:* `story_points` **nie są NULL** (jeśli są — trafiłeś w
      złe pole, nie w błąd kodu); `committed_sp` = suma SP ticketów **bez**
      `added_after_sprint_start`; `completed_sp` = suma SP tylko tych, które
      **weszły do Done w trakcie tego sprintu** (ticket przeniesiony z poprzedniego
      i już wtedy zamknięty **nie** liczy się, choć w Jirze jest Done);
      `committed_frozen_at` ma znacznik czasu.
      *Dlaczego:* stara reguła była migawką „co jest w Done TERAZ", nadpisywaną co
      cykl. Faza 4 zamraża tę liczbę **na zawsze**.

- [ ] **11.8** (3.9) Ticket dorzucony w trakcie sprintu nie podnosi zobowiązania.
      *Co zrobić:* zapisz „Committed" z panelu **Reliability**. W Jirze przeciągnij
      do aktywnego sprintu ticket z backlogu **z estymatą**. „Sync now", odśwież.
      *Co musi być prawdą:* linia zakresu na burndownie **rośnie**, ale
      **„Committed" się NIE zmienia**; `committed_frozen_at` ma **tę samą**
      wartość co przed dorzuceniem.
      *Dlaczego:* zobowiązanie rosnące razem z zakresem nie jest zobowiązaniem —
      reliability wyglądałoby dobrze z konstrukcji.

- [ ] **11.9** (3.10) Estymata `0.5` nie zawiesza synchronizacji.
      *Co zrobić:* ustaw dowolnemu ticketowi estymatę **0.5**, „Sync now".
      *Co musi być prawdą:* status Jiry zostaje **OK** (nie ERROR), dashboard się
      aktualizuje, a ticket ma w bazie `story_points = 1`.
      *Dlaczego:* kolumna jest `integer`, a zapis idzie **wewnątrz transakcji** —
      jedna wartość ułamkowa wywracała **całą** transakcję i stemplowała
      `sync_state` jako ERROR co 15 minut, bez ścieżki samonaprawy.

### Faza 4 — rekord pomiaru sprintu

- [ ] **11.10** (4.8) Po realnym rollowerze rekord zgadza się z ostatnim dniem sprintu.
      ⚠️ **Zależny od czasu** — wymaga przewinięcia sprintu w Jirze. Nie czekaj na
      niego; sweep jest odporny na opóźnienie i zapisze sprint kilka cykli po fakcie.
      *Co zrobić:* ostatniego dnia sprintu zapisz z **Availability** MD i dni
      robocze, a z **Reliability** „Committed" i „Delivered". Po zamknięciu
      sprintu „Sync now", potem:
      `select jira_sprint_id, sprint_name, working_days, capacity_full_md, capacity_adjusted_md, committed_sp, delivered_sp, committed_frozen_at, finalized_at from sprint_measurement where owner_id = '<owner FM>' order by start_date;`
      *Co musi być prawdą:* **dokładnie jeden** wiersz dla zamkniętego sprintu;
      `working_days` i `capacity_adjusted_md` równe zapisanym z dashboardu;
      `delivered_sp` = „Delivered"; `committed_sp` = „Committed"; `finalized_at`
      niepuste. Powtórz „Sync now" — **żadna liczba nie drgnęła**. Jeśli
      `committed_frozen_at` jest NULL, `finalized_at` też **MUSI** być NULL —
      to poprawny wynik (uczciwy „brak danych" z FR-023), nie błąd.
      *Dlaczego:* jeśli rekord rozjedzie się z ekranem, rozjedzie się **na
      zawsze** — fazy 5–7 liczą średnią wyłącznie z tych wierszy i nie ma ścieżki
      przeliczenia wstecz.

- [ ] **11.11** (4.9) Zmiana projektu Jira i powrót nie kasuje historii.
      *Wymaga* drugiego projektu na tym samym site.
      *Co zrobić:* policz `select count(*) from sprint_measurement where owner_id = '<owner FM>';`.
      Przełącz projekt na inny (potwierdź destrukcyjny dialog), sprawdź
      `count(*)` na `sprint` **i** na `sprint_measurement`. Wróć na FM, „Sync
      now", wejdź na `/dashboard`.
      *Co musi być prawdą:* wiersze w `sprint` dla starego projektu **znikają**
      (kaskada), a liczba wierszy w `sprint_measurement` **nie zmienia się ani o
      jeden**; po powrocie te same rekordy są tam z tym samym `jira_project_id`
      (to **jirowe** id, np. `10000`, nie wewnętrzny UUID).
      *Dlaczego:* to cały powód, dla którego rekord ma własną tabelę bez klucza
      obcego — FK przywróciłby dokładnie tę kaskadę, którą rekord ma przeżyć.

### Faza 5 — ręczna korekta leada

- [ ] **11.12** (5.7) Override pokazuje plakietkę i wartość policzoną pod spodem.
      *Co zrobić:* zapisz MD z nagłówka **Availability**. W sekcji **„Adjust this
      sprint by hand"** wpisz w **Capacity override (MD)** wartość **`90.25`** —
      celowo z dwoma miejscami po przecinku — **Save**, F5, przejdź na inną
      zakładkę i wróć.
      *Co musi być prawdą:* przeglądarka **przyjmuje** `90.25` (żadnego dymka o
      „najbliższych prawidłowych wartościach"); nagłówek pokazuje **90,3 MD** z
      plakietką **„Overridden"**, pod spodem „Computed from the roster: <liczba>
      MD"; zniknął dopisek „of N MD, after absences"; po F5 **obie** liczby są
      nadal na ekranie, w polu stoi `90.25`, jest przycisk **„Reset to computed"**.
      *Dlaczego:* override wchodzi do normalizacji FR-024 — musi wyglądać jak
      oznaczony wyjątek, nie jak pomiar. `step="0.5"` sprawiał, że przeglądarka
      odrzucała wartość, którą schema serwerowa jawnie akceptuje.

- [ ] **11.13** (5.8) Override czyści **tylko** przycisk, nigdy puste pole.
      *Co zrobić:* przy ustawionym override z 11.12 **najpierw** wykasuj pole do
      pustego i kliknij **Save**. Dopiero potem **„Reset to computed"** i F5. Na
      koniec spójrz na sekcję **Delivered story points**.
      *Co musi być prawdą:* puste pole + Save **NIE** czyści — czerwony komunikat
      „Couldn't save" z treścią *„Enter a number, or use »Reset to computed« to
      clear it."*, nagłówek dalej **90,3 MD** z plakietką. Dopiero **„Reset to
      computed"** wraca **dokładnie** do liczby z 11.12 i wszystko znika po F5.
      W **Delivered story points** na trwającym sprincie **nie ma pola do
      wpisania** — sam tekst „Correctable once this sprint closes…".
      *Dlaczego:* `input[type=number]` czyści się sam przy przecinku
      dziesiętnym z polskiej klawiatury — dopóki „puste = wyczyść", literówka
      kasowała override i **meldowała sukces**.

### Faza 6 — relacja i estymata

- [ ] **11.14** (6.5) Przy mniej niż dwóch zamkniętych sprintach panel nazywa brak, nie liczbę.
      *Co zrobić:* sprawdź
      `select jira_sprint_id, finalized_at from sprint_measurement where owner_id = '<owner FM>' order by start_date;`,
      potem `/dashboard` → **Reliability** → karta **Estimated velocity**.
      *Co musi być prawdą:* przy **0 lub 1** wierszu z `finalized_at` karta pokazuje
      **zdanie**, nie liczbę — „SprintFlow has N closed sprint(s) recorded and needs
      2 before it will estimate…", gdzie **N zgadza się** z SELECT-em (aktywny
      sprint się nie liczy). **Nigdzie „≈" ani liczby SP.** Przy dwóch zamkniętych:
      „≈ X SP" **i** pod spodem średnia, liczba sprintów oraz procent — wszystkie
      trzy naraz.
      *Dlaczego:* jedna miara to nie średnia, tylko ostatni wynik przebrany za
      trend — dokładnie ten gadżet, który właściciel odrzucił przy framingu.

- [ ] **11.15** (6.6) Reliability pokazuje linię capacity, a procent się nie zmienia.
      *Co zrobić:* zapisz procent z opisu karty („X of Y committed story points
      delivered so far (Z%)"). Ustaw **Capacity override (MD)** na inną liczbę
      (np. `50`), zapisz, wróć na **Reliability**.
      *Co musi być prawdą:* pod opisem stoi „Capacity 50 of &lt;pełne&gt; MD, over N
      working days." z plakietką **„Overridden"**, N zgadza się z zakładką
      Availability; **procent Z% jest identyczny**, słupki się nie ruszyły. Po
      „Reset to computed" plakietka znika, linia zostaje, procent nadal ten sam.
      *Dlaczego:* FR-016 mówi wprost, że capacity **stoi obok** wskaźnika, a nie
      **w** nim. Gdyby weszło do ilorazu, ręcznie wpisany override zacząłby ruszać
      KPI.

### Faza 7 — przełącznik sprintów na Sprint Detail

- [ ] **11.16** (7.5) Sprint sprzed zmiany projektu pokazuje swoje liczby, a zakładki nazywają brak.
      *Wymaga* przynajmniej jednego zamkniętego sprintu z `finalized_at`.
      *Co zrobić:* zapisz `jira_sprint_id` i nazwę zamkniętego sprintu. Przełącz
      projekt Jira na inny, potem **z powrotem na FM**, „Sync now". Wejdź na
      `/dashboard/sprint-detail`, rozwiń listę **Sprint** i wybierz ten sprint.
      *Co musi być prawdą:* nagłówek pokazuje **nazwę wybranego sprintu** i
      plakietkę „Sprint closed"; **Reliability** pokazuje jego „Committed",
      „Delivered" i linię capacity — liczby **z rekordu**, nie z aktywnego
      sprintu; wszystkie **trzy zakładki** (Workflow health / Team activity / By
      technology) pokazują „This sprint's detail data is no longer stored", a
      **nie** wykresy aktywnego sprintu.
      *Dlaczego:* gdyby strona cofnęła się do aktywnego sprintu, pokazałaby
      **liczby bieżącego sprintu pod nazwą starego**, bez śladu na ekranie.

- [ ] **11.17** (7.6) Adres z `?sprint=` da się wysłać i przeżywa przeładowanie.
      *Co zrobić:* wybierz sprint inny niż aktywny, skopiuj adres, F5, otwórz w
      **nowej karcie**. Na koniec podmień na `?sprint=99999`.
      *Co musi być prawdą:* adres zawiera `?sprint=<jirowe id>`; po F5 i w nowej
      karcie **ten sam** sprint, zaznaczony na liście; przy zmyślonym id strona
      **nie wywala się** — pokazuje sprint **aktywny**, normalnie, bez błędu.
      *Dlaczego:* id z adresu jest rozstrzygane wyłącznie przeciwko serii tego
      konta i projektu, więc id z cudzego konta nie ma prawa niczego wyświetlić;
      błąd zamiast wyjścia awaryjnego zamieniłby stary link w zepsutą stronę.

- [ ] **11.18** (7.9) Zamknięty sprint przyjmuje korektę SP, a pomiar zostaje obok.
      *Wymaga* sprintu z `finalized_at` **oraz** wciąż istniejącym wierszem w
      `sprint` (czyli **przed** przełączeniem projektu z 11.16 albo po powrocie).
      *Co zrobić:* zapisz „Delivered" z Reliability. W **Adjust this sprint by
      hand** → **Delivered story points** wpisz liczbę większą (pomiar 21 → wpisz
      `26`), **Save**, F5. Potem wejdź na `/dashboard` → **Reliability** i spójrz
      na **aktywny** sprint.
      *Co musi być prawdą:* na zamkniętym pole **jest** (na trwającym go nie było
      — 11.13); po zapisie Reliability pokazuje **26**, plakietkę **„Corrected"**
      i **„(measured 21 SP)"** — obie liczby naraz; po F5 nadal tak. Na
      `/dashboard` **aktywny** sprint ma swoje własne, **niezmienione**
      „Delivered".
      *Dlaczego:* korekta trafia do średniej z FR-024 — gdyby lądowała na złym
      sprincie, skrzywiłaby estymatę w sposób, którego nikt już nie odtworzy.

---

## 12. S-09 `demo-mode` — otwarte w całości (2026-08-28, dopisane 2026-08-29)

**Ten slice też nie miał tu ani jednego wiersza.** `plan.md` ma 12 nieodhaczonych
pozycji manualnych. Pełne opisy: `context/archive/2026-08-28-demo-mode/MANUAL-CHECKLIST.md`.

⚠️ **Wiersz 12.4 to jedyna nieodwracalna ścieżka w tej zmianie** — zrób go
pierwszy, zanim zaczniesz cokolwiek innego w demie.

- [ ] **12.1** (4.7 + 4.8 + 4.12) „Zobacz demo" wczytuje pełny dashboard poniżej 2 s.
      *Gdzie:* `/settings/demo`, konto **bez** podłączonej Jiry i GitHuba.
      *Co zrobić:* Ustawienia → **Demo** → **„Zobacz demo"** → poczekaj na
      przeładowanie → `/dashboard`.
      *Co musi być prawdą:* kliknięcie kończy się **poniżej 2 sekund** (US-02 —
      zero wywołań zewnętrznych); na górze każdego ekranu baner **„Jesteś w trybie
      demonstracyjnym"** z konkretną datą stanu danych; **Anomaly Inbox** ma co
      najmniej **cztery różne typy** anomalii, każdy wiersz z kompletem pięciu
      atrybutów (severity, opis, kontekst, sugerowana akcja, link do źródła);
      zakładka **Reliability** pokazuje liczby (nie „brak danych"), panel
      estymaty pokazuje wartość; zakładka **Availability** wymienia **dni wolne
      zespołu**.
      *Dlaczego:* anomalie demo pochodzą z prawdziwego silnika detekcji na
      zamrożonym zegarze. Jeśli fixture przestanie przekraczać progi z
      `src/db/defaults.ts`, inbox będzie pusty przy zielonych testach jednostkowych.
      ⚠️ **Po zmianach progów z §10** — wykonuj to na regułach domyślnych.

- [ ] **12.2** (4.9) Sprint Detail w demie renderuje wszystkie trzy sekcje.
      *Gdzie:* `/dashboard/sprint-detail`, w trybie demo.
      *Co musi być prawdą:* **raport starzenia** listuje zadania posortowane po
      czasie od ostatniego ruchu, z kolumną **UNKNOWN** (WEB-97 ma niezmapowany
      status — to celowe); **macierz aktywności** (Developer × Dzień) ma liczby, w
      tym wiersz `outside-contributor` spoza rosteru i komórki z „—" (commity bez
      churnu); **sub-burndowny** rysują się dla FRONTEND / BACKEND / MOBILE / QA.
      *Dlaczego:* to druga połowa US-02 — demo ma pokazać produkt działający, a
      nie jeden ekran z danymi i resztę pustą.

- [ ] **12.3** (4.10) Baner jest wszędzie, a „Wyjdź z demo" wraca na prawdziwe konto.
      *Co zrobić:* przejdź kolejno `/dashboard`, `/dashboard/sprint-detail`,
      `/team/roster`, `/team/absences`, `/refinement` → na ostatnim kliknij
      **„Wyjdź z demo"**.
      *Co musi być prawdą:* baner na **każdym** z tych ekranów; po kliknięciu
      baner znika, a `/team/roster` pokazuje **Twój** roster, nie sześcioosobowy
      zespół demo; Ustawienia → Demo oferuje teraz **„Wróć do demo"** (dane
      zachowane), a nie ponowne „Zobacz demo".
      *Dlaczego:* tryb siedzi w kolumnie bazy, nie w URL-u — `/dashboard` wygląda
      identycznie w obu trybach. Baner jest jedyną rzeczą, która mówi leadowi, że
      patrzy na fikcję.

- [ ] **12.4** (4.11) 🔴 **Prawdziwe tokeny przeżywają load i reset.**
      *Gdzie:* `/settings/connections`, na koncie z **prawdziwie podłączonymi**
      GitHubem i Jirą — identyfikuj po **`token_last4`**, nie po nazwie konta (§5).
      *Co zrobić:* 1) zanotuj `token_last4` obu integracji; 2) Demo → **„Zobacz
      demo"**; 3) otwórz `/settings/connections` **będąc w demie**; 4) Demo →
      **„Usuń dane demo"**; 5) otwórz `/settings/connections` ponownie.
      *Co musi być prawdą:* w kroku 3 karty pokazują **prawdziwe** integracje z
      tymi samymi `last4`, a **„Sync now"** i **„Test connection"** są
      **wyszarzone** z wyjaśnieniem; w kroku 5 obie integracje są nadal podłączone
      z **niezmienionymi last4**.
      *Dlaczego:* to jedyna nieodwracalna ścieżka tej zmiany. Poprzedni skrypt
      seedujący `DELETE`-ował obie tabele credentiali po `owner_id` — przy zakresie
      „każde konto może wczytać demo" byłaby to utrata tokenów bez odzyskania.

- [ ] **12.5** (5.9 + 5.10 + 5.11) Refinement i Daily Recap w demie nie wychodzą na zewnątrz.
      *Gdzie:* `/refinement` i `/settings/recap`, w trybie demo, potem to samo po
      wyjściu z demo.
      *Co musi być prawdą:* `/refinement` pokazuje **zapisany przebieg** z
      werdyktami `DOR_MET`, `GAPS` **i** `NOT_VIABLE`, a wszystkie przyciski
      „Sprawdź…" są wyszarzone z wyjaśnieniem; `/settings/recap` pokazuje podgląd,
      **Save** jest wyszarzony, a kopia statusu **nie** mówi „is being sent right
      now"; po wyjściu z demo oba ekrany działają normalnie.
      *Dlaczego:* demo nie może wydać ani jednego tokena Anthropic ani wysłać maila
      w imieniu fikcyjnego zespołu. Serwer odmawia (pilnują tego testy), ale bez
      wyłączonych kontrolek lead odkryje to dopiero po kliknięciu.

- [ ] **12.6** (2.10) `npm run db:seed:demo` — **wiersz nieaktualny, nie wykonuj.**
      Skrypt `scripts/seed-dashboard.mjs` został **usunięty w fazie 5** tego samego
      slice'a; dane demo wczytuje się wyłącznie z aplikacji (12.1). Zostawione
      widoczne, bo `plan.md` ma go nieodhaczonego — nie szukaj skryptu, którego nie
      ma. Patrz też §5, gdzie dawne ostrzeżenie „seed kasuje credentiale" jest już
      zaktualizowane.

- [ ] **12.7** (1.6) Każdy istniejący ekran zachowuje się **dokładnie** jak przed S-09.
      *Co zrobić:* na koncie **poza** demem przejdź `/dashboard`,
      `/dashboard/sprint-detail`, `/settings/*`, `/refinement`.
      *Co musi być prawdą:* żadnego banera demo, żadnej zmiany w danych, żadnej
      wyszarzonej kontrolki.
      *Dlaczego:* S-09 przepiął **~25 miejsc** z `session.user.id` na
      `resolveWorkspace()`. Pominięte miejsce nie wywala się — czyta po prostu
      niewłaściwego właściciela, co jest awarią izolacji, a nie błędem na ekranie.

- [ ] **12.8** (3.9) Ręcznie ustawiony `active_workspace = 'DEMO'` renderuje demo, a Connections zostaje realne.
      *Co zrobić:* `update "user" set active_workspace = 'DEMO' where id = '<owner>';`
      potem otwórz oba dashboardy i `/settings/connections`.
      *Co musi być prawdą:* oba dashboardy pokazują zespół demo, a
      `/settings/connections` **nadal pokazuje prawdziwe integracje**.
      *Dlaczego:* to sprawdzian, że rozdział „dane per-workspace" ↔ „credentiale
      per-konto" trzyma się także wtedy, gdy przełącznik ustawi ktoś z boku UI.

---

---

## 13. S-04 `setup-team-roster-cadence` — kreator setupu (2026-08-20, dopisane 2026-08-29)

`plan.md` ma **21** nieodhaczonych wierszy manualnych, ale to **10 unikalnych** —
plan niesie je dwa razy (raz bez numeracji w sekcjach faz, raz numerowane w
`## Progress`). Poniżej dziesięć unikalnych, z uczciwym rozdziałem na to, co
zostało już pokryte gdzie indziej.

**Pokryte przez późniejsze slice'y — nie powtarzaj:**

- **4.3** (roster auto-importuje oba źródła, mapowanie scala wiersze, edycje
  przeżywają re-import) → S-15 przebudował tę powierzchnię i przetestował ją
  osobno: scalanie to **§7.7**, różnicowy zapis i re-import to zamknięte wiersze
  S-15 z sesji 2026-08-25.
- **4.6** (shadcn/ui, szerokość 10 cali) → **§7.5** pokrywa tę samą kontrolę na
  `/team/roster`, a `/setup/team` używa **tego samego organizmu**.
- **4.4** (kadencja pre-fill + `cadenceOverridden`) → **§1a**, wiersze 2.7 i
  „Nadpisana kadencja przeżywa cykl _i rollover_", które testują to na
  reconcilerze, czyli w kształcie, jaki kod ma dziś.

**Wciąż otwarte:**

- [x] **13.1** (1.5) Trzy readery zwracają oczekiwane kształty na **prawdziwym**
      repo + projekcie. **Zaliczone 2026-08-29** (sesja manualna, Ania): świeże
      konto, `AdamLisek/tenexdevs1` + projekt FM. Kolaboranci GitHuba → 3 osoby,
      członkowie projektu Jiry → 3 osoby, konfiguracja aktywnego sprintu →
      „SCRUM Sprint 1" / 14 dni. Żadna z trzech list nie wróciła pusta.
      *Gdzie:* konto `demo@sprintflow.test`, `/setup/github` → `/setup/jira` →
      `/setup/team`, albo skrypt scratch.
      *Co musi być prawdą:* import kolaborantów GitHuba, członków projektu Jiry i
      konfiguracji aktywnego sprintu zwraca niepuste listy o spodziewanym
      kształcie; żaden z trzech nie kończy się cichą pustą listą.
      *Dlaczego to łapie:* pusty wynik z zawężającego zapytania czyta się jak
      „nic tam nie ma" (`lessons.md`) — a to najczęstsza awaria tej ścieżki.

- [ ] **13.2** (2.7) Odczyty przed transakcją trzymają się pod **prawdziwym**
      Hyperdrive, bez wyczerpania połączeń.
      *Co zrobić:* powtórz import rosteru kilkanaście razy pod rząd.
      *Co musi być prawdą:* żadnego błędu połączenia, czas odpowiedzi się nie
      degraduje.
      *Dlaczego to łapie:* import rosteru robi **odczyty przed transakcją**
      (`roster-store.ts:51-52`) — pod prawdziwym Hyperdrive każdy z nich bierze
      połączenie z puli osobno, a nie jedzie tą samą sesją co zapis. To jedyny
      wiersz, który sprawdza tę regułę od strony użytkownika, na żywym
      Hyperdrive. *(Do 2026-08-30 uzasadnienie brzmiało „pule per-request, które
      nigdy nie są zamykane". S-21 pokazał pomiarem, że taki mechanizm nie
      istnieje — pule same się zwalniają. Wiersz zostaje, bo reguła, którą
      naprawdę ćwiczy, jest inna i wciąż otwarta.)*

- [ ] **13.3** (2.8) Odszyfrowanie zwraca **działający** token.
      *Co zrobić:* po zapisaniu credentiali kliknij **„Test connection"** na
      `/settings/connections` dla obu integracji.
      *Co musi być prawdą:* oba wywołania kończą się sukcesem — czyli token
      wyszedł z bazy w stanie, w jakim wszedł.
      *Dlaczego to łapie:* szyfrowanie w spoczynku jest guardrailem PRD; test
      round-tripu jest jedynym dowodem, że klucz i tryb się zgadzają na żywym
      zapisie, a nie tylko w teście jednostkowym.

- [ ] **13.4** (3.4) Akcje wołane z organizmów zwracają oczekiwane typy end-to-end.
      *Co zrobić:* przejdź kreator do końca, obserwując zakładkę **Network**.
      *Co musi być prawdą:* żadna odpowiedź akcji nie niesie tokena ani surowej
      treści błędu (guardrail PRD), a błędy walidacji wracają jako zdania dla
      człowieka.

- [ ] **13.5** (4.5) Trzy bannery pojawiają się w swoich przypadkach.
      ⏸️ **Próbowane 2026-08-29 — nie da się zamknąć przy sprawnym środowisku.**
      Pełne przejście kreatora na świeżym koncie nie pokazało ŻADNEGO z trzech, i
      to jest poprawne: token miał komplet uprawnień (`scopes = 'repo'`, repo
      osobiste — degradacja nie zaszła), sprint w Jirze był aktywny, a projekt FM
      ma jedną tablicę scrumową. Wszystkie trzy to ścieżki degradacji — żeby je
      zobaczyć, trzeba środowisko celowo popsuć (wąski PAT → §7.6, konto między
      sprintami, projekt z ≥2 tablicami). Ten wiersz wymaga preparacji, nie
      przejścia happy-path — dopisane, żeby nikt nie tracił na to trzeciej sesji.
      *Co musi być prawdą:* **banner zakresu PAT** przy wąskim tokenie; **banner
      braku aktywnego sprintu** z edytowalnymi wartościami domyślnymi; **wybór
      boardu** tylko wtedy, gdy projekt ma więcej niż jeden board scrumowy.
      *Dlaczego to łapie:* wszystkie trzy to ścieżki degradacji — bez nich
      kreator kończy się pustym ekranem bez wyjaśnienia.

- [x] **13.6** (5.5) Z karty „Jira connected" przycisk **Continue** prowadzi na
      `/setup/team`, a **nie** na `/dashboard`. **Zaliczone 2026-08-29** (sesja
      manualna, Ania): świeże konto, pełne przejście kreatora; cel przycisku
      sprawdzony przez najechanie — `/setup/team`.
      *Dlaczego to łapie:* skrót do dashboardu zostawia konto bez rosteru, czyli w
      stanie, w którym detekcja nie ma kogo przypisać do anomalii.

- [x] **13.7** (5.6) Ukończenie rosteru + kadencji sprawia, że `isOnboardingComplete`
      zwraca `true` i przenosi na `/dashboard`.
      ⏸️ **NIE ODHACZONY 2026-08-29 — połowa wiersza jest dziś niesprawdzalna.**
      Przebieg wykonany w całości (sesja manualna, Ania, świeże konto): „Save &
      finish setup" przeniosło na `/dashboard`, wszystkie sześć składników
      predykatu jest w bazie (1 `github_credential`, 1 `monitored_repo`, 1
      `jira_credential`, 1 `jira_project`, 5 `status_mapping`, 6 `team_member`),
      pulpit renderuje dane zespołu w zakładkach Yesterday i Availability.
      **Ale to, po co ten wiersz istnieje — „predykat naprawdę bramkuje routing" —
      jest dowodowo NIEPRAWDĄ i nie jest defektem.** W tej samej sesji konto tuż po
      rejestracji, z zerem integracji, weszło prosto na `/dashboard`: nic nie
      skierowało go do kreatora. Zgadza się to z roadmapą, która o
      `isOnboardingComplete` mówi wprost „BUILT AND UNUSED… zero production
      callers" (`roadmap.md:712`) i planuje podpięcie jako **S-22**
      (`onboarding-routing`, status *proposed*). Przekierowanie na `/dashboard` po
      kreatorze pochodzi z `cadence-form.tsx:142` (`router.push`), a nie z
      predykatu — więc obserwowalna połowa przeszłaby także wtedy, gdyby predykat
      w ogóle nie istniał.
      **ZAMKNIĘTY 2026-08-30 — S-22 (`onboarding-routing`) dowieziony, wiersz
      przeniesiony do §15.** Predykat ma dziś dwóch produkcyjnych konsumentów:
      serwerową bramkę na `/dashboard` i wybór drzwi na progu `/setup`. To, czego
      ten wiersz nie mógł sprawdzić — „predykat naprawdę bramkuje routing" — jest
      teraz osobnym, wykonalnym wierszem **15.A** (świeże konto ląduje na progu,
      a ręcznie wpisany `/dashboard` odbija z powrotem). Obserwowalna połowa
      („kreator kończy się na `/dashboard`") żyje dalej jako **15.J**, bo
      przekierowanie z `cadence-form.tsx` zmieniło zachowanie: z wnętrza demo
      najpierw wychodzi z demo. Nic nie zostało odhaczone hurtem — wiersz jest
      **zastąpiony**, nie zaliczony.
      *Dlaczego to łapie:* ⚠️ `isOnboardingComplete` to znany w tym repo przypadek
      szwu **zbudowanego i niepodpiętego** (S-22). Ten wiersz jest jedynym
      sprawdzianem, że predykat naprawdę bramkuje routing, a nie tylko istnieje.

---

## 14. S-12 `recap-history` — otwarte (2026-08-29)

FR-019: przeglądanie historii daily recapów + automatyczne czyszczenie starszych
niż bieżący sprint plus dwa poprzednie. **Kod dowieziony w całości, 4 fazy**
(`1855031`, `ed51cf3`, `1772eec`, + faza 4), PR #65. Wszystkie bramki
automatyczne zielone: 1047 unit, 335 integration, `typecheck`, `lint`, build
Workera 3191 KiB gzip przy progu 5000.

Siedem wierszy blokujących (14.A–14.G) jest **tutaj w całości** — pełna,
rozpisana wersja tych samych siedmiu leży w
`context/changes/recap-history/MANUAL-CHECKLIST.md`. Dalej (14.1) to, co
świadomie NIE weszło w ten slice.

### Blokujące (odpowiadają wierszom 2.11 i 3.11–3.15 w `plan.md`)

- [x] **14.A** (1.11) `daily_recap` przeżywa zmianę projektu Jira. **ZALICZONE 2026-08-29.**
      *Gdzie:* terminal, lokalna baza Supabase.
      *Co zrobić:* `psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c '\d daily_recap'`.
      *Co musi być prawdą:* `sprint_id` jest **nullable**; FK
      `daily_recap_sprint_id_sprint_id_fk` ma **`ON DELETE SET NULL`**; indeksu
      `daily_recap_owner_sprint_idx` **nie ma**.
      *Dlaczego to łapie:* przy `CASCADE` przełączenie monitorowanego projektu
      Jira kasowało **całe archiwum recapów** ownera i dzisiejszy wiersz-claim,
      co dawało **drugiego maila za ten sam dzień**.

- [ ] **14.B** (2.11) Pełny cykl crona loguje purge i nie psuje pozostałych kroków.
      *Gdzie:* terminal + `/settings/connections`, konto z prawdziwymi credentialami.
      *Co zrobić:* wywołaj pełny cykl crona (sync → detekcja → recap → pomiar
      sprintu) i przeczytaj log cyklu.
      *Co musi być prawdą:* w logu jest **licznik purge** (**0 to poprawny
      wynik** przy mniej niż trzech zapisanych sprintach); **wszystkie
      pozostałe kroki** cyklu kończą się jak wcześniej; w „Recent sync attempts"
      jest nowy wiersz.
      *Dlaczego to łapie:* purge to jedyny krok tego slice'a, który **trwale
      kasuje wiersze**, i chodzi co 15 minut. Wyjątek z niego może zabrać kroki
      wykonywane po nim — a te wysyłają maile i zamykają pomiar sprintu.
      „0 usuniętych" jest wynikiem pozytywnym: model świadomie zawodzi w stronę
      **zachowania danych**.

- [ ] **14.C** (3.11 + 3.12 + 3.13) Historia jest osiągalna, kompletna i otwiera się.
      *Gdzie:* `/settings/recap` → `/settings/recap/history` → wiersz listy.
      Konto z prawdziwymi recapami.
      *Co zrobić:* Settings → **Daily recap** → w karcie *Last send* kliknij
      **„See all past recaps →"** → kliknij dzień w pierwszym wierszu.
      *Co musi być prawdą:* link istnieje; zakładka **Daily recap** zostaje
      podświetlona na **obu** nowych trasach; lista jest **od najnowszego dnia**
      i pokazuje **wszystkie** recapy, także nieudane; każdy wiersz ma dzień,
      odznakę, godzinę i zdanie „co się stało"; kliknięcie otwiera treść maila
      taką, jaka poszła; **linki Jira / GitHub w mailu są klikalne i otwierają
      nową kartę**.
      *Dlaczego to łapie:* brak linku z `/settings/recap` czyni powierzchnię
      nieosiągalną — istnieje pod adresem, ale nikt jej nie znajdzie. Lista
      wyłącznie z udanymi wysyłkami byłaby gorsza od braku listy: nieudany recap
      to jedyna rzecz, na którą lead ma zareagować. Klikalność linków jest
      **nieoczywista** — treść leci w `<iframe sandbox>`, a pusty sandbox blokuje
      nawigację; bez tokenów `allow-popups` /
      `allow-popups-to-escape-sandbox` linki wyglądałyby normalnie i **nie
      robiłyby nic**, czyli piąty atrybut z FR-014 byłby martwy.

- [ ] **14.D** 🔒 (3.14) Cudzy recap zwraca **404**, a nie pustą stronę.
      *Gdzie:* `/settings/recap/history/<id>` z podmienionym `id`.
      *Co zrobić:* wejdź z (a) losowym, nieistniejącym UUID-em i (b) prawdziwym
      `id` recapu **innego konta** (`select id, owner_id, recap_day from
      daily_recap order by recap_day desc limit 10;`).
      *Co musi być prawdą:* **oba** przypadki dają **tę samą stronę 404**;
      w żadnym nie widać dnia, statusu ani treści maila.
      *Dlaczego to łapie:* pod tymi tabelami **nie ma RLS** — predykat `owner_id`
      **jest** izolacją. Zapomniany predykat nie wywala się głośno: pokazuje
      cudzy recap z nazwami zadań, nazwiskami ludzi i linkami do cudzej Jiry.
      Osobno: inny komunikat dla cudzego wiersza niż dla nieistniejącego sam w
      sobie **potwierdzałby istnienie wiersza** komuś, kto nie ma prawa go
      czytać.

- [ ] **14.E** (3.15) Demo pokazuje historię, a nie jeden wiersz.
      *Gdzie:* `/settings/demo` → **„Zobacz demo"** → `/settings/recap/history`.
      *Co zrobić:* załaduj demo → Settings → Daily recap → **„See all past
      recaps →"** → otwórz wiersz **Failed** → wróć, zresetuj demo, wejdź
      ponownie na listę.
      *Co musi być prawdą:* **pięć** recapów na **pięciu różnych dniach**, od
      najnowszego; **dokładnie jeden** *Failed*, reszta *Sent*; **żaden** wiersz
      nie ma „Sending" ani „Stalled"; wiersz *Failed* **otwiera się i pokazuje
      treść maila**; po resecie lista pokazuje „No recaps yet…", a nie błąd.
      *Dlaczego to łapie:* demo to jedyna droga, którą ktoś bez integracji
      zobaczy tę powierzchnię (US-02), a lista z jednym elementem wygląda tak
      samo jak zepsute sortowanie. „Sending"/„Stalled" w demo byłoby **regresją
      zamrożonego zegara** — te dwa stany porównują `Date.now()` z
      `last_attempt_at`, więc pojawiłyby się dopiero po czasie i tylko u części
      oglądających.

### Faza 4 — webhook Resenda. Kod gotowy, ale najpierw KROKI OPERATORSKIE

> ⚠️ **Twarda zależność, jak przy S-11.** Wiersze **14.F** i **14.G** są
> **nieosiągalne**, dopóki w panelu Resenda nie powstanie endpoint webhooka
> wskazujący na `https://sprintflow.pl/api/webhooks/resend`, zasubskrybowany na
> **oba** zdarzenia (`email.bounced` + `email.complained`), a jego signing
> secret (`whsec_…`) nie trafi przez `npx wrangler secret put
> RESEND_WEBHOOK_SECRET`. To zadanie **operatorskie**, nie programistyczne —
> kod jest bez zarzutu, a webhook i tak nigdy nie dostanie żądania. Instrukcja
> krok po kroku stoi na górze `MANUAL-CHECKLIST.md`.
> **Bez sekretu endpoint odpowiada 500 i NIE dotyka bazy** — to zachowanie
> zamierzone (`lessons.md` #6), nie awaria.

- [ ] **14.F** 🔒 (4.18 + 4.19) Podpis jest jedyną bramką — sprawdź obie strony.
      *Gdzie:* panel Resenda → **Send test event**; potem `curl` z terminala.
      *Co zrobić:* wyślij testową dostawę z panelu; potem powtórz to samo ciało
      żądania z **byle jakim** podpisem (`svix-signature: v1,ZmFrZQ==`).
      *Co musi być prawdą:* dostawa z panelu → **200**; sfałszowana → **401**;
      po tej drugiej recap w `/settings/recap` **dalej jest włączony**, a
      `select … from recap_settings where disabled_reason is not null` nie
      pokazuje nowego wiersza.
      *Dlaczego to łapie:* to **jedyna** publiczna, nieuwierzytelniona trasa w
      całym repo, a podpis jest **całą** jej ochroną — gdyby przepuszczał
      cokolwiek, dowolna osoba w internecie wyłączałaby recap dowolnemu
      ownerowi, podając jego adres e-mail. 16 testów jednostkowych sprawdza
      algorytm, ale **żaden nie dowodzi, że prawdziwy Resend podpisuje tak
      samo** — 200 z panelu jest jedynym dowodem na to.

- [ ] **14.G** (4.20 + 4.21) Bounce wyłącza recap, mówi dlaczego, a ręczne
      wyłączenie **nie** udaje awarii.
      *Gdzie:* `/settings/recap`, konto z prawdziwymi credentialami.
      *Co zrobić:* doprowadź do wysyłki na `bounced@resend.dev` (najprościej
      reset hasła — **ten sam webhook** obsługuje maile resetu, i to jest
      zamierzone); potem włącz recap z powrotem i zapisz; na koniec wyłącz go
      **ręcznie** i odśwież.
      *Co musi być prawdą:* po bounce przełącznik jest **wyłączony**, a **nad
      nim** stoi czerwony komunikat mówiący co się stało, **kiedy** i co
      naprawić; po ponownym włączeniu komunikat **znika** i nie wraca po
      odświeżeniu; po **ręcznym** wyłączeniu **nie ma** żadnego czerwonego
      komunikatu.
      *Dlaczego to łapie:* przełącznik, który sam się przestawił, jest
      nieodróżnialny od decyzji sprzed pół roku — i pierwsze, co owner zrobi, to
      włączy go z powrotem, prosto w tę samą pętlę odbić. Kontrola odwrotna jest
      równie ważna: komunikat przy ręcznym wyłączeniu oskarżałby o awarię tam,
      gdzie nic się nie zepsuło. To dwa różne stany bazy (`disabled_reason` NULL
      kontra niepuste) i tylko ten wiersz sprawdza, że interfejs je rozróżnia.

- [ ] **14.H** (4.22) `MANUAL-CHECKLIST.md` tego slice'a jest podpisana w całości
      (A–G).
      *Dlaczego to łapie:* to jedyny wiersz, który pilnuje, że pozostałe zostały
      naprawdę wykonane, a nie odhaczone hurtem przy archiwizacji. Rozjazd z
      2026-08-29 (68 otwartych wierszy w planach kontra 27 znanych backlogowi)
      wziął się dokładnie stąd.

### Świadomie NIE zrobione w tym slice'ie

- [ ] **14.1** Retencja **surowych danych sync** (tickety, PR-y, commity,
      historia statusów) — non-goal z PRD mówi o tym samym oknie „bieżący sprint
      + 2 poprzednie", ale FR-019 i roadmapowy zakres S-12 nazywają **tylko
      recapy**. Tabele GitHuba nie mają żadnego FK do sprintu
      (`github_commit` / `github_pull_request` wiszą pod `monitored_repo`), więc
      ich czyszczenie wymaga własnej reguły datowej — to osobna decyzja, nie
      dokładka do tej.
      *Co musi być prawdą, gdy ktoś to podejmie:* reguła datowa jest zapisana
      **zanim** powstanie kod kasujący, bo to kolejny krok, który trwale usuwa
      wiersze.

---

## 15. S-22 `onboarding-routing` — próg kreatora, otwarte (2026-08-30)

Świeżo założone konto nie miało dokąd wylądować: rejestracja, logowanie i layout
`(auth)` odsyłały na `/dashboard`, czyli na pełny ekran S-07/S-10 renderujący
same zera, a `/setup` dało się otworzyć **wyłącznie** wpisując adres ręcznie.
Ta zmiana buduje **próg**: pierwszy ekran pod `/setup` z dwojgiem drzwi
(skonfiguruj prawdziwe dane albo zobacz demo) plus serwerową bramkę na
`/dashboard`, która nieskonfigurowane **prawdziwe** konto odsyła na próg.
Konto w demo bramka przepuszcza zawsze — ktoś, kto świadomie wybrał demo, nie
może zostać wepchnięty do kreatora, który omijał.

Cztery wiersze blokujące (**15.A–15.D**) mają pełną, rozpisaną wersję w
`context/changes/onboarding-routing/MANUAL-CHECKLIST.md` (tam jako A–D).
Pozostałe sześć (**15.E–15.J**) jest tylko tutaj — nie blokują slice'a, ale
zamykają rzeczy, których automatyka nie widzi.

Bramki automatyczne zielone w całości: 1057 testów jednostkowych, 335
integracyjnych, 14 Playwrighta (w tym nowy `e2e/setup-doorstep.spec.ts` z trzema
scenariuszami: próg, bramka, drzwi demo), `typecheck`, `lint`.

⚠️ **Migracji nie ma.** Ta zmiana nie dodaje ani jednej kolumny — predykat
`isOnboardingComplete` czyta stan, który już jest w bazie. Nie ma więc kroku
„zaaplikuj migrację przed testami".

### Wiersze blokujące (te same, co w checkliście slice'a)

- [ ] **15.A** (faza 3, `3.6`) **Gdzie:** okno prywatne, `/signup`, adres, którego
      jeszcze nie ma (np. `prog-<data>@example.test`).
      **Co zrobić:** zarejestruj konto, nie klikaj nic po drodze, a gdy wylądujesz
      — wpisz ręcznie w pasku adresu `/dashboard`.
      **Co musi być prawdą:** po rejestracji adres to `/setup`; widać dokładnie
      dwa przyciski wyboru drogi (konfiguracja + „Zobacz demo"); u góry „Krok 1
      z 4"; **nie ma górnej nawigacji**; ręcznie wpisany `/dashboard` wraca na
      `/setup`.
      *Dlaczego to łapie:* to cała teza zmiany. Pulpit po kroku 3 znaczy, że
      bramka nie działa i pierwsze wrażenie z produktu to tabela zer; widoczna
      nawigacja znaczy, że próg da się ominąć jednym kliknięciem.

- [ ] **15.B** (faza 3, `3.7`) **Gdzie:** `/login`, konto z **prawdziwymi**
      credentialami (to, na którym pulpit pokazuje realne dane).
      **Co zrobić:** wyloguj się, zaloguj ponownie, popatrz na pasek adresu nie
      klikając nic; potem wpisz ręcznie `/setup` (tylko podgląd — nic tam nie
      zmieniaj).
      **Co musi być prawdą:** po zalogowaniu adres to `/dashboard` z danymi
      zespołu i **ani na moment** nie przewija się przez `/setup`.
      *Dlaczego to łapie:* bramka czyta sześć warunków z bazy. Jeden źle odpytany
      i konto, które przeszło cały kreator, zostaje wyrzucone z powrotem do
      kreatora — ktoś z działającą integracją traci dostęp do własnego pulpitu.

- ~~**15.C**~~ (faza 3, `3.8`) — **WYCOFANE 2026-08-31 przez S-31.** Wiersz
      kazał kliknąć w oknie potwierdzenia przycisk **„Disconnect GitHub"**,
      którego S-26 się pozbył i którego **brak** jest dziś warunkiem zaliczenia
      wiersza **16.A**. Tester wykonujący 15.C dosłownie utknąłby na kroku 2, a
      gdyby „poprawił" go po swojemu, potwierdziłby wynik, którego 16.A zabrania.
      Powód i pełne uzasadnienie: §6. **Żywa połowa tego wiersza — że odłączenie
      z `/settings/connections/github` nie może wyrzucić leada na `/setup` —
      wraca jako 24.C**, pod slice'em, który czyni tę ścieżkę ważniejszą.

- [ ] **15.D** (faza 4, `4.6` + `4.9`) **Gdzie:** to samo świeże konto co w
      **15.A**, zaraz po nim.
      **Co zrobić:** na progu kliknij „Zobacz demo"; obejrzyj kolejno
      `/dashboard`, `/dashboard/sprint-detail` i `/team/roster`, patrząc za
      każdym razem na baner demo; kliknij w banerze **„Dokończ konfigurację"**;
      przejdź cały kreator (GitHub → Jira → Zespół) i kliknij **„Save & finish"**.
      **Co musi być prawdą:** baner na **każdym z trzech** ekranów niesie przycisk
      „Dokończ konfigurację" obok „Wyjdź z demo"; przycisk prowadzi na `/setup`,
      nie do Ustawień, i po drodze **wychodzi z trybu demo — baner znika, i tak ma
      być** (kreator konfiguruje prawdziwe konto; demo zostaje i wrócisz do niego
      z Ustawień → Demo); po „Save & finish" jesteś na `/dashboard`, **banera demo
      nie ma**, a dane pochodzą z właśnie podłączonej Jiry/GitHuba.
      *Dlaczego to łapie:* bez tego przycisku osoba, która wybrała demo, nie ma
      **żadnej** drogi z powrotem na próg. A bez wyjścia z demo na końcu kreatora
      „Save & finish" odsyła pod baner demo, do fikcyjnych danych — lead kończy
      konfigurację i nie dostaje sygnału, że zadziałała.

### Wiersze nieblokujące (tylko tutaj)

- [ ] **15.E** (faza 2, `2.6`) **Gdzie:** świeże konto, `/setup` → GitHub → Jira →
      Zespół.
      **Co zrobić:** przejdź kreator krok po kroku i na każdym ekranie odczytaj
      napis nad paskiem postępu oraz sam pasek.
      **Co musi być prawdą:** kolejno „Krok 1 z 4", „Krok 2 z 4", „Krok 3 z 4",
      „Krok 4 z 4"; na ostatnim kroku pasek jest wypełniony w 100%. Nigdzie nie
      pojawia się „of 3" ani „Step".
      *Dlaczego to łapie:* próg dołożył czwarty krok. Licznik był wcześniej
      wpisany na sztywno w czterech miejscach i już raz się rozjechał (4→3 przy
      S-04); zły licznik to jedyna informacja, jaką ktoś ma o tym, ile mu jeszcze
      zostało.

- [ ] **15.F** (faza 2, `2.7`) **Gdzie:** `/settings/connections/github`, konto z
      prawdziwymi credentialami.
      **Co zrobić:** otwórz stronę i popatrz nad formularz.
      **Co musi być prawdą:** **nie ma** żadnego wskaźnika kroku ani paska
      postępu — Ustawienia to zarządzanie bieżące, nie kreator.
      *Dlaczego to łapie:* renumeracja kroków dotyka wspólnej powłoki. Gdyby
      przeciekła do Ustawień, lead rotujący token dostaje komunikat „Krok 1 z 4",
      sugerujący, że musi przejść cały kreator od nowa.

- [ ] **15.G** (faza 3, `3.9`) **Gdzie:** konto w trybie demo (wejdź przez
      Ustawienia → Demo albo drzwiami z progu).
      **Co zrobić:** będąc w demo wpisz ręcznie `/dashboard`.
      **Co musi być prawdą:** pulpit demo otwiera się normalnie, pod banerem demo
      — **żadnego** przekierowania na `/setup`.
      *Dlaczego to łapie:* demo jest modelowane jako osobny najemca, a jego
      fixture spełnia wszystkie sześć warunków predykatu pod **demowym** ownerem.
      Bramka odpytana o złe konto albo wpuszcza każdego, albo zamyka demo na
      głucho — ten wiersz rozróżnia te dwa błędy.

- [ ] **15.H** (faza 4, `4.7`) **Gdzie:** konto z **prawdziwymi** credentialami,
      wejdź w demo przez Ustawienia → Demo.
      **Co zrobić:** popatrz na baner demo na `/dashboard`.
      **Co musi być prawdą:** baner ma **tylko** „Wyjdź z demo" i odnośnik
      „Ustawienia demo" — przycisku „Dokończ konfigurację" **nie ma**.
      *Dlaczego to łapie:* odnośnik powrotny ma się pokazywać wyłącznie, dopóki
      prawdziwe konto jest nieskonfigurowane. Widoczny na skonfigurowanym koncie
      zaprasza leada do kreatora, z którego wychodzi się nadpisaniem działającej
      konfiguracji — a bieżące zarządzanie ma zostać w Ustawieniach.

- [ ] **15.I** (faza 4, `4.8`) **Gdzie:** świeże, nieskonfigurowane konto, które
      weszło w demo drzwiami z progu.
      **Co zrobić:** kliknij w banerze **„Wyjdź z demo"** i poczekaj, aż ekran się
      odświeży.
      **Co musi być prawdą:** lądujesz na progu `/setup`, a **nie** na pulpicie z
      samymi zerami.
      *Dlaczego to łapie:* wyjście z demo tylko przełącza aktywny workspace i nie
      zmienia adresu. Bez bramki na `/dashboard` odświeżenie zostawia leada na
      pustym pulpicie bez żadnej wskazówki, co dalej — czyli dokładnie w stanie,
      dla którego ten slice powstał.

- [ ] **15.J** (faza 4, `4.9`, druga połowa dawnego **13.7**) **Gdzie:** świeże
      konto, ostatni krok kreatora `/setup/team`, **poza** demo.
      **Co zrobić:** uzupełnij roster i kadencję, kliknij „Save & finish".
      **Co musi być prawdą:** trafiasz na `/dashboard` i **zostajesz tam** — bramka
      nie odbija cię z powrotem na `/setup`.
      *Dlaczego to łapie:* to sprawdzian, że sześć warunków predykatu jest
      naprawdę spełnionych w bazie po przejściu kreatora, a nie tylko wygląda na
      spełnione. Odbicie tutaj oznacza pętlę: kreator kończy się i natychmiast
      zaczyna od nowa. (Dawny wiersz **13.7** sprawdzał to samo w czasach, gdy
      przekierowanie pochodziło wyłącznie z `router.push` i przeszłoby nawet bez
      predykatu — teraz przechodzi tylko wtedy, gdy predykat naprawdę działa.)

- [ ] **15.K** `MANUAL-CHECKLIST.md` tego slice'a jest podpisana w całości (A–D).
      *Dlaczego to łapie:* to jedyny wiersz pilnujący, że pozostałe zostały
      wykonane, a nie odhaczone hurtem przy archiwizacji — rozjazd z 2026-08-29
      (68 otwartych wierszy w planach kontra 27 znanych backlogowi) wziął się
      dokładnie stąd.

---

## 16. S-24 `destructive-action-confirmation` — otwarte (2026-08-30)

Slice zamknięty i zarchiwizowany 2026-08-30, cztery fazy. Pełne opisy:
`context/archive/2026-08-30-destructive-action-confirmation/MANUAL-CHECKLIST.md`.
Źródło kanoniczne: `context/archive/2026-08-30-destructive-action-confirmation/plan.md`
`## Progress` (16.A–16.D). **16.E pochodzi z impl-review (F1), nie z planu** —
nie ma go w checkliście ani w `## Progress`, bo powstał po ich zamknięciu;
raport: `.../reviews/impl-review.md`.

**Konto:** wiersze 16.A i 16.B wymagają konta z **prawdziwymi** credentialami
(na lokalnej bazie `demo@sprintflow.test` — patrz §5, identyfikuj po
`token_last4`). 16.B najlepiej na koncie, które ma wpisaną co najmniej jedną
nieobecność.

⚠️ **Żaden wiersz poniżej nie każe klikać żadnej z akcji okna do końca.** Cały
sens slice'a to możliwość wycofania się; wszystkie kończą się na **Cancel**.

⚠️ **ZMIENIONE 2026-08-30 przez S-26 (§21).** Do tej pory stało tu zdanie:
*„Potwierdzone odłączenie Jiry kasuje ręcznie wpisane nieobecności bezpowrotnie
— żaden sync ich nie odtworzy"*. **To już nieprawda i nie jest tylko poprawką
stylistyczną.** S-26 zwęził kaskadę w bazie (migracja `0021`) i rozbił jedną
akcję na dwie: okno ma teraz **dwa** przyciski akcji, domyślny **zachowuje**
nieobecności, a kasuje je wyłącznie ten drugi, nazwany wprost „Delete my Jira
data". Dlatego wiersze 16.A i 16.B poniżej mają **nowe** warunki zaliczenia —
stara treść okna („Disconnect GitHub" jako jedyny przycisk, nieobecności na
liście strat) dziś oznacza **błąd**, a nie sukces. Zdanie zostaje zapisane tutaj
z powodem, a nie wykasowane, żeby ktoś czytający starą checklistę S-24
(`context/archive/2026-08-30-destructive-action-confirmation/MANUAL-CHECKLIST.md`)
wiedział, dlaczego jej treść i ekran się rozjeżdżają.

- [ ] **16.A** (faza 2, `2.5`; treść okna zaktualizowana przez S-26)
      **Gdzie:** `/setup/github`, konto z podłączonym GitHubem.
      **Co zrobić:** kliknij **Disconnect**, przeczytaj okno, kliknij **Cancel**.
      **Co musi być prawdą:** po kliknięciu **nic się nie odłączyło** — pojawia
      się okno „Disconnect GitHub?". Repozytoria i to, co z nich zsynchronizowane,
      są wymienione **po stronie zachowywanych**: „the monitored repositories and
      everything synced from them, which are re-linked when you reconnect", obok
      zespołu, dni wolnych, pomiarów zamkniętych sprintów i połączenia z Jirą.
      Jako kasowane wymienia je **wyłącznie** osobne zdanie o drugim przycisku:
      „Choosing „Delete my GitHub data" also removes the list of monitored
      repositories and every commit, pull request and code review synced from
      them". W stopce są **trzy** kontrolki: `Cancel`, `Delete my GitHub data`
      (czerwony) i `Keep my GitHub data` (zwykły) — **żadna** nie nazywa się
      „Disconnect GitHub". Po Cancel karta „GitHub connected" jest dokładnie taka
      jak była: ten sam login, ta sama liczba repozytoriów, żadnego formularza
      „Connect".
      *Dlaczego to łapie:* to była ścieżka, na której jeden klik kasował
      bezpowrotnie całą historię commitów, PR-ów i recenzji bez pytania. Jeśli
      Cancel jednak coś skasował, dialog jest gorszy niż jego brak — daje
      fałszywe poczucie bezpieczeństwa. Nowa część warunku pilnuje drugiej
      strony: po S-26 domyślne wyjście **niczego nie kasuje poniżej samego
      credentiala**, więc okno, które nadal straszy utratą repozytoriów, wypycha
      leada z bezpiecznej ścieżki równie skutecznie, jak wcześniej milczenie
      wpychało go w kasowanie.

- [ ] **16.B** (faza 2, `2.6`; warunek zaliczenia **przepisany** przez S-26 —
      okno oferuje dwa wyjścia, a domyślnym jest zachowanie danych)
      **Gdzie:** `/settings/connections`, karta **Jira**, konto z podłączoną Jirą
      i co najmniej jedną nieobecnością w `/team/absences`.
      **Co zrobić:** kliknij **Disconnect** na karcie Jira, przeczytaj **całe**
      okno, kliknij **Cancel**, potem wejdź na `/team/absences`.
      **Co musi być prawdą:** w stopce są **trzy** kontrolki: `Cancel`,
      `Delete my Jira data` (czerwony) i `Keep my Jira data` (zwykły, domyślny —
      to on jest wyróżniony, nie czerwony). Nieobecności **nie** stoją po stronie
      strat: okno mówi, że zostają („the recorded absences you entered by hand,
      which stay with the team and stop being linked to a sprint"), obok zespołu,
      dni wolnych całego zespołu, pomiarów zamkniętych sprintów, połączenia z
      GitHubem i raportów dziennych. Jako kasowane wymienia sprinty, ticket'y,
      historię statusów, anomalie i mapowanie statusów. Osobne zdanie nazywa
      **czerwony przycisk po imieniu**: „Choosing „Delete my Jira data" also
      removes the recorded absences, which were entered by hand and cannot be
      synced back". Po Cancel nieobecność nadal jest na liście, a Jira nadal
      podłączona.
      *Dlaczego to łapie:* to jest widziany oczami użytkownika efekt S-26.
      Nieobecności to jedyna pozycja na tej liście, której żaden sync nie
      odtworzy; do S-24 okno w ogóle o nich nie mówiło, a do S-26 kasowało je
      **każde** potwierdzone odłączenie. Jeśli okno nadal ma jeden przycisk
      akcji albo domyślnym jest czerwony, slice nie dotarł do ekranu; jeśli
      wymienia nieobecności po stronie strat, tekst i kod się rozjechały i lead
      zrezygnuje z rozłączenia, którego może bezpiecznie dokonać. Pełne
      sprawdzenie obu ścieżek (klik do końca) siedzi w §21 — tutaj kończymy na
      Cancel.

- [ ] **16.C** (faza 3, `3.6`; **układ karty przepisany przez S-31 —
      2026-08-31**) **Gdzie:** `/settings/connections`, konto z **załadowanym
      demo** (baner na górze) i z prawdziwie podłączonymi integracjami.
      **Co zrobić:** załaduj demo, wejdź na `/settings/connections`, popatrz na
      obie karty. Spróbuj kliknąć **Reconnect**.
      **Co musi być prawdą:** w rzędzie akcji są **dwie** kontrolki —
      **Reconnect** i **Disconnect** — obie wyszarzone i nieklikalne, tak jak
      **Test connection** stojące nad rzędem. **Reconnect nigdzie nie prowadzi**:
      kliknięcie nie zmienia adresu (to link tylko poza demo). Przycisków
      **Change monitored repositories** / **Change monitored project** w rzędzie
      **w ogóle nie ma**, a sekcje do zmiany repozytoriów i projektu Jiry **się
      nie renderują**. Pod przyciskami stoi polskie zdanie zaczynające się od
      „W trybie demonstracyjnym nic, co robisz, nie zmienia Twojego prawdziwego
      konta". **Nie musi ono wymieniać poszczególnych kontrolek** — od S-27 jest
      to celowo jedno ogólne zdanie, bo wyliczanka rozjeżdżała się z kodem trzy
      razy z rzędu.
      *Dlaczego to łapie:* karta Connections celowo pokazuje prawdziwe konto
      nawet w demo. Do tej pory znaczyło to, że z ekranu demo dało się jednym
      klikiem skasować prawdziwe dane — baner obiecywał „Twoje prawdziwe dane i
      integracje są nietknięte", a kod tego nie dotrzymywał. S-31 dokłada do tego
      nowe ryzyko: **Reconnect** jest teraz najbardziej zachęcającym przyciskiem
      na karcie, a prowadzi do formularza zapisującego prawdziwy credential —
      gdyby w demo pozostał linkiem, slice zrobiłby z niego najkrótszą drogę do
      nadpisania prawdziwego tokena z ekranu demo.
      **Zmiana warunku (2026-08-31):** stara treść wymagała, żeby polskie zdanie
      *wymieniało*, co jest wyłączone. To już nieprawda od S-27 i było fałszywym
      niezaliczeniem. Położenie zdania — **pod** przyciskami — zostaje warunkiem,
      bo przyciski się przesunęły.

- [ ] **16.D** (faza 3, `3.7`) **Gdzie:** baner demo → `/settings/demo` →
      `/team/roster` i `/dashboard`.
      **Co zrobić:** w demo zmień imię jednego członka zespołu i zapisz; wyjdź z
      demo; wejdź w demo ponownie; wróć na `/team/roster` i `/dashboard`.
      **Co musi być prawdą:** widzisz **ten sam** sprint demo i **tę samą**
      zmianę. Wyjście z demo niczego nie skasowało — kasuje wyłącznie osobny
      przycisk „Resetuj dane demo".
      *Dlaczego to łapie:* faza 3 dokłada sprawdzenie trybu demo do dziewięciu
      akcji serwerowych. Gdyby przy okazji zepsuła cykl życia demo, dane demo
      znikałyby przy każdym wyjściu — a właściciel wprost chce, żeby demo
      zostawało dostępne w każdej chwili.

- [ ] **16.E** (z impl-review F1, **nie** ma odpowiednika w checkliście slice'a)
      **Gdzie:** dowolny ekran w trybie demo — najprościej `/dashboard` — baner na
      samej górze strony.
      **Co zrobić:** załaduj demo i przeczytaj **całe** zdanie w banerze
      „Jesteś w trybie demonstracyjnym".
      **Co musi być prawdą:** baner mówi, że **nie widzisz tu żadnych swoich
      prawdziwych danych, a ustawienia integracji są w demo zablokowane**.
      Nie może tam paść zdanie, że „Twoje prawdziwe dane i integracje są
      nietknięte" — bez zastrzeżenia, o integracjach też.
      *Dlaczego to łapie:* to zdanie **było nieprawdziwe**. Kreator (`/setup/**`)
      nadal nie ma bramki demo, a `storeGithubIntegration` /
      `storeJiraIntegration` nie mają odmowy — więc z ekranu demo wciąż można
      wejść na `/setup/github` i **zapisać prawdziwy token**. S-24 zawęził samo
      zdanie do tego, co kod naprawdę trzyma; zamknięcie luki to **S-27**. Jeśli
      kiedyś zobaczysz tu z powrotem mocniejsze zdanie o „nietkniętych
      integracjach", a S-27 nie jest zrobione — to jest błąd, zgłoś go.
      ⚠️ **Nieaktualne od 2026-08-30: S-27 WESZŁO** (§19). Luka jest zamknięta,
      więc baner celowo mówi znowu mocniej — teraz ogólnie, że nic zrobione w
      demie nie zmienia prawdziwego konta ani jego integracji. **Nie zgłaszaj
      tego jako błędu.** Ten wiersz zastępuje **19.F**, które sprawdza nową
      treść we wszystkich czterech miejscach naraz; 16.E rób tylko wtedy, gdy
      chcesz potwierdzić samą historię.

- [ ] **16.F** `MANUAL-CHECKLIST.md` tego slice'a
      (`context/archive/2026-08-30-destructive-action-confirmation/MANUAL-CHECKLIST.md`)
      jest podpisana w całości (16.A–16.D), a 16.E odhaczone osobno.
      *Dlaczego to łapie:* pilnuje, że pozostałe zostały naprawdę wykonane, a nie
      odhaczone hurtem przy archiwizacji — rozjazd z 2026-08-29 wziął się
      dokładnie stąd.

**Fazy 1 i 4 nie mają własnych wierszy manualnych.** Faza 1 to moduł
`disconnect-impact.ts` plus test wyprowadzający kaskadę ze schematu — bez
ekranu. Faza 4 poprawia teksty i dokumenty; zmienione zdania widać w 16.A, 16.B
i 16.C.


---

## 17. S-21 `db-pool-teardown` — otwarte (2026-08-30)

Slice zamknięty 2026-08-30, pięć faz, PR #77. Źródło kanoniczne:
`context/changes/db-pool-teardown/plan.md` `## Progress`. Blokujące wiersze mają
pełne opisy w `context/changes/db-pool-teardown/MANUAL-CHECKLIST.md` (17.A–17.C);
reszta jest tylko tutaj.

**O co chodzi, po ludzku.** Jedno żądanie do aplikacji otwierało do bazy **trzy**
osobne połączenia (a akcja zapisu — **cztery**) zamiast jednego. Przy kilku
równoległych testach Postgres kończył się miejsca. Gorsze było to, jak to
wyglądało: aplikacja **nie** pokazywała błędu bazy, tylko wyrzucała zalogowaną
osobę na `/login`, jakby sesja wygasła — więc przez tygodnie czytano to jako
losowo pękające testy. Slice naprawia jedno i drugie.

**Konto:** dowolne, na którym potrafisz się zalogować. Żaden wiersz nie dotyka
prawdziwych tokenów, nic nie kasuje.

⚠️ **17.A i 17.B wymagają zatrzymania lokalnej bazy** (`npx supabase stop`,
powrót `npx supabase start`). Nic się nie kasuje — `stop` wyłącza kontenery,
dane zostają. **Po testach uruchom bazę z powrotem.**

### Blokujące (te same, co w checkliście slice'a)

- [ ] **17.A** (faza 4, `4.6`) **Gdzie:** `/dashboard`, na koncie, na którym
      jesteś **już zalogowana**.
      **Co zrobić:** zaloguj się przy działającej bazie, potem `npx supabase stop`,
      potem odśwież `/dashboard`.
      **Co musi być prawdą:** karta **„Something went wrong"** z przyciskiem
      **„Try again"** i zdaniem **„If you were signed in, you still are"**. Adres nadal
      `/dashboard` — **nie** przeskoczyłaś na `/login`.
      *Dlaczego to łapie:* to cała diagnoza slice'a. Awaria bazy udawała
      wylogowanie, więc nikt nie szukał problemu z bazą. Ekran logowania w tym
      miejscu znaczy, że poprawka nie zadziałała.

- [ ] **17.B** (faza 4, `4.7`) **Gdzie:** `/login`, przy **zatrzymanej** bazie
      (od razu po 17.A).
      **Co zrobić:** wejdź ręcznie na `/login`.
      **Co musi być prawdą:** strona logowania renderuje się normalnie — pola
      e-mail i hasło. Żadnej karty błędu, żadnego pustego ekranu, żadnego
      zapętlonego przekierowania.
      *Dlaczego to łapie:* logowanie musi działać nawet gdy aplikacja nie
      potrafi sprawdzić, czy ktoś jest zalogowany — inaczej awaria bazy zamyka
      wszystkich na zewnątrz. Ta strona celowo zachowuje się odwrotnie niż
      `/dashboard` i to rozróżnienie łatwo zepsuć jedną zmianą.

- [ ] **17.C** (faza 4, `4.9`) **Gdzie:** `/dashboard`, przy **działającej**
      bazie, w oknie prywatnym.
      **Co zrobić:** `npx supabase start`, poczekaj, otwórz okno prywatne,
      wejdź na `/dashboard`.
      **Co musi być prawdą:** przekierowanie na `/login`, tak jak zawsze. Żadnej
      karty „Something went wrong".
      *Dlaczego to łapie:* 17.A i 17.B pilnują nowej ścieżki; ten wiersz pilnuje,
      że stara — zwykłe przekierowanie niezalogowanego gościa — nie została przy
      okazji zepsuta. Gdyby się zepsuła, każdy niezalogowany widziałby ekran
      błędu zamiast logowania.

### Nieblokujące (tylko tutaj)

- [ ] **17.D** (faza 4, `4.8`) **Gdzie:** `/settings/connections`, zalogowana,
      przy **zatrzymanej** bazie.
      **Co zrobić:** zaloguj się przy działającej bazie, wejdź na
      `/settings/connections`, zatrzymaj bazę, kliknij dowolny przycisk
      zapisujący (np. **„Test connection"**).
      **Co musi być prawdą:** formularz zgłasza **niepowodzenie akcji** i
      zostajesz na tej samej stronie. **Nie** zostajesz przerzucona na `/login`.
      *Dlaczego to łapie:* akcje serwerowe były większym konsumentem tej wady niż
      renderowanie stron (cztery połączenia na akcję, nie trzy). „Nie udało się
      zapisać" jest prawdą; „zostałaś wylogowana" nie było.

- [ ] **17.E** (faza 4, `4.10`) **Gdzie:** ekran błędu z 17.A.
      **Co zrobić:** przeczytaj **całą** kartę, łącznie z drobnym drukiem na
      dole. Jeśli umiesz — otwórz też podgląd źródła strony (Ctrl/Cmd+U).
      **Co musi być prawdą:** nigdzie nie widać adresu bazy (`postgres://…`,
      `127.0.0.1:54322`), żadnego tokena, żadnego surowego komunikatu
      sterownika. Jedyna techniczna rzecz, jaka może się pojawić, to krótkie
      **„Reference: …"** — nieprzezroczysty identyfikator.
      *Dlaczego to łapie:* guardrail PRD mówi, że żaden token ani connection
      string nie trafia do niczego, co widzi klient. Błędy sterownika Postgresa
      **cytują connection string w treści komunikatu**, więc ekran błędu jest
      dokładnie tym miejscem, gdzie wyciek jest najłatwiejszy.

- [ ] **17.F** (faza 2, `2.7`–`2.9`) **Gdzie:** `/dashboard`,
      `/settings/connections`, `/login`.
      **Co zrobić:** przy działającej bazie: uruchom `npm run dev`, zaloguj się,
      otwórz `/dashboard`, zapisz cokolwiek na `/settings/connections`, wyloguj
      się i zaloguj ponownie.
      **Co musi być prawdą:** wszystko działa dokładnie tak jak przed zmianą —
      dashboard się renderuje z danymi, zapis się udaje, wylogowanie i logowanie
      przechodzą.
      *Dlaczego to łapie:* zmiana dotyka **jednego** pliku (`src/lib/db.ts`), ale
      tego, przez który przechodzi każde zapytanie do bazy w całej aplikacji.
      Jest pokryta testami automatycznymi (`npm test`, `npm run test:e2e`,
      testy integracyjne), więc to wiersz „na wszelki wypadek", nie blokujący.

- [ ] **17.G** (faza 3, `3.4`–`3.7`) **Gdzie:** terminal, nie przeglądarka —
      wiersz dla właściciela, nie dla testerki.
      **Co zrobić:** przeczytaj
      `context/changes/db-pool-teardown/measurements.md` i porównaj tabelę
      „przed" z tabelą „po"; uruchom `npm run test:e2e` (workery równoległe) i
      sprawdź, czy w logu nie ma `53300` ani „remaining connection slots".
      **Co musi być prawdą:** liczba połączeń przestaje rosnąć wraz z
      równoległością — płaskie **5** (`POOL_MAX`) przy 8, 12 i 24 równoległych
      żądaniach, zamiast 3,00 i 4,00 na żądanie. Suita E2E przechodzi na
      równoległych workerach i nie jest wolniejsza niż wersja seryjna.
      *Dlaczego to łapie:* to jedyny dowód, że poprawka zadziałała **z tego
      powodu, z którego miała**. Pomiary są już wykonane i zapisane w
      `measurements.md` (2026-08-30); ten wiersz to ich przegląd, nie powtórka.

- [ ] **17.H** (faza 5, `5.6`–`5.8`) **Gdzie:** trzy dokumenty — wiersz dla
      właściciela.
      **Co zrobić:** przeczytaj wpis #3 w `context/foundation/lessons.md`, wpis
      S-21 w `context/foundation/roadmap.md`, i sprawdź `git diff`, że cztery
      celowo pominięte miejsca są **nietknięte**: `roster-store.ts:51-52`,
      `reconcile-sprint.ts:29-30`, `absence-store.ts:139-140`,
      `api/auth/[...all]/route.ts:10`.
      **Co musi być prawdą:** wpis #3 da się zastosować bez znajomości historii
      slice'a; wpis S-21 w roadmapie opisuje to, co naprawdę weszło; cztery
      wymienione miejsca nie mają żadnej zmiany.
      *Dlaczego to łapie:* stary wpis #3 podawał **błędny mechanizm** i przez
      trzy miesiące sterował decyzjami w S-02, S-04, S-05 i S-24. Jeśli nowa
      wersja jest niejasna, następny slice wyprowadzi z niej kolejne błędne
      ograniczenie. Cztery pominięte miejsca używają tego samego słownictwa, ale
      opisują **inne**, wciąż ważne reguły — zmiana któregokolwiek z nich byłaby
      pomyłką, nie porządkami.

- [ ] **17.I** `MANUAL-CHECKLIST.md` tego slice'a
      (`context/changes/db-pool-teardown/MANUAL-CHECKLIST.md`) jest podpisana w
      całości (17.A–17.C).
      *Dlaczego to łapie:* pilnuje, że wiersze zostały naprawdę wykonane, a nie
      odhaczone hurtem przy archiwizacji — rozjazd z 2026-08-29 wziął się
      dokładnie stąd.

**Faza 1 nie ma własnych wierszy manualnych po stronie aplikacji** — to pomiar
bazowy wykonany jednorazowym skryptem ze scratchpada. Niecommitowany jest sam
**skrypt** (celowo — to jednorazowe narzędzie, nie instrument); wyniki są w repo,
w `context/changes/db-pool-teardown/measurements.md`, i to je otwierasz w 17.G.

---

## 18. S-25 `sprint-identity-visibility` — otwarte (2026-08-30)

Slice wzięty **z Twojego zgłoszenia** z 2026-08-30 (notatka źródłowa została
skasowana razem z naprawą, zgodnie z konwencją w `CLAUDE.md`; opis znaleziska
żyje dalej w pozycji **S-25** roadmapy): „na
dashboardzie nie ma nazwy, nazwa jest dopiero w zakładce Sprint Detail ale jest
mało widoczna". Odpowiedź nie jest kosmetyczna. Każdy ekran pokazujący dane
sprintu ma teraz **jedną linię obok nagłówka: nazwa + zakres dat**, np.
`PT Sprint 1 · 30.08 – 12.09`. Daty są czytane w **strefie czasowej Twojej
Jiry**, żeby dało się je porównać jeden do jednego z Jirą — sama nazwa jest
nieweryfikowalna, a to właśnie weryfikowalności zabrakło, gdy sync świecił
zielono przy pustym dashboardzie.

Pełne opisy: `context/archive/2026-08-30-sprint-identity-visibility/MANUAL-CHECKLIST.md`.
Źródło kanoniczne: `context/archive/2026-08-30-sprint-identity-visibility/plan.md`
`## Progress`. **Slice zarchiwizowany 2026-08-30 — to NIE zamyka tych wierszy.**
Archiwizacja przenosi folder, nie odhacza testów; 18.A–18.E czekają tak samo jak
przedtem. Odhaczając cokolwiek, odhacz też w powyższym `plan.md`.

**Konta:** wiersze 18.A, 18.B i 18.D wymagają konta z **prawdziwą** Jirą i
trwającym sprintem — to `demo@sprintflow.test` (mimo nazwy to ono ma prawdziwe
tokeny). Wiersz 18.C wymaga konta **bez** aktywnego sprintu —
`adam.reszka85@gmail.com` albo świeżo założone. Nic tu nie kasuje danych.

- [ ] **18.A** (faza 3, `3.5`) **Gdzie:** `/dashboard`, konto z prawdziwą Jirą.
      **Co zrobić:** wejdź i **nie klikaj żadnej zakładki**; popatrz obok
      nagłówka „Dashboard — Today"; w drugiej karcie otwórz Jirę i znajdź
      aktywny sprint.
      **Co musi być prawdą:** obok nagłówka jest pogrubiona nazwa sprintu, a za
      nią jaśniejszy zakres `DD.MM – DD.MM`; nazwa jest identyczna z Jirą znak w
      znak, a data początku to **ten sam dzień**, który Jira pokazuje jako start
      — nie dzień wcześniej.
      *Dlaczego to łapie:* „Today" było jedynym ekranem, który nazwy nie miał
      **wcale** — nie było czego pogrubić, trzeba było ją wprowadzić. Data o
      jeden dzień wcześniejsza oznacza, że czytanie idzie w UTC zamiast w
      strefie zespołu, i wtedy porównanie z Jirą przestaje cokolwiek
      potwierdzać.

- [ ] **18.B** (faza 3, `3.6`) **Gdzie:** `/dashboard/sprint-detail`, to samo
      konto.
      **Co zrobić:** zapamiętaj nazwę i daty obok nagłówka; z listy rozwijanej w
      prawym rogu tego samego wiersza wybierz **inny, zamknięty** sprint;
      poczekaj na przeładowanie.
      **Co musi być prawdą:** nazwa i daty zmieniły się na te wybranego sprintu
      (nie zostały poprzednie), a obok nadal jest plakietka **„Sprint closed"**.
      *Dlaczego to łapie:* najłatwiejsza wpadka w tym slice to podmienić nazwę,
      ale zostawić daty poprzedniego sprintu — wtedy liczby jednego sprintu są
      podpisane datami innego i nie ma tego jak zauważyć. Dotyczy to zwłaszcza
      sprintów, których surowe dane już zniknęły po zmianie projektu w Jirze:
      ich daty muszą pochodzić z zapisanego pomiaru, nie z aktywnego sprintu.

- [ ] **18.C** (faza 3, `3.7`; faza 4, `4.6`) **Gdzie:** konto **bez** aktywnego
      sprintu; kolejno `/dashboard`, `/dashboard/sprint-detail`, zakładka
      **„Reliability"** na `/dashboard`, oraz `/setup/team`.
      **Co zrobić:** na każdym z trzech ekranów popatrz obok nagłówka (na
      `/setup/team` — obok tytułu karty „Sprint cadence"); w kafelku
      **„Estimated velocity"** przeczytaj cały tekst pod tytułem; na
      `/setup/team` spróbuj zmienić dowolne pole rytmu sprintu.
      **Co musi być prawdą:** wszędzie widnieje napis **„Sprint: none active"**
      — puste miejsce jest opisane, a nie po prostu puste; kafelek „Estimated
      velocity" **nigdzie** nie zawiera zwrotu **„the active sprint"**; pola
      rytmu sprintu nadal się edytują.
      *Dlaczego to łapie:* brak elementu na ekranie wygląda identycznie jak
      element, który się nie wyrenderował z powodu błędu. A stary tekst „scaled
      to what **the active sprint** actually has" twierdził, że aktywny sprint
      istnieje, na koncie, na którym go nie ma — ta sama pomyłka co „pusty wynik
      czytany jako sukces" z `lessons.md`.

- [ ] **18.D** (faza 4, `4.5`) **Gdzie:** `/setup/team`, konto z prawdziwą Jirą.
      **Co zrobić:** wejdź i **nie klikaj niczego**; przewiń do karty **„Sprint
      cadence"** i popatrz na jej nagłówek; dopiero potem kliknij **„Pull from
      Jira"**.
      **Co musi być prawdą:** już przy pierwszym wejściu obok tytułu jest nazwa
      sprintu i zakres dat — **te same** co w 18.A; po „Pull from Jira" nadal
      tam są; zdanie pod tytułem nie zawiera już nazwy sprintu w cudzysłowie.
      *Dlaczego to łapie:* to jest ekran z Twojego zgłoszenia. Jeśli nazwa
      pojawia się dopiero po kliknięciu, znaczy to, że serwer jej nie policzył i
      pierwsze wejście nadal nie odpowiada na pytanie „z którego sprintu to
      jest". Ten krok przeszedł też na **wspólny** sposób ustalania aktywnego
      sprintu — jeśli kreator i `/dashboard` pokazują **różne** sprinty, to jest
      błąd, nie różnica ekranów.

- [ ] **18.E** (faza 5, `5.5`) **Gdzie:** `/settings/recap/history`, dowolne
      konto z zapisanymi recapami sprzed dzisiaj.
      **Co zrobić:** otwórz **najstarszy** recap z listy.
      **Co musi być prawdą:** strona szczegółów otwiera się i nadal pokazuje
      nazwę sprintu oraz liczbę anomalii — **nie** komunikat o nieczytelnej
      treści. Pusta lista historii ⇒ napisz „brak recapów", nie „zaliczone".
      *Dlaczego to łapie:* faza 5 dołożyła dwa pola do zapisywanej treści
      recapu. Podbicie numeru wersji formatu unieważniłoby **każdy** wcześniej
      wysłany recap i wykasowałoby z historii nazwę sprintu oraz licznik
      anomalii. Wersja została celowo niezmieniona — ten wiersz to sprawdza.

**Wysyłki maila nie da się dziś przetestować manualnie** — Resend nie jest
jeszcze podłączony. Nowa treść maila (nazwa sprintu w temacie także w dni bez
anomalii, oraz linia tożsamości w obu wersjach treści) jest pokryta testami
jednostkowymi w `src/lib/recap/render.test.ts`; 18.E sprawdza jedyną część,
która ma widoczny skutek w aplikacji.

---

## 19. S-27 `demo-boundary-enforcement` — otwarte w całości (2026-08-30)

Slice zamknięty 2026-08-30, pięć faz. Źródło kanoniczne:
`context/changes/demo-boundary-enforcement/plan.md` `## Progress`. Wiersze
blokujące mają pełne opisy w
`context/changes/demo-boundary-enforcement/MANUAL-CHECKLIST.md` (19.A, 19.C,
19.D, 19.E, 19.G); 19.B, 19.F i 19.H są tylko tutaj.

**O co chodzi, po ludzku.** Do tej pory tryb demo był umową, nie blokadą.
Baner obiecywał, że nic prawdziwego się nie zmienia, a z ekranu demo dało się w
trzech kliknięciach **nadpisać własny, prawdziwy token GitHuba albo Jiry** — a
przy Jirze zmiana projektu kasuje kaskadowo sprinty, zadania, historię statusów i
anomalie prawdziwego konta. Ten slice zamyka to po stronie serwera (odmowa w
pięciu akcjach), po stronie tras (przekierowanie z każdej strony z polem na
token), naprawia kasowanie świata demo przy ponownym wejściu w demo, i przestaje
obiecywać listę wyłączonych rzeczy — zamiast tego mówi jedno ogólne zdanie, które
jest prawdziwe.

**Konto:** 19.A wymaga konta z **prawdziwymi** credentialami GitHuba i Jiry (na
lokalnej bazie to `demo@sprintflow.test` — nazwy są mylące, patrz §5,
identyfikuj po `token_last4`). 19.C, 19.D i 19.E najlepiej na **świeżym koncie
bez integracji** — to jest sytuacja, w której odwiedzający naprawdę ląduje w
demie.

⚠️ **Nie odpalaj `db:seed:demo` na koncie z prawdziwymi tokenami** — seed je
kasuje.

⚠️ **19.G kończy się na „Anuluj".** Potwierdzenie kasuje cały świat demo (profil
demo i wszystko pod nim). To odwracalne tylko przez wczytanie demo od zera —
stracisz każdą zmianę zrobioną wewnątrz dema. 19.H potwierdza świadomie i jest
osobnym wierszem właśnie dlatego.

### Blokujące (te same, co w checkliście slice'a)

- [ ] **19.A** (faza 1, `1.5`) **Gdzie:** konto z **prawdziwie podłączonym**
      GitHubem i Jirą, przełączone w tryb demo (`/settings/demo` → „Wróć do
      demo" albo „Zobacz demo").
      **Co zrobić:** na `/settings/connections` zapisz sobie **cztery ostatnie
      cyfry** tokena GitHuba (`••••XXXX`) i adres przestrzeni Jiry; potem wpisz w
      pasek adresu kolejno `/setup/github`, `/setup/jira`,
      `/settings/connections/github`; wróć na `/settings/connections` i porównaj.
      **Co musi być prawdą:** w żadnym z trzech kroków **nie zobaczysz pola na
      token** — za każdym razem lądujesz z powrotem na stronie nadrzędnej
      (`/setup` albo `/settings/connections`), a górny pasek dalej mówi „Jesteś w
      trybie demonstracyjnym". Na koniec cztery cyfry tokena i adres Jiry są
      **identyczne** jak na początku.
      *Dlaczego to łapie:* to cały sens slice'a. Wcześniej lider oglądający demo
      mógł w trzech kliknięciach nadpisać własny, prawdziwy token — a przy Jirze
      zmiana projektu kasuje kaskadowo sprinty, zadania i historię statusów.

- [ ] **19.C** (faza 2, `2.5`) **Gdzie:** dowolne konto w trybie demo.
      **Co zrobić:** będąc w demie, wpisz w pasek adresu
      `/settings/connections/github` i zatwierdź.
      **Co musi być prawdą:** adres zmienia się na `/settings/connections`, a na
      ekranie są **karty integracji, nie formularz**. Żadnego białego ekranu ani
      komunikatu o błędzie — ma to wyglądać jak zwykłe wejście na Connections.
      *Dlaczego to łapie:* wyszarzony przycisk to tylko uprzejmość. Jeżeli ręcznie
      wpisany adres dalej otwiera formularz, blokada nie istnieje — a to
      najkrótsza droga do nadpisania prawdziwego tokena z ekranu dema.

- [ ] **19.D** (faza 2, `2.6`) **Gdzie:** **świeże konto bez żadnych
      integracji**, które weszło w demo przyciskiem „Zobacz demo" na `/setup`.
      **Co zrobić:** będąc w demie wejdź na `/setup` (Wstecz albo wpisany adres),
      kliknij przycisk na **lewej** karcie („Podłącz GitHuba").
      **Co musi być prawdą:** lądujesz na **kroku kreatora z polem na token**
      (`/setup/github`), a paska „Jesteś w trybie demonstracyjnym" **już nie ma**
      — wyjście z dema wydarzyło się po drodze, samo. Nie wolno wrócić na tę samą
      stronę `/setup`, na której właśnie byłaś/eś.
      *Dlaczego to łapie:* blokady z fazy 2 zamykają kreator przed demem, a ta
      karta jest jedyną drogą DO kreatora dla kogoś, kto zaczął od dema. Jeśli
      przycisk odbija z powrotem na `/setup`, odwiedzający jest zamknięty w demie
      bez żadnego komunikatu — dokładnie scenariusz, przed którym ostrzega FR-008.

- [ ] **19.E** (faza 3, `3.4`) **Gdzie:** konto ze świeżo wczytanym demem.
      **Co zrobić:** w demie wejdź na `/team/roster`, **zmień imię jednej
      osoby** na rozpoznawalne (np. „TEST TEST") i zapisz; zapamiętaj datę z
      paska dema („stan na …"); wejdź na `/setup`; kliknij **„Zobacz demo"**;
      wróć na `/team/roster`.
      **Co musi być prawdą:** zmienione imię **dalej tam jest**, a pasek dema
      pokazuje **tę samą datę** co przed wyjściem.
      *Dlaczego to łapie:* wcześniej ten przycisk budował świat demo od zera przy
      każdym naciśnięciu — drugie wejście w demo po cichu kasowało wszystko, co
      odwiedzający w nim poprzestawiał, i przesuwało zamrożoną datę. Utrata danych
      bez ostrzeżenia, wywołana przyciskiem, który brzmi jak „pokaż".

- [ ] **19.G** (faza 4, `4.4`) **Gdzie:** `/settings/demo`, konto z wczytanym
      demem.
      **Co zrobić:** kliknij **„Usuń dane demo"**, przeczytaj okno, kliknij
      **Anuluj**, potem wejdź na `/dashboard`.
      **Co musi być prawdą:** po kliknięciu **nic się nie skasowało** — pojawiło
      się okno, które mówi osobno, co **znika** (cały świat demo: zespół, sprint,
      zadania, anomalie) i co **zostaje** (prawdziwe konto, jego integracje i
      tokeny), oraz że demo można wczytać ponownie. Po Anuluj okno znika, a dane
      demo są nadal na miejscu.
      *Dlaczego to łapie:* ten przycisk kasuje profil demo i kaskadowo 25
      powiązanych tabel, a stoi **obok** „Wyjdź z demo", które nie kasuje nic.
      Wcześniej odpalał się z jednego kliknięcia, bez pytania — okno jest też tym,
      co odróżnia te dwa przyciski od siebie.

### Nieblokujące (tylko tutaj)

- [ ] **19.B** (faza 2, `2.4`) **Gdzie:** `/settings/connections`, konto w trybie
      demo. Zrób to na **dwóch** kontach: raz z obiema integracjami podłączonymi,
      raz na świeżym koncie bez żadnej.
      **Co zrobić:** popatrz na obie karty integracji i spróbuj kliknąć każdy
      przycisk na nich.
      **Co musi być prawdą:** na koncie podłączonym **„Reconnect" jest wyszarzony
      i nieklikalny** na obu kartach — tak samo jak „Test connection", „Sync now"
      i „Disconnect". Na koncie bez integracji wyszarzony jest **„Connect"**.
      Żaden z tych przycisków nie otwiera formularza.
      *Dlaczego to łapie:* S-24 wyszarzył Test/Disconnect, ale **przeoczył
      Connect i Reconnect** — a to właśnie one prowadzą prosto do pola na token.
      Ten wiersz pilnuje obu stanów karty, bo każdy pokazuje inny przycisk i
      wystarczy zabezpieczyć jeden z nich, żeby drugi został otwarty.

- [ ] **19.F** (faza 4, `4.6`) **Gdzie:** cztery miejsca, w demie: pasek na górze
      `/dashboard`, panel na `/settings/demo`, karty na
      `/settings/connections`, prawa karta na `/setup`.
      **Co zrobić:** przeczytaj **całe** zdanie o demie w każdym z tych czterech
      miejsc.
      **Co musi być prawdą:** wszystkie cztery mówią **to samo, ogólnie** — że
      nic zrobione w demie nie zmienia prawdziwego konta ani jego integracji.
      **Nigdzie nie ma listy** typu „wyłączone są: test połączenia, odłączenie,
      zmiana projektu…". Nie ma też starego, zawężonego zdania o „ustawieniach
      integracji zablokowanych w demie".
      *Dlaczego to łapie:* enumeracja zdezaktualizowała się **trzy razy** — za
      każdym razem obietnica na ekranie mówiła coś innego niż kod. Jedno ogólne
      zdanie jest jedynym, które da się utrzymać; jeśli lista wróci, wróci też ten
      błąd.

- [ ] **19.H** (faza 4, `4.5`) ⚠️ **KASUJE ŚWIAT DEMO — rób jako ostatni z tej
      sekcji.** **Gdzie:** `/settings/demo`, konto z wczytanym demem, na którym
      nie masz już nic do sprawdzenia.
      **Co zrobić:** kliknij **„Usuń dane demo"** i tym razem **potwierdź**.
      Potem popatrz na panel i wejdź na `/dashboard`.
      **Co musi być prawdą:** panel wraca do stanu „nie ma danych demo" — jedyna
      oferta to **wczytanie dema od nowa**, nie „wróć do demo". Baner dema
      zniknął, `/dashboard` zachowuje się jak na koncie bez dema. Kliknięcie
      „wczytaj" buduje świat demo od zera.
      *Dlaczego to łapie:* to druga połowa 19.G — potwierdzenie musi naprawdę
      kasować, a panel musi to zauważyć. Panel, który po skasowaniu dalej oferuje
      „wróć do demo", zostawia konto w stanie, którego nie da się otworzyć.

- [ ] **19.I** `MANUAL-CHECKLIST.md` tego slice'a
      (`context/changes/demo-boundary-enforcement/MANUAL-CHECKLIST.md`) jest
      podpisana w całości (19.A, 19.C, 19.D, 19.E, 19.G).
      *Dlaczego to łapie:* pilnuje, że wiersze zostały naprawdę wykonane, a nie
      odhaczone hurtem przy archiwizacji — rozjazd z 2026-08-29 wziął się dokładnie
      stąd.

**Faza 5 nie ma własnych wierszy manualnych** — to test
`src/lib/demo/boundary-inventory.test.ts`, który przechodzi po całym kodzie i
przewraca build, gdy jakaś akcja serwerowa celuje w prawdziwe konto bez
sprawdzenia trybu demo, albo gdy strona z polem na token przestaje przekierowywać.
Zastępuje komentarze, które trzy razy wymieniły za mało miejsc.

---

## 20. S-20 `absence-sprint-scoping` — otwarte (2026-08-30)

Slice zamknięty 2026-08-30, dwie fazy. Źródło kanoniczne:
`context/changes/absence-sprint-scoping/plan.md` `## Progress`. Pełne opisy
wierszy: `context/changes/absence-sprint-scoping/MANUAL-CHECKLIST.md`.
Zobowiązania dokumentacyjne tego slice'a (2.6, 2.7) **nie są tutaj** — siedzą w
**§3** i zamyka je implementujący, nie osoba testująca.

**O co chodzi, po ludzku.** Gdy lead zapisywał nieobecność, aplikacja zapamiętywała
przy okazji, **który sprint był akurat aktywny**. Anomalia „sprint zagrożony"
pytała potem o ten zapamiętany sprint zamiast o **daty** nieobecności. Skutek:
urlop wpisany w sprincie 12, ciągnący się w sprint 13, obniżał pojemność sprintu
13 i wyciszał w nim alert o braku commitów — ale **nie potrafił** podnieść w nim
ryzyka. Od teraz liczą się wyłącznie daty, tak jak we wszystkich pozostałych
siedmiu miejscach w kodzie.

**Konto:** dowolne, z rosterem i aktywnym sprintem. Nic się nie kasuje, nie ma
migracji, nie ma dotykania tokenów. Absencje założone w teście usuwasz na końcu
sama (to część wiersza 18.A).

⚠️ **Czego świadomie NIE ma na tej liście.** Dwa przypadki, dla których slice
powstał — nieobecność zapisana, gdy konto nie ma jeszcze żadnego sprintu, oraz
nieobecność zapisana w sprincie N zapalająca ryzyko w N+1 — wymagają ręcznego
zamknięcia sprintu i wstawienia następnego w bazie. **Nie da się ich odtworzyć
klikaniem.** Oba są pokryte testami integracyjnymi na prawdziwym Postgresie
(`detect.integration.test.ts`) i to jest ich dowód.

### Blokujące (te same, co w checkliście slice'a)

- [ ] **20.A** (faza 1, `1.8`) **Gdzie:** `/team/absences`, potem
      `/dashboard`.
      **Co zrobić:** policz na `/dashboard` wiersze „sprint at risk" ze zdaniem
      **„unexpectedly away"**; dodaj **nieplanowaną** nieobecność od dzisiaj do
      daty za końcem sprintu; wróć na `/dashboard`. Potem dodaj **drugą**,
      **zaplanowaną**, innej osobie w tym samym oknie; odśwież. Na koniec usuń
      obie i odśwież.
      **Co musi być prawdą:** nieplanowana daje **dokładnie jeden** nowy wiersz
      („… unexpectedly away for **N** of the **M** working day(s) left"), gdzie
      **M** to dni robocze od dziś do końca sprintu, a **N** — część
      nieobecności w tym oknie. Zaplanowana **nie** dodaje nic. Usunięcie obu
      gasi wiersz i wraca do liczby wyjściowej.
      *Dlaczego to łapie:* slice **usunął** warunek, który wcześniej odsiewał
      część nieobecności — po takiej zmianie najłatwiej o strzelanie za często
      (podwojony wiersz) albo o utratę rozróżnienia „zaskoczenie" vs „urlop
      wpisany miesiąc wcześniej". Zła liczba **M** albo **N** znaczy z kolei, że
      przy okazji ruszono arytmetykę dni roboczych, która miała zostać
      nietknięta.
      ⚠️ **Dopisane 2026-08-30 (S-28).** Ta jedna arytmetyka — „N of the M
      working day(s)" — jest **celowo nietknięta** przez S-28: liczy całe dni
      roboczych utraconego czasu, co jest właściwą jednostką dla kosztu w
      man-days, i dalej idzie przez `countWorkingDaysInclusive`. Wszystko INNE na
      dashboardzie zmieniło jednostkę na godziny robocze. Jeśli **M** albo **N**
      wygląda tu inaczej niż przed S-28, to jest regresja, a nie skutek zmiany.


---

## 21. S-28 `working-day-aging` — otwarte (2026-08-30)

**Co ten slice zmienił, w jednym zdaniu:** każdy budżet czasowy w silniku
anomalii przestał być czasem zegarowym i stał się **czasem roboczym** — zegar
idzie tylko między **08:00 a 16:00** w strefie zespołu, tylko w dniach roboczych
sprintu i **nigdy** w dniu wolnym całego zespołu. Osiem godzin roboczych to jeden
dzień pracy.

Powód, słowami właściciela: *„mechanizm niepotrzebnie liczy soboty i niedziele
jako dni robocze"*. Konkretnie: ticket 3 SP przesunięty do In Progress w piątek o
16:00 miał budżet 48 h i odpalał w **niedzielę** o 16:00 — prosto do
poniedziałkowego inboxu, czyli na powierzchnię, którą FR-016 nazywa główną.

**Czego ten slice świadomie NIE robi.** Nieobecność **jednej osoby** nie
zatrzymuje zegara — sprint jest zespołu, a inbox jest alertem dla leada o pracy,
która stoi, a nie urządzeniem wycelowanym w człowieka (to też wymóg gwarancji
„żadnego kadrowania per-developer" z PRD). Osobna obietnica FR-010 stoi
nietknięta: nieobecność dalej **całkowicie wycisza** `DEVELOPER_INACTIVE` dla tej
osoby. Okno 08:00–16:00 jest **stałą w kodzie**, nie ustawieniem — Jira nie
wystawia pola godzin pracy, a przy tych budżetach godzina w tę czy w tę nie
zmienia dnia, w którym anomalia się pojawi.

**Wiersze, które ten slice unieważnił w innych sekcjach** (już poprawione tam, w
miejscu): **10.3**, **10.4**, **10.5**, **10.D**, **10.7**, **11.5** i przypis
przy **20.A**. Najważniejszy jest **11.5** — mówił, że ticket 3 SP nie reaguje na
dzień wolny i „to nie jest błąd". Od dziś reaguje, a brak reakcji jest błędem.

### Blokujące (te same, co w checkliście slice'a)

- [ ] **21.A** (faza 2, `2.6`) 🔴 Konto, które **przed** tą zmianą miało własny
      próg, dalej widzi swoją liczbę.
      *Gdzie:* `/settings/anomalies`, karta **Ticket ageing in a status**, na
      koncie, które kiedykolwiek klikało **Save** na tej karcie. Jeśli takiego nie
      masz — zrób je teraz: zmień 5 SP na `30`, **Save**, i wróć tu po pierwszym
      przeładowaniu.
      *Co zrobić:* otwórz `/settings/anomalies` i **nic nie klikaj**. Przeczytaj
      wszystkie siedem kubełków SP, Code review i Testing. Potem F5 i przeczytaj
      jeszcze raz.
      *Co musi być prawdą:* karta pokazuje **własne** wartości konta, a nie
      domyślne; odznaka **„Modified"** stoi; **nie ma** komunikatu „Unsaved
      changes." zaraz po wejściu na stronę, zanim cokolwiek zostało dotknięte.
      *Dlaczego to łapie:* `mergeRule` waliduje zapisane nadpisanie
      `.strict()`-em przy **każdym odczycie** i przy niepowodzeniu **wyrzuca całe
      nadpisanie razem z severity**, zostawiając tylko `console.error`. Widać to
      wyłącznie tak: domyślne liczby pod odznaką „Modified" i „Unsaved changes."
      na wejściu. To jest największe pojedyncze ryzyko tego slice'a i zielone
      testy go nie widzą.

- [ ] **21.B** (faza 2/3, `2.7` + `3.6`) 🔴 Ticket przestawiony w **piątek po
      południu** nie pojawia się w inboxie przez weekend, a pojawia się w
      poniedziałek.
      *Gdzie:* prawdziwe konto z aktywnym sprintem (nie demo), Jira + `/dashboard`.
      *Co zrobić:* w piątek po 14:00 przestaw w Jirze ticket **3 SP** do **In
      Progress** (budżet 16 godzin roboczych). W sobotę i w niedzielę otwórz
      `/dashboard` i policz wiersze `TICKET_STATUS_AGING` dla tego klucza. Otwórz
      jeszcze raz we wtorek po południu.
      *Co musi być prawdą:* przez cały weekend **zero** wierszy dla tego ticketa;
      we wtorek — jeden. (Poniedziałek jest granicą: budżet domyka się w
      poniedziałek po południu, więc nie licz go jako dowodu w żadną stronę.)
      *Dlaczego to łapie:* to jest cały slice w jednym kliknięciu. Przed zmianą
      ten sam ticket odpalał w niedzielę.
      *Zależność:* trwa trzy dni kalendarzowe — zacznij go **w piątek**, inaczej
      przesuwa się o tydzień.

- [ ] **21.C** (faza 3, `3.6`) Nieobecność dalej wycisza `DEVELOPER_INACTIVE`.
      *Gdzie:* `/team/absences`, potem `/dashboard`.
      *Co zrobić:* znajdź w inboxie wiersz **„… has an In Progress ticket but no
      commits in the last 2 working days"**. Zapisz tej osobie nieobecność
      obejmującą **ostatnie dwa dni robocze**. Wróć na `/dashboard`.
      *Co musi być prawdą:* wiersz `DEVELOPER_INACTIVE` dla tej osoby **znika**
      od razu, bez „Sync now". Wiersze `TICKET_STATUS_AGING` dla **jej** ticketów
      **zostają** — nieobecność jednej osoby nie zatrzymuje zegara ticketa.
      *Dlaczego to łapie:* okno tej reguły zmieniło jednostkę, a wyciszenie z
      FR-010 czyta **to samo** okno. Gdyby zlały się w jedno, nieobecność
      skracałaby okno zamiast tłumaczyć ciszę — i połowicznie pokryty urlop dawałby
      alarm zamiast spokoju.

- [ ] **21.D** (faza 4, `4.5` + `4.6`) Ustawienia nazywają jednostkę, a 21 SP jest
      polem liczbowym.
      *Gdzie:* `/settings/anomalies`.
      *Co zrobić:* przeczytaj wszystkie osiem kart. Zmień **21 SP** z `64` na
      `72`, **Save**, F5.
      *Co musi być prawdą:* każde pole czasu mówi **„working hours"** albo
      **„working days"** (nie samo „hours" / „days"); *Sprint at risk* mówi
      „working hours before sprint end"; gdzieś na stronie stoi zdanie o tym, w
      jakim oknie idzie zegar (08:00–16:00, dni robocze zespołu, bez dni wolnych)
      i że nieobecność jednej osoby go nie zatrzymuje; kubełek 21 SP to **pole
      liczbowe**, nie lista; po F5 stoi w nim `72` i **nie ma** „Unsaved changes."
      na wejściu.
      *Dlaczego to łapie:* liczba bez jednostki na tej stronie kłamie — „8" czyta
      się jako osiem godzin zegarowych, a znaczy cały dzień pracy zespołu. A pole
      21 SP jest jedyną kontrolką, która zmieniła **typ**, więc jedyną, która może
      się rozjechać z tym, co przyjmuje walidacja.

- [ ] **21.E** (faza 5, `5.8` + `5.9`) Demo załadowane **w poniedziałek** pokazuje
      co najmniej **cztery różne** typy anomalii.
      *Gdzie:* `/setup` (próg pierwszego uruchomienia) albo `/settings/demo`.
      *Co zrobić:* w **poniedziałek rano** kliknij „Zobacz demo", otwórz
      `/dashboard` i policz, ile **różnych** typów anomalii jest w inboxie (nie
      ile wierszy — ile typów). Potem „Zresetuj dane demo", załaduj demo jeszcze
      raz i policz ponownie.
      *Co musi być prawdą:* za każdym razem **co najmniej cztery różne** typy.
      *Dlaczego to łapie:* to jest kryterium akceptacji **US-02** i jedyne miejsce,
      gdzie ten slice mógł je po cichu zepsuć: kotwica demo to prawdziwy zegar w
      momencie ładowania, więc odkąd budżety liczą się w czasie roboczym, dzień
      tygodnia stał się wejściem do każdego przekroczenia progu w fixturze.
      Poniedziałek jest najgorszym przypadkiem — za kotwicą leży weekend.
      *Uwaga:* automat pokrywa tę samą własność dla **wszystkich siedmiu** dni
      tygodnia (`src/lib/demo/fixture.test.ts`); ten wiersz sprawdza, że to samo
      widać na prawdziwym ekranie, a nie tylko w silniku.

---

## 22. S-26 `disconnect-data-retention` — otwarte (2026-08-30)

Slice zamknięty 2026-08-30, sześć faz. Źródło kanoniczne:
`context/changes/disconnect-data-retention/plan.md` `## Progress`. Pełne opisy
wierszy: `context/changes/disconnect-data-retention/MANUAL-CHECKLIST.md`.
Zobowiązanie dokumentacyjne (6.6) **nie jest tutaj** — siedzi w **§3** i zamyka
je implementujący, nie osoba testująca. Wiersze **4.6 i 4.7** (zmiana
monitorowanego projektu Jira) są **zaliczone** i nie ma ich poniżej.

**O co chodzi, po ludzku.** Rozłączenie Jiry kasowało **wszystkie ręcznie
wpisane nieobecności** — dane, których żadna synchronizacja nie odtworzy, bo
nigdy nie przyszły z Jiry. Nikt tego nie chciał ani nie zaprojektował: absencja
dostawała przy zapisie stempel „aktywny sprint", a sprinty ginęły kaskadą razem
z credentialem. S-24 dołożył pytanie („czy na pewno?"), ale świadoma strata to
nadal strata. S-26 zwęża kaskadę w bazie (migracja `0021`) i **rozbija jedną
akcję na dwie**: domyślne wyjście zachowuje to, co lead wpisał sam, a kasuje
tylko drugi przycisk, nazwany wprost. Drugi, cichszy defekt: rozłączenie i
ponowne podłączenie **w trakcie sprintu** zamrażało zobowiązanie sprintu po raz
drugi, po nowej sumie — czyli trwale zatruwało jeden wpis historii prędkości
danymi wyglądającymi na poprawne.

**Konto:** wiersze 22.B–22.D wymagają konta z **prawdziwymi** credentialami (na
lokalnej bazie `demo@sprintflow.test` — patrz §5, identyfikuj po `token_last4`),
z podłączoną Jirą i co najmniej jedną nieobecnością. W trybie demo cała zakładka
Connections odmawia (S-27), więc na koncie demo tych wierszy nie da się zrobić.

⚠️ **Kolejność jest wiążąca.** 22.A (migracja) musi być **przed** 22.C i 22.D.
Kod uruchomiony na niezmigrowanej bazie wygląda identycznie, a kaskada dalej
kasuje nieobecności — 22.C wtedy słusznie failuje, ale z powodu, którego ten
slice nie dotyczy.

⚠️ **22.D kasuje dane nieodwracalnie.** Nie ma „cofnij"; ponowne podłączenie
Jiry nieobecności nie przywróci. Rób go dopiero po 22.C i tylko wtedy, gdy
zgadzasz się stracić nieobecności na tym koncie.

### Blokujące (te same, co w checkliście slice'a)

- [x] **22.A** (faza 1, `1.7`, ZROBIONE 2026-08-31 — patrz MANUAL-CHECKLIST.md) **Gdzie:** terminal, **główny checkout** repo (nie
      worktree — wszystkie worktree dzielą jedną lokalną bazę). Potrzebny
      connection string do bazy produkcyjnej.
      **Co zrobić:** najpierw sprawdź, co jest **naprawdę** zaaplikowane —
      zajrzyj do tabeli `drizzle.__drizzle_migrations` albo uruchom
      `DATABASE_URL_OVERRIDE='<connection string>' npx drizzle-kit up --config
      drizzle.config.ts`. Nie zakładaj, że baza stoi na `0020`. Potem
      `DATABASE_URL_OVERRIDE='<connection string>' npm run db:migrate`.
      **Co musi być prawdą:** komenda kończy się `migrations applied
      successfully`, ostatni wiersz `drizzle.__drizzle_migrations` to
      `0021_tricky_electro`, a w bazie `absence.sprint_id` i
      `monitored_repo.credential_id` mają `ON DELETE SET NULL` (nie `CASCADE`),
      przy czym `monitored_repo.credential_id` jest `NULL`-owalna. Liczba wierszy
      w `absence` i `monitored_repo` **przed i po jest identyczna** — migracja
      niczego nie kasuje.
      *Dlaczego to łapie:* schemat i kod jadą tu dwoma osobnymi torami i tylko
      jeden jest zautomatyzowany — CI migruje własną, tymczasową bazę, a
      Cloudflare Workers Builds deployuje wyłącznie kod. Zielony deploy **nie
      jest** dowodem na zmigrowaną bazę, a `lessons.md:56-60` odnotowuje, że
      `0019` i `0020` pojechały z kodem i nikt ich nie zaaplikował. Bez `0021` na
      produkcji cały slice jest tylko nowym napisem na przycisku: użytkownik
      wybiera „zachowaj moje dane", a baza dalej kasuje je kaskadą.

- [ ] **22.B** (faza 3, `3.6`) **Gdzie:** `/settings/connections`, prawdziwe
      konto. **Ten wiersz niczego nie zapisuje** — kończy się na `Cancel`.
      **Co zrobić:** na karcie **Jira** kliknij **Disconnect**, przeczytaj całą
      treść okna, popatrz na stopkę, zamknij **Cancel**. Powtórz na karcie
      **GitHub**.
      **Co musi być prawdą:** w stopce są **trzy** kontrolki: `Cancel`,
      `Delete my Jira data` (czerwony) i `Keep my Jira data` (zwykły, wyróżniony
      jako domyślny). Żadna **nie** nazywa się „Disconnect". Na karcie GitHub
      analogicznie: `Delete my GitHub data` i `Keep my GitHub data`. Treść okna
      zawiera zdanie „Choosing „Delete my Jira data" also removes…", czyli
      **cytuje nazwę** przycisku powodującego dodatkową stratę. Po `Cancel`
      integracja jest nadal połączona.
      *Dlaczego to łapie:* to cały slice widziany oczami użytkownika. Jeśli oba
      przyciski wyglądają tak samo albo domyślny jest czerwony, lead kliknie ten
      destrukcyjny „bo tak się kończy takie okno". Etykiety nie mogą też zawierać
      słowa „Disconnect" — inaczej ani Playwright, ani czytnik ekranu nie
      odróżni ich od przycisku, który to okno otworzył.

- [ ] **22.C** (faza 3, `3.7`) **Gdzie:** `/team/absences`, potem
      `/settings/connections`, prawdziwe konto. **Wymaga 22.A.**
      **Co zrobić:** na `/team/absences` zapisz sobie (zrzut ekranu), ile
      nieobecności widzisz i dla kogo; jeśli nie ma żadnej — dodaj jedną. Potem
      `/settings/connections` → karta Jira → **Disconnect** → **Keep my Jira
      data**. Wróć na `/team/absences`.
      **Co musi być prawdą:** wszystkie nieobecności z pierwszego kroku są nadal
      na liście, z tymi samymi osobami i datami. Karta Jira pokazuje teraz „Not
      connected". Roster (`/team/roster`) i dni wolne całego zespołu
      (`/team/days-off`) też są nietknięte.
      *Dlaczego to łapie:* to jest defekt, dla którego powstał S-26. Do tej pory
      rozłączenie Jiry kasowało **każdą** nieobecność wpisaną ręcznie przez leada
      — dane, których żaden sync nie odtworzy — i nikt o tym nie był
      informowany. Pusta lista po tym kroku znaczy, że migracja `0021` nie jest
      na bazie (patrz 22.A) albo kaskada nie została zwężona.

- [ ] **22.D** (faza 3, `3.8`) 🔴 **KASUJE DANE NIEODWRACALNIE.** **Gdzie:**
      `/settings/connections` → `/team/absences`, prawdziwe konto. **Wymaga
      22.A i 22.C.**
      **Co zrobić:** podłącz Jirę z powrotem (**Connect** / kreator), żeby
      Disconnect znów był dostępny; upewnij się na `/team/absences`, że
      jakaś nieobecność istnieje; potem karta Jira → **Disconnect** → **Delete my
      Jira data**; wróć na `/team/absences`.
      **Co musi być prawdą:** lista nieobecności jest **pusta**. Roster
      (`/team/roster`) jest **nienaruszony** — ludzie zostają, znikają wyłącznie
      ich nieobecności. Dni wolne całego zespołu (`/team/days-off`) też zostają.
      *Dlaczego to łapie:* bez tego kroku „wybór" jest pozorny — obie ścieżki
      robiłyby to samo i lead, który świadomie czyści konto przed oddaniem go
      komuś innemu, zostawiłby dane w bazie. Sprawdzenie rosteru pilnuje drugiej
      strony: `clear` ma usuwać wiersze FR-010, a nie osoby, do których należą.

- [ ] **22.E** (faza 6, `6.5`) **Gdzie:** wiersz **16.B** (§16) plus **22.C** i
      **22.D** powyżej — ten wiersz jest ich domknięciem, nie nowym klikaniem.
      **Co zrobić:** zrób 16.B (czytasz okno, kończysz na `Cancel`), potem 22.C
      (ścieżka zachowująca) i 22.D (ścieżka kasująca).
      **Co musi być prawdą:** obie ścieżki dają się **doprowadzić do końca** z
      tego samego okna i dają **różne** wyniki na `/team/absences` — po 22.C
      nieobecności są, po 22.D ich nie ma. Treść okna zapowiadała dokładnie to,
      co się stało w obu przypadkach.
      *Dlaczego to łapie:* dwa przyciski, które robią to samo, są gorsze niż
      jeden — obiecują wybór, którego nie ma. To jedyny wiersz sprawdzający obie
      gałęzie **przeciwko sobie**; osobno każda z nich może wyglądać poprawnie,
      gdy `mode` nie dojechał z okna do akcji serwerowej i obie idą tą samą
      ścieżką.

### Nieblokujące (tylko tutaj)

- [ ] **22.F** **Zamrożone zobowiązanie sprintu przeżywa rozłączenie w trakcie
      sprintu.** **Gdzie:** `/dashboard` (Sprint Pulse / burndown) →
      `/settings/connections` → kreator Jiry → z powrotem `/dashboard`.
      ⚠️ Ten wiersz **kasuje zsynchronizowane sprinty** (tickety, historię
      statusów, anomalie) — odzyskuje je kolejny sync.
      **Co zrobić:** w trakcie **trwającego** sprintu zapisz sobie liczbę
      „committed SP". Dodaj do sprintu w Jirze nowy ticket z estymatą (albo
      poproś kogoś, żeby dodał), tak żeby bieżąca suma SP była **inna** niż
      zamrożona. Rozłącz Jirę (**Keep my Jira data**), podłącz **ten sam**
      projekt z powrotem i poczekaj na pełny sync (albo wymuś go).
      **Co musi być prawdą:** „committed SP" jest **takie samo jak na początku** —
      nie równa się nowej, wyższej sumie.
      *Dlaczego to łapie:* zobowiązanie sprintu ma być zamrożone **raz**, na
      starcie. Rozłączenie kasowało wiersz sprintu, a ponowne podłączenie
      tworzyło nowy, nieodróżnialny od sprintu nigdy niewidzianego — więc
      następny pełny sync zamrażał zobowiązanie **drugi raz, po sumie z chwili
      ponownego podłączenia**. Efekt jest cichy i trwały: `sprint_measurement`
      kopiuje tę liczbę i nigdy jej nie przelicza, więc jeden wpis historii
      prędkości (FR-023/FR-024) zostaje na zawsze zatruty wartością wyglądającą
      na poprawną. Objęte testem integracyjnym, ale wyłącznie ta droga pokazuje
      to na prawdziwej Jirze.

---

## 23. S-19 `team-navigation-section` — otwarte (2026-08-31)

Slice zamknięty 2026-08-31, trzy fazy. Źródło kanoniczne:
`context/changes/team-navigation-section/plan.md` `## Progress`. Pełne opisy
wierszy: `context/changes/team-navigation-section/MANUAL-CHECKLIST.md`.

**O co chodzi, po ludzku.** Settings miało sześć zakładek, które odpowiadały na
**dwa różne pytania**: cztery na „skąd SprintFlow bierze dane" (Connections,
Daily recap, Anomaly rules, Demo) i dwie na „kim jest twój zespół" (Team,
Absences). S-19 wyprowadza tę drugą parę do własnej sekcji **Team** w górnym
menu. Przy okazji rozdziela dwie rzeczy, które dotąd stały na jednej stronie i
się myliły: **nieobecność** należy do konkretnej osoby i do sprintu, a **dzień
wolny całego zespołu** jest własnością kalendarza i dotyczy każdego sprintu,
który go obejmuje. Każda z nich ma teraz własną zakładkę.

**Stare adresy nadal działają.** `/settings/team` i `/settings/absences`
przekierowują na nowe miejsca, więc żaden zapisany link ani starszy wiersz z
tego pliku nie kończy się błędem 404.

**Zastępuje dwa wiersze S-15.** 5.3 („Settings → Team dostępne z nawigacji") i
5.4 („aktywna zakładka jest wyróżniona") były odhaczone 2026-08-25, ale
sprawdzały ścieżkę nawigacyjną, która przestała istnieć. Zostały oznaczone jako
`SUPERSEDED` w `context/archive/2026-08-23-team-management-surface/plan.md` i
zastępują je poniższe **23.A** i **23.B**.

**Konto:** wiersze 23.A–23.D robisz na **swoim zwykłym koncie** (dowolnym — nie
wymagają prawdziwych tokenów, poza 23.D, które potrzebuje aktywnego sprintu i
ludzi w rosterze). Wiersz 23.E wymaga wejścia w tryb demo.

### Blokujące (te same, co w checkliście slice'a)

- [ ] **23.A** (faza 1, `1.8`) **Gdzie:** dowolny ekran aplikacji po zalogowaniu.
      **Co zrobić:** popatrz na górne menu. Kliknij **Team**.
      **Co musi być prawdą:** w menu jest **pięć** pozycji w tej kolejności:
      Dashboard, Sprint Detail, **Team**, Settings, Refinement. Kliknięcie
      **Team** ląduje pod adresem `/team/roster` (sprawdź pasek adresu),
      wyświetla listę członków zespołu, a w pasku zakładek pod nagłówkiem
      **Roster** jest wyróżniony jako aktywny.
      *Dlaczego to łapie:* to jest cały sens slice'a widziany oczami leada —
      zastępuje wiersz S-15 5.3. Jeśli menu prowadzi w puste miejsce albo roster
      się nie renderuje, sekcja istnieje tylko w kodzie. Kolejność też jest
      celowa: Team to **dane o zespole**, więc stoi przy innych ekranach z
      danymi, przed konfiguracją.

- [ ] **23.B** (faza 2, `2.7`) **Gdzie:** `/team/roster`, `/team/absences`,
      `/team/days-off`.
      **Co zrobić:** dwa przejścia. Najpierw **klikaj** kolejno wszystkie trzy
      zakładki. Potem każdy z tych trzech adresów **wpisz ręcznie w pasek
      adresu** i wejdź na niego bezpośrednio (albo przeładuj `Cmd+R`).
      **Co musi być prawdą:** za każdym razem — i po kliknięciu, i po wejściu z
      paska adresu — dokładnie **jedna** zakładka jest wyróżniona (ciemniejszy
      tekst, podkreślenie) i jest to ta, na której faktycznie jesteś. Nigdy zero,
      nigdy dwie.
      *Dlaczego to łapie:* zastępuje wiersz S-15 5.4, rozszerzony z dwóch
      zakładek na trzy. Wyróżnienie liczy się po **prefiksie adresu**, więc nowa
      zakładka o dłuższej nazwie to dokładnie ten przypadek, w którym taka
      logika potrafi zapalić dwie naraz albo żadnej. Wejście z paska adresu jest
      osobnym krokiem, bo klikanie działa nawet wtedy, gdy stan po odświeżeniu
      jest zepsuty.

- [ ] **23.C** (faza 1, `1.9`) **Gdzie:** pasek adresu, potem `/settings`.
      **Co zrobić:** wpisz ręcznie `/settings/team` i zatwierdź. Potem wpisz
      `/settings/absences`. Na koniec wejdź na `/settings`.
      **Co musi być prawdą:** pierwszy adres ląduje na `/team/roster`, drugi na
      `/team/absences` — pasek adresu ma **zmienić się sam**. Żaden nie pokazuje
      błędu 404 ani pustej strony. Zakładka **Settings** ma teraz **cztery**
      pozycje: Connections, Daily recap, Anomaly rules, Demo — bez Team i bez
      Absences.
      *Dlaczego to łapie:* przeprowadzka jest zrobiona w połowie, jeśli stare
      adresy przestają działać. Wskazuje na nie mnóstwo rzeczy poza aplikacją:
      zakładki w przeglądarce, starsze wiersze w tym pliku, zarchiwizowane
      dokumenty. 404 w takim miejscu czyta się jak zepsuta aplikacja, a nie jak
      przeniesiona strona.

- [ ] **23.D** (faza 1 i 2, `1.10` + `2.5`) 🔴 **Wiersz o zapisie — sprawdza, czy
      podział stron nie zerwał drogi zapisu.** **Gdzie:** `/team/absences`,
      `/team/days-off`, potem `/dashboard`. Potrzebny **aktywny sprint** i ludzie
      w rosterze.
      **Co zrobić:** dwa niezależne zapisy. **(1)** Na `/dashboard` znajdź w
      inboxie anomalię `DEVELOPER_INACTIVE` dla konkretnej osoby. Wejdź na
      `/team/absences` i zapisz jej nieobecność obejmującą dzisiaj. Wróć na
      `/dashboard` i **przeładuj stronę — nie klikaj „Sync now"**. **(2)** Na
      `/dashboard` → **Availability** zapisz sobie obecne MD i liczbę dni
      roboczych. Wejdź na `/team/days-off` i dodaj **dzień roboczy (pon–pt)
      leżący wewnątrz aktywnego sprintu**. Wróć na `/dashboard`.
      **Co musi być prawdą:** **(1)** anomalia `DEVELOPER_INACTIVE` dla tej osoby
      **zniknęła** z inboxa, bez czekania na cykl crona. **(2)** liczba dni
      roboczych spadła **dokładnie o 1**, a MD o **sumę etatów** zespołu.
      *Dlaczego to łapie:* to jedyne realne ryzyko regresji w tym slice'ie. Oba
      edytory stały wcześniej na jednej stronie i dzieliły **jeden** odczyt
      danych sprintu; teraz każdy robi swój własny. Jeśli któryś dostał zły
      sprint albo zgubił ponowne przeliczenie anomalii po zapisie, ekran wygląda
      normalnie — po prostu nic się nie dzieje, a lead uzna, że zapis nie
      przeszedł, i zapisze drugi raz.

- [ ] **23.E** (faza 1 i 2, `1.11` + `2.8`) **Gdzie:** `/settings/demo`, potem
      `/team/roster` i `/team/days-off`. **Wymaga trybu demo.**
      **Co zrobić:** wejdź na `/settings/demo` i załaduj demo. **Bez klikania po
      innych ekranach** przejdź prosto na `/team/roster`, popatrz, potem prosto
      na `/team/days-off`.
      **Co musi być prawdą:** roster pokazuje **sześcioosobowy zespół demo**, nie
      twoich prawdziwych ludzi. Dni wolne pokazują dni wolne **konta demo**, nie
      twoje. Oba **za pierwszym wejściem** — bez odświeżania i bez drugiej
      nawigacji.
      *Dlaczego to łapie:* przy wejściu w demo aplikacja czyści z pamięci
      podręcznej listę adresów, które zależą od tego, czyje dane pokazują. Trasy
      się przeprowadziły, a `/team/days-off` w ogóle wcześniej nie istniała —
      jeśli którejś zabrakło na tej liście, **nie widać żadnego błędu**: strona
      renderuje się poprawnie, tylko z danymi **poprzedniego** konta. To jest
      dokładnie ten rodzaj awarii, którego nie da się zauważyć bez celowego
      sprawdzenia, a w demie prezentowanym komuś z zewnątrz wygląda jak wyciek
      cudzych danych.

### Nieblokujące

- [ ] **23.F** (faza 2, `2.6`) **Gdzie:** `/team/absences`.
      **Co zrobić:** przeczytaj sam ekran — nagłówek, akapit pod nim i to, co
      jest niżej.
      **Co musi być prawdą:** na stronie jest **wyłącznie** edytor nieobecności
      pojedynczych osób — nie ma już drugiej sekcji „Team days off" ani jej
      kalendarza. Akapit pod nagłówkiem kończy się zdaniem kierującym do
      zakładki **Team days off** dla dnia, w którym wolne ma cały zespół.
      *Dlaczego to łapie:* to jedyne, co zostało z podziału po stronie tekstu.
      Lead, który wiedział, gdzie wpisuje się święta, wchodzi tu z
      przyzwyczajenia i musi dostać wskazówkę, dokąd poszły — inaczej uzna, że
      funkcja zniknęła. **Nieblokujące:** zły albo brakujący tekst nikogo nie
      zatrzymuje i niczego nie psuje, dlatego nie ma tego wiersza w checkliście
      slice'a.

- [ ] **23.G** (impl-review F1, dopisane 2026-08-31) **Gdzie:** `/dashboard` →
      zakładka **Availability**.
      **Co zrobić:** popatrz na nagłówek karty „Who is away" — na jego prawą
      stronę. Kliknij **Days off**.
      **Co musi być prawdą:** w nagłówku są **dwie** kontrolki obok siebie:
      `Manage` (z ramką) i `Days off` (bez ramki). Nie nachodzą na siebie, nie
      zawijają się brzydko i nie rozjeżdżają tytułu karty — sprawdź też przy
      szerokości tabletu (DevTools → 1024 px). `Days off` prowadzi na
      `/team/days-off`.
      *Dlaczego to łapie:* karta pokazuje linijkę „− N team days off already
      subtracted", a po podziale stron w S-19 jej jedyny przycisk prowadził już
      tylko do nieobecności — liczba nie miała drogi do swojego edytora. Drugi
      przycisk to naprawia, ale nagłówek nie był projektowany na dwie kontrolki,
      więc jego wygląd jest jedyną rzeczą tutaj, której nie potwierdza żaden test
      automatyczny. **Nieblokujące:** obie ścieżki działają niezależnie od tego,
      jak to wygląda.


---

## 24. S-31 `reconnect-affordance` — otwarte (2026-08-31)

Slice zamknięty 2026-08-31, pięć faz. Źródło kanoniczne:
`context/changes/reconnect-affordance/plan.md` `## Progress`. Pełne opisy
wierszy blokujących: `context/changes/reconnect-affordance/MANUAL-CHECKLIST.md`
(pięć wierszy — te są u testera pierwsze).

**O co chodzi, po ludzku.** Lead, któremu wygasł token, wchodził na
`/settings/connections` i musiał zgadywać. Karta oferowała **cztery** kontrolki
o równej albo mniejszej wadze, trzy z nich nazwane mechanizmem
(`Test connection`, `Reconnect`, `Disconnect`), i **nic** na niej nie mówiło, że
jedna z nich wymienia token bez żadnej straty, a inna kasuje sprinty. S-24 dał
`Disconnect` okno potwierdzenia, S-26 dał temu oknu bezpieczne domyślne wyjście —
ale oba działają **po** tym, jak lead wybrał już zły przycisk. S-31 naprawia to,
co jest wcześniej: wagę i słowa. `Reconnect` jest teraz jedynym wyróżnionym
przyciskiem, `Test connection` stoi osobno nad rzędem jako diagnostyka,
`Disconnect` zostaje **najcichszą** kontrolką karty, a dwa zdania — jedno nad
rzędem, jedno pod nim — nazywają trzy zadania i mówią, co ponowne podłączenie
kosztuje. Te same `Reconnect` dostały też obie karty kreatora, gdzie do dziś
jedyną drogą do nowego tokena było kliknięcie przycisku niszczącego.

**Żadnej migracji, żadnej zmiany w bazie.** To slice tekstu i układu. Nic tutaj
nie kasuje danych — każdy wiersz kończy się na patrzeniu albo na `Cancel`.

**Wpływ na starsze wiersze tego pliku.** **16.C** ma przepisany warunek
zaliczenia (przyciski się przesunęły, a wyliczanka w polskim zdaniu przestała
być prawdą już przy S-27). **15.C** jest wycofane — powód w §6 — a jego żywa
połowa wraca niżej jako **24.C**.

**Konto:** 24.A i 24.B robisz na **prawdziwym** koncie z podłączonym GitHubem
(karta Connections nigdy nie pokazuje danych demo). 24.C wymaga prawdziwego
konta i **tego samego PAT-a GitHuba pod ręką**.

### Nieblokujące (tylko tutaj)

- [ ] **24.A** (faza 2, poza `plan.md`) **Gdzie:** `/settings/connections`,
      przeglądarka zwężona do **1024 px** (DevTools → Responsive → 1024×768).
      To podłoga formatu z NFR — „tablety 10 cali i większe".
      **Co zrobić:** popatrz na rząd trzech kontrolek na obu kartach. Potem
      otwórz **Change monitored repositories** i popatrz jeszcze raz.
      **Co musi być prawdą:** zamknięty rząd mieści się czytelnie — kontrolki
      albo stoją w jednej linii, albo zawijają się **całe**, żadna nie jest
      przycięta ani nie nachodzi na sąsiednią. Otwarty panel zajmuje **całą
      szerokość** karty i spycha `Disconnect` pod siebie; nie próbuje dzielić
      linii z `Reconnect`.
      *Dlaczego to łapie:* rząd urósł z trzech kontrolek do trzech **plus**
      wyprowadzony nad niego `Test connection`, a przycisk otwierający edytor
      wszedł do zawijanego kontenera dopiero w tym slice'ie. Na szerokim
      monitorze wszystko się mieści i defekt jest niewidoczny. **Nieblokujące:**
      brzydkie zawinięcie nikomu niczego nie kasuje, a podłoga tabletu jest
      wymaganiem niefunkcjonalnym, nie ścieżką krytyczną.

- [ ] **24.B** (faza 2, poza `plan.md`) **Gdzie:** `/settings/connections`,
      prawdziwe konto, karta GitHub.
      **Co zrobić:** kliknij **Test connection** i poczekaj na wynik.
      **Co musi być prawdą:** przycisk na moment pokazuje „Testing…", a potem
      **nad** dolnym blokiem (nad zdaniem „Three jobs live here") pojawia się
      ramka „Connection is live" albo „Connection test failed" z wyjaśnieniem.
      Rząd trzech przycisków i oba zdania są nadal na swoich miejscach, a dolne
      bloki obu kart nadal są wyrównane względem siebie.
      *Dlaczego to łapie:* `Test connection` przeprowadził się w tym slice'ie —
      z rzędu akcji nad zdanie opisowe — i jego alert renderuje się w zupełnie
      innym miejscu układu niż sam przycisk. Test automatyczny sprawdza
      **kolejność w DOM**, nie to, czy klik nadal cokolwiek robi i czy wynik
      jest widoczny bez przewijania. **Nieblokujące:** sama akcja serwerowa jest
      nietknięta przez ten slice.

- [ ] **24.C** (przeniesione z **15.C**, krok 2 przepisany 2026-08-31)
      **Gdzie:** `/settings/connections/github`, konto z prawdziwymi
      credentialami.
      ⚠️ **Ten wiersz odłącza prawdziwą integrację i zaraz ją podłącza z
      powrotem — miej ten sam PAT GitHuba pod ręką, zanim zaczniesz.**
      **Co zrobić:** na `/settings/connections` kliknij **Disconnect** na karcie
      GitHub; w oknie potwierdzenia kliknij **Keep my GitHub data** (przycisk
      zwykły, nie czerwony — od S-26 to jest domyślne wyjście i **niczego** nie
      kasuje poniżej samego credentiala; przycisk „Disconnect GitHub" w tym oknie
      **nie istnieje**, i tak ma być). Popatrz na pasek adresu **zanim**
      klikniesz cokolwiek innego. Potem podłącz GitHuba z powrotem tym samym
      PAT-em i tymi samymi repozytoriami i wejdź na `/dashboard`.
      **Co musi być prawdą:** po odłączeniu jesteś na `/settings/connections`
      albo `/settings/connections/github` z formularzem ponownego podłączenia —
      **nie** na `/setup`. Po ponownym podłączeniu `/dashboard` znów pokazuje
      dane.
      *Dlaczego to łapie:* bramka pierwszego uruchomienia pilnuje `/dashboard`,
      ale nie wolno jej pilnować `/settings/**`. Gdyby zadziałała szerzej, lead
      rotujący wygasły token zostałby wyrzucony z jedynej strony, na której jest
      formularz „podłącz ponownie" — a od S-31 to jest strona, na którą prowadzi
      **wyróżniony** przycisk `Reconnect` z obu kart Ustawień **i** z obu kart
      kreatora. Wiersz przestał więc dotyczyć jednej ścieżki brzegowej i zaczął
      dotyczyć głównej.
