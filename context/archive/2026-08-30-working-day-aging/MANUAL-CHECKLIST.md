# S-28 working-day-aging — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md` (§21, plus poprawione wiersze 10.3,
10.4, 10.5, 10.D, 10.7, 11.5 i przypis przy 20.A). Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Co ten slice zmienił, w jednym zdaniu:** każdy budżet czasowy w silniku
anomalii przestał być czasem zegarowym i stał się **czasem roboczym** — zegar
idzie tylko między **08:00 a 16:00** w strefie zespołu, tylko w dniach roboczych
sprintu, i **nigdy** w dniu wolnym całego zespołu. Osiem godzin roboczych to
jeden dzień pracy, więc wszystkie domyślne progi zmieniły liczby: 24 h znaczyło
„jeden dzień", a jeden dzień to 8 godzin roboczych.

⚠️ **Nieobecność jednej osoby NIE zatrzymuje zegara.** To jest decyzja, nie
przeoczenie: sprint jest zespołu, a inbox to alert dla leada o pracy, która stoi.
Osobna obietnica FR-010 stoi nietknięta — nieobecność dalej całkowicie wycisza
`DEVELOPER_INACTIVE` dla tej osoby (wiersz 3 poniżej sprawdza obie połowy naraz).

**Konto:** wiersz 2 wymaga **prawdziwego** konta z aktywnym sprintem w Jirze i
możliwością przestawienia ticketa. Wiersze 1, 3 i 4 działają na dowolnym
zalogowanym koncie; wiersz 5 celowo na demie.

⚠️ **Nic w tej checkliście nie kasuje danych.** Nie ma migracji, nie ma dotykania
tokenów. Jedyne, co zapisujesz, to progi na `/settings/anomalies` i (w wierszu 3)
nieobecność, którą na końcu usuwasz.

---

## Faza 2

- [ ] **2.6 — Konto z własnym progiem sprzed tej zmiany dalej widzi swoją liczbę** 🔴

  **Gdzie:** `/settings/anomalies`, karta **Ticket ageing in a status**, na
  koncie, które kiedykolwiek klikało **Save** na tej karcie. Jeśli takiego nie
  masz — zrób je teraz: zmień **5 SP** na `30`, **Save**, i wróć tu po pierwszym
  przeładowaniu strony.

  **Co zrobić:**
  1. Otwórz `/settings/anomalies` i **nic nie klikaj**.
  2. Przeczytaj wszystkie siedem kubełków SP oraz *Code review* i *Testing*.
  3. Naciśnij F5 i przeczytaj jeszcze raz.

  **Co musi być prawdą:** karta pokazuje **własne** wartości konta, nie
  domyślne; odznaka **„Modified"** stoi na tej jednej karcie; i — najważniejsze —
  **nie ma** komunikatu „Unsaved changes." zaraz po wejściu na stronę, zanim
  cokolwiek zostało dotknięte.

  **Dlaczego to ma znaczenie:** zapisane nadpisanie progu jest walidowane przy
  **każdym odczycie**, a przy niepowodzeniu kod wyrzuca **całe** nadpisanie
  razem z ustawionym severity i zostawia po sobie tylko wpis w logu serwera.
  Ekran wygląda wtedy prawie normalnie: domyślne liczby pod odznaką „Modified" i
  „Unsaved changes." na wejściu. To największe pojedyncze ryzyko tego slice'a i
  żaden zielony test go nie widzi — konto testowe nie ma zapisanych nadpisań.

- [ ] **2.7 — Ticket przestawiony w piątek po południu nie odpala w weekend** 🔴

  **Gdzie:** prawdziwe konto z aktywnym sprintem; Jira i `/dashboard`.

  **Co zrobić:**
  1. **W piątek po 14:00** przestaw w Jirze ticket **3 SP** do **In Progress**
     (jego budżet to 16 godzin roboczych, czyli dwa dni pracy).
  2. W **sobotę** otwórz `/dashboard` i policz wiersze `TICKET_STATUS_AGING` z
     kluczem tego ticketa.
  3. To samo w **niedzielę**.
  4. To samo we **wtorek po południu**.

  **Co musi być prawdą:** w sobotę i w niedzielę **zero** wierszy dla tego
  ticketa; we wtorek — **jeden**. Poniedziałek jest granicą (budżet domyka się w
  poniedziałek po południu), więc nie licz go jako dowodu w żadną stronę.

  **Dlaczego to ma znaczenie:** to jest cały slice w jednym kliknięciu i dokładnie
  ta usterka, którą zgłosiłeś. Przed zmianą ten sam ticket miał budżet 48 godzin
  zegarowych i odpalał w **niedzielę** o 16:00 — trafiając do poniedziałkowego
  inboxu, choć weekend nie był czasem, w którym ktokolwiek mógł go ruszyć.

  ⚠️ **Ten wiersz trwa trzy dni kalendarzowe.** Zacznij go w piątek, inaczej
  przesuwa się o tydzień.

## Faza 3

- [ ] **3.6 — Nieobecność dalej wycisza `DEVELOPER_INACTIVE`, ale nie zatrzymuje ticketa**

  **Gdzie:** `/settings/absences`, potem `/dashboard`.

  **Co zrobić:**
  1. Znajdź w inboxie wiersz **„… has an In Progress ticket but no commits in the
     last 2 working days"** i zapamiętaj, czyj jest.
  2. Zapisz tej osobie nieobecność obejmującą **ostatnie dwa dni robocze**.
  3. Wróć na `/dashboard` (samym przejściem, bez „Sync now").
  4. Usuń nieobecność i odśwież.

  **Co musi być prawdą:** po kroku 3 wiersz `DEVELOPER_INACTIVE` dla tej osoby
  **znika**, a wiersze `TICKET_STATUS_AGING` dla **jej** ticketów **zostają** — z
  tym samym wiekiem co przed zapisem. Po kroku 4 wiersz wraca.

  **Dlaczego to ma znaczenie:** okno tej reguły zmieniło jednostkę, a wyciszenie
  z FR-010 czyta **to samo** okno. To są dwa osobne mechanizmy i muszą takie
  zostać: gdyby zlały się w jeden, nieobecność **skracałaby** okno zamiast
  tłumaczyć ciszę, a urlop pokryty w połowie dawałby alarm zamiast spokoju.
  Druga połowa wiersza — nieruszony wiek ticketów — jest dowodem na decyzję, że
  nieobecność jednej osoby nie zatrzymuje zegara zespołu.

## Faza 4

- [ ] **4.6 — Ustawienia nazywają jednostkę, a 21 SP jest polem liczbowym**

  **Gdzie:** `/settings/anomalies`.

  **Co zrobić:**
  1. Przeczytaj wszystkie osiem kart, ze szczególną uwagą na podpisy pod polami
     czasu.
  2. Zmień **21 SP** (karta *Ticket ageing in a status*) z `64` na `72`.
  3. **Save**, potem F5.

  **Co musi być prawdą:** każde pole czasu mówi **„working hours"** albo
  **„working days"** — nigdy samo „hours" / „days"; *Sprint at risk* mówi
  „working hours before sprint end"; gdzieś na stronie stoi zdanie o tym, w jakim
  oknie idzie zegar (08:00–16:00, dni robocze zespołu, bez dni wolnych całego
  zespołu) i że nieobecność jednej osoby go nie zatrzymuje. Kubełek **21 SP** to
  **pole liczbowe**, takie samo jak pozostałych sześć — nie lista z dwiema
  pozycjami. Po F5 stoi w nim `72` i **nie ma** „Unsaved changes." na wejściu.

  **Dlaczego to ma znaczenie:** liczba bez jednostki na tej stronie kłamie —
  „8" czyta się jako osiem godzin zegarowych, a znaczy cały dzień pracy zespołu,
  czyli lead ustawiłby próg trzykrotnie za krótki. Pole 21 SP jest jedyną
  kontrolką, która zmieniła **typ** (z listy na liczbę), więc jedyną, która może
  się rozjechać z tym, co przyjmuje walidacja przy zapisie.

## Faza 5

- [ ] **5.8 + 5.9 — Demo załadowane w poniedziałek pokazuje cztery różne typy anomalii**

  **Gdzie:** `/setup` (próg pierwszego uruchomienia) albo `/settings/demo`.

  **Co zrobić:**
  1. W **poniedziałek rano** kliknij „Zobacz demo".
  2. Otwórz `/dashboard` i policz, ile **różnych typów** anomalii jest w inboxie
     (nie ile wierszy — ile typów; np. „PR review stalled" i „Ticket ageing" to
     dwa typy, choćby każdy miał po trzy wiersze).
  3. Kliknij „Zresetuj dane demo", załaduj demo jeszcze raz i policz ponownie.

  **Co musi być prawdą:** za każdym razem **co najmniej cztery różne** typy.

  **Dlaczego to ma znaczenie:** to jest kryterium akceptacji **US-02** i jedyne
  miejsce, w którym ten slice mógł je po cichu zepsuć. Kotwica demo to prawdziwy
  zegar w momencie ładowania, więc odkąd budżety liczą się w czasie roboczym,
  dzień tygodnia stał się wejściem do każdego przekroczenia progu w fixturze.
  Poniedziałek jest najgorszym przypadkiem — tuż za kotwicą leży weekend, w
  którym żaden zegar nie szedł.

  *Uwaga:* automat pokrywa tę samą własność dla **wszystkich siedmiu** dni
  tygodnia i dwóch pór dnia (`src/lib/demo/fixture.test.ts`, 84 przypadki). Ten
  wiersz sprawdza, że to samo widać na prawdziwym ekranie, a nie tylko w silniku.
