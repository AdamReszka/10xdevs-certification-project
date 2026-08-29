# SprintFlow — globalny backlog testów manualnych

Jedno miejsce na wszystko, co wymaga człowieka przy klawiaturze i **nie jest**
pokryte automatyką. Zebrane 2026-08-23 przez przeskanowanie każdej sekcji
`#### Manual` w `context/**/plan.md` plus checklisty zmian.

**Plany pozostają kanoniczne.** Ten plik jest indeksem — odhaczając coś tutaj,
odhacz też w źródłowym `plan.md`, inaczej `## Progress` skłamie. Kolumna
„źródło" wskazuje, gdzie.

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
> zasymulować się nie da.

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

### 7.7 — 4.7 🔴 Merge dwóch wierszy rosteru

- [ ] **7.7** Scalenie dwóch członków zespołu w jeden wiersz.
      *Gdzie:* `/settings/team`, konto z prawdziwymi tokenami (identyfikuj po
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

- [ ] **7.8** Roster wraca do stanu wyjściowego po wierszach 7.1–7.7.
      *Gdzie:* `/settings/team` (albo `psql`).
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

### Osiągalne od razu — nie wymagają Resenda

- [ ] **1.9** `\d daily_recap` i `\d recap_settings` na lokalnym Supabase
      pokazują zamierzony kształt.
      *Źródło:* `context/changes/daily-recap-email/plan.md` faza 1
      *Co musi być prawdą:* brak kolumny `recap_date`; `recap_day text NOT NULL`;
      `daily_recap_owner_day_uq UNIQUE (owner_id, recap_day)`; `send_status NOT
      NULL DEFAULT 'PENDING'`; kolumny `attempt_count`, `last_attempt_at`,
      `rendered_message`; `recap_settings` z `recap_settings_owner_uq`.
      *Status:* **zweryfikowane w sesji** przez `psql` przeciwko `:54322` —
      wyszło zgodnie z planem. Zostawione nieodhaczone, bo checklisty manualne
      zamyka użytkownik, nie agent.
      *Dlaczego to ma znaczenie:* cała gwarancja exactly-once opiera się na tym
      unique key. Nullowalny człon klucza nie kolidowałby nigdy (lessons.md #1).

- [ ] **4.13** Dashboard „Today" renderuje się identycznie po wyciągnięciu
      mapowania anomalii z RSC do `lib/anomaly/inbox-view.ts`.
      *Jak:* `/dashboard` → Anomaly Inbox. Porównaj z tym, co pamiętasz sprzed
      slice'a: te same anomalie, ta sama kolejność, te same context chips,
      działające sortowanie i filtry.
      *Dlaczego:* to refaktor bez zmiany zachowania, ale dotyka jedynej ścieżki
      renderującej nagłówkową powierzchnię produktu. Test integracyjny dowodzi,
      że mail i inbox wołają tę samą funkcję — nie że komponent nadal ją dobrze
      konsumuje.

- [ ] **6.10** Ostrzeżenie przy zmianie projektu Jira wymienia „daily recaps".
      *Jak:* `/settings/connections` → zmiana projektu Jira → **przeczytaj
      ostrzeżenie, nie potwierdzaj**.
      *Dlaczego:* `daily_recap` kaskaduje po `sprint`, więc przełączenie projektu
      kasuje archiwum recapów. Potwierdzenie, które niedomawia, co kasuje, jest
      defektem.

- [ ] **6.11** `/settings/recap` osiągalne z zakładek i pokazuje bieżące wartości.
- [ ] **6.12** Zmiana godziny zapisuje się, toastuje i przeżywa reload.
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
      *Ticket ageing in a status* pokazuje **siedem** kubełków SP (1/2/3/5/8/13
      jako pola liczbowe + 21 SP jako lista z dwiema pozycjami); *PR / ticket
      desync* pokazuje **tylko** Severity, bez pola liczbowego; **żadna** karta
      nie ma odznaki „Modified".
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
      `DEFAULT_THRESHOLDS`: PR review stalled → 24 h; Developer inactive i Ticket
      with no commits → 2 dni; Sprint at risk → 2 / 2 / 3 równolegle + 48 h;
      Scope creep → 20 %; PR / ticket desync → samo Severity.
      *Dlaczego:* pole przemianowane po jednej stronie daje detektorowi
      `undefined`, a to jest właśnie ścieżka `NaN` → `risk_score`.

- [ ] **10.4** Edycja **jednego** kubełka SP w karcie *Ticket ageing in a status*
      zostawia w bazie **wszystkie siedem**.
      *Co zrobić:* zmień 3 SP na `96`, zapisz, odśwież — sprawdź, że 1, 2, 5, 8,
      13 i 21 SP mają nadal swoje wartości (21 SP dalej „8 working days").
      *Dlaczego:* scalanie nadpisania jest **jednopoziomowe**, więc częściowa mapa
      **zastępuje** domyślną i kasuje resztę kubełków. `inProgressBudget` spada
      wtedy do najbliższego niższego progu albo — dla pustej mapy — zwraca `null`
      i pomija **każde** zadanie In Progress, co na ekranie wygląda jak zdrowy
      sprint. To dokładnie lekcja „zawężający predykat zamienia złą wartość w
      pusty wynik" z `lessons.md`.

- [ ] **10.5** Kontrolka 21 SP działa w **obie** strony: przełącz na
      „120 hours (5 days)", zapisz, odśwież, przełącz z powrotem na
      „8 working days", zapisz, odśwież.
      *Dlaczego:* `"8_WORKING_DAYS"` to sentinel, który detektor rozwiązuje
      względem kalendarza dni roboczych sprintu; zapisanie go jako tekstu tam,
      gdzie kod oczekuje liczby (albo odwrotnie), psuje regułę po cichu.

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

### Świadomie NIE zrobione w tym slice'ie

**Sentinel `"8_WORKING_DAYS"` nie stał się danymi.** Kubełek 21 SP pozostaje
wyborem dwupozycyjnym (`120 h` albo `8 dni roboczych`); „10 dni roboczych" jest
niewyrażalne. Zmiana wymagałaby ruszenia `src/db/defaults.ts`,
`ticket-status-aging.ts` **i** założeń fixture'a demo naraz.

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

- [ ] **11.1** (1.7) Banner migracji na `/settings/team` znika na dobre.
      *Co zrobić:* wejdź na `/settings/team`, policz członków, kliknij
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
      *Gdzie:* `/settings/absences` → **Team days off**, potem `/dashboard` →
      **Availability**.
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
      ⚠️ **Tylko kubełek 21 SP.** To jedyny budżet z FR-009 wyrażony w dniach
      roboczych (`8_WORKING_DAYS`); 1/2 SP = 24h, 3 SP = 48h, 5 SP = 72h,
      8/13 SP = 120h liczą **czas zegarowy** i święto ich nie zatrzymuje. Test na
      3 SP pokaże „brak reakcji" — **to nie jest błąd**.
      *Co zrobić:* znajdź ticket **21 SP** w **In Progress** stojący bez ruchu od
      ośmiu dni roboczych; potwierdź, że jest w inboxie. Dodaj dzień wolny
      **w środku tego okna** i przeładuj dashboard.
      *Co musi być prawdą:* anomalia `TICKET_STATUS_AGING` dla tego ticketa
      **znika** bez czekania na cykl crona.
      *Zależność:* wymaga ticketa 21 SP — jeśli go nie ma, przenieś ten wiersz na
      później zamiast go pomijać.

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
      `/settings/team`, `/settings/absences`, `/refinement` → na ostatnim kliknij
      **„Wyjdź z demo"**.
      *Co musi być prawdą:* baner na **każdym** z tych ekranów; po kliknięciu
      baner znika, a `/settings/team` pokazuje **Twój** roster, nie sześcioosobowy
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
  `/settings/team`, a `/setup/team` używa **tego samego organizmu**.
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
      *Dlaczego to łapie:* `lessons.md` ma otwarty wpis o pulach per-request,
      które nigdy nie są zamykane (`db-pool-teardown`). To jedyny wiersz, który
      dotyka go od strony użytkownika.

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

- [ ] **13.7** (5.6) Ukończenie rosteru + kadencji sprawia, że `isOnboardingComplete`
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
      **Do decyzji ownera:** wiersz zamknie się sam wraz z S-22; do tego czasu
      przepisanie go na „kreator kończy się na `/dashboard`" odhaczyłoby coś, czego
      on nie sprawdza.
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
