# Obserwacja — Daily Recap nie zna weekendów ani dni wolnych firmy

- **Slice:** S-11 `daily-recap-email` (dotyka też S-14 / anomaly rules i S-23 `capacity-in-man-days`)
- **Data:** 2026-08-30
- **Gałąź:** test/manual-testing-session-2026-08-30-1231
- **Wynik:** ⚠️ **to nie jest nieudany test** — to obserwacja produktowa zgłoszona
  przez testerkę przy okazji wiersza **1.9**. Sam wiersz 1.9 (kształt tabel
  `daily_recap` / `recap_settings`) **przechodzi** i został odhaczony osobno.
- **Wiersz w backlogu:** `context/foundation/manual-test-backlog.md` §9
- **Decyzja należy do właściciela** — nie ma tu defektu do naprawy „po cichu",
  bo część tego zachowania może być świadomym wyborem.

## Pytanie, które to uruchomiło

Testerka zapytała wprost: *„Jak będzie działał ten mechanizm w dniach wolnych?
Standardowo sobota i niedziela są wolne. Z jakimi danymi szef dostanie maila w
poniedziałek? I co jeśli jakiś dzień w tygodniu będzie wolny, bo będzie święto i
cała firma nie będzie pracować?"*

Odpowiedź wyszła z **czytania kodu, nie z uruchomienia** — patrz „Czego nie
sprawdzono".

## Co wynika z kodu

### 1. Wysyłka nie patrzy w kalendarz

`isRecapDue` (`src/lib/recap/due.ts:32`) rozstrzyga „wysłać dziś czy nie" na
podstawie **dokładnie dwóch** warunków: `enabled` (`due.ts:46`) i tego, czy
minęła lokalna godzina wysyłki (`due.ts:55`). Nie ma tu ani dnia tygodnia, ani
`team_day_off`. `sendDailyRecap` (`src/lib/recap/send.ts:120`) jest jedynym
konsumentem i nie dokłada własnego filtra.

**Skutek:** recap wychodzi w sobotę, niedzielę i w święto firmowe tak samo jak w
środę.

### 2. „Wczorajsza aktywność" to poprzedni dzień **kalendarzowy**, nie roboczy

`src/lib/recap/build.ts:66` liczy okno jako `now - 24h`, a `build.ts:74–75`
zbiera na tym oknie cały rollup aktywności i tickety przeniesione do Done.

**Skutek:** poniedziałkowy mail opisuje **niedzielę** — czyli w typowym zespole
zera w commitach, PR-ach i zamkniętych ticketach. Piątkowa praca zespołu trafia
wyłącznie do **sobotniego** maila, którego z założenia nikt nie czyta w
poniedziałek rano. Najbardziej potrzebny mail tygodnia niesie najmniej treści.

Uwaga na kierunek zależności: `build.ts:63` mówi wprost, że okno ma się zgadzać
z panelem „Yesterday's Activity" na `/dashboard`. **Zmiana definicji „wczoraj"
tylko w mailu rozjedzie mail z pulpitem** — a to jest nagłówkowe ryzyko tego
slice'a (backlog §9, wiersz 5.15).

### 3. Alarmy w mailu reagują na dni wolne **niejednolicie**

Mail i inbox pokazują te same anomalie (`build.ts:83`, `toInboxAnomalies`), więc
poniższe dotyczy obu powierzchni:

| Reguła | Zna dni wolne? | Gdzie |
|---|---|---|
| `SPRINT_AT_RISK` | ✅ tak | `sprint-at-risk.ts:129,157` — `countWorkingDaysInclusive` z `snapshot.nonWorkingDays` |
| `TICKET_STATUS_AGING`, kubełek **21 SP** | ✅ tak | `ticket-status-aging.ts:63–74` — `countWorkingDays` z `nonWorkingDays` |
| `TICKET_STATUS_AGING`, pozostałe kubełki | ❌ nie | `ticket-status-aging.ts:76–80` — `hoursBetween`, czas zegarowy |
| `TICKET_STATUS_AGING`, Code Review / Testing | ❌ nie | `ticket-status-aging.ts:82–86` — czas zegarowy |
| `DEVELOPER_INACTIVE` | ❌ nie | `developer-inactive.ts:31` — `now - noCommitDays * MS_PER_DAY`, dni kalendarzowe |

`DEVELOPER_INACTIVE` wygląda na najbardziej dotknięty. Wycisza go **wyłącznie**
indywidualna absencja wpisana w kalendarzu (`developer-inactive.ts:47–50`);
`snapshot.nonWorkingDays` nie jest w tej regule czytany w ogóle.

**Skutek, jeśli hipoteza się potwierdzi:** przy domyślnym progu 2 dni sam weekend
nie wystarczy, ale **długi weekend albo święto w tygodniu — owszem**, i wtedy
poniedziałkowy mail zgłosi jako „nic nie robi" pół zespołu, który po prostu nie
był w pracy. To jest dokładnie ten kształt, przed którym ostrzega komentarz w
nagłówku tej samej reguły (`developer-inactive.ts:16–19`): inbox, który krzyczy
bez powodu, uczy szefa, żeby przestać go czytać.

### 4. Dane, których brakuje, **już są w systemie**

Tabela `team_day_off` istnieje (`src/db/schema.ts:688`), właściciel wpisuje w nią
dni wolne całej firmy, a `nonWorkingDays` jest podawany do snapshotu anomalii i
używany przez dwie reguły z tabeli wyżej. **Nie brakuje danych — brakuje
podłączenia** ich pod wysyłkę i pod `DEVELOPER_INACTIVE`.

## Prawdopodobna przyczyna — HIPOTEZA, niezweryfikowana

Wygląda na to, że S-11 (recap, 2026-08-26) powstał **przed** S-23
(`capacity-in-man-days`, 2026-08-27), który wprowadził `team_day_off` i
`nonWorkingDays`. Reguły dotknięte przez S-23 dostały kalendarz dni wolnych;
recap, którego S-23 nie ruszał, został przy czasie kalendarzowym. To by
tłumaczyło, dlaczego wsparcie jest tak nierówne — prawdopodobnie nie było to
decyzją, tylko kolejnością slice'ów.

**Nikt tego nie potwierdził uruchomieniem.** Możliwe też, że codzienna wysyłka
w weekend jest świadomym wyborem (FR-018 opisuje recap jako powierzchnię
„off-hours", więc mail w sobotę nie jest oczywistym absurdem) — ale nawet wtedy
pusta treść poniedziałkowego maila zostaje pytaniem otwartym.

## Czego nie sprawdzono

- **Nie uruchomiono żadnego realnego cyklu wysyłki.** Cała obserwacja pochodzi z
  czytania kodu. Zachowanie w weekend można potwierdzić dopiero przy wierszach
  5.15 / 5.16 z §9 backlogu, na prawdziwej wysyłce.
- Nie sprawdzono, czy jakiś test automatyczny **utrwala** obecne zachowanie jako
  zamierzone — jeśli tak, to argument, że była to decyzja, nie przeoczenie.
- Nie sprawdzono zachowania w trybie demo.
- Nie policzono, czy przy progu domyślnym `noCommitDays` sam weekend (2 dni)
  faktycznie nie wystarcza do odpalenia `DEVELOPER_INACTIVE` — to zależy od
  godziny detekcji i wymaga sprawdzenia na danych, nie w kodzie.

## Możliwe kierunki dla właściciela (nie rekomendacja, tylko rozwidlenie)

1. **Wysyłka:** pominąć dni niepracujące — albo zostawić, ale wtedy odpowiedzieć
   na punkt 2, bo to on boli.
2. **„Wczoraj":** zmienić na „od ostatniego dnia roboczego", **jednocześnie na
   pulpicie i w mailu**, żeby nie rozjechać obu powierzchni (`build.ts:63`).
3. **`DEVELOPER_INACTIVE`:** przekazać regule `snapshot.nonWorkingDays` tak, jak
   robią to `sprint-at-risk.ts` i kubełek 21 SP.

Punkty 1–3 są niezależne; punkt 2 jest jedyny, który dotyka dwóch powierzchni
naraz.

## Aktualizacja 2026-08-30 — S-28 zamknął **tylko** punkt 3

Slice **S-28** (`context/changes/working-day-aging/`) przestawił silnik anomalii
na czas roboczy: budżety wszystkich pięciu reguł czasowych — `PR_REVIEW_STALLED`,
wszystkie pięć gałęzi `TICKET_STATUS_AGING`, `DEVELOPER_INACTIVE`,
`TICKET_NO_COMMIT_LINK` i warunek „ToDo pod koniec sprintu" w `SPRINT_AT_RISK` —
liczą się w **godzinach roboczych**: zegar chodzi 08:00–16:00 w strefie zespołu,
wyłącznie w dniach roboczych sprintu i nigdy w dniu wolnym całej firmy
(`team_day_off`). Tabela z punktu 3 tej notatki jest więc **nieaktualna**: nie ma
już reguły, która nie zna dni wolnych. Indywidualna absencja świadomie **nie**
zatrzymuje zegara (sprint jest zespołu, nie osoby), a wyciszenie
`DEVELOPER_INACTIVE` przez absencję działa dalej dokładnie tak jak wcześniej —
FR-010 nie został ruszony.

**Punkty 1 i 2 pozostają otwarte i nikt ich nie podjął.** S-28 nie dotykał
warstwy recapu:

- **Wysyłka** (`src/lib/recap/due.ts`) nadal nie patrzy w kalendarz — mail
  wychodzi w sobotę, niedzielę i w święto firmowe.
- **„Wczoraj"** (`src/lib/recap/build.ts:66`) to nadal poprzednie 24 godziny
  kalendarzowe, więc poniedziałkowy mail nadal opisuje niedzielę. Uwaga o
  kierunku zależności z punktu 2 dalej obowiązuje: definicję „wczoraj" trzeba
  zmieniać jednocześnie w mailu i w panelu „Yesterday's Activity" na
  `/dashboard`, inaczej obie powierzchnie się rozjadą.

Ta notatka **nie jest** więc zamknięta i nie wolno jej czytać jako naprawionej —
naprawiona jest jedna z trzech obserwacji.

## Stan po teście

Bez śladów. Wykonano wyłącznie odczyty — zapytanie o strukturę tabel (wiersz 1.9)
i czytanie plików. Nic nie zapisano do bazy, nic nie zmieniono w kodzie.
