# S-13 refinement-helper-ai — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md`. Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Konto:** wiersze 2.4, 6.4 i 6.6 wymagają konta z **prawdziwymi** credentialami
Jiry. Na lokalnej bazie to `demo@sprintflow.test` — nazwy kont są mylące, patrz
`manual-test-backlog.md` §5. Identyfikuj po `token_last4` (`B9D0`), nigdy po nazwie.

**Klucz API:** wiersze 1.6, 4.6 i 6.7 dotyczą `ANTHROPIC_API_KEY` w `.env.local`.
⚠️ Nie odpalaj `db:seed:demo` na koncie z prawdziwymi tokenami — seed je kasuje.

---

## Faza 1

- [x] **1.6 — brak klucza daje błąd konfiguracji, nie 401** *(faza 1)* ✅ 2026-08-26

  **Gdzie:** terminal, `scripts/anthropic-smoke.eval.ts` (faza 1).

  **Co zrobić:** usuń (albo zakomentuj) `ANTHROPIC_API_KEY` z `.env.local`
  i uruchom `npx vitest run --config vitest.eval.config.ts scripts/anthropic-smoke.eval.ts`.

  **Co musi być prawdą:** wypisany błąd to `AnthropicConfigError` i wymienia
  **obie** drogi skonfigurowania klucza — Workers Secret oraz `.env.local`.
  Nie może to być `401`, `Invalid API key` ani surowy błąd z SDK.

  **Dlaczego to ma znaczenie:** `lessons.md` #7 opisuje dokładnie tę pułapkę —
  w S-11 210 zielonych testów integracyjnych przechodziło, a `sendDailyRecap`
  nie potrafił wysłać niczego, bo żaden test nie przeszedł przez prawdziwy
  resolver z pustą konfiguracją. To jedyny wiersz, który sprawdza ścieżkę,
  którą kod napotka jako pierwszą po deployu.

---

## Faza 2

Oba wiersze zamyka jedno uruchomienie:
`npx vitest run --config vitest.eval.config.ts scripts/jira-refinement.eval.ts`
Skrypt sam znajduje konto po `token_last4` (`B9D0`) i odmawia startu na innej
bazie niż lokalna Supabase. Tokenu nie wypisuje.

- [x] **2.5 — ścieżka boardu zwraca BACKLOG, nie aktywny sprint** *(faza 2)* ✅ 2026-08-27

  **Gdzie:** terminal, komenda wyżej. Konto z prawdziwymi credentialami Jiry.

  **Co zrobić:** przeczytaj wiersz `2.5` w wyniku oraz dwie linie `[eval]`:
  listę kluczy backlogu i listę kluczy aktywnego sprintu.

  **Co musi być prawdą:** test `2.5` jest zielony (części wspólnej brak) **oraz**
  lista backlogu nie jest pusta. Jeśli skrypt wypisze ostrzeżenie „no active
  sprint", rozstrzygnięcie należy do Ciebie — spójrz na listę kluczy i potwierdź,
  że to backlog, a nie zawartość sprintu.

  **Dlaczego to ma znaczenie:** cykl sync czyta wyłącznie `sprint = <id>`, więc
  backlog to zupełnie inna ścieżka (`/rest/agile/1.0/board/{id}/backlog`).
  `lessons.md` ostrzega, że zawężenie na złej wartości zwraca pustkę, która
  czyta się jak sukces — dlatego rozłączność zbiorów jest asercją, a nie oceną.

  **Wynik (2026-08-27, `foxmind.atlassian.net`, projekt FM, board 1):**
  backlog `FM-4, FM-5`; aktywny sprint „SCRUM Sprint 1" `FM-3, FM-6, FM-1, FM-2`.
  Zbiory rozłączne, backlog niepusty — obie połowy warunku spełnione maszynowo.
  Uwaga do fazy 6: backlog ma dziś **dwa** tickety i oba to przykłady wgrane
  przez Atlassian, więc `/refinement` pokaże właśnie je.

- [x] **2.4 — prawdziwy ADF spłaszcza się do czytelnego tekstu** *(faza 2)* ✅ 2026-08-27

  **Gdzie:** ten sam wynik, wiersz `2.4` i wypisane ramki ticketów.

  **Co zrobić:** przeczytaj bloki `DESCRIPTION` i `COMMENTS` dla wypisanych
  ticketów. Jeśli backlog jest pusty albo chcesz wskazać konkretne zadania,
  ustaw `JIRA_EVAL_KEYS=FM-1,FM-2` przed komendą.

  **Co musi być prawdą:** tekst da się przeczytać — listy wyglądają jak listy
  (`- `), nagłówki mają `#`, a linki niosą swój URL w nawiasie. Załączniki
  pokazują nazwę i typ MIME. Ściana tekstu bez podziału na linie albo puste
  `DESCRIPTION` przy tickecie, który w Jirze opis ma, to porażka.

  **Dlaczego to ma znaczenie:** fixture'y dowodzą tylko tych typów węzłów, które
  przewidzieliśmy. Prawdziwy opis jest jedynym dowodem na te, których nie —
  a URL linku jest wprost dowodem dla klasy braku `MOCKUP_MISSING` w fazie 4.

  **Wynik (2026-08-27, `JIRA_EVAL_KEYS=FM-1`).** FM-1 został w tym celu ręcznie
  wzbogacony o wszystkie sześć poziomów nagłówka, listy, znaczniki i komentarz.
  Każdy warunek ma dowód z prawdziwego ADF: nagłówki `#`…`######` zgodnie z
  poziomem, listy punktowane `- `, numerowane `1.`/`2.`, linki z URL-em w
  nawiasie, `COMMENTS (1)` z czytelną treścią, dwa załączniki z nazwą i typem
  MIME — w tym nazwa ze spacjami i przecinkiem.

  **Dwie obserwacje, świadomie NIEnaprawiane:**
  1. Znaczniki (pogrubienie, kursywa, podkreślenie) są gubione — to `marks`, nie
     struktura. Skutek uboczny: ticket używający pogrubienia zamiast nagłówków
     traci podział na sekcje, a tak robią właśnie szablony Atlassiana. Dlatego
     wykrycie sekcji „Kryteria akceptacji" opiera się na węźle `heading`, nie na
     pogrubionej linijce.
  2. Przecinek w nazwie pliku (`ChatGPT Image 23 sie 2026, 23_08_21.png`) nigdy
     nie był dwuznaczny dla mechanizmu: lista załączników przychodzi z Jiry jako
     tablica i tablicą pozostaje aż do promptu, który wypisuje ją po jednym
     wpisie w linii (`prompt.ts:228-233`) — nic tego tekstu nie parsuje z
     powrotem. Dwuznaczne było tylko wyjście `show()` w tym evalu, sklejane
     przecinkami dla człowieka; poprawione na jeden plik w linii. Rozważana i
     ODRZUCONA alternatywa: rozpoznawanie granicy rekordu po rozszerzeniu
     (`.png`, `.jpeg`) przed przecinkiem. Zawodzi na nazwie `raport.pdf, wersja
     ostateczna.pdf` i na plikach bez rozszerzenia (`Dockerfile`), a przede
     wszystkim odtwarzałaby heurystyką strukturę, której nie trzeba było
     niszczyć.

---

## Faza 4

Oba wiersze zamyka jedno uruchomienie: `npm run eval:refinement`
(10 prawdziwych wywołań modelu, ~kilkadziesiąt groszy). Skrypt na końcu wypisuje
tabelę i podsumowanie — wiersze 4.5, 4.7 i 4.9 są w niej asercjami albo
licznikami, więc czerwony test sam je pokaże. Poniżej to, co wymaga Twojej oceny.

- [x] **4.6 — kompletny ticket nie generuje żadnego braku** *(faza 4)* ✅ 2026-08-27

  **Gdzie:** terminal, `npm run eval:refinement` z ustawionym `ANTHROPIC_API_KEY`.

  **Co zrobić:** uruchom eval i przeczytaj wiersze dotyczące fixture'ów
  oznaczonych jako kompletne (te, których oczekiwany werdykt to `DOR_MET`).

  **Co musi być prawdą:** każdy z co najmniej trzech kompletnych ticketów kończy
  się werdyktem `DOR_MET` i **pustą** listą braków. Ani jednego zgłoszenia.

  **Dlaczego to ma znaczenie:** nadgorliwość jest głównym ryzykiem tego slice'u —
  mechanizm, który na każdym tickecie znajdzie osiem braków, zostanie wyłączony
  po trzecim refinemencie. Recall na ticketach niekompletnych mierzy ten sam
  eval automatycznie; tylko brak fałszywych alarmów wymaga ludzkiego spojrzenia
  na to, *co* zostało zgłoszone.

- [x] **4.8 — `MAX_TICKETS_PER_RUN` ustawiony z pomiaru, nie z przeczucia** *(faza 4)* ✅ 2026-08-27

  **Gdzie:** terminal, ten sam wynik `npm run eval:refinement`, blok
  `MAX_TICKETS_PER_RUN candidates at p95 …` na końcu.

  **Co zrobić:** przeczytaj `p95` oraz dwie zaproponowane wartości (budżet
  requestu 60 s i TTL cache'u 5 min). Wybierz mniejszą z nich i powiedz mi,
  jaką — wpiszę ją do `src/lib/refinement/analyze.ts` i do `plan.md`.
  Sprawdź przy okazji `cache reads after ticket 1` — musi być pełne.

  **Co musi być prawdą:** wybrana liczba pochodzi z wypisanego `p95`, a nie
  z obecnej prowizorycznej ósemki. Jeśli `p95 × wybrany limit` przekracza
  5 minut, na bloku systemowym ląduje `ttl: "1h"` w tym samym przebiegu.

  **Jak to się skończyło (2026-08-27, `effort: "high"`):** mediana 7,3 s,
  średnia 9,9 s, p95 22,0 s, cały 10-ticketowy przebieg 98,7 s. Ustawiono
  **4** — czyli **wbrew** regule „mniejsza z dwóch" powyżej, która dawała 2.
  Przy n=10 to „p95" jest po prostu najgorszym pojedynczym ticketem, więc
  wycenia każdy przebieg tak, jakby każdy ticket był najgorszy; 4 to ~40 s
  oczekiwane i ~88 s w ogonie. Dwa tickety na przebieg to nie jest sesja
  refinementu. Przekroczenie w ogonie jest ryzykiem przyjętym świadomie i
  zapisanym przy stałej w `analyze.ts` oraz w `plan.md`; lekarstwem nie jest
  większa liczba, tylko wyprowadzenie przebiegu poza ścieżkę requestu.

  **Dlaczego to ma znaczenie:** cały przebieg dzieje się wewnątrz jednego
  requestu Workers, trzymając pulę Hyperdrive. Czego nie zdąży, to nie jest
  wolna funkcja, tylko zawieszona strona. Faza 6 buduje synchroniczną
  powierzchnię wprost na tej liczbie — limit, którego nikt nie zmierzył, to
  limit, którego nikt nie ustawił.

---

## Faza 6

- [ ] **6.4 — `/refinement` pokazuje prawdziwy backlog projektu** *(faza 6)*

  **Gdzie:** `/refinement`, konto z prawdziwymi credentialami Jiry.

  **Co zrobić:** zaloguj się, wejdź w Refinement z górnej nawigacji.

  **Co musi być prawdą:** lista zawiera zadania z **backlogu** monitorowanego
  projektu — nie tickety aktywnego sprintu i nie pustą listę. Link w nawigacji
  przenosi na stronę, zamiast nie robić nic.

  **Dlaczego to ma znaczenie:** cykl sync filtruje po aktywnym sprincie, więc
  backlog to zupełnie inna ścieżka odczytu (`/board/{id}/backlog`). Jeśli
  zwróci aktywny sprint albo pustkę, cała powierzchnia jest bezużyteczna —
  a `lessons.md` ostrzega, że pusty wynik z zawężonego zapytania czyta się
  jak sukces.

- [ ] **6.6 — braki nazywają coś z tego konkretnego ticketu** *(faza 6)*

  **Gdzie:** `/refinement`, to samo konto.

  **Co zrobić:** zaznacz trzy tickety, w tym jeden, o którym wiesz, że jest
  niekompletny. Uruchom analizę. Rozwiń wiersz z brakami.

  **Co musi być prawdą:** każdy wiersz pokazuje **rozpoznany rodzaj zadania**
  i werdykt, a każde zdanie braku odnosi się do treści tego ticketu
  („Zadanie dotyczy publikacji regulaminu, ale…"). Zdanie typu „Czy są kryteria
  akceptacji?" bez odniesienia do treści oznacza porażkę.

  **Dlaczego to ma znaczenie:** to jest całe FR-020. Osadzenie w treści jest
  wymaganym kształtem zdania, a widoczny rodzaj zadania jest jedynym
  zabezpieczeniem przed cichą błędną klasyfikacją, która wycina całą grupę
  sprawdzeń.

- [ ] **6.7 — brak klucza degraduje z bannerem i nic nie zapisuje** *(faza 6)*

  **Gdzie:** `/refinement`, `ANTHROPIC_API_KEY` usunięty z `.env.local`,
  serwer dev zrestartowany.

  **Co zrobić:** wejdź na `/refinement`, zaznacz ticket, uruchom analizę.
  Następnie sprawdź `select count(*) from refinement_run`.

  **Co musi być prawdą:** widoczny czytelny banner mówiący, że klucz AI nie jest
  skonfigurowany — nie biały ekran, nie stacktrace. Licznik `refinement_run`
  **nie rośnie**.

  **Dlaczego to ma znaczenie:** PRD wymaga graceful degradation, a `lessons.md` #7
  ma korolarium: warunek wstępny, który nie poprawi się przy kolejnej próbie,
  sprawdza się **przed** zapisem i kończy pominięciem, nigdy trwałym rekordem
  porażki.
