# Katalog sprawdzeń — SprintFlow, środowisko lokalne (macOS)

Każde sprawdzenie ma: **komendę**, **warunek zaliczenia**, **co to znaczy po
polsku** (tego użyj w tabeli raportu) i **dwie drogi naprawy**.

Komendy uruchamiaj z katalogu głównego repo. Grupuj po kilka w jedno wywołanie
Bash. Wszystko w sekcjach A–E jest **wyłącznie do odczytu** — nic nie zmienia.

---

## A. Narzędzia globalne (spoza repo)

Bez nich nie ruszy nic. Sprawdź je zawsze, nawet przy zawężonym zakresie.

```bash
echo "A1 git:     $(git --version 2>&1 || echo BRAK)"
echo "A2 node:    $(node --version 2>&1 || echo BRAK)  (wymagane: v$(cat .nvmrc))"
echo "A3 npm:     $(npm --version 2>&1 || echo BRAK)"
echo "A4 docker:  $(docker info --format '{{.ServerVersion}}' 2>&1 | head -1 || echo BRAK)"
echo "A5 openssl: $(openssl version 2>&1 || echo BRAK)"
```

### A1 — git
- **Zalicza:** wypisuje wersję.
- **Po polsku:** „narzędzie, którym pobierasz kod projektu".
- **Brak:** na macOS pojawia się okienko „install command line developer tools" —
  kliknąć *Install*. Alternatywnie `xcode-select --install`.
- **Ty:** możesz uruchomić `xcode-select --install`, ale dalej klika człowiek.

### A2 — Node.js
- **Zalicza:** wersja major zgadza się z `.nvmrc` (dziś `24`).
- **Po polsku:** „silnik, na którym uruchamia się aplikacja".
- **Zła wersja:** to najczęstsza przyczyna dziwnych błędów przy `npm ci`.
  Jeśli jest `nvm`: `nvm install 24 && nvm use 24`. Jeśli `fnm`: `fnm use 24`.
  Jeśli nie ma żadnego menedżera — pobrać instalator z nodejs.org (wersja 24 LTS).
- **Ty:** możesz uruchomić `nvm use 24`, ale **tylko jeśli `nvm` istnieje** —
  sprawdź `command -v nvm || [ -s "$HOME/.nvm/nvm.sh" ]`. Instalacji Node z
  internetu nie wykonuj sam(a) — to zmiana w systemie, nie w projekcie.

### A3 — npm
- **Zalicza:** wypisuje wersję. Przychodzi razem z Node, więc brak npm przy
  obecnym Node oznacza uszkodzoną instalację → przeinstalować Node.

### A4 — Docker
- **Zalicza:** wypisuje wersję serwera (nie sam `docker --version` — ten działa
  też przy wyłączonym Dockerze; potrzebny jest **działający** silnik).
- **Po polsku:** „program, w którym uruchamia się baza danych projektu".
- **Nie działa:** otworzyć aplikację **Docker Desktop** (albo **OrbStack**) i
  poczekać, aż ikonka na górnym pasku przestanie się animować.
- **Ty:** możesz uruchomić `open -a Docker`, ale **poczekaj i sprawdź ponownie**
  — start trwa 30–60 sekund. Nie raportuj sukcesu, dopóki `docker info` nie
  przejdzie.
- **Brak w ogóle:** instalacja Docker Desktop ze strony docker.com. To pobranie
  ~1 GB — informujesz, nie robisz tego sam(a).

### A5 — openssl
- **Zalicza:** wypisuje wersję. Na macOS jest zawsze.
- **Potrzebny tylko** przy generowaniu kluczy do `.env.local` (sekcja C). Brak →
  ⚠️, nie ❌.

---

## B. Repo i zależności

```bash
echo "B1 katalog: $([ -f supabase/config.toml ] && [ -f src/db/schema.ts ] && echo OK || echo "ZLY KATALOG ($(pwd))")"
echo "B2 branch:  $(git rev-parse --abbrev-ref HEAD 2>&1)  |  zmiany: $(git status --porcelain | wc -l | tr -d ' ') plikow"
for b in next supabase drizzle-kit vitest playwright; do
  printf "B3 %-12s %s\n" "$b:" "$([ -x node_modules/.bin/$b ] && echo OK || echo BRAK)"
done
echo "B4 spojnosc: $(npm ls --depth=0 >/dev/null 2>&1 && echo OK || echo "NIEZGODNE z package.json")"
```

### B1 — właściwy katalog
- **Zalicza:** istnieją `supabase/config.toml` i `src/db/schema.ts`.
- **Nie zalicza:** sesja Claude Code została odpalona w złym miejscu.
  Powiedz jej: „zamknij i otwórz VS Code w katalogu, do którego sklonowałaś
  projekt" — i wypisz, gdzie faktycznie jesteś (`pwd`).

### B2 — branch
- **Nie jest to test** — to informacja do raportu. Wypisz nazwę brancha i liczbę
  zmienionych plików. Jeśli branch to `main`, dopisz jedno zdanie: „testujesz
  główną wersję; jeśli miałaś testować konkretną zmianę, upewnij się u autora,
  czy to właściwa gałąź".
- **Nie przełączaj brancha.** To robota drugiego skilla.

### B3 — zależności projektu
- **Zalicza:** wszystkie pięć narzędzi obecnych w `node_modules/.bin/`.
- **Po polsku:** „biblioteki, z których zbudowana jest aplikacja".
- **Brak:** `npm ci` (nie `npm install` — `ci` instaluje dokładnie te wersje,
  które są zapisane w projekcie). Trwa 1–3 minuty.
- **Ty:** to bezpieczna naprawa, możesz ją wykonać po zgodzie. Ostrzeż o czasie.

### B4 — spójność zależności
- **Zalicza:** `npm ls --depth=0` kończy się bez błędu (ok. 1 s).
- **Nie zalicza:** zainstalowane biblioteki nie zgadzają się z tym, czego wymaga
  projekt — zwykle dlatego, że ktoś dodał nową bibliotekę po ostatniej
  instalacji. ⚠️, naprawa jak w B3.
- **Nie porównuj dat plików** (`package-lock.json` vs `node_modules`) — `npm`
  przepisuje lockfile także wtedy, gdy nic się nie zmieniło, więc taka
  heurystyka alarmuje na w pełni zdrowym środowisku.
- Playwright (testy przeglądarkowe) wymaga dodatkowo `npx playwright install`.
  **Sprawdzaj to tylko, jeśli pyta o testy e2e** — do testów manualnych
  niepotrzebne.

---

## C. Konfiguracja — pliki `.env`

⚠️ **Nigdy nie wypisuj zawartości tych plików.** Poniższa komenda pokazuje
wyłącznie obecność, długość i format — nigdy wartości.

🔴 **Ustawienia siedzą w DWÓCH plikach i trzeba czytać oba.** `.env` trzyma
wartości wspólne, `.env.local` je nadpisuje — dokładnie tak, jak robi to sama
aplikacja. Sprawdzenie samego `.env.local` zgłasza braki na w pełni sprawnym
środowisku (zweryfikowane 2026-08-29: `BETTER_AUTH_SECRET` i `BETTER_AUTH_URL`
leżą w `.env`, nie w `.env.local`). Kolejność flag poniżej jest znacząca —
plik podany później wygrywa.

```bash
echo "C1 .env:       $([ -f .env ] && echo jest || echo BRAK)"
echo "C1 .env.local: $([ -f .env.local ] && echo jest || echo BRAK)"
if [ ! -f .env ] && [ ! -f .env.local ]; then echo "C1: BRAK OBU PLIKOW"; else
node --env-file-if-exists=.env --env-file-if-exists=.env.local -e '
const need = ["DATABASE_URL","TOKEN_ENCRYPTION_KEY","BETTER_AUTH_SECRET","BETTER_AUTH_URL","NEXT_PUBLIC_SUPABASE_URL","NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
for (const k of need) {
  const v = process.env[k];
  console.log("C2", k.padEnd(36), v ? `jest (${v.length} znakow)` : "BRAK");
}
try { const u = new URL(process.env.DATABASE_URL);
  console.log("C3 baza wskazuje na:", `${u.hostname}:${u.port}`, (u.hostname==="127.0.0.1"||u.hostname==="localhost") && u.port==="54322" ? "= LOKALNA, OK" : "= NIE JEST LOKALNA !!!");
} catch { console.log("C3 baza wskazuje na: NIE DA SIE ODCZYTAC"); }
const t = process.env.TOKEN_ENCRYPTION_KEY;
console.log("C4 dlugosc klucza szyfrujacego:", t ? Buffer.from(t,"base64").length + " bajtow (wymagane 32)" : "BRAK");
console.log("C5 BETTER_AUTH_URL:", process.env.BETTER_AUTH_URL === "http://localhost:3000" ? "OK" : "powinno byc http://localhost:3000");
console.log("C6 ANTHROPIC_API_KEY:", process.env.ANTHROPIC_API_KEY ? "jest" : "brak (opcjonalny)");
console.log("C7 RESEND_API_KEY:", process.env.RESEND_API_KEY ? "USTAWIONY - uwaga, maile pojda naprawde" : "nieustawiony, OK");
'
fi
```

### C1 — pliki istnieją
- **Po polsku:** „pliki z ustawieniami i hasłami do lokalnej bazy. Nie ma ich w
  projekcie celowo — hasła nigdy nie trafiają do repozytorium."
- **Zalicza:** liczy się wynik złożenia obu plików (C2–C7), a nie obecność
  konkretnego z nich. Brak jednego z dwóch przy komplecie wartości to ✅, nie ⚠️.
- **Brak obu / brakujące wartości:** **poproś właściciela projektu**. Podaj jej
  gotową treść wiadomości:
  > „Potrzebuję plików `.env` i `.env.local` do SprintFlow — po sklonowaniu repo
  > ich nie ma, a bez nich nie uruchomię aplikacji."
- **Ty:** *możesz* zaproponować wygenerowanie pliku roboczego (lokalna baza +
  losowe klucze `openssl rand -base64 32`), ale **powiedz uczciwie, czego
  zabraknie**: bez klucza Anthropic nie zadziała Refinement Helper. Wykonaj
  wyłącznie po jej wyraźnej zgodzie i nigdy nie nadpisuj istniejącego pliku.

### C2 — wymagane wartości
- **Zalicza:** wszystkie sześć obecne i niepuste.
- **Brak którejś:** ❌, droga jak w C1 — to plik od właściciela. Nie zgaduj, w
  którym z dwóch plików wartość „powinna" być; interesuje Cię tylko wynik
  złożenia.

### C3 — baza MUSI być lokalna 🔴
- **Zalicza:** host `127.0.0.1` (lub `localhost`) i port `54322`.
- **Uwaga:** `.env` w tym projekcie wskazuje na bazę **zdalną** — i tak ma być.
  Chroni Was `.env.local`, który ją nadpisuje. Dlatego sprawdzasz wartość
  **po złożeniu obu plików**: to ta, której faktycznie użyje aplikacja.
- **Nie zalicza:** **przerwij wszystko.** Nie uruchamiaj `db:migrate`, nie
  uruchamiaj aplikacji, nie zapisuj nic do bazy. Napisz:
  > Ustawienia wskazują na bazę, która nie jest Twoją lokalną. Zatrzymuję się
  > tutaj — uruchomienie czegokolwiek mogłoby zmienić prawdziwe dane. Napisz do
  > właściciela projektu, zanim pójdziemy dalej.
- To jedyne sprawdzenie, którego wynik unieważnia cały resztę raportu.

### C4 — klucz szyfrujący
- **Zalicza:** po odkodowaniu dokładnie **32 bajty**.
- **Nie zalicza:** logowanie i zapis tokenów przestaną działać w sposób, który
  wygląda na losowy błąd. ❌, pliki od właściciela.

### C5 — adres aplikacji
- **Zalicza:** dokładnie `http://localhost:3000`.
- **Nie zalicza:** zaloguje się i natychmiast wyloguje. ⚠️ z konkretem.

### C6 — klucz Anthropic (opcjonalny)
- **Brak:** ⚠️. Napisz konkretnie: „zakładka **Refinement** nie wygeneruje
  oceny — pokaże komunikat o braku konfiguracji. Reszta aplikacji działa
  normalnie. Pomiń testy manualne dotyczące Refinement Helpera."

### C7 — Resend (poczta)
- **Zalicza:** **nieustawiony**. Wtedy maile lądują w logach, nie w internecie.
- **Ustawiony:** ⚠️ — „testowe maile mogą pójść do prawdziwych skrzynek".
  Zaproponuj zakomentowanie tej linii; wykonaj tylko za zgodą.

---

## D. Baza danych

```bash
echo "D1 --- supabase status ---"; npx supabase status 2>&1 | head -20
echo "D2 port 54322: $(nc -z -G 2 127.0.0.1 54322 >/dev/null 2>&1 && echo OTWARTY || echo ZAMKNIETY)"
```

Dalsze kroki tylko jeśli **C3 = lokalna** i **D2 = otwarty**:

```bash
node --env-file-if-exists=.env --env-file-if-exists=.env.local -e '
const {Client} = require("pg");
const c = new Client({connectionString: process.env.DATABASE_URL});
c.connect()
 .then(() => c.query("select count(*)::int as n from drizzle.__drizzle_migrations"))
 .then(r => console.log("D4 zastosowane migracje:", r.rows[0].n))
 .catch(e => console.log("D4 migracje: BRAK (" + e.message.split("\n")[0] + ")"))
 .then(() => c.query("select count(*)::int as n from information_schema.tables where table_schema=$1", ["public"]))
 .then(r => console.log("D5 tabele w bazie:", r.rows[0].n))
 .catch(e => console.log("D5 tabele: blad -", e.message.split("\n")[0]))
 .finally(() => c.end());
'
echo "D4b plikow migracji w projekcie: $(ls src/db/migrations/*.sql | wc -l | tr -d ' ')"
echo "D5b tabel oczekiwanych wg kodu:  $(grep -A1 'pgTable(' src/db/schema.ts | grep -oE '\"[a-z_]+\"' | tr -d '\"' | grep -v '^id$' | sort -u | wc -l | tr -d ' ')"
```

### D1 — usługi Supabase
- **Zalicza:** w wyniku pada zdanie `supabase local development setup is running`
  i wypisuje się lista adresów (Studio, Mailpit, DB URL).
- 🔴 **Nie panikuj przy `Stopped services: [...]`.** Na zdrowym środowisku
  `imgproxy`, `edge_runtime` i `pooler` są wyłączone celowo — projekt ich nie
  używa. To **nie jest** awaria i nie zgłaszasz tego jako problem. Liczy się
  wyłącznie zdanie o `running` oraz sprawdzenia D2–D4.
- **Po polsku:** „baza danych projektu i jej panel podglądu".
- **Nie działa** (błąd, pusto, „not running"): `npx supabase start`. Za pierwszym
  razem 2–5 minut i wymaga internetu — pobiera obrazy. **Wymaga działającego
  Dockera (A4)** — jeśli A4 = ❌, oznacz D jako ⬜ i napraw najpierw A4.
- **Ty:** bezpieczna naprawa, po zgodzie. Uprzedź o czasie, żeby nie myślała,
  że się zawiesiło.

### D2 — port bazy
- **Zalicza:** port `54322` otwarty. To potwierdzenie D1 od drugiej strony.

### D3 — połączenie (zawarte w komendzie wyżej)
- **Zalicza:** zapytanie się wykonuje. Jeśli `connect()` rzuca błąd, baza stoi,
  ale odrzuca hasło z `.env.local` → ❌, pliki od właściciela (C1).

### D4 — migracje
- **Zalicza:** liczba z bazy **równa** liczbie plików `.sql` w projekcie.
- **Po polsku:** „struktura bazy — tabele, w których siedzą dane. Musi pasować
  do wersji kodu."
- **Mniej / brak:** `npm run db:migrate`. Trwa kilka sekund.
- **Ty:** naprawa dozwolona, **ale wyłącznie gdy C3 potwierdziło bazę lokalną**.
  Nigdy inaczej, nawet na prośbę.
- **Więcej w bazie niż plików:** baza jest nowsza niż kod → prawdopodobnie stary
  branch. ⚠️, skieruj do właściciela; nie „naprawiaj" cofaniem migracji.

### D5 — tabele
- **Zalicza:** liczba tabel w bazie ≥ liczba tabel oczekiwanych przez kod.
- Sprawdzenie zdroworozsądkowe. Rozbieżność przy zaliczonym D4 zgłoś jako ⚠️
  do właściciela — nie próbuj naprawiać.

---

## E. Aplikacja

Wykonuj **dopiero gdy A–D są zielone**. Przy jakimkolwiek ❌ oznacz E jako ⬜.

```bash
echo "E1 port 3000: $(lsof -ti tcp:3000 >/dev/null 2>&1 && echo ZAJETY || echo WOLNY)"
```

### E1 — port 3000
- **Zajęty:** albo aplikacja już chodzi (sprawdź E2), albo wisi po poprzedniej
  sesji. Nie zabijaj procesu bez pytania — zapytaj, czy ma coś uruchomionego.

### E2 — aplikacja odpowiada
- **Uruchomienie:** `npm run dev` w tle. **Zapytaj o zgodę** — to pierwszy krok,
  który faktycznie uruchamia aplikację.
- Po starcie poczekaj na gotowość i sprawdź:
  ```bash
  curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login
  ```
- **Zalicza:** kod `200`.
- **Nie zalicza:** pokaż jej **ostatnie 15 linii** logu z `npm run dev` i
  przetłumacz błąd na polski. Nie wklejaj całego logu.
- Nie zostawiaj procesu w tle bez uprzedzenia — powiedz, że aplikacja działa
  i jak ją zatrzymać (Ctrl+C w terminalu / zamknięcie karty).

### E3 — co dalej
Gdy E2 zalicza, zakończ instrukcją:
> Aplikacja działa: otwórz **http://localhost:3000**. Załóż konto na dowolny
> adres e-mail, a potem wejdź w **Ustawienia → Dane demo** i kliknij wczytanie
> danych demonstracyjnych — bez tego wszystkie ekrany będą puste.

Jeśli zapyta o maile (reset hasła, podsumowanie dzienne): przy nieustawionym
`RESEND_API_KEY` (C7) **żaden mail nie wychodzi na zewnątrz** — jego treść
pojawia się w terminalu, w logu `npm run dev`. Tam ich szukajcie.

---

## F. Opcjonalnie — czy sam kod jest sprawny

**Nie uruchamiaj z automatu.** Zaproponuj tylko wtedy, gdy A–E są zielone, a coś
mimo to zachowuje się dziwnie.

```bash
npm run typecheck     # ok. 30 s — czy kod się w ogóle spina
npm test              # ok. 1 min — testy automatyczne, nie dotykają bazy
```

Jeśli któreś nie przechodzi na świeżo sklonowanym repo, to **nie jest jej wina**
— to defekt do zgłoszenia właścicielowi. Powiedz to wprost.
