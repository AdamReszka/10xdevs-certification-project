# S-26 disconnect-data-retention — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md`. Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Kolejność ma znaczenie.** Wiersz 1.7 (migracja) musi być zrobiony **przed**
wierszami z faz 3 i 4 — one klikają po ekranach, które zakładają nowy kształt
bazy. Kod, który potwierdza „zachowaj dane", uruchomiony na niezmigrowanej
bazie, dalej je kasuje kaskadą.

---

## Faza 1

- [x] **1.7 — migracja `0021` trafia na bazę produkcyjną** *(faza 1)* — ZROBIONE 2026-08-31

  **Gdzie:** terminal, główny checkout repo (nie worktree — wszystkie worktree
  dzielą jedną lokalną bazę). Potrzebny connection string do bazy produkcyjnej.

  **Co zrobić:**
  1. **Najpierw sprawdź, co już jest zaaplikowane** — `lessons.md:56-60`
     odnotowuje, że migracje `0019` i `0020` pojechały na produkcję razem z
     kodem, ale **nikt ich nie zaaplikował**. Nie zakładaj, że baza jest na
     `0020`:
     ```
     DATABASE_URL_OVERRIDE='<produkcyjny connection string>' \
       npx drizzle-kit up --config drizzle.config.ts
     ```
     albo po prostu zajrzyj do tabeli `drizzle.__drizzle_migrations` i zobacz
     ostatni wpis.
  2. Zaaplikuj migracje:
     ```
     DATABASE_URL_OVERRIDE='<produkcyjny connection string>' npm run db:migrate
     ```
  3. Sprawdź, że `0021` jest zapisana — ostatni wiersz
     `drizzle.__drizzle_migrations` odpowiada `0021_tricky_electro`.

  **Co musi być prawdą:** komenda kończy się `migrations applied successfully`,
  a w bazie produkcyjnej `absence.sprint_id` i `monitored_repo.credential_id`
  mają `ON DELETE SET NULL` (a nie `CASCADE`), oraz `monitored_repo.credential_id`
  jest `NULL`-owalna. Migracja **niczego nie kasuje** — liczba wierszy w
  `absence` i `monitored_repo` przed i po jest identyczna.

  ---

  **✅ WYNIK (2026-08-31).** Zaaplikowana. Stan przed → po, zmierzony na
  produkcji (`uzqwuikgbbkpnemcnlwo`):

  | | przed | po |
  |---|---|---|
  | `absence` wierszy | 0 | 0 |
  | `monitored_repo` wierszy | 0 | 0 |
  | `absence_sprint_id_sprint_id_fk` | `c` (CASCADE) | `n` (SET NULL) |
  | `monitored_repo_credential_id_…_fk` | `c` (CASCADE) | `n` (SET NULL) |
  | `monitored_repo.credential_id` | NOT NULL | NULL-owalna |
  | migracji w `drizzle.__drizzle_migrations` | 21 | 22 |

  `monitored_repo_owner_repo_uq` nietknięty, oba FK odtworzone. Migracja
  niczego nie skasowała.

  **Sprawdzenie długu wyszło dobrze:** `0019` i `0020` **były** już na
  produkcji (hash po hashu względem `_journal.json`), więc `0021` była jedyną
  brakującą. Ostrzeżenie z `lessons.md:56-60` jest nieaktualne dla tej bazy.

  **⚠️ KOMENDA WYŻEJ NIE ZADZIAŁA Z TEJ MASZYNY — i to nie jest kwestia
  hasła.** `db.uzqwuikgbbkpnemcnlwo.supabase.co` ma wyłącznie rekord **AAAA**
  (IPv6), żadnego A; ta maszyna nie ma wyjścia na IPv6, więc `drizzle-kit`
  kończy się `getaddrinfo ENOTFOUND`. Kto będzie aplikował następną migrację,
  ma dwie drogi: **session-mode pooler** Supabase
  (`aws-0-<region>.pooler.supabase.com:5432`, user `postgres.<ref>` — string do
  wzięcia z dashboardu, Connect → Session pooler) w `DATABASE_URL_OVERRIDE`,
  albo Supabase API/MCP. `0021` poszła tą drugą drogą, a wiersz księgujący
  w `drizzle.__drizzle_migrations` został dopisany ręcznie z **dokładnie** tym,
  co zapisałby `drizzle-kit`: `hash` = sha256 pliku `.sql`
  (`38e8cbea…0332c`), `created_at` = `when` z `_journal.json`
  (`1788110121631`). Zweryfikowane przez porównanie z wierszem, który
  `drizzle-kit` zapisał na bazie lokalnej — są identyczne, więc `db:migrate`
  nie spróbuje jej aplikować drugi raz.

  ---

  **Dlaczego to ma znaczenie:** schemat i kod jadą tu dwoma osobnymi torami i
  tylko jeden z nich jest zautomatyzowany — CI migruje własną, tymczasową bazę,
  a Cloudflare Workers Builds deployuje wyłącznie kod. Zielony deploy **nie
  jest** dowodem na zmigrowaną bazę. Jeśli `0021` nie trafi na produkcję, cały
  ten slice jest tylko nowym tekstem na przycisku: użytkownik wybiera „zachowaj
  moje dane", a baza dalej kasuje nieobecności kaskadą.

---

## Faza 3

> **Kolejność:** wiersz 1.7 (migracja `0021`) musi być zrobiony **przed** tymi
> trzema. Na niezmigrowanej bazie przycisk „Keep my Jira data" wygląda tak samo,
> a kaskada dalej kasuje nieobecności — test 3.7 wtedy słusznie failuje, ale z
> powodu, którego ta faza nie dotyczy.

- [ ] **3.6 — dialog Disconnect oferuje dwa różne przyciski i Cancel** *(faza 3)*

  **Gdzie:** `/settings/connections`, zalogowany na **prawdziwe** konto (nie
  demo — w demo przycisk Disconnect jest wyszarzony i akcja i tak odmówi).

  **Co zrobić:**
  1. Na karcie **Jira** kliknij **Disconnect**.
  2. Przeczytaj treść okna i nie klikaj jeszcze nic — popatrz na stopkę.
  3. Zamknij okno przyciskiem **Cancel**.
  4. Powtórz na karcie **GitHub**.

  **Co musi być prawdą:** w stopce są **trzy** kontrolki, w tej kolejności:
  `Cancel`, `Delete my Jira data` (czerwony), `Keep my Jira data` (zwykły,
  niebieski). Żaden z nich nie nazywa się „Disconnect". Na karcie GitHub
  analogicznie: `Delete my GitHub data` i `Keep my GitHub data`. Treść okna
  mówi zdaniem „Choosing „Delete my Jira data" also removes…", czyli nazywa
  przycisk, który powoduje dodatkową stratę. Po **Cancel** integracja jest
  nadal połączona.

  **Dlaczego to ma znaczenie:** to jest cały slice widziany oczami użytkownika.
  Jeśli oba przyciski wyglądają tak samo albo domyślny jest czerwony, lead
  kliknie ten destrukcyjny „bo tak się kończy takie okno". Etykiety nie mogą też
  zawierać słowa „Disconnect" — inaczej Playwright (i czytnik ekranu) nie
  odróżni ich od przycisku, który to okno otworzył.

- [ ] **3.7 — „Keep my Jira data" zostawia zapisane nieobecności** *(faza 3)*

  **Gdzie:** `/settings/absences`, potem `/settings/connections`, prawdziwe konto.

  **Co zrobić:**
  1. Wejdź na `/settings/absences` i **zapisz sobie**, ile nieobecności widzisz
     i dla kogo (wystarczy zrzut ekranu). Jeśli nie ma żadnej — dodaj jedną,
     dowolną, żeby było co sprawdzać.
  2. `/settings/connections` → karta Jira → **Disconnect** → **Keep my Jira
     data**.
  3. Wróć na `/settings/absences`.

  **Co musi być prawdą:** wszystkie nieobecności z kroku 1 są nadal na liście, z
  tymi samymi osobami i datami. Karta Jira na `/settings/connections` pokazuje
  teraz „Not connected".

  **Dlaczego to ma znaczenie:** to jest defekt, dla którego powstał S-26. Do tej
  pory rozłączenie Jiry kasowało **każdą** nieobecność wpisaną ręcznie przez
  leada — dane, których żadna synchronizacja nie odtworzy — i nikt o tym nie był
  informowany. Jeśli po tym kroku lista jest pusta, migracja `0021` nie jest na
  bazie (patrz 1.7) albo kaskada nie została zwężona.

- [ ] **3.8 — „Delete my Jira data" faktycznie je usuwa** *(faza 3)*

  ⚠️ **Ten test kasuje dane nieodwracalnie.** Wykonaj go dopiero po 3.7 i tylko
  wtedy, gdy zgadzasz się stracić nieobecności na tym koncie. Nie ma „cofnij" —
  ponowne połączenie Jiry ich nie przywróci.

  **Gdzie:** `/settings/connections` → `/settings/absences`, prawdziwe konto.

  **Co zrobić:**
  1. Połącz Jirę z powrotem (**Connect** / kreator), żeby przycisk Disconnect
     znów był dostępny.
  2. Upewnij się na `/settings/absences`, że jakaś nieobecność istnieje.
  3. `/settings/connections` → karta Jira → **Disconnect** → **Delete my Jira
     data**.
  4. Wróć na `/settings/absences`.

  **Co musi być prawdą:** lista nieobecności jest pusta. Roster zespołu
  (`/settings/team`) jest **nienaruszony** — ludzie zostają, znikają tylko ich
  nieobecności. Dni wolne całego zespołu też zostają.

  **Dlaczego to ma znaczenie:** bez tego kroku „wybór" jest pozorny — obie
  ścieżki robiłyby to samo i lead, który świadomie chce wyczyścić konto przed
  oddaniem go komuś innemu, zostawiłby dane w bazie. Sprawdzenie rostera pilnuje
  drugiej strony: `clear` ma usuwać wiersze FR-010, a nie osoby, do których
  należą.

---

## Faza 4

> **Kolejność:** wiersz 1.7 (migracja `0021`) musi być zrobiony **przed** tymi
> dwoma — na niezmigrowanej bazie kaskada `sprint → absence` dalej działa i
> przycisk „Keep my absences" skasuje nieobecności mimo swojej nazwy.
>
> ⚠️ Oba wiersze **kasują zsynchronizowane sprinty** tego konta (tickety,
> historię statusów, anomalie) — tak działa zmiana projektu i tak było przed
> S-26. Odzyskuje się je ponownym syncem z nowego projektu; nieobecności nie.

- [ ] **4.6 — zmiana monitorowanego projektu Jira z „keep" zostawia nieobecności** *(faza 4)*

  **Gdzie:** `/settings/absences`, potem `/settings/connections`, zalogowany na
  **prawdziwe** konto (w demo cała zakładka Connections odmawia). Potrzebne
  konto Jira, w którym widać **co najmniej dwa** projekty — inaczej nie da się
  przełączyć na inny.

  **Co zrobić:**
  1. Wejdź na `/settings/absences` i **zapisz sobie**, ile nieobecności widzisz
     i dla kogo (wystarczy zrzut ekranu). Jeśli nie ma żadnej — dodaj jedną.
  2. `/settings/connections` → karta Jira → **Change monitored project**.
  3. Kliknij **Keep my absences and choose a project** (przycisk zwykły, nie
     czerwony).
  4. Wybierz **inny** projekt niż obecny, zmapuj statusy i zapisz.
  5. Wróć na `/settings/absences`.

  **Co musi być prawdą:** wszystkie nieobecności z kroku 1 są nadal na liście, z
  tymi samymi osobami i datami. Ekran po zapisie mówi „Your recorded absences
  were kept — they stay with the team rather than with the project" (a **nie**
  „cannot be synced back"). Roster (`/settings/team`) i dni wolne zespołu też są
  nienaruszone.

  **Dlaczego to ma znaczenie:** to trzecia — i do S-26 jedyna nieopisana —
  droga do tej samej straty. Rozłączenie Jiry i zmiana projektu kasowały
  nieobecności tym samym mechanizmem (`delete(sprint)` → kaskada), ale tylko
  jedna z nich miała jakiekolwiek ostrzeżenie. Jeśli po tym kroku lista jest
  pusta, migracja `0021` nie jest na bazie (patrz 1.7) albo `mode` nie dojechał
  z ekranu ostrzeżenia do zapisu przez trzy kroki kreatora.

- [ ] **4.7 — ostrzeżenie zapowiada dokładnie to, co robią przyciski** *(faza 4)*

  **Gdzie:** `/settings/connections`, prawdziwe konto. **Ten wiersz niczego nie
  zapisuje** — kończy się na `Cancel`, więc można go zrobić przed 4.6.

  **Co zrobić:**
  1. Karta Jira → **Change monitored project**.
  2. Przeczytaj całe ostrzeżenie i **nie klikaj** żadnego z dwóch przycisków
     akcji.
  3. Zamknij **Cancel**.

  **Co musi być prawdą:** w ostrzeżeniu są **trzy** kontrolki: `Keep my absences
  and choose a project` (zwykła), `Delete my absences and choose a project`
  (czerwona) i `Cancel`. Tekst wymienia po stronie strat sprinty, ich tickety,
  historię statusów i anomalie — **bez** nieobecności; po stronie zachowanych
  m.in. „the recorded absences, which stay with the team rather than with the
  project"; i osobne zdanie „Choosing „Delete my absences and choose a project"
  also removes the recorded absences, which were entered by hand and cannot be
  synced back" — cytujące **dokładnie** nazwę czerwonego przycisku. Po `Cancel`
  monitorowany projekt jest ten sam co przed.

  **Dlaczego to ma znaczenie:** ostrzeżenie, które niedomawia, co kasuje, jest
  defektem — i ten ekran już raz go miał (S-24: wymieniał `daily_recap`, które
  przeżywa, a pomijał `absence`, które ginęło). Zdanie cytujące nazwę przycisku
  jest tu jedynym miejscem, w którym lead dowiaduje się, **który** klik powoduje
  nieodwracalną stratę; jeśli nazwa w zdaniu i napis na przycisku się rozjadą,
  lead kliknie, żeby się dowiedzieć.

---

## Fazy 2, 5 i 6 — bez własnych wierszy blokujących

**Faza 2** (store'y i akcje) i **faza 5** (pomiar jako źródło zamrożonego
zobowiązania) nie mają wierszy manualnych: obie są pokryte testami
integracyjnymi na prawdziwym Postgresie i nie dokładają nowego ekranu. Efekt
fazy 5 widać w niezmienionym „committed SP" po rozłączeniu i ponownym
podłączeniu w trakcie sprintu — to wiersz **22.F** w
`context/foundation/manual-test-backlog.md`, nieblokujący, bo wymaga
manipulowania sprintem po stronie Jiry.

**Faza 6** ma dwa wiersze w `plan.md` `## Progress` i oba celowo **nie** są
osobnymi pozycjami tej checklisty — byłyby duplikatem:

- **6.5** — „tester idący wierszem 16.B domyka obie ścieżki". To domknięcie
  wierszy **3.7** i **3.8** powyżej, spięte w backlogu jako **22.E**. Odhacz je
  dopiero, gdy 3.7 **i** 3.8 są zrobione, a treść okna zapowiedziała dokładnie
  to, co się w obu przypadkach stało.
- **6.6** — przegląd dokumentów (czy gdziekolwiek nie zostało zdanie, że
  *potwierdzone* rozłączenie kasuje nieobecności). **Nie oddawaj go osobie
  testującej** — to czytanie, nie klikanie; zamyka je implementujący. Siedzi w
  **§3** backlogu, razem z pozostałymi zobowiązaniami dokumentacyjnymi.
