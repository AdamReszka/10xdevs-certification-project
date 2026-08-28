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

## Faza 3 — uczciwe sumy sprintu

⚠️ **Wiersz 1.8 z `manual-test-backlog.md`** (wpisanie estymat SP w projekcie FM,
który dziś ma same `story_points = NULL`) **blokuje wiersz 3.8** — bez estymat
relacja capacity↔velocity nie ma czego mierzyć na żywych danych. Wiersze 3.9
i 3.10 są od tego niezależne i można je zrobić od razu. Fazy 1 i 2 są od 1.8
niezależne w całości.

### 3.8 Realny sync zapisuje sumy zgodne z Jirą

- **Gdzie:** Jira projektu FM + `/settings/connections` (konto
  `demo@sprintflow.test`) + baza lokalna.
- **Co zrobić:** wpisz estymaty SP kilku ticketom aktywnego sprintu — **w jednym
  polu** (patrz pułapka w `manual-test-backlog.md` wiersz 1.8: site może mieć
  i „Story Points", i „Story point estimate"). Kliknij **„Sync now"**. Potem:
  `select key, story_points, added_after_sprint_start, current_category from
  jira_ticket where owner_id = '<owner FM>' order by key;` a następnie
  `select committed_sp, completed_sp, committed_frozen_at from sprint where
  owner_id = '<owner FM>';`
- **Co ma być prawdą:** `story_points` **nie są NULL-ami** (jeśli są — trafiłeś
  w złe pole, nie w błąd kodu). `committed_sp` = suma SP ticketów, które
  **nie** mają `added_after_sprint_start = true`. `completed_sp` = suma SP tylko
  tych ticketów, które **weszły do Done w trakcie tego sprintu** — ticket
  przeniesiony z poprzedniego sprintu i już wtedy zamknięty **nie** liczy się
  tutaj, choć w Jirze widnieje jako Done. `committed_frozen_at` ma znacznik
  czasu, nie NULL.
- **Dlaczego to ważne:** to jedyny dowód, że nowa definicja velocity działa na
  żywych danych. Stara reguła (`suma SP tam, gdzie current_category = 'DONE'`)
  była migawką „co jest w Done TERAZ" i była nadpisywana co cykl — także po
  zamknięciu sprintu. Faza 4 zamrozi tę liczbę na zawsze; jeśli jest zła teraz,
  będzie zła w każdym rekordzie pomiaru.

### 3.9 Ticket dorzucony w trakcie sprintu nie podnosi zobowiązania

- **Gdzie:** Jira projektu FM + `/dashboard` → zakładka **Sprint Pulse**
  i panel **Reliability**.
- **Co zrobić:** zapisz obecną wartość „Committed" na panelu Reliability.
  W Jirze **przeciągnij do aktywnego sprintu** ticket z backlogu, który ma
  estymatę. Kliknij „Sync now". Odśwież dashboard.
- **Co ma być prawdą:** linia **zakresu na burndownie rośnie** (nowy ticket
  wszedł do sprintu), ale liczba **„Committed" na Reliability się NIE zmienia**.
  W bazie `committed_frozen_at` ma **tę samą** wartość co przed dorzuceniem.
- **Dlaczego to ważne:** zobowiązanie, które rośnie razem z dorzucanym zakresem,
  nie jest zobowiązaniem — sprawia, że reliability zawsze wygląda dobrze,
  z konstrukcji. Dodatkowo test sprawdza nowy dzielnik: „dodany po starcie"
  liczy się teraz z **changelogu pola Sprint**, a nie z daty utworzenia ticketa,
  więc stary ticket z backlogu wciągnięty dziś jest poprawnie wykluczony
  z zobowiązania (wcześniej liczył się jako zobowiązany).

### 3.10 Estymata 0.5 nie zawiesza już synchronizacji

- **Gdzie:** Jira projektu FM + `/settings/connections` + `/dashboard`.
- **Co zrobić:** ustaw dowolnemu ticketowi aktywnego sprintu estymatę **0.5**.
  Kliknij „Sync now". Poczekaj na wynik, wróć na dashboard.
- **Co ma być prawdą:** status integracji Jira zostaje **OK** (nie ERROR),
  dashboard dalej się aktualizuje, a ten ticket ma w bazie `story_points = 1`
  (`select key, story_points from jira_ticket where key = '<klucz>';`).
- **Dlaczego to ważne:** kolumna `story_points` jest typu `integer`, a zapis
  dzieje się **wewnątrz transakcji** synchronizacji. Jedna wartość ułamkowa
  wywracała **całą** transakcję Jiry (`invalid input syntax for type integer`)
  i stemplowała `sync_state` jako ERROR — co 15 minut, w nieskończoność, bez
  ścieżki samonaprawy i bez śladu, po czym lead mógłby się domyślić przyczyny.
  Zaokrąglenie jest strażnikiem wejścia, nie zmianą modelu: progi z FR-009 są
  ciągiem Fibonacciego (1/2, 3, 5, 8/13, 21), więc pół story pointa nie jest
  wielkością, którą ten produkt zna.

---

## Faza 4 — rekord pomiaru sprintu

⚠️ Wiersz **4.8 jest zależny od czasu** — wymaga realnego przewinięcia sprintu
w Jirze projektu FM. Nie czekaj na niego: 4.9 robisz od razu, a 4.8 odhaczysz
przy najbliższym rollowerze. Sweep jest z założenia odporny na opóźnienie —
zapisze zamknięty sprint nawet kilka cykli po fakcie.

### 4.8 Po realnym rollowerze rekord zgadza się z ostatnim dniem sprintu

- **Gdzie:** `/dashboard` (konto `demo@sprintflow.test`) w OSTATNIM dniu
  aktywnego sprintu, potem baza lokalna po przewinięciu sprintu w Jirze.
- **Co zrobić:** ostatniego dnia sprintu zapisz sobie z zakładki **Availability**
  liczbę MD i liczbę dni roboczych, a z panelu **Reliability** — „Committed"
  i „Delivered". Poczekaj aż sprint się zamknie i ruszy następny (albo zamknij go
  ręcznie w Jirze), kliknij **„Sync now"**, a potem:
  `select jira_sprint_id, sprint_name, working_days, capacity_full_md,
  capacity_adjusted_md, committed_sp, delivered_sp, committed_frozen_at,
  finalized_at from sprint_measurement where owner_id = '<owner FM>' order by
  start_date;`
- **Co ma być prawdą:** dla zamkniętego sprintu istnieje **dokładnie jeden**
  wiersz. `working_days` i `capacity_adjusted_md` **równają się** temu, co
  zapisałeś z dashboardu; `delivered_sp` równa się „Delivered";
  `committed_sp` równa się „Committed". `finalized_at` **ma znacznik czasu**.
  Kliknij „Sync now" jeszcze raz i sprawdź ten sam SELECT — **żadna liczba nie
  drgnęła**. Jeśli `committed_frozen_at` jest NULL, to `finalized_at` też MUSI
  być NULL — to poprawny wynik, nie błąd (patrz „dlaczego").
- **Dlaczego to ważne:** to jedyny dowód, że zamrożenie łapie **ten sam** stan,
  który lead widział na ekranie. Do tej pory nic w systemie nie zapisywało, czym
  był sprint: capacity liczyło się na żywo z rosteru bez wymiaru czasu i znikało,
  a `completed_sp` było migawką „co jest w Done TERAZ", nadpisywaną co 15 minut —
  także po zamknięciu sprintu. Jeśli rekord rozjeżdża się z ekranem, rozjedzie
  się **na zawsze**: fazy 5–7 średnią liczą wyłącznie z tych wierszy i nie ma
  ścieżki przeliczenia wstecz. Osobno: brak `committed_frozen_at` blokuje
  finalizację celowo — sprint, którego zobowiązanie nigdy nie zostało zamrożone,
  to uczciwy „brak danych" (FR-023), a nie rekord z wiarygodnie wyglądającą
  liczbą w środku.

### 4.9 Zmiana projektu Jira i powrót nie kasuje historii

- **Gdzie:** `/settings/connections` → sekcja projektu Jira, konto
  `demo@sprintflow.test`. Potrzebny **drugi** projekt na tym samym site.
- **Co zrobić:** najpierw policz wiersze:
  `select count(*) from sprint_measurement where owner_id = '<owner FM>';`
  Przełącz monitorowany projekt na inny (potwierdź destrukcyjny dialog).
  Sprawdź: `select count(*) from sprint;` **oraz** ten sam count na
  `sprint_measurement`. Przełącz projekt z powrotem na FM, kliknij „Sync now",
  wejdź na `/dashboard`.
- **Co ma być prawdą:** po przełączeniu wiersze w `sprint` dla starego projektu
  **znikają** (kaskada), a liczba wierszy w `sprint_measurement`
  **nie zmienia się ani o jeden**. Po powrocie na FM te same rekordy dalej tam
  są, z tym samym `jira_project_id` (to **jirowe** id projektu, np. `10000`, nie
  wewnętrzny UUID).
- **Dlaczego to ważne:** to jest cały powód, dla którego rekord mieszka we
  **własnej tabeli**, a `jira_project_id` jest zwykłym tekstem **bez klucza
  obcego** — FK przywróciłby dokładnie tę kaskadę, którą rekord ma przeżyć.
  Druga połowa testu jest subtelniejsza: ścieżka ustawień **aktualizuje wiersz
  `jira_project` w miejscu**, więc jego wewnętrzne id jest stabilne przy zmianie
  projektu, choć zespół, który opisuje, już nie. Gdyby rekord był kluczowany po
  tym id, po przełączeniu system uśredniłby dwa różne zespoły w jedną liczbę,
  która nie opisuje nikogo — a to gorzej niż uczciwe „brak danych".
