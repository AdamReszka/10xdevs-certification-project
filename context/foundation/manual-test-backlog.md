# SprintFlow — globalny backlog testów manualnych

Jedno miejsce na wszystko, co wymaga człowieka przy klawiaturze i **nie jest**
pokryte automatyką. Zebrane 2026-08-23 przez przeskanowanie każdej sekcji
`#### Manual` w `context/**/plan.md` plus checklisty zmian.

**Plany pozostają kanoniczne.** Ten plik jest indeksem — odhaczając coś tutaj,
odhacz też w źródłowym `plan.md`, inaczej `## Progress` skłamie. Kolumna
„źródło" wskazuje, gdzie.

**Po polsku, bo to Twój roboczy dokument.** Precedens: `manual-test-plan.md`
z S-07 też jest po polsku; reszta `context/` (PRD, roadmapa, plany) jest po
angielsku i taka zostaje.

---

## 1. Teraz — blokuje domknięcie S-10 (PR #46)

PR jest `ready for review` i `MERGEABLE`. Te trzy pozycje zostały otwarte
świadomie — merge bez nich jest decyzją, nie przeoczeniem.

- [ ] **1.8** Realny sync zapisuje `sprint.committed_sp` / `completed_sp`
      zgodne z ręcznym przeliczeniem w Jirze.
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

- [ ] **6.6** Reset seeda i ponowne uruchomienie dają spójną historię sprintu na
      obu dashboardach.
      *Źródło:* `plan.md:1288` + `MANUAL-CHECKLIST.md` sekcja G
      *Uwaga bezpieczeństwa:* `db:seed:demo` **kasuje credentiale** ownera, którego
      dostanie. Patrz §5 — konta na lokalnej bazie mają mylące nazwy.

- [ ] **11.15** Parasol manualnej weryfikacji — zamyka się **sam**, gdy padnie 6.6.
      Pozostałe 21 z 22 wierszy `MANUAL-CHECKLIST.md` jest już zamkniętych.
      *Nie odhaczaj ręcznie przed 6.6.*

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
> zasymulować się nie da.

- [ ] **2.7** Kreator `/setup/team` nadal działa po przepięciu na
      `reconcile-sprint.ts` (nazwa aktywnego sprintu + chooser tablic).
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

- [ ] **3.7** Dashboard „Today" renderuje ticket'y i anomalie **nowego**
      sprintu, ze świeżym timestampem. *Źródło:* `plan.md:824`
      *Wymaga przeglądarki* — nie da się zasymulować z CLI.

- [x] **3.8** `select count(*) from sprint where owner_id = $1 and state = 'ACTIVE'`
      zwraca 1. **Zamknięte 2026-08-26** tym samym przebiegiem co 3.6: przed
      cyklem 2 wiersze ACTIVE, po cyklu 1.

- [ ] **4.6** Zmiana projektu Jiry w kreatorze nie zostawia starego sprintu.
      *Źródło:* `plan.md:839`
      ⚠️ **Wiersz zmienił sens** — patrz checklista. Ustalenie z fazy 4:
      `/setup/jira` nie pokazuje pickera projektu, dopóki istnieje
      `jira_credential`, a Disconnect i tak kasuje sprint kaskadą. Nośną
      połową jest teraz **krok 2** (potwierdź, że widzisz kartę statusu, a nie
      picker) — pilnuje założenia, na którym oparto brak confirmation dialogu.

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

## 4. Osobna kategoria: deploy

`context/deployment/deploy-plan.md` ma **19** niezaznaczonych kroków, ale to
runbook wdrożeniowy (utworzenie Hyperdrive, sekrety, rozmiar bundle'a), nie
testy produktu. Odhaczasz je, wykonując pierwszy deploy — nie wcześniej.
Przypomnienie z pamięci projektu: przed pierwszym deployem są **3 twarde
prerekwizyty** (migracja adaptera, sterownik DB, flaga CI).

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

---

## 6. Nie powtarzaj tego — już zweryfikowane dowodowo

`context/changes/dashboard-sprint-detail/MANUAL-CHECKLIST.md` — 18 z 19 wierszy
zamkniętych, każdy z zapisaną metodą i wynikiem. W szczególności nie ma potrzeby
ponownie sprawdzać: czytelności wykresów w obu motywach (4.8, 3.5, 8.12),
arytmetyki burndownu (2.5, 2.6), braku wycieków w payloadach akcji (7.7) i w
logach Workera (1.7), guardu seeda (F5) oraz niedestrukcyjności edycji repo i
projektu Jiry (F1, F2).

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
*Jak:* `/settings/team` na koncie z **jednym** członkiem → kosz → przeczytaj
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
*Dlaczego odłożone:* auto-import na pustym rosterze ma test integracyjny
(„fresh import proposes members from both sources"), a **oba** mounty edytora
czytają przez `listRosterForEditor`, więc nie mogą się rozjechać (komentarz w
`src/lib/roster.ts`). Koszt: pełny setup nowego konta z credentialami.
*Jeśli będzie czas na jeden dodatkowy test — wybierz ten.* To jedyny wiersz
dotykający kreatora, a nie zakładki Settings.

### 7.5 — 5.7 Szerokość tabletu (NFR, podłoga 10 cali)

*Źródło:* `plan.md` faza 5, wiersz 5.7 — **zamyka zaparkowany wiersz 4.6 z S-04**
*Jak:* DevTools → 1024 px → `/settings/team`.
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
*Gdzie:* `/settings/absences`, potem `/settings/team`.
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
*Gdzie:* `/dashboard` (zakładka **Anomaly Inbox**), potem `/settings/absences`.
*Jak:* znajdź w inboxie wiersz `DEVELOPER_INACTIVE`, zapisz absencję dla tej
osoby na zakres obejmujący **dzisiaj**, wróć na `/dashboard` i odśwież.
*Co musi być prawdą:* wiersz zniknął **od razu**, bez czekania na cykl cron
(15 min) i bez „Sync now".
*Dlaczego:* to decyzja D1. Testy integracyjne pokrywają pętlę reconcile, ale nie
ścieżkę Server Action → `router.refresh()` → render. Jeśli to nie działa, lead
zapisuje urlop i patrzy na anomalię, którą właśnie wyjaśnił.

### 8.6 — 2.3 Zapis absencji przeżywa odświeżenie, z właściwymi dniami

*Źródło:* `MANUAL-CHECKLIST.md`, faza 2
*Gdzie:* `/settings/absences`.
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
*Gdzie:* `/settings/absences`, mając **co najmniej dwie** absencje.
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
*Gdzie:* terminal, potem `/dashboard`.
*Jak:* `OWNER_ID=<id konta z atrapami> npm run db:seed:demo`.
⚠️ **Sprawdź last4 przed uruchomieniem** — patrz §5; `db:seed:demo` **kasuje
credentiale** swojego ownera.
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
wierszami na `/settings/absences`.
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
(`/settings/team`, pole Capacity na puste, zapisz) → `/dashboard` → Availability.
*Co musi być prawdą:* widać zdanie „No story-point capacity set for anyone on
the team yet…", a **nie** liczba „0 SP".
*Dlaczego odłożone:* `NULL` jest tu jawnie wykluczony i policzony osobno
(`membersWithoutCapacity`), i ma własny test unitowy („excludes a member with no
capacity set and counts them separately"). Przygotowanie stanu wymaga
zdemolowania rosteru konta testowego, co jest droższe niż samo sprawdzenie.
*Dlaczego mimo to warto:* `NULL` czytany jako zero to dokładnie ta klasa błędu,
która daje leadowi liczbę wyglądającą na prawdziwą — a on nie ma jak poznać, że
jest zaniżona.
