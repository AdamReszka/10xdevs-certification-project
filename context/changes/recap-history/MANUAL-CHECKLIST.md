# S-12 Historia recapów — manual checklist (owner side)

> Siedem pozycji (A–E z faz 1–3, F–G z fazy 4). Wszystko poza nimi jest zielone
> automatycznie i **nie jest tu powtarzane**: 1047 testów jednostkowych, 335
> integracyjnych, `typecheck`, `lint`, build Workera (3191 KiB gzip przy progu
> 5000). Reszta — wiersze odłożone, dług cross-slice — siedzi w
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
> wykonaj **w trybie demo** — powód jest w samym wierszu. Wiersze **F** i **G**
> wymagają najpierw kroków operatorskich poniżej.

---

## ⚠️ Zanim zrobisz F i G — kroki operatorskie w panelu Resenda

**To zadanie operatorskie, nie programistyczne.** Kod fazy 4 jest kompletny i
wszystkie bramki automatyczne są zielone, ale dopóki poniższe cztery kroki nie
zostaną wykonane, webhook **nigdy nie dostanie żadnego żądania** — a to znaczy,
że wiersze F i G są nieosiągalne, nie „niezaliczone".

1. W panelu Resenda → **Webhooks** → **Add Webhook**, endpoint URL:
   `https://sprintflow.pl/api/webhooks/resend`.
2. Zasubskrybuj **oba** zdarzenia: `email.bounced` **i** `email.complained`.
   Sam `email.bounced` zamyka tylko połowę tego, po co ten webhook powstał.
3. Skopiuj **signing secret** (zaczyna się od `whsec_`) ze strony tego webhooka.
4. `npx wrangler secret put RESEND_WEBHOOK_SECRET` i wklej wartość.
   ⚠️ **Sekret, nie `var`.** Zwykłe `vars` rozwiązują się do `null` w
   `getCloudflareContext().env` na tej wersji OpenNexta — a bez sekretu endpoint
   odpowiada 500 i **nie dotyka bazy**, co jest zachowaniem zamierzonym.

Bez sekretu lokalnie: endpoint zwraca 500. To poprawne — nic nie zostaje
zapisane, a stan naprawia się sam, gdy tylko sekret się pojawi.

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

---

## F. 🔒 Podpis jest jedyną bramką — sprawdź obie strony — faza 4

**Gdzie:** panel Resenda → Twój webhook → **Send test event**; potem terminal.

**Co zrobić:**
1. W panelu Resenda wyślij **testową dostawę** na ten endpoint.
2. Zobacz odpowiedź w panelu (Resend pokazuje kod HTTP).
3. Teraz sfałszuj żądanie z terminala — ten sam kształt ciała, **byle jaki**
   podpis:
   ```bash
   curl -i -X POST https://sprintflow.pl/api/webhooks/resend \
     -H "content-type: application/json" \
     -H "svix-id: msg_fake" \
     -H "svix-timestamp: $(date +%s)" \
     -H "svix-signature: v1,ZmFrZQ==" \
     -d '{"type":"email.bounced","data":{"to":["forged-probe@example.com"],"bounce":{"type":"Permanent"}}}'
   ```

> ✅ **Połowa negatywna tego wiersza jest już zweryfikowana (2026-08-29).**
> Cztery sondy na wdrożony endpoint: sfałszowany podpis → **401**, brak nagłówków
> `svix-*` → **401**, podpis z timestampem sprzed doby → **401**, `GET` → **405**.
> Zostaje **tylko** test delivery z panelu Resenda, który ma dać **200**.
> Dlaczego 401 jest tu mocnym wynikiem, a nie tylko „nie wpuściło": pula bazy w
> route'cie jest otwierana **dopiero po** udanej weryfikacji podpisu, więc przy
> 401 handler wraca, zanim jakiekolwiek połączenie z bazą powstanie — sfałszowane
> żądanie nie ma jak niczego zapisać.

**Co musi być prawdą:**
- testowa dostawa z panelu Resenda kończy się **200**;
- sfałszowane żądanie z curla kończy się **401** — i **nic** się nie zmienia:
  w `/settings/recap` recap dalej jest włączony;
- w bazie nie przybył żaden wiersz:
  ```bash
  psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
    -c "select owner_id, enabled, disabled_reason from recap_settings where disabled_reason is not null;"
  ```

**Dlaczego to łapie:** to **jedyna** publiczna, nieuwierzytelniona trasa w całym
repo, a podpis jest **całą** jej ochroną. Gdyby weryfikacja przepuszczała
cokolwiek, dowolna osoba w internecie wyłączałaby recap dowolnemu ownerowi,
podając jego adres e-mail — bez żadnego dostępu do konta. Testy jednostkowe
sprawdzają to na 16 sposobów, ale **żaden z nich nie dowodzi, że prawdziwy
Resend trafia w ten sam algorytm**: sam 200 z panelu jest jedynym dowodem, że
podpisujemy dokładnie to, co on podpisuje.

---

## G. Bounce naprawdę wyłącza recap i mówi dlaczego — faza 4

**Gdzie:** `/settings/recap` na koncie z prawdziwymi credentialami.

**Co zrobić:**
1. Doprowadź do wysyłki na adres testowy Resenda `bounced@resend.dev`
   (najprościej: reset hasła na konto o tym adresie — **ten sam webhook** obsługuje
   maile resetu, i to jest zamierzone).
2. Poczekaj, aż Resend dostarczy zdarzenie (w panelu widać próbę i kod odpowiedzi).
3. Wejdź na `/settings/recap`.
4. Przełącz **Send me a daily recap** z powrotem na włączone i kliknij **Save**.
5. Odśwież stronę.

**Co musi być prawdą:**
- po bounce przełącznik **Send me a daily recap** jest **wyłączony**;
- **nad** przełącznikiem stoi czerwony komunikat, który mówi **co się stało**
  (trwałe odrzucenie przez dostawcę poczty), **kiedy** (data) i **co naprawić
  przed ponownym włączeniem**;
- po ponownym włączeniu i zapisaniu **komunikat znika** i nie wraca po odświeżeniu;
- ⚠️ **kontrola odwrotna:** wyłącz recap ręcznie, zapisz, odśwież — ma **nie
  być** żadnego czerwonego komunikatu.

**Dlaczego to łapie:** przełącznik, który sam się przestawił, jest nieodróżnialny
od decyzji, którą owner podjął pół roku temu — i pierwsze, co zrobi, to włączy go
z powrotem, prosto w tę samą pętlę odbić. Kontrola odwrotna jest tu równie ważna:
komunikat pokazywany przy **ręcznym** wyłączeniu oskarżałby o awarię tam, gdzie
nic się nie zepsuło. To dwa różne stany bazy (`disabled_reason` NULL kontra
niepuste) i tylko ten wiersz sprawdza, że interfejs je rozróżnia.
