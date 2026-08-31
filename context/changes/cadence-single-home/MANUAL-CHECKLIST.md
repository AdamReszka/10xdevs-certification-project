# S-32 cadence-single-home — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md` (§27). Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Wiersz 1 dotyka produkcyjnej bazy.** W przeciwieństwie do S-30 **nie blokuje**
wierszy 2–3: to migracja **kasująca** kolumny, a kod, który do nich pisał, znika
w tym samym PR. Kod, który dojedzie na produkcję przed migracją, działa dalej
poprawnie — `working_days` było nullowalne, a `cadence_overridden` ma
`DEFAULT false NOT NULL`, więc insert, który przestaje je podawać, przechodzi.
Wiersz 1 jest tu dlatego, że migracja bez nazwanej trasy na produkcję to migracja,
której nikt nigdy nie zastosuje — nie dlatego, że coś się pali.

**Konto:** wiersz 2 wymaga **prawdziwego** konta z podłączoną Jirą i aktywnym
sprintem. Wiersz 3 działa na koncie demo. Żaden z nich niczego nie kasuje
bezpowrotnie — wiersz 2 zmienia rytm sprintu, który da się ustawić z powrotem tym
samym ekranem.

---

## Faza 2 — migracja produkcyjna

- [ ] **1 — `0024` trafia na produkcję przy najbliższym zwyczajnym przebiegu**
      *(faza 2, wiersz spoza `## Progress` — wymóg `lessons.md`)*

  **Gdzie:** produkcyjna baza Supabase — **nie** lokalna (lokalnie migracja jest
  już zastosowana, `npm run db:migrate`, 2026-08-31). `drizzle-kit` nie dosięgnie
  produkcyjnego hosta z tego Maca (host jest IPv6-only), więc trasa jest ta sama
  co dla `0021`, `0022` i `0023`: albo pooler + `DATABASE_URL_OVERRIDE`, albo
  Supabase MCP `apply_migration` z ręcznie dopisanym wpisem bookkeepingowym w
  `drizzle.__drizzle_migrations`.

  **Co zrobić:**
  1. Zastosuj `src/db/migrations/0024_watery_rocket_racer.sql` (dwa
     `ALTER TABLE "sprint" DROP COLUMN`, nic więcej).
  2. Dopisz wpis w `drizzle.__drizzle_migrations` (idx 24), żeby kolejny
     `db:migrate` nie próbował zastosować `0024` po raz drugi.
  3. Odczytaj `select column_name from information_schema.columns where
     table_name = 'sprint';`.

  **Co musi być prawdą:** na liście kolumn **nie ma** ani `working_days`, ani
  `cadence_overridden`; **są** `length_days` i `start_day` (te zostają — to
  pamięć podręczna wyliczona z dat Jiry, którą resolver nadal czyta). Wpis w
  `drizzle.__drizzle_migrations` istnieje.

  **Dlaczego to ma znaczenie:** deploy na Cloudflare wysyła **kod, nie migracje**
  (`lessons.md`: „a deploy that ships code but not migrations breaks silently").
  Tu kierunek zagrożenia jest odwrotny niż zwykle i łagodniejszy — nie zastosowana
  migracja **niczego nie psuje**, zostawia tylko dwie martwe kolumny, do których
  nic już nie pisze ani nie czyta. Ryzykiem jest więc nie awaria, tylko cicha
  rozjeżdżalność schematu z kodem, po której następna migracja generowana z
  `schema.ts` zaczyna opisywać bazę, której nie ma. „Bez migracji produkcyjnej"
  nie jest trasą — dlatego ten wiersz istnieje.

---

## Faza 2 — kadencja czyta się z jedynego już miejsca

- [ ] **2 — Mon–Thu zapisuje się, przeżywa przeładowanie i czyta jako ręcznie
      ustawione TYLKO dla dni roboczych** *(faza 2, zamyka `2.8`)*

  **Gdzie:** `/team/cadence`, zalogowane **prawdziwe** konto z podłączoną Jirą i
  aktywnym sprintem (lokalnie: to konto, które ma prawdziwe tokeny — rozpoznaj je
  po ostatnich czterech znakach tokenu, nie po nazwie).

  **Co zrobić:**
  1. Wejdź na `/team/cadence`.
  2. W „Working days" odznacz **Friday**, tak by zostało Mon–Tue–Wed–Thu.
     **Nie ruszaj** pól „Sprint length" ani „Start day".
  3. Zapisz.
  4. Odśwież stronę (F5).

  **Co musi być prawdą:** po odświeżeniu zaznaczone są dokładnie Mon, Tue, Wed,
  Thu. Baner/opis na górze ekranu mówi, że **dni robocze** zostały ustawione
  ręcznie, a **długość sprintu i dzień startu nadal podążają za Jirą** — nie
  „wszystko ustawione ręcznie" i nie „wszystko podąża za Jirą".

  **Dlaczego to ma znaczenie:** ten slice usunął z bazy drugą kopię wzorca dni
  roboczych (`sprint.working_days`) i pojedynczą flagę „lead coś nadpisał"
  (`sprint.cadence_overridden`). Jeżeli którakolwiek ścieżka — zapis albo
  odczyt — po cichu opierała się na usuniętej kolumnie, objawi się to dokładnie
  tutaj: albo Mon–Thu nie przeżyje przeładowania, albo ekran zacznie twierdzić, że
  lead nadpisał wszystkie trzy pola. To także jedyny stan, którego stara,
  jednobooleanowa reprezentacja **nie umiała wyrazić** (FR-007), więc ten wiersz
  jest zarazem dowodem, że nowy model działa.

- [ ] **3 — demo ładuje się i dashboard renderuje sprint z anomaliami**
      *(faza 2, zamyka `2.9`)*

  **Gdzie:** `/settings/demo`, a potem `/dashboard`.

  **Co zrobić:**
  1. Wejdź na `/settings/demo` i kliknij wczytanie danych demo (jeśli demo już
     jest wczytane — najpierw „Reset", potem wczytaj ponownie).
  2. Przejdź na `/dashboard`.

  **Co musi być prawdą:** strona `/dashboard` renderuje się bez błędu, widać
  sprint demo (nazwa, burndown/Sprint Pulse) oraz **niepustą** skrzynkę anomalii.
  Żadnego białego ekranu ani komunikatu o błędzie serwera.

  **Dlaczego to ma znaczenie:** fikstura demo wstawia wiersz `sprint` w całości,
  jednym insertem. Gdyby jej literał rozjechał się z kształtem tabeli po usunięciu
  dwóch kolumn, wczytanie demo wywaliłoby się na wstawianiu — a demo jest ścieżką,
  którą nowy odwiedzający ogląda produkt (US-02), więc jej awaria nie ma żadnej
  obejścia. Dodatkowo dni robocze do wyliczania wieku anomalii biorą się teraz ze
  stałej `DEFAULT_CADENCE`, a nie z wiersza fikstury: niepusta skrzynka anomalii
  jest dowodem, że ta podmiana nie zmieniła wyniku.
