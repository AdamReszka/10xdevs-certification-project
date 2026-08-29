# Notatka z nieudanego testu — format

Cel: właściciel projektu otwiera pull requesta, widzi listę plików i **bez
czytania rozmowy** wie, co padło, jak to powtórzyć i gdzie zacząć szukać.

## Nazwa pliku

```
context/manual-tests/<SLICE>-<NUMER>-<krótki-opis>.md
```

Przykłady:

```
context/manual-tests/S-16-2.7-kreator-kadencji.md
context/manual-tests/S-14-3.5-zapis-progow-anomalii.md
context/manual-tests/S-08-6.4-usuwanie-absencji.md
```

`<SLICE>` bierzesz z nagłówka sekcji backlogu (`## 1a. S-16 …` → `S-16`).
**Nie pomijaj go** — numery wierszy powtarzają się między slice'ami (`2.7`
istnieje w kilku), a bez przedrostka druga notatka nadpisałaby pierwszą.
`<krótki-opis>` po polsku, małymi literami, myślniki zamiast spacji.

## Język

**Notatka po polsku.** Nazwy plików, funkcji, tabel i kolumn zostają po
angielsku — to identyfikatory, nie tekst.

## Szablon

```markdown
# <NUMER> — <tytuł testu>

- **Slice:** <S-XX nazwa>
- **Data:** <RRRR-MM-DD>
- **Gałąź:** <test/manual-testing-session-...>
- **Wynik:** ❌ nieudany
- **Wiersz w backlogu:** `context/foundation/manual-test-backlog.md` §<sekcja>
- **Wiersz w planie:** `<ścieżka do plan.md>` — `<numer>`

## Co miało się stać

<Warunek zaliczenia z backlogu, przepisany na jedno–dwa zdania.>

## Co się stało

<Obserwacja testerki, jej słowami. Zacytuj, jeśli opisała to konkretnie.
Nie „ubieraj" jej opisu w terminologię, której nie użyła.>

## Jak to powtórzyć

1. <krok>
2. <krok>
3. <krok — ten, na którym padło>

## Prawdopodobna przyczyna — HIPOTEZA, niezweryfikowana

<Co znalazłeś w kodzie. Odnośniki w formacie `ścieżka:linia`.
Pisz warunkowo: „wygląda na to, że", „prawdopodobnie".
NIE twierdź, że to JEST przyczyna — nikt tego nie potwierdził uruchomieniem.>

## Czego nie sprawdzono

<Co zostało poza zasięgiem tej sesji i mogłoby zmienić wnioski — np.
„nie sprawdzono, czy to samo dzieje się na danych demo".>

## Stan po teście

<Czy coś zostało w bazie w niedokończonym stanie? Czy trzeba posprzątać przed
kolejnym testem? Jeśli nie — napisz „bez śladów".>
```

## Zasady pisania notatki

1. **Rozdziel obserwację od hipotezy.** Sekcja „Co się stało" to fakty. Sekcja
   „Prawdopodobna przyczyna" to Twoje domysły z kodu i ma to być powiedziane
   wprost. Notatka, która myli jedno z drugim, wysyła właściciela w złą stronę.
2. **Wolno Ci czytać kod, nie wolno go zmieniać.** Żadnych poprawek, żadnych
   „przy okazji", nawet jednolinijkowych.
3. **Nie zgłaszaj znanych pułapek jako defektów.** Najpierw sprawdź `## 5.
   Środowisko i pułapki` w backlogu.
4. **Jeśli nie masz hipotezy — napisz, że jej nie masz.** Zmyślona przyczyna
   jest gorsza niż żadna, bo ktoś ją sprawdzi i straci na to czas.
5. **Sekcja „Stan po teście" jest obowiązkowa** przy wierszach 🔴 (kasujących
   dane). Kolejny test może startować z popsutego stanu i wtedy padnie
   niesłusznie.
