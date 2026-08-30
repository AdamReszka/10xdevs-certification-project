# S-21 db-pool-teardown — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md` (§17). Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Konto:** wystarczy dowolne konto, na którym potrafisz się zalogować. Żaden
wiersz nie dotyka prawdziwych tokenów GitHuba ani Jiry, nic nie kasuje i nic nie
zapisuje w bazie.

**Co ten slice zmienił, żebyś wiedziała czego szukasz.** Do tej pory jedno
żądanie do aplikacji otwierało do bazy **trzy albo cztery** osobne połączenia
zamiast jednego. Przy kilku równoległych testach Postgres kończył się miejsca i
aplikacja zaczynała się zachowywać dziwnie — ale **nie** pokazywała błędu bazy:
wyrzucała zalogowaną osobę na ekran logowania, jakby sesja wygasła. Poniższe
trzy wiersze sprawdzają dokładnie tę drugą część: że awaria bazy wygląda teraz
jak awaria, a nie jak wylogowanie.

⚠️ **Wiersze 4.6, 4.7 i 4.8 wymagają ZATRZYMANIA lokalnej bazy.** Robisz to
poleceniem `npx supabase stop` w katalogu projektu, a wracasz `npx supabase start`.
Nic się nie kasuje — `stop` wyłącza kontenery, dane zostają. **Po skończeniu
testów uruchom bazę z powrotem**, inaczej nic innego nie zadziała.

---

## Faza 4

- [ ] **4.6 — baza leży, a Ty jesteś zalogowana: widzisz błąd, nie ekran logowania**

  **Gdzie:** `/dashboard`, na koncie, na którym jesteś **już zalogowana**
  (najpierw zaloguj się przy działającej bazie, dopiero potem ją zatrzymaj).

  **Co zrobić:**
  1. Uruchom aplikację (`npm run dev`) i zaloguj się normalnie. Upewnij się, że
     `/dashboard` się otwiera.
  2. W drugim oknie terminala, w katalogu projektu: `npx supabase stop`.
  3. Wróć do przeglądarki i **odśwież** `/dashboard`.

  **Co musi być prawdą:** widzisz kartę z nagłówkiem **„Something went wrong"**,
  zdaniem, że SprintFlow nie mógł wczytać strony, i przyciskiem **„Try again"**.
  Karta mówi wprost **„You are still signed in"**. Adres w pasku przeglądarki
  **nadal jest** `/dashboard` — **nie** przeskoczyłaś na `/login`.

  **Dlaczego to ma znaczenie:** to jest cała diagnoza tego slice'a. Przez
  tygodnie awaria bazy udawała wylogowanie, więc nikt nie szukał problemu z
  bazą — testy wyglądały na losowo pękające, a nie na jeden konkretny błąd.
  Jeśli tu zobaczysz ekran logowania, poprawka nie zadziałała i następna awaria
  znów zostanie źle zdiagnozowana.

- [ ] **4.7 — baza leży, ale `/login` nadal się otwiera**

  **Gdzie:** `/login`, przy **zatrzymanej** bazie (czyli od razu po wierszu 4.6,
  bez uruchamiania Supabase z powrotem).

  **Co zrobić:**
  1. Przy zatrzymanej bazie wejdź ręcznie na `/login`.

  **Co musi być prawdą:** strona logowania **renderuje się normalnie** — widzisz
  pola e-mail i hasło. Nie ma karty „Something went wrong", nie ma pustego
  ekranu, nie ma zapętlonego przekierowania.

  **Dlaczego to ma znaczenie:** ekran logowania musi działać nawet wtedy, gdy
  aplikacja nie potrafi sprawdzić, czy ktoś jest zalogowany — inaczej awaria
  bazy zamyka wszystkich na zewnątrz bez żadnej drogi powrotu. Ta strona celowo
  zachowuje się odwrotnie niż `/dashboard`, i to rozróżnienie łatwo zepsuć jedną
  zmianą.

- [ ] **4.9 — baza działa: niezalogowany nadal ląduje na logowaniu**

  **Gdzie:** `/dashboard`, przy **działającej** bazie (`npx supabase start`),
  w oknie prywatnym / incognito albo po wylogowaniu.

  **Co zrobić:**
  1. Uruchom bazę z powrotem: `npx supabase start`. Poczekaj, aż skończy.
  2. Otwórz okno prywatne i wejdź na `/dashboard`.

  **Co musi być prawdą:** zostajesz przekierowana na `/login` — **tak jak
  zawsze**. Żadnej karty „Something went wrong", żadnego błędu.

  **Dlaczego to ma znaczenie:** poprawka rozdzieliła dwie sytuacje, które
  wcześniej były jedną: „nie ma sesji" i „nie dało się sprawdzić". Wiersze 4.6
  i 4.7 pilnują nowej ścieżki; ten wiersz pilnuje, że stara — zwykłe
  przekierowanie niezalogowanego gościa — **nie została przy okazji zepsuta**.
  Gdyby się zepsuła, każdy niezalogowany odwiedzający zobaczyłby ekran błędu
  zamiast logowania.

---

**Pozostałe wiersze manualne tego slice'a** (fazy 2, 3 i 5 — start serwera po
zmianie, pomiary połączeń, przegląd dokumentów) są w
`context/foundation/manual-test-backlog.md` §17. Nie blokują slice'a: fazy 2 i 3
mają pokrycie w testach automatycznych (`npm test`, `npm run test:e2e` na
równoległych workerach) i w zapisanych pomiarach
(`context/changes/db-pool-teardown/measurements.md`), a faza 5 to przegląd
tekstów, nie klikanie.
