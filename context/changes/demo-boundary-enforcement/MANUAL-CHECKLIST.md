# S-27 demo-boundary-enforcement — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md`. Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Konto:** wiersz 1.5 wymaga konta z **prawdziwymi** credentialami GitHuba i
Jiry. Na lokalnej bazie to `demo@sprintflow.test` — nazwy kont są mylące, patrz
`manual-test-backlog.md` §5. Identyfikuj po `token_last4`, nigdy po nazwie.
Wiersze 2.5, 2.6 i 3.4 najlepiej robić na **świeżym koncie bez integracji** —
to jest sytuacja, w której odwiedzający naprawdę ląduje w demie.

⚠️ **Nie odpalaj `db:seed:demo` na koncie z prawdziwymi tokenami** — seed je
kasuje.

⚠️ **Wiersz 4.4 kończy się na „Anuluj".** Potwierdzenie kasuje cały świat demo
(profil demo i wszystko pod nim). To jest odwracalne tylko przez ponowne
wczytanie demo od zera — stracisz każdą zmianę zrobioną wewnątrz dema.

---

## Faza 1

- [ ] **1.5 — w demie żadna droga nie prowadzi do formularza tokena, a prawdziwy
  token się nie zmienia** *(faza 1)*

  **Gdzie:** konto z **prawdziwie podłączonym** GitHubem i Jirą, przełączone w
  tryb demo (`/settings/demo` → „Wróć do demo" albo „Zobacz demo").

  **Co zrobić:**
  1. Wejdź na `/settings/connections` i **zapisz sobie cztery ostatnie cyfry**
     tokena GitHuba (pole „Token", `••••XXXX`) oraz adres przestrzeni Jiry.
  2. Wpisz w pasek adresu `/setup/github`. Zobacz, gdzie wylądujesz.
  3. To samo z `/setup/jira`.
  4. To samo z `/settings/connections/github`.
  5. Wróć na `/settings/connections` i porównaj cztery cyfry z krokiem 1.

  **Co musi być prawdą:** w krokach 2–4 **ani razu nie zobaczysz pola na token**
  — za każdym razem ląduje się z powrotem na stronie nadrzędnej (`/setup` albo
  `/settings/connections`), a górny pasek dalej mówi „Jesteś w trybie
  demonstracyjnym". W kroku 5 cztery cyfry tokena i adres Jiry są **identyczne**
  jak w kroku 1.

  **Dlaczego to ma znaczenie:** to jest cały sens tego slice'a. Do tej pory lider
  oglądający demo mógł w trzech kliknięciach nadpisać własny, prawdziwy token
  GitHuba lub Jiry — a przy Jirze zmiana projektu kasuje kaskadowo sprinty,
  zadania i historię statusów prawdziwego konta.

## Faza 2

- [ ] **2.5 — wklejony adres nie omija blokady** *(faza 2)*

  **Gdzie:** dowolne konto w trybie demo.

  **Co zrobić:**
  1. Będąc w demie, wpisz w pasek adresu `/settings/connections/github`
     i zatwierdź.
  2. Zobacz, na czym wylądowałaś/eś.

  **Co musi być prawdą:** adres w pasku zmienia się na `/settings/connections`,
  a na ekranie są **karty integracji, nie formularz**. Nie ma białego ekranu ani
  komunikatu o błędzie — to ma wyglądać jak zwykłe wejście na Connections.

  **Dlaczego to ma znaczenie:** wyszarzony przycisk to tylko uprzejmość. Jeżeli
  wpisany ręcznie adres dalej otwiera formularz, blokada nie istnieje — a to
  najkrótsza droga do nadpisania prawdziwego tokena z ekranu dema.

- [ ] **2.6 — z dema da się wrócić do konfiguracji** *(faza 2)*

  **Gdzie:** **świeże konto bez żadnych integracji**, które weszło w demo
  przyciskiem „Zobacz demo" na `/setup`.

  **Co zrobić:**
  1. Będąc w demie, wejdź na `/setup` (przycisk Wstecz w przeglądarce albo
     wpisany adres).
  2. Kliknij przycisk na **lewej** karcie — „Podłącz GitHuba".
  3. Zobacz, gdzie wylądujesz i czy górny pasek dema dalej tam jest.

  **Co musi być prawdą:** lądujesz na **kroku kreatora z polem na token**
  (`/setup/github`), a **paska „Jesteś w trybie demonstracyjnym" już nie ma** —
  wyjście z dema wydarzyło się po drodze, samo. Nie wolno wrócić na tę samą
  stronę `/setup`, na której właśnie byłaś/eś.

  **Dlaczego to ma znaczenie:** blokady z fazy 2 zamykają kreator przed demem, a
  ta karta jest jedyną drogą DO kreatora dla kogoś, kto zaczął od dema. Jeśli
  przycisk odbija z powrotem na `/setup`, odwiedzający jest zamknięty w demie bez
  żadnego komunikatu — dokładnie ten scenariusz, przed którym PRD (FR-008)
  ostrzega.

## Faza 3

- [ ] **3.4 — wejście w demo po raz drugi go nie kasuje** *(faza 3)*

  **Gdzie:** konto ze świeżo wczytanym demem.

  **Co zrobić:**
  1. Będąc w demie, wejdź na `/settings/team` i **zmień imię jednej osoby** w
     zespole demo na coś rozpoznawalnego (np. „TEST TEST"). Zapisz.
  2. Zapamiętaj datę z paska dema u góry („stan na …").
  3. Wejdź na `/setup`.
  4. Kliknij **„Zobacz demo"** na prawej karcie.
  5. Wejdź ponownie na `/settings/team`.

  **Co musi być prawdą:** w kroku 5 zmienione imię **dalej tam jest**, a pasek
  dema pokazuje **tę samą datę** co w kroku 2.

  **Dlaczego to ma znaczenie:** dziś ten przycisk buduje świat demo od zera za
  każdym naciśnięciem — wejście w demo drugi raz po cichu kasuje wszystko, co
  odwiedzający w nim poprzestawiał, i przesuwa zamrożoną datę. To utrata danych
  bez ostrzeżenia, wywołana przyciskiem, który brzmi jak „pokaż".

## Faza 4

- [ ] **4.4 — „Usuń dane demo" pyta, a Anuluj niczego nie kasuje** *(faza 4)*

  **Gdzie:** `/settings/demo`, konto z wczytanym demem.

  **Co zrobić:**
  1. Wejdź na `/settings/demo`.
  2. Kliknij **„Usuń dane demo"**.
  3. Przeczytaj treść okna, które się pojawi.
  4. Kliknij **Anuluj / Cancel**.
  5. Wejdź na `/dashboard`.

  **Co musi być prawdą:** po kroku 2 **nic się nie skasowało** — pojawiło się
  okno, które mówi osobno, co **znika** (cały świat demo: zespół, sprint,
  zadania, anomalie) i co **zostaje** (prawdziwe konto, jego integracje i tokeny),
  oraz że demo można wczytać ponownie. Po kroku 4 okno znika, a w kroku 5 dane
  demo są nadal na miejscu.

  **Dlaczego to ma znaczenie:** ten przycisk kasuje profil demo i kaskadowo 25
  powiązanych tabel, a stoi **obok** „Wyjdź z demo", które nie kasuje nic. Dziś
  odpala się z jednego kliknięcia, bez pytania — okno jest też tym, co odróżnia
  te dwa przyciski od siebie.
