# S-29 post-setup-cadence-surface — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md` (§25). Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Wiersz 1 dotyka produkcyjnej bazy** i musi zostać wykonany **przed
wszystkimi pozostałymi**: reszta sprawdza zachowanie, które istnieje dopiero po
tej migracji. Pozostałe wiersze niczego nie kasują — zmieniają rytm sprintu,
który można ustawić z powrotem tym samym ekranem.

**Konto:** wiersze 2–4 wymagają **prawdziwego** konta z podłączoną Jirą.
Wiersz 5 wymaga tego samego konta z **załadowanym demo**.

---

## Faza 2 — migracja produkcyjna

- [ ] **1 — `0022` trafia na produkcję, zanim ktokolwiek dotknie reszty listy**
      *(faza 2, zamyka `2.4`)*

  **Gdzie:** produkcyjna baza Supabase — **nie** lokalna. `drizzle-kit` nie
  dosięgnie tego hosta z tego Maca (host jest IPv6-only), więc trasa jest ta
  sama co dla `0021`: Supabase MCP `apply_migration`, a wpis w
  `drizzle.__drizzle_migrations` dopisywany ręcznie.

  **Co zrobić:** zastosuj `src/db/migrations/0022_unfreeze_cadence_override.sql`
  na produkcji, dopisz wpis bookkeepingowy, a potem odczytaj kolumnę
  `cadence_overridden` z tabeli `sprint`.

  **Co musi być prawdą:** **każdy** wiersz `sprint` ma `cadence_overridden = f`
  — łącznie z jedynym prawdziwym kontem onboardowanym, które przed migracją
  miało `t`. Wpis w `drizzle.__drizzle_migrations` istnieje, więc kolejny
  `db:migrate` nie spróbuje zastosować `0022` po raz drugi.

  **Dlaczego to ma znaczenie:** to jest jedyny krok tego slice'u, którego kod
  nie zrobi sam. Deploy na Cloudflare wysyła **kod, nie migracje**
  (`lessons.md`: „a deploy that ships code but not migrations breaks silently"),
  a bez tego wiersza konto, które jedynie ukończyło kreator, zostaje odcięte od
  auto-pullu FR-007 na zawsze — dokładnie ta wada, którą slice zamyka.
  **Uwaga na oczekiwanie:** `start_day` **nie musi** się zmienić. Jest wyliczany
  z daty startu sprintu w Jirze, więc sprint faktycznie wystartowany w piątek
  dalej da `FRI`. Ten wiersz sprawdza, że flaga zeszła — nie że jakaś wartość
  podskoczyła.

---

## Faza 1 — kreator przestaje zamrażać konto

- [ ] **2 — ukończenie kreatora BEZ edycji zostawia auto-pull włączony**
      *(faza 1, zamyka `1.8`)*

  **Gdzie:** świeże konto przechodzące kreator do końca, `/setup/team`.

  **Co zrobić:** przejdź kreator do ostatniego kroku. Na karcie **Sprint
  cadence** **nie zmieniaj niczego** — nie ruszaj długości, dnia startu ani dni
  roboczych. Kliknij **Save & finish setup**. Wylądujesz na `/dashboard`.
  Potem odczytaj z bazy wiersz `sprint` tego konta.

  **Co musi być prawdą:** kreator kończy się na `/dashboard`, wiersz `sprint`
  ma zapisane te same wartości, które widziałeś na ekranie, **a
  `cadence_overridden` jest `f`**. Jeśli zmienisz cokolwiek przed zapisem i
  powtórzysz próbę na innym koncie — wtedy i tylko wtedy ma być `t`.

  **Dlaczego to ma znaczenie:** to jest sedno całego slice'u. Dotąd *ukończenie
  kreatora* było zapisywane jako *świadome nadpisanie rytmu*, więc każde konto,
  które przeszło setup, było na zawsze odcięte od auto-pullu FR-007 — z
  wartościami z jednej minuty, w której akurat kliknęło Save. Jeśli tu wychodzi
  `t` bez żadnej edycji, wada wróciła i migracja `0022` niczego nie załatwia.

## Faza 4 — nowy ekran

- [ ] **3 — zapis MIĘDZY sprintami naprawdę zapisuje** *(faza 4, zamyka `4.8`)*

  **Gdzie:** `/team/cadence`, prawdziwe konto, którego zespół jest **między
  sprintami** (w Jirze nie ma aktywnego sprintu — na ekranie zobaczysz baner
  „Your team is between sprints").

  **Co zrobić:** zmień **długość sprintu** na inną liczbę, kliknij **Save
  cadence**, a potem **przeładuj stronę** (F5).

  **Co musi być prawdą:** po zapisie widzisz potwierdzenie, a **po
  przeładowaniu w polu stoi nowa wartość**. Nie stara.

  **Dlaczego to ma znaczenie:** to jest dokładnie ta ścieżka, która wcześniej
  **mówiła „zapisano" i nie zapisywała nic** — zapis celował w sprint `ACTIVE`,
  a formularz czytał z zamkniętego. Między sprintami to jest ten moment, w
  którym lead najczęściej poprawia rytm, więc cicha porażka trafiała w
  najgorszą możliwą chwilę. Potwierdzenie bez przeładowania nic tu nie dowodzi.

- [ ] **4 — ekran jest osiągalny, a dni robocze naprawdę ruszają liczby**
      *(faza 4, zamyka `4.6` i `4.7`)*

  **Gdzie:** `/team` → zakładka **Sprint cadence**. Zanim zaczniesz, zapisz
  sobie liczbę **capacity (MD)** z `/dashboard/sprint-detail`.

  **Co zrobić:** wejdź na zakładkę (ma być czwarta, po **Team days off**).
  Sprawdź, że pola są wypełnione tym, co konto naprawdę ma. Odznacz **Fri**,
  zapisz, przeładuj — a potem wróć na `/dashboard/sprint-detail`.

  **Co musi być prawdą:** zakładka istnieje i klika się z paska; po
  przeładowaniu **Fri** dalej jest odznaczony; **capacity w man-days spadło**.
  Pod polem **Working days** stoi zdanie mówiące, że to ustawienie SprintFlow,
  a nie wartość z Jiry.

  **Dlaczego to ma znaczenie:** cała obietnica FR-007 („lead może nadpisać
  rytm") była dotąd spełniona wyłącznie wewnątrz kreatora, do którego
  onboardowany lead nie ma drogi powrotnej. A od S-28 `working_days` nie jest
  już tylko mnożnikiem capacity — decyduje, **kiedy odpala pięć reguł
  anomalii**. Jeśli capacity nie drgnęło, ekran zapisuje w miejsce, którego
  reszta aplikacji nie czyta.

- [ ] **5 — „Restore Jira's values" oddaje rytm Jirze** *(faza 4, zamyka `4.9`)*

  **Gdzie:** `/team/cadence`, prawdziwe konto z **aktywnym** sprintem w Jirze.

  **Co zrobić:** najpierw zmień długość sprintu na oczywiście złą wartość (np.
  `3`) i zapisz — baner ma powiedzieć, że ustawiłeś rytm ręcznie. Potem kliknij
  **Restore Jira's values** i potwierdź w okienku.

  **Co musi być prawdą:** długość i dzień startu wracają do tego, co wynika z
  dat sprintu w Jirze, komunikat mówi, że auto-pull jest z powrotem włączony, a
  baner „You set this cadence by hand" **znika**. Dni robocze zostają
  nietknięte — Jira ich nie ma.

  **Dlaczego to ma znaczenie:** bez tego nadpisanie jest jednokierunkowe: lead,
  który raz kliknął zły rytm, nie ma jak wrócić do wartości z Jiry inaczej niż
  zgadując je ręcznie. To także jedyny wiersz, który sprawdza kolejność operacji
  — gdyby flaga była czyszczona osobnym zapisem przed pobraniem, nieudane
  połączenie z Jirą zostawiłoby konto po cichu na auto-pullu.
