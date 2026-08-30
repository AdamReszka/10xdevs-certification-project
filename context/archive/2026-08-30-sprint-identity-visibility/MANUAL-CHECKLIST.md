# S-25 sprint-identity-visibility — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md` (§18). Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Nic tutaj nie kasuje danych i nic nie zapisuje w bazie.** Wszystkie wiersze to
patrzenie na ekran; jedyne kliknięcia to nawigacja i „Pull from Jira".

**Co ten slice zmienił, żebyś wiedziała czego szukasz.** Zgłosiłaś, że nie da
się odpowiedzieć na pytanie „który to sprint?" — nazwa była tylko na dole
kreatora i w słabo widocznym badge'u w Sprint Detail, a na dashboardzie
„Today" nie było jej wcale. Teraz **każdy** ekran pokazujący dane sprintu ma
jedną linię obok nagłówka: **nazwa + zakres dat**, np. `PT Sprint 1 · 30.08 – 12.09`.
Daty są czytane w **strefie czasowej Twojej Jiry**, żeby dało się je porównać
jeden do jednego z tym, co pokazuje Jira. Tam, gdzie sprintu nie ma, ekran mówi
to wprost (**„Sprint: none active"**) zamiast pisać „the active sprint" o czymś,
czego nie ma.

---

## Faza 3 — dwa dashboardy

- [ ] **3.5 — na „Today" widzisz nazwę sprintu i daty bez otwierania zakładki**

  **Gdzie:** `/dashboard`, na koncie z **prawdziwą** Jirą i trwającym sprintem
  (to konto `demo@sprintflow.test` — to na nim są prawdziwe tokeny).

  **Co zrobić:**
  1. Zaloguj się i wejdź na `/dashboard`.
  2. **Nie klikaj w żadną zakładkę.** Patrz tylko na górę strony, obok napisu
     „Dashboard — Today".
  3. Otwórz w drugiej karcie swoją Jirę i znajdź aktywny sprint na tablicy.

  **Co musi być prawdą:** obok nagłówka „Dashboard — Today" jest pogrubiona
  nazwa sprintu, a zaraz za nią jaśniejszy zakres dat w formacie `DD.MM – DD.MM`.
  Nazwa jest **identyczna** z nazwą sprintu w Jirze, znak w znak. Data początku
  jest **tym samym dniem**, który Jira pokazuje jako start sprintu — nie dniem
  wcześniej.

  **Dlaczego to ma znaczenie:** to jest cały sens tego slice'a. Sama nazwa nie
  wystarcza — dopiero daty pozwalają sprawdzić, że SprintFlow patrzy na ten sam
  sprint co Jira. Dokładnie tego zabrakło, gdy przez kilka dni sync świecił się
  na zielono, a dashboard był pusty, bo aplikacja pilnowała sprintu o numerze,
  którego w tamtej Jirze w ogóle nie było. Jeśli data początku jest o jeden dzień
  wcześniejsza niż w Jirze, to znak, że daty czytają się w złej strefie czasowej
  i cała weryfikacja przestaje działać.

- [ ] **3.6 — przełącznik sprintów w „Sprint Detail" zmienia tożsamość na ekranie**

  **Gdzie:** `/dashboard/sprint-detail`, to samo konto.

  **Co zrobić:**
  1. Wejdź na `/dashboard/sprint-detail`. Zapamiętaj nazwę i daty obok nagłówka.
  2. W prawym górnym rogu tego samego wiersza jest lista rozwijana ze sprintami.
     Wybierz z niej **inny** sprint (zamknięty, czyli nie ten oznaczony jako
     aktywny).
  3. Poczekaj, aż strona się przeładuje.

  **Co musi być prawdą:** nazwa i daty obok nagłówka zmieniły się na te
  wybranego sprintu — **nie** zostały te same co przed przełączeniem. Obok nich
  nadal jest szara plakietka **„Sprint closed"**.

  **Dlaczego to ma znaczenie:** to najłatwiejszy sposób, żeby ekran skłamał —
  podmienić nagłówek, ale zostawić daty poprzedniego sprintu. Wtedy patrzysz na
  liczby jednego sprintu podpisane datami innego i nie masz jak tego zauważyć.
  Plakietka „Sprint closed" musi zostać, bo bez niej nie odróżnisz sprintu
  zamkniętego od trwającego.

- [ ] **3.7 + 4.6 — konto bez aktywnego sprintu mówi to wprost, na wszystkich trzech ekranach**

  **Gdzie:** konto **bez** trwającego sprintu — czyli `adam.reszka85@gmail.com`
  (ma zaseedowane, nieprawdziwe tokeny) albo świeżo założone konto testowe.
  Odwiedzasz kolejno `/dashboard`, `/dashboard/sprint-detail` i `/setup/team`.

  **Co zrobić:**
  1. Zaloguj się na to konto i wejdź na `/dashboard`. Popatrz obok nagłówka.
  2. Przejdź na `/dashboard/sprint-detail`. Popatrz obok nagłówka.
  3. Na `/dashboard` otwórz zakładkę **„Reliability"** i znajdź kafelek
     **„Estimated velocity"**. Przeczytaj cały tekst pod tytułem.
  4. Wejdź na `/setup/team` i popatrz obok tytułu karty „Sprint cadence".
     Spróbuj zmienić którekolwiek pole rytmu sprintu.

  **Co musi być prawdą:** na wszystkich trzech ekranach widzisz napis
  **„Sprint: none active"** — czyli puste miejsce jest opisane, a nie po prostu
  puste. Kafelek „Estimated velocity" **nigdzie** nie zawiera zwrotu
  **„the active sprint"**. Na `/setup/team` pola rytmu sprintu nadal się
  edytują — nie są zablokowane.

  **Dlaczego to ma znaczenie:** brak elementu na ekranie wygląda dokładnie tak
  samo jak element, który się nie wyrenderował z powodu błędu — nie da się tego
  odróżnić. A stary tekst „scaled to what **the active sprint** actually has"
  twierdził, że aktywny sprint istnieje, na koncie, na którym go nie ma. To ten
  sam błąd co wcześniej: niewiadoma podana jako uspokajający ogólnik.

## Faza 4 — krok kadencji w kreatorze

- [ ] **4.5 — kreator nazywa sprint zanim cokolwiek klikniesz**

  **Gdzie:** `/setup/team`, konto z prawdziwą Jirą (`demo@sprintflow.test`).

  **Co zrobić:**
  1. Wejdź na `/setup/team`. **Nie klikaj niczego.** Przewiń do karty
     **„Sprint cadence"** i popatrz na jej nagłówek.
  2. Dopiero teraz kliknij **„Pull from Jira"** i poczekaj, aż przycisk
     przestanie się kręcić.

  **Co musi być prawdą:** już przy pierwszym wejściu, obok tytułu „Sprint
  cadence", jest nazwa sprintu i zakres dat — **te same**, co na `/dashboard`
  w wierszu 3.5. Po kliknięciu „Pull from Jira" nadal tam są i się nie zmieniły
  (chyba że w międzyczasie zmienił się sprint w Jirze). Zdanie pod tytułem nie
  zawiera już nazwy sprintu w cudzysłowie — mówi tylko o nadpisywaniu rytmu.

  **Dlaczego to ma znaczenie:** to ekran, na którym zgłosiłaś problem. Nazwa
  była wpleciona w środek zdania pomocniczego i pojawiała się dopiero po
  zaciągnięciu danych; jeśli teraz jest widoczna tylko po kliknięciu „Pull from
  Jira", to znaczy, że serwer jej nie policzył i pierwsze wejście na ekran nadal
  nie odpowiada na pytanie „z którego sprintu to jest zaciągnięte".

## Faza 5 — historia recapów

- [ ] **5.5 — stary recap nadal się otwiera**

  **Gdzie:** `/settings/recap/history`, dowolne konto, na którym są już zapisane
  recapy **sprzed dzisiaj**.

  **Co zrobić:**
  1. Wejdź na `/settings/recap/history`.
  2. Otwórz **najstarszy** recap z listy (kliknij w jego wiersz).

  **Co musi być prawdą:** strona szczegółów się otwiera i nadal pokazuje nazwę
  sprintu oraz liczbę anomalii — **nie** komunikat, że treści nie da się
  odczytać. Jeśli lista historii jest pusta, ten wiersz jest nie do wykonania —
  napisz „brak recapów", a nie „zaliczone".

  **Dlaczego to ma znaczenie:** ta faza dołożyła dwa nowe pola do zapisanej
  treści recapu. Gdyby przy okazji podbić numer wersji formatu, **każdy**
  wcześniej wysłany recap zostałby uznany za nieczytelny i straciłby nazwę
  sprintu i licznik anomalii w historii. Wersja została celowo niezmieniona —
  ten wiersz sprawdza, że rzeczywiście nic się nie zepsuło.
