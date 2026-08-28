# Frame Brief: Refinement Helper (S-13 / FR-020)

> Krok framingowy przed `/10x-plan`. Dokument zapisuje, o co *faktycznie*
> chodzi, oddzielone od tego, co pierwotnie założono.
>
> Materiał źródłowy: `dor-notes.md` (wiedza dziedzinowa od użytkownika,
> zebrana w tej samej sesji).

## Reported Observation

FR-020 obiecuje trzy rzeczy: 5–8 pytań DOR „osadzonych w treści historyjki",
**DOR Compliance Score** i **checklistę brakujących elementów**. W repozytorium:

1. Nie istnieje żadna lista elementów DOR — ani w `context/`, ani w `src/`.
   Score i checklista liczą się względem rubryki, której nie ma.
2. `dor_score` to `integer("dor_score")` (`src/db/schema.ts:826`) bez
   udokumentowanego producenta — liczba od modelu czy wyliczona przez kod.
3. Kryterium osadzenia nie ma testu. `context/foundation/test-plan.md:115`
   wskazuje sędziego-LLM jako narzędzie do dokładnie tej własności, ale
   opatruje go „defer until S-13 ships" — a S-13 potrzebuje tego testu, żeby
   swoje główne kryterium było falsyfikowalne.

## Initial Framing (preserved)

- **Stated cause**: trzy luki w specyfikacji slice'u — do rozstrzygnięcia przed
  planowaniem, nie do obejścia w planie.
- **Proposed direction**: zakwestionować ujęcie przed `/10x-plan`, zamiast
  odpowiadać na pytania po kolei.
- **Pre-dispatch narrowing**: użytkownik odrzucił ustrukturyzowane pytania
  zawężające i zamiast tego **podyktował brakującą wiedzę dziedzinową wprost**
  (`dor-notes.md` §1–§5, 9 klas braków + przypowieść o Zenku, plus runda
  odpowiedzi w §8). To *jest* zawężenie: hipoteza „to jedna luka w trzech
  przebraniach" (jedna z opcji, których nie zdążył wybrać) została potwierdzona
  przez to, że jedna dostarczona treść zamknęła wszystkie trzy pytania naraz.

## Dimension Map

Obserwacja mogła powstać w którymkolwiek z tych miejsc:

1. **Luka dokumentacyjna** — rubryka DOR istnieje w głowie użytkownika, nikt jej
   nie spisał. ← *pierwotne ujęcie*
2. **PRD opisał kształt wyjścia zamiast przedmiotu oceny** — FR-020 mówi
   „score + 5–8 pytań + checklista" (kontrakt UI), ale nigdzie nie mówi, *czego*
   te pytania dotyczą. Rubryki nie da się spisać, bo FR-020 nigdy nie pytał o
   domenę.
3. **`dor_score` to artefakt kolejności prac** — F-02 zaprojektował schemat dla
   wszystkich dwudziestu FR-ów naraz, czytając brzmienie PRD. Kolumna jest
   zgadywanką ze słów „Compliance Score", nie decyzją produktową.
4. **Nietestowalność jest skutkiem kształtu wyjścia** — przy „5–8 swobodnych
   pytań" nie ma czego asertować, więc jedynym narzędziem zostaje sędzia-LLM.
   Brak testu nie jest brakiem narzędzia, tylko konsekwencją formy odpowiedzi.
5. **Wejście nie istnieje** — produkt nie ma treści ticketu, więc nie ma na czym
   uruchomić żadnej rubryki, choćby spisanej.

## Hypothesis Investigation

| Hipoteza | Dowód | Werdykt |
| --- | --- | --- |
| **D1** Luka dokumentacyjna | Użytkownik podyktował rubrykę w jednej rundzie rozmowy (`dor-notes.md` §4–§5). Wiedza istniała i była gotowa — brakowało tylko zapisu. Prawdziwe, ale niewystarczające: samo spisanie nie tłumaczy #2 ani #3. | **WEAK** |
| **D2** PRD opisał kształt wyjścia, nie przedmiot oceny | `prd.md:169` — całe FR-020 mówi o formie odpowiedzi („5–8 pytań", „Score", „checklist") i o *stylu* pytań, ani słowem o tym, co czyni zadanie gotowym. `roadmap.md:332` powtarza to samo. `shape-notes.md:194` jest identyczne — luka pochodzi z etapu shapingu, nie z PRD. Wszystkie trzy zgłoszone objawy wywodzą się stąd. | **STRONG** |
| **D3** `dor_score` to artefakt F-02 | `schema.ts:815-836` — `refinement_session` ma zero odczytów i zero zapisów w `src/`. Precedens: `daily_recap` z tej samej migracji F-02 został przekształcony dopiero w slice'ie konsumującym (`archive/2026-08-26-daily-recap-email/plan.md:257-280`: `recap_date` **usunięty**, cztery kolumny dodane, „no data is at risk because no data exists"). Użytkownik rozstrzygnął, że punktacja jest „wtórna albo w ogóle niepotrzebna" (`dor-notes.md` §2, §8.1). | **STRONG** |
| **D4** Nietestowalność wynika z formy wyjścia | Gdy użytkownik podał realną formę wyniku — *„Zadanie dotyczy publikacji regulaminu ale brak załącznika"* (`dor-notes.md` §8.1) — osadzenie przestało być cechą stylistyczną do oceny i stało się **wymaganym kształtem zdania**, a wykrycie braku stało się twierdzeniem klasowym, asertowalnym na korpusie. Zapętlenie z `test-plan.md:115` rozpada się bez sędziego-LLM. | **STRONG** |
| **D5** Wejście nie istnieje | `src/lib/jira.ts:845` zamawia dokładnie `summary, status, assignee, created` (+ pole SP). `schema.ts:580-613` — `jira_ticket` trzyma z treści zadania **wyłącznie `summary`**. Z siedmiu pól, których wymaga analiza (§1 notatek), istnieje jedno. Ale: `searchSprintIssues` (`:828`) to generyczne JQL po `/rest/api/3/search/jql` z konfigurowalną listą pól i gotową paginacją, a `listBoards` (`:469`) już gada z `/rest/agile/1.0` (gdzie żyje `/board/{id}/backlog`). Luka jest realna; transport nie jest. | **STRONG** (rozmiar, nie blokada) |

## Narrowing Signals

- **Cel to lista braków, nie liczba.** „Punktacja to albo kwestia wtórna, albo w
  ogóle niepotrzebna. Cel jest taki, aby **wskazać czego brakuje**, a nie
  szacować jakiś parametr oceny." → `dor_score` martwy.
- **Werdykt jest binarny.** Nic nie brakuje → „Spełniony DOR". Brakuje → lista
  wskazówek. → „5–8 pytań" z FR-020 zastąpione przez „tyle, ile ich jest".
- **Wejściem jest przegląd backlogu**, nie jedna wklejona historyjka: „sprint
  sobie trwa, a ja przeglądam zadania w ramach refinementu, przygotowując się
  na kolejny sprint". → inne wejście niż zakłada FR-020.
- **Braki dzielą się na cztery poziomy wykrywalności** (`dor-notes.md` §4): P0
  obecność pola (zwykły `if`), P1 jakość treści (model, samowystarczalnie),
  P2 zobowiązania wynikające z rodzaju pracy (model musi najpierw rozpoznać
  rodzaj), P3 stan projektu poza ticketem. Wartość FR-020 mieszka w P1–P2; P3
  wymaga wejść, których produkt nie ma.
- **Przypowieść o Zenku wnosi dwie rzeczy, których nie ma w PRD**: (A) istotność
  braku jest kontekstowa — mechanizm zgłaszający wszystko zostanie wyłączony;
  (B) zadanie może być **bezsensowne albo niewykonalne**, nie tylko niekompletne
  — trzecia kategoria wyniku, której FR-020 nie przewiduje.
- **Adresat braku odrzucony** (propozycja M7): „Deweloper idzie do product
  ownera i prosi o uzupełnienie."
- **Zmiana standardu opisu na Markdown niepotrzebna** — użytkownik rozważał
  przestawienie zespołu; pola Jiry są zamawiane pojedynczo przez `fields`, więc
  koszt to spłaszczenie ADF→tekst, nie zmiana nawyków zespołu.

## Cross-System Convention

Ten projekt ma ustalony wzorzec dla tabel z F-02, których żaden slice jeszcze
nie dotknął: **konsumujący slice przekształca tabelę**, bo nie ma w niej danych
(`daily_recap` w S-11 — usunięta kolumna, cztery dodane, jedna migracja).
`refinement_session` jest w identycznym położeniu, a rozstrzygnięcia z §8.1
unieważniają co najmniej `dor_score`, semantykę `questions` i zestaw wartości
`refinement_source_type` (`PASTED_TEXT` / `JIRA_TICKET` nie zna partii z
backlogu). Wzorzec obowiązuje — to nie jest wyjątek.

Kultura testowa repo (deterministyczne asercje, brak harnessu komponentowego,
logika wyciągana do czystych `.ts`) też jest tu zgodna: „czy zgłoszono klasę
braku #3 na tickecie o podmianie regulaminu" jest zwykłą asercją. To sędzia-LLM
był ciałem obcym, nie ta funkcjonalność.

## Reframed Problem Statement

> **Faktyczny problem do zaplanowania**: FR-020 wyspecyfikował **kształt
> odpowiedzi** (score, 5–8 pytań, checklista), nigdy nie specyfikując
> **przedmiotu oceny** — i wszystkie trzy zgłoszone wątpliwości są objawami tej
> jednej luki. Brakującym artefaktem, bez którego slice'u nie da się ani
> zaplanować, ani przetestować, jest **taksonomia klas braków DOR wraz z
> korpusem ticketów o znanych brakach** — a nie wiersz w bazie ani wywołanie SDK.

Pierwotne ujęcie („trzy luki w specyfikacji") było trafne co do objawów i
niekompletne co do przyczyny: to jedna luka, która rozgałęzia się na trzy. Gdy
rubryka jest spisana, punktacja znika sama (bo rubryka wskazuje braki, a nie
mierzy stopień), a testowalność pojawia się sama (bo klasa braku jest
asertowalna, a osadzenie w treści staje się wymaganym kształtem zdania, nie
własnością do ocenienia). Rubryka została spisana w tej sesji —
`dor-notes.md` jest tym artefaktem.

**Zmiana głównego ryzyka.** Ryzyko, przed którym ostrzegał PRD („pytania wyjdą
szablonowe i użytkownik je zignoruje"), przestaje być wiodące — taksonomia jest
zbyt konkretna, żeby wyprodukować „czy są kontrole dostępu?". Jego miejsce
zajmuje **nadgorliwość** (Zasada A): mechanizm znajdujący osiem braków na każdym
tickecie umrze tak samo szybko, tylko z przeciwnego powodu. Korpus musi zawierać
zadania kompletne, na których jedynym poprawnym wynikiem jest „Spełniony DOR".

## Rozjazdy z PRD do świadomego zaakceptowania

| FR-020 mówi | Ustalenie użytkownika | konsekwencja |
| --- | --- | --- |
| „DOR Compliance Score" + `dor_score integer` | punktacja wtórna albo zbędna | kolumna do usunięcia |
| „5–8 pytań" | tyle braków, ile ich jest | limit zniesiony |
| „pytania" | stwierdzenia braków, czasem z pytaniem domykającym | inna forma wyjścia |
| „wklejony tekst LUB wybrany ticket" | przegląd **backlogu** przed planowaniem | inne wejście |
| — | werdykt „to nie powinno wejść do sprintu" | nowa kategoria wyniku |

Te rozjazdy wymagają decyzji użytkownika o aktualizacji `prd.md` / `roadmap.md`
— roadmapa jest kanoniczna dla zakresu (`task-tracking.md`), więc zmiana zakresu
zaczyna się tam, nie w planie.

## Confidence

**HIGH** — trzy hipotezy z twardym dowodem (`file:line`), zbieżne; pierwotne
ujęcie potwierdzone co do objawów i pogłębione co do przyczyny; wzorzec repo
(reshape tabeli z F-02 w slice'ie konsumującym) niezależnie potwierdza D3;
sygnały zawężające pochodzą wprost od właściciela domeny, nie z dedukcji.

Jedna niepewność świadomie zostawiona otwarta, oznaczona przez użytkownika jako
odwracalna: **czy analiza jest jednorazowa, czy konwersacyjna** (`dor-notes.md`
§8.4 — „jakiś a'la czatbot? […] najwyżej to zmienimy"). Nie blokuje planowania;
blokuje wyłącznie decyzję o kształcie powierzchni.

## What Changes for /10x-plan

Plan nie jest o wpięciu `@anthropic-ai/sdk`. Jest o **czterech poziomach
wykrywalności braku** (`dor-notes.md` §4) i o tym, gdzie przebiega granica MVP —
z twardym ustaleniem, że P1–P2 są osiągalne dopiero po rozszerzeniu tego, co
`src/lib/jira.ts` pobiera z ticketu, a P3 wymaga wejść, których produkt nie ma.
Plan musi też objąć **korpus ticketów o znanych brakach zawierający przypadki
kompletne**, bo to on, a nie sędzia-LLM, czyni FR-020 falsyfikowalnym; oraz
przekształcenie `refinement_session` wzorem S-11.

## References

- Wiedza dziedzinowa: `context/changes/refinement-helper-ai/dor-notes.md`
- Tożsamość zmiany: `context/changes/refinement-helper-ai/change.md`
- `context/foundation/prd.md:169` (FR-020), `:47` (kryterium sukcesu)
- `context/foundation/roadmap.md:330-343` (S-13)
- `context/foundation/test-plan.md:115` (odłożony sędzia-LLM)
- `src/db/schema.ts:103-107, 580-613, 815-836`
- `src/lib/jira.ts:23, 469, 828, 845`
- `context/archive/2026-08-26-daily-recap-email/plan.md:257-280` (precedens reshape)
- `context/foundation/lessons.md` — „Test the no-configuration path through the
  real resolver" (dotyczy braku `ANTHROPIC_API_KEY`)
- Dochodzenie równoległe: **nie odpalone** — świadoma decyzja użytkownika po
  ocenie, że hipotezy zostały rozstrzygnięte w rozmowie, a dwie kwestie
  faktyczne (pola Jiry, backlog) sprawdzone bezpośrednio.
