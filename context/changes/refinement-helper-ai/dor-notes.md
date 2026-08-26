# DOR — wiedza dziedzinowa od użytkownika

> Materiał wejściowy do `frame.md`, zebrany w rozmowie 2026-08-26. PRD (FR-020)
> ma tu **mniej** treści niż ta rozmowa — jeśli coś się rozjeżdża, ten dokument
> jest bliżej intencji, a rozjazd jest ustaleniem dla frame'u, nie błędem.
>
> Po polsku, bo to dokument roboczy użytkownika (precedens:
> `manual-test-backlog.md`).

---

## 1. Po co to istnieje

Ocenić, **czy zadanie, które chcemy wziąć na sprint, ma spełniony DOR** — zanim
je weźmiemy.

**Ból:** zadanie *wygląda* na kompletne. W trakcie sprintu okazuje się, że
czegoś brakuje — i wtedy albo (a) nie da się go zrealizować, albo (b) jest dużo
większe, niż się wydawało. Oba skutki uderzają po tym, jak zobowiązanie zostało
już podjęte.

**Analizowana treść ticketu w Jirze:** tytuł, opis, user story, kryteria
akceptacji, linki, załączniki, komentarze.

## 2. Rozstrzygnięcie o punktacji

> „Punktacja określająca poziom spełnienia DOR to albo kwestia wtórna, albo w
> ogóle jest niepotrzebna. Cel jest taki, aby **wskazać czego brakuje**, a nie
> szacować jakiś parametr oceny."

Deliverable = **lista braków**. `dor_score` jest wtórny lub zbędny.

## 3. Cztery pytania nadrzędne (podsumowanie użytkownika)

1. Czy zadanie da się **jednoznacznie zinterpretować** pod kątem tego, co jest
   do zrobienia?
2. Czy wiemy **gdzie, jak i na kiedy** mamy to zrealizować?
3. Czy mamy **jasno określone kryteria akceptacji**?
4. Czy mamy **cały wsad** potrzebny do realizacji — pliki, załączniki, makiety,
   dokumenty, opis, dane, kontrakty, endpointy?

---

## 4. Taksonomia braków — cztery poziomy

Poziomy różnią się tym, **czego trzeba, żeby brak w ogóle wykryć**. To nie jest
porządek ważności, tylko porządek kosztu i wykonalności.

### P0 — obecność nośnika

Czy pole w ogóle istnieje. Wykrywalne kodem, bez modelu (`if (!description)`).

- **#1 Brak opisu.** „Deweloper po samym tytule się zorientuje" — przykład z
  życia. Trzeba po prostu wskazać, że opisu nie ma.
- Brak kryteriów akceptacji (patrz #9 — ale tam jest też P1).
- Brak załącznika / makiety tam, gdzie natura zadania ich wymaga (#3, #5).

### P1 — jakość tego, co jest

Pole jest wypełnione, ale jego treść nie robi swojej roboty. Wymaga modelu
czytającego tekst; **samowystarczalne w obrębie ticketu**.

- **#2 Tytuł na złym poziomie abstrakcji.** Test: *po przeczytaniu tytułu nie
  rodzą się w głowie podstawowe pytania o to, co jest do zrobienia.*
  Przykłady z życia:
  | jest | powinno być | dlaczego |
  |---|---|---|
  | „Feedy produktowe" | „Opracowanie sposobu wczytywania do bazy feedów produktowych" | dobry tytuł na epik, zły na spike |
  | „Propaganda apkowa" | „Dodanie nowych reklam aplikacji mobilnej w panelu klienta" | nie wynika, co jest do zrobienia |
  | „Nowy regulamin" | „Aktualizacja regulaminu karty" | nie wiadomo *jaki* regulamin bez czytania opisu |

- **#4 User story — dwa osobne testy.**
  - **(a) Czy potrzeba jest zrozumiała?** Modelowo: *jako <user>, potrzebuję
    <czego>, w jakim celu* + co ma zostać zrobione. Sprawdzić, czy faktycznie
    rozumiesz, jaka potrzeba użytkownika ma być zrealizowana, i czy ten kontekst
    będzie **użyteczny dla dewelopera i dla Claude Code**. Jeśli nie — „popraw
    user story".
  - **(b) Czy w user story jest prawdziwy user?** Częsty defekt: rolę
    **zamawiającego** wstawiono w miejsce **odbiorcy**.
    - OK: „Jako pracownik marketingu potrzebuję nowej zakładki, gdzie będę mógł
      pobierać raporty aktywności userów" — marketing jest odbiorcą.
    - Kaszana: „Jako pracownik marketingu potrzebuję, aby powstała nowa
      podstrona kontaktowa **dla klientów**" — odbiorcą jest klient.
    - Reguła detekcji: *tam, gdzie nasuwa Ci się, że istnieje użytkownik będący
      odbiorcą tej funkcjonalności, a ktoś go nie umieścił w user story* —
      wymusić poprawkę. Role typu „pracownik compliance", „zarząd" same w sobie
      nie są błędem; błędem jest podmiana odbiorcy na zamawiającego.

- **#9 Kryteria akceptacji.** Czy są, w punktach: co ma działać i jak. Jeśli
  nie ma — **czy bez nich da się jednoznacznie wywnioskować, na podstawie czego
  stwierdzimy, że zadanie jest skończone.** (Brak AC nie jest automatycznie
  defektem; niemożność wywnioskowania warunku „done" jest.)

### P2 — obowiązki wynikające z natury zadania

Model musi najpierw **rozpoznać, jakiego rodzaju to praca**, a potem zastosować
zobowiązania właściwe temu rodzajowi. Tu mieszka większość wartości, której
checker obecności pól nie dotknie.

- **#3 Podmiana pliku / dokumentu** (np. regulamin):
  - czy z kontekstu wynika, **od kiedy** plik obowiązuje → czy jest informacja o
    momencie podmiany;
  - co ma się stać **ze starym plikiem**;
  - czy plik jest w ogóle **załączony**;
  - czy **po nazwie załącznika** da się wydedukować, że załączono właściwy plik.

- **#5 Nowy widok / strona / komponent lub zmiany wizualne**, których nie da się
  zerojedynkowo wyprowadzić z opisu → w zadaniu musi być **makieta**: link do
  Figmy / Canvy / Photoshopa, plik, screeny. Jeśli nie ma — wymusić uzupełnienie.

- **#6 Zmiana treści:**
  - **gdzie** dokładnie i **z jakiej treści na jaką**;
  - czy to jedyne miejsce, w którym ta treść występuje — czy trzeba poszukać
    innych;
  - **czy to w ogóle jest zadanie dla dewelopera** — a może treść idzie z CMS-a
    i interesariusz może ją zmienić sam, tylko o tym zapomniał.

- **#7 Zadanie frontowe oparte o dane z backendu:**
  - makieta może być potrzebna — trzeba wydedukować, czy jest;
  - **czy wskazano endpointy** i z jakiego API;
  - czy endpointy są **stare i znane**, czy nowe;
  - czy jest **kontrakt** — struktura danych, payload, tokeny;
  - jeśli brakuje — czy rozpisano **subtaski techniczne** i czy są podpięte;
  - jeśli endpointy są nowe — czy **zadania backendowe są już Done**; jeśli nie,
    czy wiemy **jak i jakie dane zamockować**;
  - czy wskazano **źródła wszystkich** potrzebnych danych.

- **#8 Wyceny** — „czy zadania mają wyceny (ale to chyba na później)". Odłożone
  świadomie przez użytkownika.

### P3 — stan projektu poza ticketem

Wykrycie wymaga danych, których w treści ticketu nie ma. Przykład użytkownika:
*„a może znając projekt orientujesz się, że tego zadania nie da się wykonać? Albo
nie da się podjąć decyzji o spełnionym DOR bez zaglądania do kodu? Czy wiemy, jak
działa funkcjonalność, którą mamy edytować? Czy ma jakieś ograniczenia, czy nie
zaczepia o coś?"*

Konkretne przypadki rozsiane po przykładach: status podpiętych zadań backendowych
(#7), czy treść jest w CMS-ie (#6), czy ta sama treść żyje gdzie indziej (#6),
czy załączony plik jest tym właściwym (#3).

**To jest granica MVP-a i główna oś do rozstrzygnięcia we frame'ie.**

---

## 5. Przypowieść o Zenku — dwie zasady, których nie ma w #1–#9

Tytuł: „Nowa fryzura dla Zenka". Pytania: dla jakiego Zenka? gdzie fryzura ma
zostać wykonana? kiedy i kto ma ją wykonać? czy Zenek ma wtedy czas? czy
potwierdził, że chce? może budżet jest ważny? jak daleko trzeba dojechać?

- **Zasada A — istotność jest kontekstowa.** „Fryzjer czy fryzjerka? To nie jest
  istotne. **A może dla Zenka jest?**" Nie każde brakujące pole jest brakiem.
  Mechanizm, który zgłasza wszystko, przestaje być używany.
- **Zasada B — zadanie może być bezsensowne lub niewykonalne, nie tylko
  niekompletne.** „Może Zenek od roku jest łysy, a ciotka, która nam to zleca, od
  roku go nie widziała — i ono nie ma sensu." „Może w zakładzie wszyscy są na
  urlopie i nie da się tego zrealizować." To jest kategoria wyniku, której
  FR-020 nie przewiduje: *nie „czego brakuje", tylko „to nie powinno wejść do
  sprintu"*.

Cel docelowy sformułowany przez użytkownika: *rozbić wsad na czynniki tak, aby
„gdy przyjdzie nam zorganizować Zenkowi fryzjera na jego ślub, dokładnie
wiedzieli, jak z tym działać".*

---

## 5a. Modele myślenia zaproponowane przez Claude'a (do akceptacji/odrzucenia)

Nie pochodzą od użytkownika — zaproponowane 2026-08-26 na jego prośbę
(„jeśli widzisz jakieś modele myślenia, które tu powinny się pojawić, śmiało
proponuj"). **Nie są jeszcze zatwierdzone.** Każdy odpowiada na jakiś fragment
bólu z §1, którego #1–#9 nie adresują wprost.

- **M1 — Odwrócenie planistyczne.** Zamiast pytać „czy czegoś brakuje", spróbuj
  **napisać z samego ticketu konkretny plan wykonania / pierwszy commit**.
  Miejsce, w którym plan się zacina, **jest** brakiem — i jest zlokalizowany, a
  nie zgadnięty. To jednocześnie dosłowna realizacja kryterium użytkownika z #4a:
  *„czy ten kontekst dla dewelopera i dla Claude Code będzie użyteczny"*.
- **M2 — Inscenizacja odbioru.** Opisz scenę, w której zadanie jest odbierane:
  kto co klika, co widzi i na tej podstawie mówi „zrobione". Jeśli sceny nie da
  się zainscenizować, kryteriów akceptacji nie ma — niezależnie od tego, czy
  pole „Kryteria akceptacji" jest wypełnione. Test na #9 bez traktowania AC jako
  pola.
- **M3 — Licznik mnogości.** Bezpośredni detektor bólu (b) („okazało się dużo
  większe"): policz **odrębne rzeczy do dostarczenia**, które ticket implikuje —
  powierzchnie (web/app/panel), języki, rynki, role, środowiska, formaty.
  „Aktualizacja regulaminu karty" → których kart? ile wersji językowych? PDF czy
  strona czy oba? link w aplikacji mobilnej też?
- **M4 — Rejestr zależności zewnętrznych.** Kto **spoza zespołu** musi coś
  dostarczyć lub zatwierdzić, zanim to się skończy: legal, compliance, treści od
  marketingu, plik od interesariusza, decyzja PO. Klasyczna przyczyna „nie da się
  dokończyć". Zenek: *„czy potwierdził, że chce nową fryzurę"*.
- **M5 — Kotwica czasowa.** Czy zadanie ma datę **narzuconą z zewnątrz**
  (regulamin obowiązuje od, start kampanii, termin ustawowy)? Jeśli tak, DOR
  obejmuje osiągalność tej daty w tym sprincie, a nie tylko kompletność treści.
  Uogólnia „od kiedy obowiązuje" z #3 i „na kiedy" z §3. Zenek: ślub.
- **M6 — Los stanu poprzedniego.** Uogólnienie „co ze starym plikiem" (#3): co z
  danymi, które już istnieją; z użytkownikami w trakcie procesu; z cache'em; ze
  starymi linkami; z kompatybilnością wstecz. Częste źródło ukrytego rozmiaru.
- **M7 — Adresat braku.** Każdy wskazany brak powinien mieć **kogoś, kto może go
  zamknąć** (autor ticketu, PO, designer, backend, compliance). „Wymusić
  poprawkę" wymaga adresata — bez niego lista braków nie jest wykonalna na
  refinemencie.

**Kandydat na ósmy, ale to już werdykt, nie brak:** *czy to jest jedno zadanie?*
Jeśli plan z M1 rozpada się na dwa niezależne dostarczenia z osobnymi momentami
odbioru, ticket jest w rzeczywistości dwoma ticketami — i to też jest powód, by
nie brać go do sprintu w obecnej formie.

---

## 6. Zderzenie z tym, co produkt faktycznie ma

- `src/lib/jira.ts:845` pobiera z Jiry dokładnie `summary, status, assignee,
  created` + pole story points.
- `jira_ticket` (`src/db/schema.ts:580-613`) trzyma z treści zadania **wyłącznie
  `summary`** — brak opisu, kryteriów akceptacji, komentarzy, załączników,
  linków, subtasków, typu zadania.
- **Z siedmiu pól z §1 istnieje jedno.** Ścieżka „wybierz ticket z Jiry" nie ma
  dziś czego analizować. Analiza tytułu (#2) to jedyny punkt taksonomii, który
  działa na obecnych danych.

## 7. Napięcia do rozstrzygnięcia we frame'ie

1. **P3 vs. dane, które produkt ma.** Najcenniejsze checki (#6 CMS, #7 status
   backendu, „znając projekt") wymagają wejść spoza ticketu.
2. **„5–8 pytań" z FR-020 vs. objętość taksonomii.** Sam #7 generuje więcej niż
   osiem pytań dla jednego zadania.
3. **Pytania czy braki?** FR-020 obiecuje *pytania*; użytkownik chce *wskazania
   braków* i wielokrotnie mówi „wymusić poprawkę" — to dyrektywa, nie pytanie.
4. **`dor_score`** — użytkownik uważa go za wtórny lub zbędny; kolumna istnieje
   w schemacie od F-02.
5. **Zasada A (istotność kontekstowa)** nie ma dziś żadnego wyrazu w FR-020 —
   a bez niej mechanizm zgłasza wszystko i traci zaufanie.
6. **Zasada B (zadanie bezsensowne/niewykonalne)** to trzecia kategoria wyniku,
   której PRD nie przewiduje.

---

## 8. Rozstrzygnięcia użytkownika (2026-08-26, runda 2)

### 8.1 Werdykt i kształt wyniku — ROZSTRZYGNIĘTE

- Jeśli **jednoznacznie niczego nie brakuje** → werdykt **„Spełniony DOR"**.
- Jeśli brakuje → **lista wskazówek co uzupełnić**, w formie: *stwierdzenie
  osadzone w treści zadania* + ewentualne pytanie. Cytaty użytkownika:
  - „Zadanie dotyczy publikacji regulaminu ale **brak załącznika**"
  - „Zadanie dotyczy obsłużenia nowych endpointów. **Nie widzę kontraktu. Czy
    backend jest gotowy?**"
- **M7 (adresat braku) — ODRZUCONY.** „Adresat nie musi być konieczny. Deweloper
  idzie do product ownera i prosi o uzupełnienie."

**Konsekwencje dla PRD (rozjazdy do zapisania we frame'ie):**
- `dor_score` — **martwy**. Werdykt jest binarny + lista braków.
- FR-020 „**5–8 pytań**" — zastąpione przez „tyle braków, ile jest". Liczba
  wynika z zadania, nie z limitu.
- FR-020 „pytania" — w rzeczywistości **stwierdzenia braków**, czasem z pytaniem
  domykającym.
- **Kryterium osadzenia z FR-020 jest spełnione konstrukcyjnie:** klauzula
  „Zadanie dotyczy X, ale…" *jest* osadzeniem w treści historyjki. To nie jest
  wymóg stylistyczny do oceny przez sędziego-LLM, tylko wymagany kształt zdania.

### 8.2 Wejście — ROZSTRZYGNIĘTE (przegląd backlogu, nie jedna historyjka)

> „Sprint sobie trwa, a ja np. przeglądam zadania w ramach refinementu,
> przygotowując się na kolejny sprint, i patrzę na zadania **w backlogu**."

Otwarte pytanie użytkownika: podać numery ticketów czy zaciągnąć backlog i
wskazać, które refinujemy?

**Ustalenie faktyczne — oba są w zasięgu, transport już istnieje:**
- `searchSprintIssues` (`src/lib/jira.ts:828`) to w istocie **generyczne
  wyszukiwanie JQL** po `/rest/api/3/search/jql`, z konfigurowalną listą pól,
  paginacją po `nextPageToken` i twardym capem stron. „Podaj numery" to ta sama
  ścieżka z `key IN (...)`.
- `listBoards` (`:469`) już rozmawia z `/rest/agile/1.0`, gdzie żyje
  `/board/{id}/backlog`. Zaciągnięcie backlogu nie jest nową instalacją
  wodno-kanalizacyjną.

### 8.3 Pola ticketu — zmiana standardu opisu NIE jest potrzebna

Użytkownik rozważał **przestawienie zespołu na opis w Markdown**, żeby wszystkie
informacje z innych pól znalazły się w jednym miejscu.

**Ustalenie faktyczne: to nie jest konieczne.** `src/lib/jira.ts` gada z
**REST API v3** (`:23`). Pola ticketu są zamawiane pojedynczo przez parametr
`fields` — dziś lista to `["summary","status","assignee","created"]` (`:845`).
`description`, `comment`, `attachment`, `issuelinks`, `subtasks`, `issuetype`,
`duedate`, `labels`, `priority` to **dopisanie nazw do tej tablicy**.

Realny koszt leży gdzie indziej: v3 zwraca `description` i `comment` w
**ADF (Atlassian Document Format)** — drzewo JSON, nie tekst. Potrzebne jest
spłaszczenie ADF→tekst, i to ono, a nie proces zespołu, jest tu pracą.
Tabele i panele spłaszczają się niedoskonale.

> **Wniosek dla użytkownika: nie zmieniaj procesu zespołu, żeby dogodzić
> narzędziu.** Standard opisu w Markdown może być dobrym pomysłem sam w sobie,
> ale nie jest warunkiem tej funkcjonalności.

### 8.4 Dopytywanie wewnątrz SprintFlow — OTWARTE

> „Może pewne rzeczy da się wywnioskować z samego projektu, a jak nie, to mogą
> być zadawane dodatkowe pytania przy takiej analizie — tylko to by się musiało
> odbywać wewnątrz SprintFlow. Jakiś a'la czatbot? Jak to ogrom pracy, to nie
> wiem, najwyżej to zmienimy."

Oś zakresu, nie decyzja implementacyjna: czy analiza jest **jednorazowa**
(wejście → lista braków → koniec), czy **konwersacyjna** (mechanizm dopytuje,
lead odpowiada, werdykt się domyka). Interakcja z §8.1: przy odpowiedzi lead
uzupełnia braki, więc werdykt musi być przeliczalny ponownie.

Zostawione użytkownikowi jako świadomie odwracalne („najwyżej to zmienimy").

### 8.5 Nazwa projektu i tytuł taska jako kontekst — PRZYJĘTE

Użytkownik wskazał, że **nazwa projektu** i **tytuł zadania** są nośnikami
kontekstu dla analizy (odpowiedź na pytanie o granicę P3). Część rozstrzygnięć
„znając projekt" da się wyprowadzić z samego projektu, bez zaglądania do kodu.
