# S-12 Historia recapów — manual checklist (owner side)

> Pięć pozycji. Wszystko poza nimi jest zielone automatycznie i **nie jest tu
> powtarzane**: 1017 testów jednostkowych, 326 integracyjnych, `typecheck`,
> `lint`. Reszta — wiersze odłożone, dług cross-slice — siedzi w
> `context/foundation/manual-test-backlog.md` §14.

**Jak to się ma do `plan.md` `## Progress`** (który zostaje kanoniczny): każdy
wiersz niesie numer fazy, do której należy. Odhacz go w tej fazie w `## Progress`,
kiedy przejdzie.

**Dlaczego ta checklista powstała w fazie 3, a nie w 4:** FR-019 jest spełniony
na koniec fazy 3, a faza 4 (webhook Resenda) jest **odcinalna z założenia** —
gdyby checklista mieszkała w niej, wycięcie fazy zostawiłoby zmianę bez żadnej
listy, mimo że fazy 1–3 dowożą całą funkcjonalność.

> **Na którym koncie:** wiersze **A**, **B**, **C** i **D** wykonaj na koncie z
> prawdziwymi credentialami (to, które dostaje realne recapy). Wiersz **E**
> wykonaj **w trybie demo** — powód jest w samym wierszu.

---

## A. ✅ ZALICZONE 2026-08-29 — `daily_recap` przeżywa zmianę projektu Jira — faza 1

**Gdzie:** terminal, lokalna baza Supabase.

**Co zrobić:**
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c '\d daily_recap'
```

**Co musi być prawdą:**
- kolumna `sprint_id` jest **nullable** (brak `not null`),
- klucz obcy `daily_recap_sprint_id_sprint_id_fk` ma **`ON DELETE SET NULL`**,
  a nie `ON DELETE CASCADE`,
- indeksu `daily_recap_owner_sprint_idx` **nie ma** (purge idzie po `recap_day`,
  listowanie po `daily_recap_owner_day_uq`).

**Dlaczego to łapie:** przy `CASCADE` zwykła akcja produktowa — przełączenie
monitorowanego projektu Jira — kasowała ownerowi **całe archiwum recapów** oraz
dzisiejszy wiersz-claim, co dawało **drugiego maila za ten sam dzień**. Bez tej
zmiany powierzchnia z fazy 3 obiecuje historię, której baza nie gwarantuje.

---

## B. Pełny cykl crona loguje purge i nie psuje pozostałych kroków — faza 2

**Gdzie:** terminal + `/settings/connections` na koncie z prawdziwymi
credentialami.

**Co zrobić:**
1. `npm run dev` (albo poczekaj na cykl `wrangler dev --test-scheduled`).
2. Wywołaj pełny cykl crona — ten sam, który robi sync, detekcję, recap i
   pomiar sprintu.
3. Przeczytaj log cyklu.

**Co musi być prawdą:**
- w logu cyklu jest **licznik purge** (ile recapów usunięto; **0 to poprawny
  wynik** na koncie z mniej niż trzema zapisanymi sprintami),
- **wszystkie pozostałe kroki cyklu kończą się jak wcześniej** — sync GitHub,
  sync Jira, detekcja anomalii, wysyłka recapu, pomiar sprintu; żaden nie
  zniknął z logu i żaden nie zgłasza błędu,
- w `/settings/connections` sekcja „Recent sync attempts" ma nowy wiersz.

**Dlaczego to łapie:** purge to jedyny krok w tym slice'ie, który **trwale
kasuje wiersze**, i jest wpięty w pętlę chodzącą co 15 minut. Jeśli rzuca
wyjątkiem, może zabrać ze sobą kroki wykonywane po nim — a te wysyłają maile i
zamykają pomiar sprintu. „0 usuniętych" jest tu wynikiem pozytywnym: model
świadomie zawodzi w stronę **zachowania danych**.

---

## C. Historia jest osiągalna, kompletna i otwiera się — faza 3

**Gdzie:** `/settings/recap` → `/settings/recap/history` → wiersz listy.

**Co zrobić:**
1. Zaloguj się na konto z prawdziwymi recapami → **Settings** → zakładka
   **Daily recap**.
2. W karcie **Last send** kliknij **„See all past recaps →"**.
3. Kliknij dzień w pierwszym wierszu tabeli.

**Co musi być prawdą:**
- link **„See all past recaps →"** istnieje w karcie *Last send*;
- po wejściu na `/settings/recap/history` zakładka **Daily recap** jest **nadal
  podświetlona** (żadna inna zakładka się nie zaznacza);
- lista jest **od najnowszego dnia** i pokazuje **wszystkie** recapy, także te
  nieudane — nie tylko te z odznaką *Sent*;
- każdy wiersz ma dzień, odznakę wyniku, godzinę i jedno zdanie „co się stało";
- po kliknięciu wiersza otwiera się `/settings/recap/history/<id>` i widać
  **treść maila taką, jaka poszła** — nagłówek, sekcję *Anomalies*, sprint,
  aktywność;
- **linki w mailu (Jira / GitHub) są klikalne i otwierają się w nowej karcie**;
- zakładka **Daily recap** jest podświetlona także tutaj, a link „← Recap
  history" wraca na listę.

**Dlaczego to łapie:** trzy różne defekty jednym przejściem. Brak linku z
`/settings/recap` czyni całą powierzchnię nieosiągalną — istnieje pod adresem,
ale nikt jej nie znajdzie. Lista wyłącznie z udanymi wysyłkami byłaby gorsza od
braku listy: nieudany recap to jedyna rzecz, na którą lead ma zareagować.
Klikalność linków jest **nieoczywista** — treść maila leci w `<iframe
sandbox>`, a pusty sandbox blokuje nawigację; gdyby zabrakło tokenów
`allow-popups` / `allow-popups-to-escape-sandbox`, linki wyglądałyby normalnie i
**nie robiłyby nic**, czyli piąty atrybut z FR-014 byłby martwy.

---

## D. 🔒 Cudzy recap zwraca 404, a nie pustą stronę — faza 3

**Gdzie:** `/settings/recap/history/<id>` z podmienionym `id`.

**Co zrobić:**
1. Będąc na `/settings/recap/history/<id>` swojego recapu, skopiuj adres.
2. Podmień `id` w adresie na dowolny inny UUID (np. zmień kilka znaków, byle
   został poprawny UUID) i wejdź.
3. Powtórz z **prawdziwym** `id` recapu **innego konta** — weź je z bazy:
   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     -c "select id, owner_id, recap_day from daily_recap order by recap_day desc limit 10;"
   ```

**Co musi być prawdą:**
- **oba** przypadki dają **tę samą stronę 404** — nieistniejący identyfikator i
  cudzy identyfikator są nie do odróżnienia;
- w żadnym z nich nie widać dnia, statusu ani treści maila;
- nie ma pustej strony ani „coś poszło nie tak" — ma być 404.

**Dlaczego to łapie:** pod tymi tabelami **nie ma RLS** — predykat `owner_id` w
zapytaniu **jest** izolacją, i to jedyne, co ją trzyma. Zapomniany predykat nie
wywala się głośno: pokazuje cudzy recap, a recap zawiera nazwy zadań, nazwiska
ludzi i linki do cudzej Jiry. Osobno: gdyby cudzy wiersz dawał inny komunikat
niż nieistniejący, sama różnica **potwierdzałaby istnienie wiersza** komuś, kto
nie ma prawa go czytać.

---

## E. Demo pokazuje historię, a nie jeden wiersz — faza 3

**Gdzie:** `/settings/demo` → **„Zobacz demo"** → `/settings/recap/history`.

**Co zrobić:**
1. `/settings/demo` → **„Zobacz demo"**.
2. **Settings** → **Daily recap** → **„See all past recaps →"**.
3. Otwórz wiersz z odznaką **Failed**.
4. Wróć na `/settings/demo` i kliknij **reset**, potem wejdź jeszcze raz na
   `/settings/recap/history`.

**Co musi być prawdą:**
- lista pokazuje **pięć** recapów na **pięciu różnych dniach**, od najnowszego;
- **dokładnie jeden** ma odznakę **Failed**, pozostałe **Sent**;
- **żaden** wiersz nie ma statusu „Sending" ani „Stalled";
- wiersz *Failed* **otwiera się i pokazuje treść maila** — nie jest pustą stroną;
- po resecie demo lista jest pusta i pokazuje zdanie „No recaps yet…", a nie
  błąd.

**Dlaczego to łapie:** demo to jedyna droga, którą ktoś bez integracji zobaczy
tę powierzchnię (US-02), a jeden wiersz nie dowodzi niczego — lista z jednym
elementem wygląda tak samo jak zepsute sortowanie. Status **„Sending"/„Stalled"
w demo byłby regresją zamrożonego zegara**: te dwa stany porównują `Date.now()`
z `last_attempt_at`, więc pojawiłyby się dopiero po czasie i tylko u części
oglądających. Wiersz *Failed* z czytelną treścią dowodzi, że nieudana wysyłka
jest **legible**, a nie pustym rekordem, którego nie da się zdiagnozować.
