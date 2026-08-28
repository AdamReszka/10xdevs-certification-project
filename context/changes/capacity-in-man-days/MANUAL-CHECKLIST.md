# MANUAL-CHECKLIST — capacity-in-man-days (S-23)

> Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
> `context/foundation/manual-test-backlog.md`. Numeracja zgadza się z
> `plan.md` → `## Progress`; `plan.md` jest kanoniczny.

## Faza 1 — etat zamiast SP w rosterze

### 1.7 Banner migracji na `/settings/team`

- **Gdzie:** `/settings/team`, konto `demo@sprintflow.test` (to ono ma prawdziwe
  tokeny — patrz `manual-test-backlog.md`).
- **Co zrobić:** wejdź na stronę. Policz członków zespołu. Kliknij
  **„Confirm availability"**. Przeładuj stronę (F5). Wejdź na `/dashboard`
  i wróć na `/settings/team`.
- **Co ma być prawdą:** przed kliknięciem widać banner „Check N people's
  availability", gdzie **N = liczba członków zespołu** (migracja ustawiła
  wszystkim `1.00`). Po kliknięciu banner znika natychmiast. Po przeładowaniu
  **nadal go nie ma**. Po powrocie z dashboardu **nadal go nie ma**.
- **Dlaczego to ważne:** migracja po cichu zrobiła z każdego part-timera pełny
  etat — `sp_capacity` = `8` jest nieodróżnialne jako 8 SP i 8 etatów, więc nie
  dało się tego przenieść. Banner jest **jedynym** sygnałem, że capacity zespołu
  jest zawyżone. Gdyby wracał po przeładowaniu, lead nauczyłby się go ignorować;
  gdyby znikał bez kliknięcia, nikt by się nie dowiedział.

### 1.8 Lista wyboru dostępności

- **Gdzie:** `/settings/team`, kolumna **Availability**.
- **Co zrobić:** rozwiń listę przy dowolnej osobie. Ustaw komuś **Half time
  (0.5)**. Zapisz roster. Przeładuj stronę.
- **Co ma być prawdą:** lista ma **dokładnie cztery** pozycje — Full time (1.0),
  0.75, Half time (0.5), 0.25 — i żadnego pustego / „—". Po przeładowaniu ta
  osoba **nadal ma 0.5**, nie 1.0 i nie puste pole.
- **Dlaczego to ważne:** `0.5` było dotąd niewpisywalne na czterech warstwach
  naraz (kolumna `integer`, walidacja `int()`, `type="number"` bez `step`,
  `Number(v)`). To jest test, że wszystkie cztery faktycznie puściły — a zapis
  przez `numeric` wraca ze sterownika jako **string** `'0.50'`, więc przeładowanie
  jest właściwym sprawdzianem, nie samo kliknięcie.

### 1.9 Capacity w man-dayach na dashboardzie

- **Gdzie:** `/dashboard` → zakładka **Availability**.
- **Co zrobić:** odczytaj liczbę MD i liczbę dni roboczych pod nią. Policz
  ręcznie: `Σ (etat każdej aktywnej osoby) × liczba dni roboczych`. Sprint musi
  mieć **zero zapisanych absencji** — jeśli są, usuń je na czas testu albo
  odejmij je od wyniku ręcznie.
- **Co ma być prawdą:** liczba na ekranie **równa się** ręcznemu rachunkowi,
  jednostka to **MD** (nie SP), a pod spodem stoi „over N working days".
  Zniknął komunikat „No story-point capacity set for anyone".
- **Dlaczego to ważne:** stary reduktor liczył `SP × (dostępne ÷ wszystkie dni)`
  — iloraz **skracał wymiar dnia**, więc liczba dni roboczych nie wpływała na
  wynik i błędny dzielnik był niewidoczny. Teraz dni są mnożnikiem, więc ten sam
  zespół w krótszym sprincie MUSI dać mniejsze capacity. Jeśli liczba się nie
  zgadza, mnożnik jest zły — a on skaluje wszystko, co zbuduje faza 4.

---

## Faza 2 — dni wolne całego zespołu

### 2.7 Dzień wolny obniża capacity i liczbę dni roboczych

- **Gdzie:** `/settings/absences` → sekcja **Team days off**, potem
  `/dashboard` → zakładka **Availability**. Konto `demo@sprintflow.test`.
- **Co zrobić:** najpierw na dashboardzie **zapisz** obecną liczbę MD i liczbę
  dni roboczych („over N working days"). Wróć na `/settings/absences`, kliknij
  **„Add a day off"**, wybierz w kalendarzu dowolny **dzień roboczy (pon–pt)
  leżący WEWNĄTRZ aktywnego sprintu**, wpisz etykietę, zapisz. Wróć na
  `/dashboard` → **Availability**.
- **Co ma być prawdą:** liczba dni roboczych spadła **dokładnie o 1**, pod nią
  pojawiła się linia „− 1 team day off already subtracted", a liczba MD spadła
  o **sumę etatów** (zespół sześciu pełnych etatów → −6 MD; jeśli ktoś ma 0.5,
  to −5.5). Jeśli wybierzesz sobotę/niedzielę, przy wierszu w tabeli pojawi się
  plakietka **„Not a working day anyway"** i **żadna z liczb się nie zmieni** —
  to też jest poprawny wynik, nie błąd.
- **Dlaczego to ważne:** to jedyny dowód, że kalendarz dni wolnych faktycznie
  wchodzi do **mnożnika** capacity, a nie tylko zapisuje się do bazy. Do fazy 1
  liczba dni roboczych była wyłącznie dzielnikiem i się skracała — teraz skaluje
  wszystko, co zbuduje faza 4 (rekord pomiaru sprintu). Jeśli MD nie drgnie,
  zamrożone rekordy będą fałszywe na zawsze.

### 2.8 Ten sam dzień wolny zatrzymuje zegar starzenia ticketa

- **Gdzie:** Jira projektu monitorowanego + `/dashboard` → **Anomaly Inbox**.
- **Co zrobić:** znajdź (albo ustaw) ticket z estymatą **21 SP** w statusie
  **In Progress**, który stoi bez ruchu od **ośmiu dni roboczych** — czyli
  właśnie zaczyna być flagowany jako `TICKET_STATUS_AGING`. Potwierdź, że jest
  w inboxie. Teraz dodaj **dzień wolny w środku tego okna** (jeden z tych ośmiu
  dni roboczych) i przeładuj dashboard.
- **Co ma być prawdą:** anomalia `TICKET_STATUS_AGING` dla tego ticketa
  **znika** z inboxu bez czekania na cykl crona — zapis dnia wolnego sam
  odpala ponowną detekcję.
- **Dlaczego to ważne:** ⚠️ **Uwaga na zakres — działa to TYLKO dla kubełka
  21 SP.** To jedyny budżet w FR-009 wyrażony w **dniach roboczych**
  (`8_WORKING_DAYS`); pozostałe (1/2 SP = 24h, 3 SP = 48h, 5 SP = 72h,
  8/13 SP = 5 dni jako godziny) liczą **czas zegarowy**, a święto nie zatrzymuje
  zegara. Ticket 3-SP **nadal się zestarzeje** przez święto i to jest zgodne
  z planem (`plan.md` faza 2 §3 wskazuje jedno miejsce:
  `ticket-status-aging.ts:64`). Gdybyś testował na 3 SP, zobaczysz „brak
  reakcji" i uznasz to za błąd — a to nie jest błąd.

### 2.9 Usunięcie dnia wolnego przywraca obie liczby

- **Gdzie:** `/settings/absences` → **Team days off** → kosz przy wierszu.
- **Co zrobić:** usuń dzień dodany w 2.7. Potwierdź w dialogu. Wróć na
  `/dashboard` → **Availability**.
- **Co ma być prawdą:** dialog **nazywa konkretną datę i etykietę**, którą
  kasuje (nie „this item"). Po usunięciu liczba dni roboczych i liczba MD
  wracają **dokładnie** do wartości zapisanych na początku 2.7, a linia
  „− N team days off" znika.
- **Dlaczego to ważne:** kalendarz dni wolnych jest **wspólnym wejściem**
  capacity i dwóch reguł anomalii. Gdyby usunięcie nie cofało wszystkiego,
  oznaczałoby to, że któryś z pięciu punktów szwu trzyma własną kopię stanu —
  a dwa liczniki, które się nie zgadzają, to awaria, którą
  `context/foundation/lessons.md` już raz zapisało.

---

## Uwaga do fazy 3 (jeszcze nie teraz)

**Wiersz 1.8 z `manual-test-backlog.md`** (wpisanie estymat SP w projekcie FM,
który dziś ma same `story_points = NULL`) **blokuje weryfikację manualną fazy 3**
— bez estymat relacja capacity↔velocity nie ma czego mierzyć na żywych danych.
Fazy 1 i 2 są od tego niezależne.
