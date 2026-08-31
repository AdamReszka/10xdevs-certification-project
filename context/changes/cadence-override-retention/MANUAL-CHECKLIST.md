# S-30 cadence-override-retention — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md` (§26). Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Wiersz 1 dotyka produkcyjnej bazy** i musi zostać wykonany **przed wszystkimi
pozostałymi**: wiersze 2–4 sprawdzają zachowanie, które istnieje dopiero po tej
migracji, a bez niej pierwsze wejście na `/team/cadence` wywali się na
nieistniejącej tabeli.

**Konto:** wiersze 2–4 wymagają **prawdziwego** konta z podłączoną Jirą, w której
jest aktywny sprint. Żaden z nich niczego nie kasuje bezpowrotnie — zmieniają
rytm sprintu, który da się ustawić z powrotem tym samym ekranem.

---

## Faza 1 — migracja produkcyjna

- [ ] **1 — `0023` trafia na produkcję, zanim ktokolwiek dotknie reszty listy**
      *(faza 1, zamyka `1.7`)*

  **Gdzie:** produkcyjna baza Supabase — **nie** lokalna. `drizzle-kit` nie
  dosięgnie tego hosta z tego Maca (host jest IPv6-only), więc trasa jest ta sama
  co dla `0021` i `0022`: albo pooler + `DATABASE_URL_OVERRIDE`, albo Supabase
  MCP `apply_migration` z ręcznie dopisanym wpisem bookkeepingowym.

  **Co zrobić:**
  1. **Najpierw** odczytaj z produkcji `select count(*) from sprint where
     cadence_overridden = true;`. Dzisiejsze zero to fakt o dzisiaj, nie
     gwarancja.
  2. Zastosuj `src/db/migrations/0023_flowery_flatman.sql` (tworzy tabelę
     `sprint_cadence_override` **i** wykonuje backfill).
  3. Dopisz wpis w `drizzle.__drizzle_migrations`, żeby kolejny `db:migrate` nie
     spróbował zastosować `0023` po raz drugi.
  4. Odczytaj `select count(*) from sprint_cadence_override;`.

  **Co musi być prawdą:** tabela `sprint_cadence_override` istnieje; liczba
  wierszy w niej **równa się** liczbie odczytanej w kroku 1 (dziś: zero i zero).
  Wpis w `drizzle.__drizzle_migrations` istnieje.

  **Dlaczego to ma znaczenie:** to jedyny krok tego slice'u, którego kod nie
  zrobi sam. Deploy na Cloudflare wysyła **kod, nie migracje** (`lessons.md`:
  „a deploy that ships code but not migrations breaks silently"), a każdy odczyt
  kadencji — dashboard, Sprint Detail, wszystkie pięć reguł czasowych, wykaz
  pojemności — idzie teraz przez tę tabelę. Bez migracji pierwszy request po
  wdrożeniu wywala się na nieistniejącej relacji.

---

## Faza 4 — kadencja przeżywa rozłączenie Jiry

- [ ] **2 — Mon–Thu przeżywa „Disconnect (keep)" i ponowne podłączenie**
      *(faza 4, zamyka `4.9`)*

  **Gdzie:** `/team/cadence`, potem `/settings/connections/jira`, potem z
  powrotem `/team/cadence`. Prawdziwe konto z podłączoną Jirą.

  **Co zrobić:**
  1. Na `/team/cadence` odznacz **Fri** w „Working days" (zostaje Mon–Thu) i
     kliknij **Save cadence**.
  2. Przeczytaj baner nad formularzem.
  3. Idź na `/settings/connections/jira`, kliknij **Disconnect** i w oknie
     wybierz **Keep my Jira data**.
  4. Podłącz Jirę z powrotem (ten sam workspace, ten sam projekt) i poczekaj na
     cykl synchronizacji — albo wymuś go przyciskiem **Sync now**.
  5. Wróć na `/team/cadence`.

  **Co musi być prawdą:** po kroku 2 baner mówi, że **dni robocze są ustawione
  ręcznie, a długość sprintu i dzień startu nadal pochodzą z Jiry** — nie że
  „auto-pull jest wyłączony" dla wszystkiego. Po kroku 5 **Fri jest nadal
  odznaczony**, a długość sprintu i dzień startu zgadzają się z aktywnym
  sprintem w Jirze.

  **Dlaczego to ma znaczenie:** to jest dokładnie ta wada, dla której powstał
  cały slice. Przed S-30 kolumny kadencji leżały na wierszu `sprint`, który
  ginął razem z poświadczeniem Jiry — a następny reconcile zasiewał je od nowa z
  Jiry. Wybór lidera nie znikał głośno, tylko był podmieniany na **prawdopodobnie
  wyglądającą złą liczbę**, i nic tego nie zgłaszało. Wiersz sprawdza też stan,
  który przed S-30 był nieosiągalny w obie strony: zespół pracujący Mon–Thu z
  jednoczesnym auto-pullem długości i dnia startu (FR-007).

- [ ] **3 — „Restore Jira's values" dotrzymuje obietnicy własnego okna**
      *(faza 3, zamyka `3.7`)*

  **Gdzie:** `/team/cadence`, to samo konto co w wierszu 2.

  **Co zrobić:**
  1. Upewnij się, że **Fri** jest odznaczony (jeśli nie — odznacz i zapisz).
  2. Zmień **Sprint length (days)** na wartość inną niż ta z Jiry (np. 21) i
     **Sprint start day** na inny dzień, po czym zapisz.
  3. Kliknij **Restore Jira's values** i przeczytaj tekst w oknie potwierdzenia.
  4. Potwierdź przyciskiem **Restore from Jira**.
  5. Odśwież stronę (F5).

  **Co musi być prawdą:** okno z kroku 3 zawiera zdanie „Working days are not
  pulled from Jira and stay as they are". Po kroku 4 **długość sprintu i dzień
  startu wracają do wartości z aktywnego sprintu w Jirze**, a **Fri jest nadal
  odznaczony**. Po odświeżeniu w kroku 5 nic się nie zmienia.

  **Dlaczego to ma znaczenie:** okno obiecywało to zdanie od S-29, a kod robił
  dokładnie odwrotnie — kasował wzorzec dni roboczych i zastępował go stałą
  Mon–Fri. „Przywrócenie z Jiry" pola, którego Jira w ogóle nie ma (nie istnieje
  tam żadne pole dni roboczych), nie jest przywróceniem — to skasowanie wyboru
  lidera pod cudzym nazwiskiem. Automat pilnuje tego w `e2e/cadence-restore.spec.ts`;
  ten wiersz sprawdza, że na prawdziwej Jirze wygląda to tak samo.

---

## Faza 5 — co ekran obiecuje przy rozłączeniu i zmianie projektu

- [ ] **4 — zmiana monitorowanego projektu Jiry zachowuje kadencję, a ekran mówi
      o tym prawdę** *(faza 5, zamyka `5.5` i `5.6`)*

  **Gdzie:** `/settings/connections/jira`, potem `/team/cadence`.

  **Co zrobić:**
  1. Na `/settings/connections/jira` przeczytaj akapit pod przyciskiem
     **Reconnect** oraz treść okna **Disconnect** (możesz je anulować — chodzi
     tylko o przeczytanie).
  2. Kliknij **Change monitored project**, wybierz **inny** projekt Jiry i
     przejdź przez ostrzeżenie do końca.
  3. Na ekranie po zmianie przeczytaj podsumowanie i kliknij prowadzący z niego
     przycisk do kadencji.
  4. Poczekaj na cykl synchronizacji (albo **Sync now**) i wróć na
     `/team/cadence`.

  **Co musi być prawdą:** teksty z kroku 1 wymieniają **kadencję ustawioną
  ręcznie** wśród rzeczy, które **zostają** — nie tylko roster, absencje i dni
  wolne. Podsumowanie z kroku 3 mówi, że kadencja została zachowana i przypnie
  się do sprintu, który wciągnie następna synchronizacja. Ekran, na który
  prowadzi przycisk, **mówi coś prawdziwego o tym, co tam jest** — nie „zaimportuj
  najpierw kadencję" z wyszarzonym przyciskiem, którego nie da się użyć. Po
  kroku 4 kadencja z nowego projektu jest ustawialna, a wzorzec **z poprzedniego
  projektu nie został na nią przeniesiony**.

  **Dlaczego to ma znaczenie:** dwie osobne wady w jednym wierszu. Pierwsza:
  `grep -i cadence` po wszystkich modułach z tekstami ostrzeżeń przed S-30
  zwracał **zero trafień** — ekran nie wspominał o kadencji ani jako o stracie,
  ani jako o rzeczy zachowanej, podczas gdy ona ginęła. Druga: po zmianie
  projektu edytor odsyłał lidera na `/team/cadence`, gdzie nie było żadnego
  wiersza `sprint` — przycisk przywracania był wyszarzony, a zapis rzucał
  błędem. Obietnica prowadziła do kontrolki, której nie dało się obsłużyć.
  Ostatnie zdanie („wzorzec z poprzedniego projektu nie został przeniesiony")
  pilnuje odwrotnego ryzyka, które ten slice sam otwiera: rekord **celowo**
  przeżywa zmianę projektu, więc gdyby nie był zawężony do projektu po stronie
  Jiry, kadencja jednego zespołu przykleiłaby się do sprintu innego.
