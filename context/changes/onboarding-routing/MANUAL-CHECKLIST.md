# S-22 Próg kreatora (`onboarding-routing`) — manual checklist (owner side)

> Cztery pozycje. Wszystko poza nimi jest zielone automatycznie i **nie jest tu
> powtarzane**: 1057 testów jednostkowych, 335 integracyjnych, 14 testów
> Playwrighta (w tym nowy `e2e/setup-doorstep.spec.ts`), `typecheck`, `lint`.
> Reszta wierszy — te, które nie blokują slice'a — siedzi w
> `context/foundation/manual-test-backlog.md` §15.

**Jak to się ma do `plan.md` `## Progress`** (który zostaje kanoniczny): każdy
wiersz niesie numer fazy i numer wiersza z `## Progress`. Odhacz go tam, kiedy
przejdzie.

**Dlaczego tylko cztery.** Ta zmiana dodaje **bramkę** — kod, który potrafi
KOGOŚ NIE WPUŚCIĆ. Trzy z czterech wierszy sprawdzają nie to, że bramka działa,
tylko że nie zamyka się na kimś, kto ma prawo wejść: na skonfigurowanym koncie,
na leadzie rotującym PAT-a w Ustawieniach i na kimś, kto wszedł drzwiami demo.
To są jedyne ścieżki, na których defekt oznacza „aplikacja jest nieosiągalna",
a nie „coś wygląda nie tak".

> **Na jakich kontach:** wiersz **A** wymaga **świeżego konta założonego przez
> UI** (rejestracja z nowym adresem — nie kasuj istniejącego). Wiersze **B** i
> **C** wykonaj na koncie z **prawdziwymi credentialami** (tym, na którym pulpit
> pokazuje realne dane z Jiry i GitHuba). Wiersz **D** zaczyna się na tym samym
> świeżym koncie co **A**, więc zrób A i D jednym ciągiem.

---

## A. Świeże konto ląduje na progu, a nie na pulpicie zer — faza 3 (`3.6`)

**Gdzie:** `/signup`, na czystej przeglądarce (okno prywatne, żeby nie wejść na
istniejącą sesję).

**Co zrobić:**
1. Zarejestruj nowe konto na adres, którego jeszcze nie ma (np.
   `prog-<dzisiejsza-data>@example.test`), hasło dowolne poprawne.
2. Poczekaj, aż przeglądarka sama przejdzie dalej — nie klikaj nic po drodze.
3. Kiedy już wylądujesz, **wpisz ręcznie w pasku adresu** `/dashboard` i
   zatwierdź.

**Co musi być prawdą:**
- Po rejestracji adres w pasku to `/setup` — **nie** `/dashboard`.
- Na ekranie są **dokładnie dwa** przyciski wyboru drogi: jeden prowadzący do
  konfiguracji, drugi opisany „Zobacz demo".
- U góry widać „Krok 1 z 4".
- **Nie ma górnej nawigacji** (Dashboard / Sprint Detail / Refinement /
  Settings) — z tego ekranu nie da się wyjść bokiem.
- Po ręcznym wpisaniu `/dashboard` przeglądarka **wraca na `/setup`**, a nie
  pokazuje pulpitu z samymi zerami.

*Dlaczego to łapie:* to jest cała teza tej zmiany. Jeśli krok 3 pokaże pulpit,
bramka nie działa i pierwsze wrażenie z produktu to tabela zer; jeśli nawigacja
jest widoczna, próg da się ominąć jednym kliknięciem i przestaje być progiem.

---

## B. Skonfigurowane konto wchodzi na pulpit BEZ objazdu — faza 3 (`3.7`)

**Gdzie:** `/login`, konto z prawdziwymi credentialami.

**Co zrobić:**
1. Wyloguj się (menu w prawym górnym rogu).
2. Zaloguj się na konto z prawdziwymi credentialami.
3. Nie klikaj nic — popatrz na pasek adresu.
4. Wpisz ręcznie `/setup`.

**Co musi być prawdą:**
- Po zalogowaniu adres to `/dashboard` i widać dane zespołu — **ani na moment**
  nie przewija się przez `/setup`.
- Po ręcznym wejściu na `/setup` widać próg z drzwiami, a przycisk konfiguracji
  prowadzi do kroku, którego naprawdę brakuje (na w pełni skonfigurowanym koncie
  próg wolno pokazać, ale **nic tam nie zmieniaj** — to tylko podgląd).

*Dlaczego to łapie:* bramka czyta sześć warunków z bazy. Jeśli którykolwiek jest
źle odpytany, konto, które przeszło cały kreator, zostaje **wyrzucone z powrotem
do kreatora** — czyli ktoś z działającą integracją traci dostęp do swojego
pulpitu.

---

## C. Rotacja PAT-a w Ustawieniach NIE wyrzuca z Ustawień — faza 3 (`3.8`)

**Gdzie:** `/settings/connections`, konto z prawdziwymi credentialami.

⚠️ **Ten wiersz odłącza prawdziwą integrację i zaraz ją podłącza z powrotem.**
Zanim zaczniesz, miej pod ręką ten sam PAT GitHuba, którego użyjesz do
ponownego podłączenia — bez niego konto zostanie odłączone.

**Co zrobić:**
1. Wejdź w Settings → Connections → GitHub.
2. Kliknij **Disconnect** i potwierdź.
3. Popatrz na pasek adresu **zanim** klikniesz cokolwiek innego.
4. Podłącz GitHuba z powrotem tym samym PAT-em i wybierz te same repozytoria.
5. Przejdź na `/dashboard`.

**Co musi być prawdą:**
- Po kroku 2 nadal jesteś na `/settings/connections/github` i widzisz formularz
  ponownego podłączenia — **nie** zostajesz przeniesiony na `/setup`.
- Po kroku 4 `/dashboard` znów pokazuje dane, bez objazdu przez kreator.

*Dlaczego to łapie:* bramka pilnuje `/dashboard`, ale nie wolno jej pilnować
`/settings/**`. Jeśli zadziała szerzej, lead rotujący wygasły token zostaje
wyrzucony z jedynej strony, na której jest przycisk „podłącz ponownie" — czyli
z pętli, z której nie ma wyjścia.

---

## D. Wejście drzwiami demo ma drogę powrotną, a kreator kończy na PRAWDZIWYM pulpicie — faza 4 (`4.6`, `4.9`)

**Gdzie:** to samo świeże konto co w wierszu **A**, zaraz po nim.

**Co zrobić:**
1. Na progu `/setup` kliknij **„Zobacz demo"**.
2. Obejrzyj kolejno `/dashboard`, `/dashboard/sprint-detail` i `/settings/team` —
   za każdym razem popatrz na baner demo u góry.
3. Kliknij w banerze **„Dokończ konfigurację"**.
4. Przejdź cały kreator: GitHub (PAT + repozytorium) → Jira (token, URL, projekt,
   mapowanie statusów) → Zespół (roster + kadencja).
5. Na ostatnim kroku kliknij **„Save & finish"**.

**Co musi być prawdą:**
- W kroku 2 baner demo na **każdym z trzech** ekranów niesie przycisk
  „Dokończ konfigurację" obok „Wyjdź z demo".
- Krok 3 przenosi na `/setup` (próg), a nie do Ustawień.
- Po kroku 5 jesteś na `/dashboard`, **banera demo nie ma**, a dane na ekranie
  pochodzą z prawdziwej Jiry/GitHuba, które właśnie podłączyłeś — nie z demo.

*Dlaczego to łapie:* bez przycisku z kroku 2 osoba, która wybrała demo, nie ma
**żadnej** drogi z powrotem na próg — demo jest w Ustawieniach, ale próg nie
jest nigdzie. A bez wyjścia z demo na końcu kreatora „Save & finish" odsyła pod
baner demo, do fikcyjnych danych: lead kończy konfigurację i nie dostaje żadnego
sygnału, że zadziałała.
