# S-19 team-navigation-section — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md` (sekcja **§23**). Odhaczając
cokolwiek tutaj, odhacz też odpowiedni wiersz w `plan.md` `## Progress` —
**plan jest kanoniczny**.

**Brak migracji.** Ten slice nie dotyka bazy — to przeprowadzka tras i
nawigacji. Nie ma żadnego kroku, który trzeba zrobić przed pozostałymi, i nic
tu nie kasuje danych.

**O co chodzi, po ludzku.** Settings miało sześć zakładek odpowiadających na
**dwa różne pytania**: cztery na „skąd SprintFlow bierze dane" i dwie na „kim
jest twój zespół". Ta druga para wyprowadziła się do własnej sekcji **Team** w
górnym menu. Przy okazji rozdzieliły się dwie rzeczy, które dotąd stały na
jednej stronie: **nieobecność** (konkretna osoba, konkretny sprint) i **dzień
wolny całego zespołu** (własność kalendarza, dotyczy każdego sprintu, który go
obejmuje).

**Stare adresy nadal działają** — `/settings/team` i `/settings/absences`
przekierowują. Jeśli wpiszesz je z przyzwyczajenia i wylądujesz gdzie indziej,
**to nie jest błąd**.

**Zastępuje dwa wiersze S-15** — 5.3 i 5.4, odhaczone 2026-08-25, sprawdzały
ścieżkę nawigacyjną, która przestała istnieć. Zostały oznaczone jako
`SUPERSEDED` w `context/archive/2026-08-23-team-management-surface/plan.md`.

**Konto:** wiersze A–D robisz na swoim zwykłym koncie (D potrzebuje aktywnego
sprintu i ludzi w rosterze). Wiersz E wymaga wejścia w tryb demo.

---

## Faza 1

- [ ] **23.A — nawigacja dociera do rosteru** *(podpisuje `1.8`)*

  **Gdzie:** dowolny ekran aplikacji po zalogowaniu.

  **Co zrobić:** popatrz na górne menu. Kliknij **Team**.

  **Co musi być prawdą:** w menu jest **pięć** pozycji w tej kolejności:
  Dashboard, Sprint Detail, **Team**, Settings, Refinement. Kliknięcie **Team**
  ląduje pod adresem `/team/roster` (sprawdź pasek adresu), wyświetla listę
  członków zespołu, a w pasku zakładek pod nagłówkiem **Roster** jest
  wyróżniony jako aktywny.

  **Dlaczego to łapie:** to cały sens slice'a widziany oczami leada — zastępuje
  wiersz S-15 5.3. Jeśli menu prowadzi w puste miejsce albo roster się nie
  renderuje, sekcja istnieje tylko w kodzie. Kolejność też jest celowa: Team to
  **dane o zespole**, więc stoi przy innych ekranach z danymi, przed
  konfiguracją.

- [ ] **23.C — stare adresy przekierowują, Settings ma cztery zakładki** *(podpisuje `1.9`)*

  **Gdzie:** pasek adresu, potem `/settings`.

  **Co zrobić:** wpisz ręcznie `/settings/team` i zatwierdź. Potem wpisz
  `/settings/absences`. Na koniec wejdź na `/settings`.

  **Co musi być prawdą:** pierwszy adres ląduje na `/team/roster`, drugi na
  `/team/absences` — pasek adresu ma **zmienić się sam**. Żaden nie pokazuje
  błędu 404 ani pustej strony. Zakładka **Settings** ma teraz **cztery**
  pozycje: Connections, Daily recap, Anomaly rules, Demo — bez Team i bez
  Absences.

  **Dlaczego to łapie:** przeprowadzka jest zrobiona w połowie, jeśli stare
  adresy przestają działać. Wskazuje na nie mnóstwo rzeczy poza aplikacją:
  zakładki w przeglądarce, starsze wiersze w backlogu, zarchiwizowane
  dokumenty. 404 w takim miejscu czyta się jak zepsuta aplikacja, a nie jak
  przeniesiona strona.

---

## Fazy 1 i 2 (jeden wiersz podpisuje oba)

- [ ] **23.D — 🔴 podział stron nie zerwał drogi zapisu** *(podpisuje `1.10` i `2.5`)*

  **Gdzie:** `/team/absences`, `/team/days-off`, potem `/dashboard`. Potrzebny
  **aktywny sprint** i ludzie w rosterze.

  **Co zrobić:** dwa niezależne zapisy.
  1. Na `/dashboard` znajdź w inboxie anomalię `DEVELOPER_INACTIVE` dla
     konkretnej osoby. Wejdź na `/team/absences` i zapisz jej nieobecność
     obejmującą dzisiaj. Wróć na `/dashboard` i **przeładuj stronę — nie klikaj
     „Sync now"**.
  2. Na `/dashboard` → **Availability** zapisz sobie obecne MD i liczbę dni
     roboczych. Wejdź na `/team/days-off` i dodaj **dzień roboczy (pon–pt)
     leżący wewnątrz aktywnego sprintu**. Wróć na `/dashboard`.

  **Co musi być prawdą:**
  1. anomalia `DEVELOPER_INACTIVE` dla tej osoby **zniknęła** z inboxa, bez
     czekania na cykl crona;
  2. liczba dni roboczych spadła **dokładnie o 1**, a MD o **sumę etatów**
     zespołu.

  **Dlaczego to łapie:** to jedyne realne ryzyko regresji w tym slice'ie. Oba
  edytory stały wcześniej na jednej stronie i dzieliły **jeden** odczyt danych
  sprintu; teraz każdy robi swój własny. Jeśli któryś dostał zły sprint albo
  zgubił ponowne przeliczenie anomalii po zapisie, ekran wygląda normalnie — po
  prostu nic się nie dzieje, a lead uzna, że zapis nie przeszedł, i zapisze
  drugi raz.

- [ ] **23.E — demo pokazuje dane demo na obu stronach** *(podpisuje `1.11` i `2.8`)*

  **Gdzie:** `/settings/demo`, potem `/team/roster` i `/team/days-off`.
  **Wymaga trybu demo.**

  **Co zrobić:** wejdź na `/settings/demo` i załaduj demo. **Bez klikania po
  innych ekranach** przejdź prosto na `/team/roster`, popatrz, potem prosto na
  `/team/days-off`.

  **Co musi być prawdą:** roster pokazuje **sześcioosobowy zespół demo**, nie
  twoich prawdziwych ludzi. Dni wolne pokazują dni wolne **konta demo**, nie
  twoje. Oba **za pierwszym wejściem** — bez odświeżania i bez drugiej
  nawigacji.

  **Dlaczego to łapie:** przy wejściu w demo aplikacja czyści z pamięci
  podręcznej listę adresów, które zależą od tego, czyje dane pokazują. Trasy się
  przeprowadziły, a `/team/days-off` w ogóle wcześniej nie istniała — jeśli
  którejś zabrakło na tej liście, **nie widać żadnego błędu**: strona renderuje
  się poprawnie, tylko z danymi **poprzedniego** konta. To dokładnie ten rodzaj
  awarii, którego nie da się zauważyć bez celowego sprawdzenia, a w demie
  prezentowanym komuś z zewnątrz wygląda jak wyciek cudzych danych.

---

## Faza 2

- [ ] **23.B — aktywna zakładka na wszystkich trzech** *(podpisuje `2.7`)*

  **Gdzie:** `/team/roster`, `/team/absences`, `/team/days-off`.

  **Co zrobić:** dwa przejścia. Najpierw **klikaj** kolejno wszystkie trzy
  zakładki. Potem każdy z tych trzech adresów **wpisz ręcznie w pasek adresu** i
  wejdź na niego bezpośrednio (albo przeładuj `Cmd+R`).

  **Co musi być prawdą:** za każdym razem — i po kliknięciu, i po wejściu z
  paska adresu — dokładnie **jedna** zakładka jest wyróżniona (ciemniejszy
  tekst, podkreślenie) i jest to ta, na której faktycznie jesteś. Nigdy zero,
  nigdy dwie.

  **Dlaczego to łapie:** zastępuje wiersz S-15 5.4, rozszerzony z dwóch zakładek
  na trzy. Wyróżnienie liczy się po **prefiksie adresu**, więc nowa zakładka o
  dłuższej nazwie to dokładnie ten przypadek, w którym taka logika potrafi
  zapalić dwie naraz albo żadnej. Wejście z paska adresu jest osobnym krokiem,
  bo klikanie działa nawet wtedy, gdy stan po odświeżeniu jest zepsuty.

---

## Wiersz nieblokujący

`2.6` (`/team/absences` pokazuje tylko nieobecności i wskazuje na zakładkę Team
days off) zostaje w `plan.md`, ale nie ma go tutaj: 23.B i 23.D i tak przechodzą
przez obie strony, a sam tekst podtytułu niczego nie psuje, jeśli jest zły.
