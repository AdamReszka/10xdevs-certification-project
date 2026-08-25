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

- [ ] **6.6** Reset seeda i ponowne uruchomienie dają spójną historię sprintu na
      obu dashboardach.
      *Źródło:* `plan.md:1288` + `MANUAL-CHECKLIST.md` sekcja G
      *Uwaga bezpieczeństwa:* `db:seed:demo` **kasuje credentiale** ownera, którego
      dostanie. Patrz §5 — konta na lokalnej bazie mają mylące nazwy.

- [ ] **11.15** Parasol manualnej weryfikacji — zamyka się **sam**, gdy padnie 6.6.
      Pozostałe 21 z 22 wierszy `MANUAL-CHECKLIST.md` jest już zamkniętych.
      *Nie odhaczaj ręcznie przed 6.6.*

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
