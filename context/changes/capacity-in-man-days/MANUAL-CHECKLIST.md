# MANUAL-CHECKLIST — capacity-in-man-days (S-23)

> Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
> `context/foundation/manual-test-backlog.md`. Numeracja zgadza się z
> `plan.md` → `## Progress`; `plan.md` jest kanoniczny.

## Faza 1 — etat zamiast SP w rosterze

### 1.7 Banner migracji na `/settings/team`

- **Gdzie:** `/settings/team`, konto `demo@sprintflow.test` (to ono ma prawdziwe
  tokeny — patrz `manual-test-backlog.md`).
- **Co zrobić:** wejdź na stronę. Policz członków zespołu. Kliknij
  **„Confirm availability"**. Przeładuj stronę (F5). Wejdź na `/dashboard`
  i wróć na `/settings/team`.
- **Co ma być prawdą:** przed kliknięciem widać banner „Check N people's
  availability", gdzie **N = liczba członków zespołu** (migracja ustawiła
  wszystkim `1.00`). Po kliknięciu banner znika natychmiast. Po przeładowaniu
  **nadal go nie ma**. Po powrocie z dashboardu **nadal go nie ma**.
- **Dlaczego to ważne:** migracja po cichu zrobiła z każdego part-timera pełny
  etat — `sp_capacity` = `8` jest nieodróżnialne jako 8 SP i 8 etatów, więc nie
  dało się tego przenieść. Banner jest **jedynym** sygnałem, że capacity zespołu
  jest zawyżone. Gdyby wracał po przeładowaniu, lead nauczyłby się go ignorować;
  gdyby znikał bez kliknięcia, nikt by się nie dowiedział.

### 1.8 Lista wyboru dostępności

- **Gdzie:** `/settings/team`, kolumna **Availability**.
- **Co zrobić:** rozwiń listę przy dowolnej osobie. Ustaw komuś **Half time
  (0.5)**. Zapisz roster. Przeładuj stronę.
- **Co ma być prawdą:** lista ma **dokładnie cztery** pozycje — Full time (1.0),
  0.75, Half time (0.5), 0.25 — i żadnego pustego / „—". Po przeładowaniu ta
  osoba **nadal ma 0.5**, nie 1.0 i nie puste pole.
- **Dlaczego to ważne:** `0.5` było dotąd niewpisywalne na czterech warstwach
  naraz (kolumna `integer`, walidacja `int()`, `type="number"` bez `step`,
  `Number(v)`). To jest test, że wszystkie cztery faktycznie puściły — a zapis
  przez `numeric` wraca ze sterownika jako **string** `'0.50'`, więc przeładowanie
  jest właściwym sprawdzianem, nie samo kliknięcie.

### 1.9 Capacity w man-dayach na dashboardzie

- **Gdzie:** `/dashboard` → zakładka **Availability**.
- **Co zrobić:** odczytaj liczbę MD i liczbę dni roboczych pod nią. Policz
  ręcznie: `Σ (etat każdej aktywnej osoby) × liczba dni roboczych`. Sprint musi
  mieć **zero zapisanych absencji** — jeśli są, usuń je na czas testu albo
  odejmij je od wyniku ręcznie.
- **Co ma być prawdą:** liczba na ekranie **równa się** ręcznemu rachunkowi,
  jednostka to **MD** (nie SP), a pod spodem stoi „over N working days".
  Zniknął komunikat „No story-point capacity set for anyone".
- **Dlaczego to ważne:** stary reduktor liczył `SP × (dostępne ÷ wszystkie dni)`
  — iloraz **skracał wymiar dnia**, więc liczba dni roboczych nie wpływała na
  wynik i błędny dzielnik był niewidoczny. Teraz dni są mnożnikiem, więc ten sam
  zespół w krótszym sprincie MUSI dać mniejsze capacity. Jeśli liczba się nie
  zgadza, mnożnik jest zły — a on skaluje wszystko, co zbuduje faza 4.

---

## Uwaga do fazy 3 (jeszcze nie teraz)

**Wiersz 1.8 z `manual-test-backlog.md`** (wpisanie estymat SP w projekcie FM,
który dziś ma same `story_points = NULL`) **blokuje weryfikację manualną fazy 3**
— bez estymat relacja capacity↔velocity nie ma czego mierzyć na żywych danych.
Fazy 1 i 2 są od tego niezależne.
