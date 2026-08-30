# S-20 absence-sprint-scoping — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md` (§20). Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Konto:** dowolne konto z rosterem i aktywnym sprintem, na którym potrafisz się
zalogować. Ten slice **niczego nie kasuje**, nie zmienia bazy i nie dotyka
tokenów GitHuba ani Jiry. Absencję, którą tu założysz, na koniec usuwasz sama.

**Co ten slice zmienił, żebyś wiedziała czego szukasz.** Gdy lead zapisze
nieobecność, aplikacja zapamiętywała przy okazji, **który sprint był akurat
aktywny** w momencie wpisywania. Anomalia „sprint zagrożony" pytała potem o ten
zapamiętany sprint zamiast o **daty** nieobecności — więc urlop wpisany w
sprincie 12, ciągnący się w sprint 13, obniżał pojemność sprintu 13 i wyciszał
w nim alert o braku commitów, ale **nie potrafił** podnieść w nim ryzyka. Od
teraz liczą się wyłącznie daty, tak jak we wszystkich pozostałych miejscach.

⚠️ **Czego NIE da się sprawdzić klikaniem — i to jest w porządku.** Dwa
przypadki, dla których ten slice powstał — nieobecność zapisana, gdy konto nie
ma jeszcze żadnego sprintu, oraz nieobecność zapisana w sprincie N, która ma
zapalić ryzyko w N+1 — wymagają ręcznego grzebania w bazie (zamknięcia sprintu i
wstawienia następnego). Oba są pokryte testami integracyjnymi na prawdziwym
Postgresie (`detect.integration.test.ts`). **Nie próbuj ich odtworzyć w
przeglądarce** — stracisz sesję i niczego nie udowodnisz. Poniższe dwa wiersze
pilnują czegoś innego i tylko tego: że rozszerzona reguła nie zaczęła strzelać
za dużo na zwykłym, jednosprintowym koncie.

---

## Faza 1

- [ ] **1.8a — nieplanowana nieobecność do końca sprintu daje DOKŁADNIE jeden wiersz**

  **Gdzie:** `/settings/absences`, potem `/dashboard`.

  **Co zrobić:**
  1. Wejdź na `/dashboard` i **policz**, ile widzisz anomalii „sprint at risk"
     ze zdaniem o tym, że ktoś jest **„unexpectedly away"**. Zapisz tę liczbę
     (najczęściej będzie to 0).
  2. Wejdź na `/settings/absences` i dodaj nieobecność dla dowolnej osoby z
     zespołu: typ dowolny, **od dzisiaj** do daty **za końcem bieżącego
     sprintu**, i **odznacz** pole mówiące, że nieobecność była zaplanowana
     (chodzi o wpis **nieplanowany** — to on podnosi ryzyko).
  3. Wróć na `/dashboard` i odśwież. Jeśli lista anomalii się nie zmieniła,
     poczekaj na kolejny cykl synchronizacji i odśwież ponownie.

  **Co musi być prawdą:** pojawił się **dokładnie jeden** nowy wiersz z tą osobą
  i zdaniem w rodzaju „… is unexpectedly away for **N** of the **M** working
  day(s) left in the sprint". **M** zgadza się z liczbą dni roboczych od dziś do
  końca sprintu (bez weekendów i bez dni wolnych całego zespołu), a **N** — z tą
  częścią nieobecności, która mieści się w tym oknie. Licznik ogólny z kroku 1
  wzrósł o jeden, nie o dwa.

  **Dlaczego to ma znaczenie:** slice usunął warunek, który wcześniej **odsiewał**
  część nieobecności. Usunięcie filtra jest dokładnie tą zmianą, po której reguła
  może zacząć strzelać za często — a podwojony wiersz w skrzynce anomalii to
  pierwszy objaw. Zła liczba **M** albo **N** znaczy z kolei, że arytmetyka dni
  roboczych została przy okazji ruszona, choć miała zostać nietknięta.

- [ ] **1.8b — nieobecność ZAPLANOWANA nadal nie podnosi ryzyka, a usunięcie gasi wiersz**

  **Gdzie:** `/settings/absences`, potem `/dashboard`.

  **Co zrobić:**
  1. Zostawiając wpis z 1.8a, dodaj **drugą** nieobecność — innej osobie, w tym
     samym oknie dat — ale tym razem **zostaw** zaznaczone, że jest
     **zaplanowana**.
  2. Odśwież `/dashboard`.
  3. Usuń **obie** nieobecności z `/settings/absences` i odśwież `/dashboard`
     jeszcze raz.

  **Co musi być prawdą:** po kroku 2 liczba wierszy „unexpectedly away" **nie
  wzrosła** — zaplanowana nieobecność nie generuje anomalii. Po kroku 3 wiersz z
  1.8a **zniknął** ze skrzynki i licznik wrócił do stanu z kroku 1 wiersza 1.8a.

  **Dlaczego to ma znaczenie:** reguła miała zostać poszerzona **tylko** o
  dopasowanie po datach. Gdyby przy okazji przestała odróżniać nieobecność
  zaplanowaną od zaskoczenia, lead dostawałby alert o każdym urlopie wpisanym z
  miesięcznym wyprzedzeniem — czyli o rzeczy, którą sam zaplanował. Druga część
  pilnuje, że usunięcie wpisu nadal zamyka anomalię: wiersz, który zostaje w
  skrzynce po zniknięciu swojej przyczyny, jest gorszy niż brak wiersza.
