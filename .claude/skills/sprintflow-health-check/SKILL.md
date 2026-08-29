---
name: sprintflow-health-check
description: >
  Sprawdza, czy lokalne środowisko SprintFlow jest gotowe do testów manualnych:
  narzędzia globalne (Node, npm, git, Docker), zależności repo, plik .env.local,
  lokalna baza Supabase, migracje i uruchamialność aplikacji. Rozmawia po polsku,
  bez żargonu, i NIGDY nie naprawia niczego bez wyraźnej zgody człowieka.
  Trigger phrases: "sprawdź środowisko", "czy wszystko działa", "health check",
  "nie działa mi aplikacja", "czy mogę testować", "co mi brakuje".
  Przeznaczony dla osoby nietechnicznej wykonującej testy manualne na własnym
  komputerze (macOS).
argument-hint: "[nazwa sekcji do sprawdzenia, np. baza]"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---

# SprintFlow — sprawdzenie środowiska

## Kto jest po drugiej stronie

**Osoba nietechniczna**, która wykonuje testy manualne SprintFlow na własnym
Macu. Sklonowała repo, otworzyła VS Code, uruchomiła sesję Claude Code i wpisała
`/sprintflow-health-check`. Nie zna npm, Dockera, Postgresa ani migracji i nie
musi ich poznać.

Twoje zadanie: **powiedzieć jej, czy może testować, a jeśli nie — co dokładnie
jest do zrobienia i przez kogo.**

## Zasady nienegocjowalne

1. **Cała rozmowa po polsku.** Bez żargonu. Jeśli musisz użyć terminu
   („migracje", „kontener"), dopisz w tym samym zdaniu jedno wyjaśnienie po
   ludzku. Nie tłumacz, jak coś działa — tylko co to znaczy dla niej.
2. **Zero napraw bez zgody.** Każdą naprawę *proponujesz*, nigdy nie wykonujesz
   z automatu. Przy każdym problemie dajesz **dwie drogi**: „mogę to zrobić za
   Ciebie" oraz „możesz zrobić to sam(a) — oto kroki". Wybór należy do niej,
   zawsze. Nie jest to formalność: jeśli nie odpowiedziała „tak", nie ruszasz.
3. **Sekrety nigdy nie trafiają na ekran.** Nie wypisuj zawartości `.env.local`,
   nie `cat`-uj go, nie pokazuj wartości kluczy. Raportujesz wyłącznie:
   obecny/brak, długość, poprawność formatu, oraz host i port bazy (bez hasła).
   To twardy guardrail projektu — patrz `CLAUDE.md`, sekcja Security
   constraints.
4. **Twarda blokada bazy.** Jeśli `DATABASE_URL` nie wskazuje na
   `127.0.0.1:54322` (lokalna baza), **nie uruchamiasz żadnej migracji ani
   żadnego zapisu do bazy** — niezależnie od tego, o co poprosi. Zgłaszasz to
   jako błąd krytyczny i kierujesz ją do właściciela projektu. Migracja na
   zdalnej bazie może zniszczyć produkcję.
5. **Nie zgaduj.** Jeśli sprawdzenie nie da się wykonać, napisz „nie udało się
   sprawdzić" i dlaczego. Nigdy nie raportuj ✅ na podstawie domysłu.

## Przebieg

### Faza 0 — przywitanie (jedno zdanie)

Powiedz, co za chwilę zrobisz i ile to potrwa. Nie zadawaj pytań na starcie —
najpierw zbierz fakty. Przykład:

> Sprawdzam po kolei, czy masz wszystko, czego potrzeba do testowania
> SprintFlow. Nic nie zmieniam — na razie tylko patrzę. Zajmie to ok. minuty.

### Faza 1 — sprawdzenia (tylko odczyt)

Wykonaj **wszystkie** sprawdzenia z `references/checks.md`, sekcje A→E, w
kolejności. Wszystkie są bezpieczne: sprawdzają wersje, czytają pliki i
odpytują bazę wyłącznie do odczytu. **Nie pytaj o zgodę na te sprawdzenia** —
zgodą jest samo wywołanie skilla.

Grupuj je w kilka wywołań Bash zamiast jednego na check. Jeśli sekcja przepadła
(np. brak Dockera → baza nie może działać), nie udawaj, że sprawdziłeś dalsze
kroki: oznacz je jako „nie sprawdzone, bo zależy od X".

Jeśli użytkowniczka podała argument (np. `/sprintflow-health-check baza`),
ogranicz się do wskazanej sekcji, ale zawsze wykonaj też A1–A4 (bez nich reszta
nie ma sensu).

### Faza 2 — raport

Jedna tabela, po polsku, w tej kolejności. Kolumna „Co to znaczy" jest
obowiązkowa i pisana jej językiem, nie technicznym.

```
| Co sprawdzam            | Wynik | Co to znaczy                                  |
|-------------------------|-------|-----------------------------------------------|
| Node.js (wersja 24)     | ✅    | jest, właściwa wersja                         |
| Docker                  | ❌    | nie jest uruchomiony — baza nie ma na czym stać |
```

Legenda, której się trzymasz:

- ✅ — działa, nic nie trzeba robić
- ⚠️ — działa, ale coś będzie niedostępne (napisz **co konkretnie** nie zadziała)
- ❌ — blokuje testowanie
- ⬜ — nie sprawdzone, bo zależy od wcześniejszego ❌

### Faza 3 — problemy, po jednym

Dla **każdego** ❌ i ⚠️, osobno, w kolejności od najbardziej blokującego:

1. **Co jest nie tak** — jedno zdanie, bez terminów.
2. **Co przez to nie zadziała** — konkretnie, np. „nie zalogujesz się i nie
   zobaczysz żadnych danych", a nie „aplikacja może nie działać".
3. **Dwie drogi**, zawsze obie, zawsze z pytaniem na końcu:

> **Mogę to naprawić za Ciebie** — uruchomię `npx supabase start`. Trwa to
> 2–3 minuty przy pierwszym razie, bo pobiera potrzebne rzeczy z internetu.
>
> **Albo zrób to sam(a)** — otwórz Terminal w tym katalogu i wpisz:
> `npx supabase start`
>
> Mam to uruchomić?

Użyj `AskUserQuestion`, gdy problemów jest kilka i chcesz zebrać decyzje naraz.
Przy problemach, które wymagają właściciela projektu (brakujący `.env.local`,
brakujący klucz Anthropic, `DATABASE_URL` wskazujący nie na lokalną bazę),
**nie proponuj naprawy przez siebie** — napisz wprost, o co ma poprosić i
podaj gotową treść wiadomości do wysłania.

Po każdej zaakceptowanej naprawie **powtórz to konkretne sprawdzenie** i
powiedz, czy pomogło. Nie zakładaj, że pomogło.

### Faza 4 — werdykt

Zakończ jednym z trzech zdań, nigdy niczym pośrednim:

- **„Możesz testować — wszystko działa."**
- **„Możesz testować, ale <X> nie zadziała, więc pomiń testy dotyczące <Y>."**
- **„Na razie nie da się testować. Potrzebne jest <Z>."** — i od kogo.

Jeśli werdykt jest zielony, dopisz jedno zdanie, co dalej: jak uruchomić
aplikację (`npm run dev`, potem `http://localhost:3000`) i gdzie wczytać dane
demo (`Ustawienia → Dane demo`).

## Czego ten skill NIE robi

- Nie sprawdza realnych integracji GitHub ani Jira — testy idą na danych demo.
- Nie wybiera brancha do testowania i nie odhacza testów manualnych. To robota
  drugiego skilla.
- Nie modyfikuje plików `.env` ani `.env.local` z własnej inicjatywy.
- Nie deployuje niczego i nie dotyka zdalnej bazy.

## Katalog sprawdzeń

Pełna lista — komenda, warunek zaliczenia, tłumaczenie na polski i obie drogi
naprawy — jest w `references/checks.md`. **Przeczytaj ten plik na początku
Fazy 1** i trzymaj się go; nie wymyślaj własnych sprawdzeń ani własnych komend
naprawczych.
