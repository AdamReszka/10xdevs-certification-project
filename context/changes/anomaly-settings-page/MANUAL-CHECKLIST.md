# Ustawienia reguł anomalii (S-14 / FR-009, FR-014) — manual checklist

Cztery wiersze. Reszta weryfikacji jest w testach automatycznych (`npm test`,
`npm run test:integration`) i w `context/foundation/manual-test-backlog.md` §8.

> **Na którym koncie:** wiersze **A**, **B** i **D** możesz wykonać na dowolnym
> zalogowanym koncie. Wiersz **C** wykonaj **w trybie demo** — powód jest w
> samym wierszu i jest istotny, bo bez niego ten test jest niefalsyfikowalny.

---

## A. Zakładka „Anomaly rules" istnieje i pokazuje osiem reguł — faza 3

**Gdzie:** `/settings` → zakładka **Anomaly rules** (piąta w kolejności, tuż
przed **Demo**).

**Co zrobić:** zaloguj się → Ustawienia → kliknij **Anomaly rules**.

**Co musi być prawdą:**
- Zakładka **Anomaly rules** jest widoczna i stoi **przed** zakładką **Demo**.
- Strona otwiera się i pokazuje **osiem kart**, po jednej na regułę:
  PR review stalled, Ticket ageing in a status, Developer inactive, Ticket with
  no commits, Sprint at risk, Pull request too big, Scope creep, PR / ticket
  desync.
- Karta **Pull request too big** pokazuje **500** w polu „PR size limit".
- Karta **Ticket ageing in a status** pokazuje siatkę **siedmiu** kubełków
  story-pointowych (1, 2, 3, 5, 8, 13 SP jako pola liczbowe + 21 SP jako lista
  rozwijana z dwiema pozycjami: „120 hours (5 days)" i „8 working days").
- Karta **PR / ticket desync** pokazuje **tylko** pole Severity, bez żadnego pola
  liczbowego, i zdanie wyjaśniające, że ta reguła nie ma liczb do strojenia.
- Na żadnej karcie nie ma odznaki **„Modified"** (świeże konto nie ma nadpisań).

**Dlaczego to łapie:** to jedyna droga do powierzchni, którą FR-009 obiecał,
przenosząc strojenie progów **poza** kreator setupu. Jeśli wpis w zakładkach nie
został dodany, strona istnieje pod adresem, ale nikt jej nie znajdzie. Osiem kart
z prawdziwymi wartościami dowodzi z kolei, że czytanie jest wyczerpujące po
wszystkich ośmiu typach — konto bez ani jednego wiersza w `anomaly_settings` musi
zobaczyć komplet domyślnych, a nie pustą listę.

---

## B. Zapis przeżywa przeładowanie i oznacza dokładnie jedną kartę — faza 3

**Gdzie:** `/settings/anomalies`, karta **Pull request too big**.

**Co zrobić:**
1. W polu **PR size limit** zmień `500` na `50`.
2. Kliknij **Save** na tej karcie.
3. Odśwież stronę (F5).

**Co musi być prawdą:**
- Po kliknięciu **Save** pojawia się zielony toast „Pull request too big saved.".
- Po odświeżeniu w polu **PR size limit** nadal jest **50**.
- Odznaka **„Modified"** jest **wyłącznie** na karcie *Pull request too big* —
  żadna z pozostałych siedmiu kart jej nie ma.
- Przycisk **Reset to defaults** na tej karcie jest **aktywny** (na pozostałych
  siedmiu — wyszarzony).

**Dlaczego to łapie:** zapis jest per-reguła i idzie w `ON CONFLICT` po
`(owner_id, anomaly_type)`. Odznaka na więcej niż jednej karcie znaczyłaby, że
zapis napisał wiersze dla reguł, których nikt nie ruszał; brak odznaki po
odświeżeniu — że nie zapisał nic, a toast skłamał.

---

## C. Zmiana progu widać w Anomaly Inbox NATYCHMIAST, bez „Sync now" — faza 3

**Gdzie:** `/settings/demo` → **„Zobacz demo"**, potem `/settings/anomalies`
i `/dashboard`.

**KONIECZNIE w trybie demo.** Na koncie **bez aktywnego sprintu** `detectAnomalies`
kończy się cichym `skipped: no_sprint`, a akcja ten wynik połyka — więc zapis
pokaże zielony toast, a inbox się nie ruszy. To wygląda **identycznie** jak
zepsute przeliczanie, więc ten wiersz wykonany poza demem niczego nie dowodzi.
Fixture demo gwarantuje aktywny sprint z pull requestami.

**Co zrobić:**
1. Ustawienia → **Demo** → **„Zobacz demo"**.
2. Otwórz `/dashboard` i **zapamiętaj, ile jest anomalii typu „Pull request too
   big"** (może być zero).
3. Ustawienia → **Anomaly rules** → karta *Pull request too big* → wpisz **50** →
   **Save**.
4. Wróć na `/dashboard` (samo przejście, bez klikania **„Sync now"**).

**Co musi być prawdą:**
- W Anomaly Inbox jest **więcej** anomalii „Pull request too big" niż w kroku 2.
- Nie kliknięto **„Sync now"** i nie czekano na cykl 15-minutowy.

**Dlaczego to łapie:** to jedyny dowód na decyzję **D1** — próg i severity są
stemplowane na wierszu `anomaly` w momencie detekcji, więc bez ponownego
uruchomienia detekcji po zapisie lead zmieniłby liczbę i przez kwadrans nie
widziałby żadnej różnicy, nie mając jak odróżnić działającego zapisu od zepsutego.
Roadmapa mówiła kiedyś coś przeciwnego; ten wiersz sprawdza, która wersja jest
prawdziwa.

---

## D. Wartość `0` jest odrzucana i nic nie zostaje zapisane — faza 3

**Gdzie:** `/settings/anomalies`, dowolna karta z polem liczbowym (najprościej
*Pull request too big*).

**Co zrobić:**
1. Najpierw kliknij **Reset to defaults** na karcie *Pull request too big*, jeśli
   ma odznakę **„Modified"** po wierszu B (pole wraca na `500`, odznaka znika).
2. Wpisz `0` w **PR size limit** → **Save**.
3. Wpisz `-5` → **Save**.
4. Odśwież stronę.

**Co musi być prawdą:**
- W obu przypadkach pod polem pojawia się czerwony komunikat (np. „The PR size
  limit must be at least 1.") i **nie ma** zielonego toasta.
- Po odświeżeniu w polu jest **500**, a karta **nie ma** odznaki „Modified".

**Dlaczego to łapie:** kolumna `thresholds` jest `jsonb`, a każdy detektor czyta
jej zawartość niesprawdzonym rzutowaniem `as`. Zapisane `0` nie wybucha przy
zapisie — dopiero przy detekcji: albo reguła zaczyna trafiać w **każdy** wiersz
(zalew fałszywych alarmów), albo `NaN` w `risk_score` (kolumna `integer`)
przerywa **całą** transakcję detekcji, nie tylko tę jedną regułę. Ten wiersz
sprawdza, że jedyna bariera runtime, jaka istnieje, faktycznie stoi.

---

Podpis fazy: **faza 3** (`plan.md` → `## Progress`, wiersze 3.5–3.11).
