# Jak czytać backlog i gdzie odhaczać

Źródło kolejki: `context/foundation/manual-test-backlog.md` (po polsku, 67
otwartych wierszy na 2026-08-29).

## 1. Zanim wybierzesz pierwszy test

**Przeczytaj sekcję `## 5. Środowisko i pułapki`** w backlogu. Opisuje realne
pułapki tego środowiska — bez niej zgłosisz jako defekt coś, co jest znanym
zachowaniem. Nie streszczaj jej testerce; użyj jej sam(a), żeby nie prowadzić
jej w ślepą uliczkę.

## 2. Które sekcje są testami aplikacji

Backlog trzyma w jednym pliku rzeczy o różnym charakterze. **Do klikania w
interfejsie nadają się tylko niektóre.**

| Sekcja | Do sesji? | Dlaczego |
|---|---|---|
| `## 1` Teraz — blokuje S-10 | ✅ tak | testy aplikacji |
| `## 1a` S-16 sprint-reconciliation | ✅ tak | testy aplikacji |
| `## 2` Zaległości (S-07, S-04, F-03, F-01) | ✅ tak | testy aplikacji |
| `## 3` Zobowiązania dokumentacyjne | ❌ nie | to pisanie dokumentów, nie testy |
| `## 4` Deploy | ❌ nie | wymaga dostępu do Cloudflare, który ma właściciel |
| `## 5` Środowisko i pułapki | ❌ nie | instrukcja do przeczytania, nie test |
| `## 6` Już zweryfikowane | ❌ nie | zamknięte dowodowo, nie powtarzać |
| `## 7` S-15 team-management | ✅ tak | testy aplikacji |
| `## 8` S-08 absence-calendar | ✅ tak | testy aplikacji |
| `## 9` S-11 daily-recap | ⚠️ częściowo | podsekcja „Zablokowane do czasu Resenda" — pomiń |
| `## 10` S-14 anomaly-settings | ✅ tak | testy aplikacji |
| `## 11` S-23 capacity-in-man-days | ✅ tak | testy aplikacji |
| `## 12` S-09 demo-mode | ✅ tak | testy aplikacji |
| `## 13` S-04 kreator setupu | ✅ tak | testy aplikacji |

Ta tabela opisuje **stan na 2026-08-29**. Jeśli w backlogu przybyła sekcja,
której tu nie ma — oceń ją po treści (czy da się to wyklikać w przeglądarce?),
a nie po numerze.

## 3. Wybór kolejnego testu

1. Weź **pierwszy `- [ ]` od góry** w sekcji oznaczonej ✅.
2. **Pomiń wiersze z adnotacją, że nie wolno ich odhaczać ręcznie.** Dziś taki
   jest jeden: **11.15** („parasol manualnej weryfikacji — zamyka się sam, gdy
   padnie 6.6"). Zamyka się w konsekwencji innego wiersza, nie osobnym testem.
3. Pomiń wiersz, który ma już dopisany odnośnik `⛔ Nieudany:` — został
   sprawdzony i czeka na naprawę właściciela. Powiedz o tym testerce jednym
   zdaniem i idź dalej.
4. Kiedy pomijasz — **powiedz dlaczego**, jednym zdaniem, jej językiem:
   > Ten pomijam, bo dotyczy wysyłania maili, a to jeszcze nie jest podpięte.

Integracje Jira i GitHub **są u niej podpięte** — nie pomijaj wierszy dlatego,
że wymagają prawdziwych danych. To jest oczekiwany tryb pracy.

## 4. Wiersze, które trwale kasują dane 🔴

Backlog oznacza je znakiem 🔴. Na 2026-08-29 są to m.in.:

- **7.1 / 4.6** — trwałe usunięcie ostatniego członka zespołu
- **7.7 / 4.7** — merge dwóch wierszy rosteru
- **8.4 / 6.4** — bramka trwałego usunięcia absencji

Przy takim wierszu **ostrzegasz osobno przed krokiem, który kasuje** (Faza 4 w
`SKILL.md`) i zbierasz potwierdzenie. Nie chodzi o zniechęcanie — to jest
dokładnie ta ścieżka, którą trzeba przetestować — tylko o to, żeby nie
skasowała czegoś, myśląc, że klika podgląd.

## 5. Odhaczanie — DWA miejsca

`CLAUDE.md` mówi jasno: kanoniczne są plany, backlog jest indeksem. Odhaczenie
tylko w jednym miejscu odtwarza rozjazd, który już raz kosztował 68 otwartych
wierszy w planach przeciw 27 znanym backlogowi.

### 5a. Backlog

Zamień `- [ ]` na `- [x]` przy wierszu i dopisz datę:

```
- [x] **2.7** Kreator `/setup/team` nadal działa po przepięciu na
      `reconcile-sprint.ts`. **Zaliczone 2026-08-29** (sesja manualna).
```

### 5b. Źródłowy `plan.md`

Wiersz niesie `*Źródło:*` ze ścieżką i numerem linii. **Obie te informacje bywają
nieaktualne** — zweryfikowane 2026-08-29: **8 z 12 ścieżek nie istnieje**, bo
slice'y zostały zarchiwizowane.

**Ścieżka:** jeśli `context/changes/<slice>/plan.md` nie istnieje, szukaj w
archiwum — nazwa katalogu ma przedrostek z datą:

```bash
ls context/archive/*-<slice>/plan.md
```

**Numer linii:** zignoruj go. Pliki się zmieniły. **Znajdź wiersz po jego
numerze** w sekcji `## Progress`:

```bash
grep -n "^ *- \[ \] 2\.7 " context/archive/2026-08-26-sprint-reconciliation/plan.md
```

Wiersze w planach wyglądają tak (uwaga: **czasem z wiodącą spacją**, czasem bez):

```
- [ ] 2.7 The setup wizard's cadence step still works end to end after the repoint
 - [x] 1.1 Type checking passes: `npx tsc --noEmit` — 3048ba7
```

Zamień `[ ]` na `[x]` i dopisz na końcu ` — manual 2026-08-29`, zachowując
wcięcie oryginału. **Plany są po angielsku — trzymaj się tego.**

Nie znalazłeś wiersza w planie? **Nie zgaduj.** Odhacz backlog, a testerce
powiedz jednym zdaniem, że wpis w planie źródłowym wymaga ręcznego domknięcia
przez właściciela — i dopisz to w treści commita.

## 6. Nieudany test — odnośnik w backlogu

Wiersz zostaje `- [ ]`. Pod nim dopisujesz jedną linię:

```
      ⛔ **Nieudany 2026-08-29** — `context/manual-tests/S-16-2.7-kreator-kadencji.md`
```

Dzięki temu przy przeglądaniu zmian widać od razu, że wiersz był sprawdzany,
że padł i gdzie leży opis. Nie kasuj ani nie przepisuj treści wiersza.
