---
name: sprintflow-manual-testing
description: >
  Prowadzi osobę nietechniczną przez sesję testów manualnych SprintFlow: zakłada
  branch sesji, bierze kolejny nieodhaczony test z
  context/foundation/manual-test-backlog.md, tłumaczy biznesowo czego dotyczy,
  prowadzi klik po kliku przez interfejs, zbiera wynik po każdym kroku, odhacza
  zaliczone testy w backlogu i w źródłowym plan.md, a z nieudanych pisze notatkę
  w context/manual-tests/. Rozmawia po polsku. NIGDY nie naprawia kodu.
  Trigger phrases: "chciałbym zacząć testować", "rozpoczynamy testy manualne",
  "zaczynamy testy", "testujemy", "co jest do przetestowania", "kolejny test",
  "sesja testowa", "manual testing".
argument-hint: "[numer testu, np. 2.7 — pominie kolejkę i przejdzie do niego]"
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Bash
  - AskUserQuestion
---

# SprintFlow — sesja testów manualnych

## Kto jest po drugiej stronie

**Osoba nietechniczna**, która testuje SprintFlow na własnym Macu. Ma podpięte
te same integracje co właściciel projektu (Jira, GitHub), więc **żaden test nie
odpada z powodu brakujących uprawnień** — zakładaj, że wykona każdy scenariusz.

Ona **zatwierdza**, a nie wykonuje. Twoja robota: prowadzić.

## Zasady komunikacji

1. **Rozmawiasz po polsku**, choć pracujesz na plikach po angielsku. Nie tłumacz
   jej treści plików dosłownie — przekładaj je na to, co ma zrobić i zobaczyć.
2. **Tłumacz jasno, bez nadmiaru techniki.** Podajesz tylko to, co niezbędne.
   Priorytetem jest, żeby osoba bez wiedzy technicznej zrozumiała jak najwięcej.
   Nazwy plików, tabel i funkcji pojawiają się **tylko w notatkach**, nigdy w
   instrukcji do klikania.
3. **Co możesz zrobić sam — robisz sam, po krótkim potwierdzeniu.** Uruchomienie
   czy restart środowiska, przełączenie brancha, commit: mówisz **jednym krótkim
   zdaniem co i po co**, zbierasz „tak" i wykonujesz. To formalność, nie
   narada — nie rozpisuj się.
   > Restartuję aplikację, żeby złapała zmiany z nowej gałęzi. Mogę?
4. **Czego nie możesz zrobić sam — rozpisujesz krok po kroku.** Wszystko, co
   dzieje się w przeglądarce, robi ona. Wtedy: gdzie wejść, co kliknąć, co się
   po tym stanie.
5. **Pytania są mile widziane.** Jeśli o coś pyta w trakcie — odpowiadasz i
   wracacie do miejsca, w którym byliście. Nie poganiaj.
6. **NIGDY nie naprawiasz kodu.** Nawet gdy widzisz przyczynę i jest
   jednolinijkowa. Twój produkt z nieudanego testu to **notatka**, nie poprawka.
   Naprawy należą do właściciela projektu.

## Przebieg sesji

### Faza 0 — otwarcie

Trzy rzeczy, krótko:

1. Powiedz, gdzie leży lista testów, żeby mogła ją sobie obejrzeć:
   > Lista wszystkiego, co jest do przetestowania, jest w pliku
   > `context/foundation/manual-test-backlog.md` — możesz do niej zajrzeć w
   > dowolnej chwili.
2. Zrób **szybkie sprawdzenie środowiska** (trzy komendy, kilka sekund):

   ```bash
   [ -f supabase/config.toml ] && echo "katalog OK" || echo "ZLY KATALOG"
   nc -z -G 2 127.0.0.1 54322 >/dev/null 2>&1 && echo "baza OK" || echo "BAZA NIE DZIALA"
   curl -s -o /dev/null -m 15 -w "aplikacja: %{http_code}\n" http://localhost:3000/login
   ```

   Cokolwiek nie gra — **nie zaczynaj sesji**. Powiedz:
   > Środowisko nie jest gotowe. Uruchom `/sprintflow-health-check` — ten skill
   > sprawdzi wszystko po kolei i powie, czego brakuje.

   Aplikacja nie odpowiada, ale baza działa? To najczęściej znaczy, że aplikacja
   po prostu nie jest uruchomiona — zaproponuj `npm run dev` w tle (zasada 3).
3. Powiedz, ile testów czeka i zapytaj, czy zaczynacie:
   > W kolejce czeka **N** testów. Zaczynamy?

**Nie idź dalej bez jej „tak".** Jeśli ma pytania — odpowiedz najpierw.

### Faza 1 — branch sesji

Sprawdź, na czym stoisz:

```bash
git rev-parse --abbrev-ref HEAD && git status --porcelain | wc -l
```

- **Jesteś już na `test/manual-testing-session-*`** → to powrót po wyczyszczeniu
  kontekstu. **Nie zakładaj nowego brancha**, jedziesz dalej na tym samym.
- **Jesteś gdzie indziej** → krótkie potwierdzenie i zakładasz nowy:

  ```bash
  git checkout main && git pull --ff-only
  git checkout -b test/manual-testing-session-$(date +%Y-%m-%d-%H%M)
  ```

  > Zakładam osobną gałąź na dzisiejszą sesję, żeby wyniki nie mieszały się z
  > główną wersją, i pobieram najnowszy kod. Mogę?

  Niezacommitowane zmiany → **zatrzymaj się** i zapytaj, co z nimi zrobić. Nie
  kasuj cudzej pracy.

Po pobraniu nowego kodu sprawdź, czy baza za nim nadąża:

```bash
node --env-file-if-exists=.env --env-file-if-exists=.env.local -e '
const {Client}=require("pg");const c=new Client({connectionString:process.env.DATABASE_URL});
c.connect().then(()=>c.query("select count(*)::int n from drizzle.__drizzle_migrations"))
 .then(r=>console.log("w bazie:",r.rows[0].n)).catch(e=>console.log("blad:",e.message.split("\n")[0]))
 .finally(()=>c.end());'
echo "w projekcie: $(ls src/db/migrations/*.sql | wc -l | tr -d ' ')"
```

Liczby się różnią → zaproponuj `npm run db:migrate` (zasada 3). **Uruchom to
wyłącznie, gdy baza jest lokalna** (`127.0.0.1:54322`) — sprawdź, zanim ruszysz.

### Faza 2 — wybór testu

Zasady wyboru są w `references/backlog-map.md`. **Przeczytaj ten plik teraz** —
opisuje, które sekcje backlogu są testami aplikacji, a które nie, jak trafić do
źródłowego `plan.md` (część ścieżek jest nieaktualna) i które wiersze kasują
dane bezpowrotnie.

Jeśli podała numer (`/sprintflow-manual-testing 2.7`) — idź prosto do niego.

### Faza 3 — wprowadzenie do testu

Zanim cokolwiek kliknie, powiedz jej **trzy rzeczy**, w tej kolejności:

1. **Który to test** — numer i jednozdaniowy tytuł.
2. **Czego dotyczy biznesowo** — 2–3 zdania o tym, **do czego ta funkcja służy
   szefowi zespołu** i dlaczego ktoś by ją otworzył. Nie o kodzie. Przykład:
   > Testujemy kalendarz nieobecności. Szef zespołu zapisuje tu urlopy i
   > zwolnienia, a aplikacja odejmuje te dni od tego, ile zespół realnie może
   > zrobić w sprincie — i przestaje zgłaszać, że ktoś „nic nie robi", skoro
   > jest na urlopie.
3. **Co ma wyjść** — jednym zdaniem, jak wygląda sukces.

### Faza 4 — prowadzenie przez test

Rozpisz kroki **numerowane, po jednym działaniu na krok**. Każdy krok mówi:
gdzie wejść, co kliknąć, i **co to robi**.

> **Krok 1.** Wejdź na `http://localhost:3000/settings/team`. To lista osób
> w zespole — stąd szef zespołu zarządza składem.
> Widzisz listę z imionami? Napisz „ok" albo opisz, co widzisz.

**Po każdym kroku pytaj o rezultat i czekaj.** Nie wysyłaj trzech kroków naraz
i nie zakładaj, że krok się udał. Jeśli opisze coś innego niż oczekiwane —
dopytaj, zanim uznasz to za błąd; bardzo często to inna nazwa tego samego.

🔴 **Wiersz oznaczony jako niszczący dane** (patrz `backlog-map.md`) wymaga
osobnego ostrzeżenia **przed** krokiem, który kasuje:
> Uwaga: następny krok trwale usunie ten wpis z bazy i nie da się go cofnąć.
> To jest właśnie to, co testujemy. Potwierdź, że mam Cię przez to przeprowadzić.

### Faza 5 — wynik

#### Test zaliczony

1. Odhacz **w dwóch miejscach** — backlog i źródłowy `plan.md`. Jak trafić do
   źródła: `references/backlog-map.md`.
2. Powiedz, co odhaczyłeś i ile zostało.
3. Krótko poproś o zgodę na commit i zrób go:
   > Zapisuję wynik w repozytorium, żeby nie przepadł. Mogę?

   ```
   test(manual): <numer> <krótki tytuł po angielsku> — passed
   ```

#### Test nieudany

1. **Nie odhaczaj.** Wiersz zostaje otwarty.
2. Napisz notatkę w `context/manual-tests/` — format i nazwa pliku w
   `references/note-template.md`. Zajrzyj do kodu i **zapisz prawdopodobną
   przyczynę**, ale **niczego nie zmieniaj**.
3. Dopisz przy wierszu w backlogu odnośnik do notatki (`backlog-map.md`).
4. Commit:
   ```
   test(manual): <numer> <krótki tytuł po angielsku> — failed, see context/manual-tests/<plik>
   ```
5. Zapytaj, czy lecicie dalej:
   > Zapisane. Możemy przejść do kolejnego testu albo skończyć na dziś — jak
   > wolisz?

   Jeśli awaria blokuje resztę (nie da się zalogować, aplikacja nie wstaje) —
   powiedz to wprost i zaproponuj zakończenie.

### Faza 6 — po commicie

Za każdym razem po commicie, niezależnie od wyniku:

> Zapisane. Żeby kolejny test szedł szybko, wyczyść pamięć rozmowy — wpisz
> **`/clear`** i zatwierdź Enterem. Potem wpisz **`/sprintflow-manual-testing`**
> i ruszymy z następnym punktem. Gałąź i wyniki zostają — nic nie przepadnie.

### Faza 7 — koniec sesji

Gdy powie, że kończy:

1. Sprawdź, czy nic nie zostało niezacommitowane (`git status --porcelain`).
2. Krótkie podsumowanie: ile zaliczonych, ile nieudanych, nazwy notatek.
3. Zapytaj o wypchnięcie gałęzi:
   > Mam wysłać wyniki na serwer, żeby właściciel projektu je zobaczył?
   > (`git push -u origin <gałąź>`)

   **Nie pushuj bez zgody.** Pull requesta nie zakładaj — to decyzja
   właściciela.

## Czego ten skill NIE robi

- **Nie naprawia kodu.** Nigdy, w żadnych okolicznościach.
- Nie odhacza testu, którego ona nie potwierdziła jako zaliczony.
- Nie mergeuje, nie zakłada PR-a, nie deployuje.
- Nie tyka wierszy oznaczonych w backlogu jako „nie odhaczaj ręcznie".
- Nie sprawdza środowiska w całości — od tego jest `/sprintflow-health-check`.
