# S-08 — manual checklist (owner side)

> **Wszystkie pozycje przeniesione do `context/foundation/manual-test-backlog.md` §8
> (2026-08-26).** Ten plik jest teraz wskaźnikiem, nie listą do odhaczania.

## Co się stało

Checklista miała pięć pozycji (6.4, 4.5, 2.3, 2.4+2.5, 6.5). **Żadna nie została
wykonana** — decyzja właściciela pod termin kursu, podjęta świadomie: *„teraz ich
nie wykonam"*. Slice idzie do merge'a bez weryfikacji manualnej.

To nie jest to samo co „nie było czego testować". Automaty pokrywają logikę:

| | |
|---|---|
| testy unitowe | 433 / 34 pliki |
| testy integracyjne | 154 / 14 plików (prawdziwy Postgres) |
| mutacje | 78.96% przy progu break 70 |
| review implementacji | 10 znalezisk, 7 naprawionych, 0 krytycznych |
| CI na PR #50 | `test` ✅ + `integration` ✅ |

Czego **nie** pokrywają: pięciu ścieżek przeglądarkowych. Nie ma harnessu do
testów komponentów (bez jsdom, bez RTL — `context/foundation/test-plan.md`), więc
wszystko, co dzieje się między kliknięciem a renderem, jest niezweryfikowane.

## Gdzie to teraz jest

`context/foundation/manual-test-backlog.md` §8, w kolejności nadrabiania:

| Backlog | Był | Temat |
|---|---|---|
| **8.4** 🔴 | 6.4 | Bramka trwałego usunięcia członka z historią |
| 8.5 | 4.5 | Absencja gasi `DEVELOPER_INACTIVE` bez czekania na sync (D1) |
| 8.6 | 2.3 | Zapis przeżywa odświeżenie z właściwymi dniami |
| 8.7 | 2.4 + 2.5 | Edycja i usuwanie trafiają we właściwy wiersz |
| 8.8 | 6.5 | Seed demo pokazuje trzy efekty FR-010 (wejście dla S-09) |
| 8.1–8.3 | 5.5–5.7 | Siatka dostępności, proporcja pojemności, brak `sp_capacity` |

## Jedna pozycja jest inna niż reszta

**8.4 (dawne 6.4) to jedyny wiersz dotykający ścieżki, która nieodwracalnie
kasuje dane.** S-08 jest pierwszym slice'em, który realnie uzbraja bramkę
usuwania z S-15: dopóki `absence` miała zero wierszy, `getMemberHistory` zawsze
zwracała 0 i gałąź „ten człowiek ma historię, nie pozwól go skasować" **nigdy się
nie wykonała na produkcyjnej ścieżce**. Kosztuje ~3 minuty.

Pozostałe cztery psują się widocznie — zły dzień w tabeli, anomalia, która nie
znika, dialog mówiący „this item". 8.4 psuje się **cicho**, kasując ręcznie
wprowadzone dane.

## `plan.md` zostaje kanoniczny

Wiersze manualne w `## Progress` **pozostają nieodhaczone** i takie mają zostać,
dopóki ktoś ich faktycznie nie przeklika. Odhaczając cokolwiek w backlogu §8,
odhacz też tam — inaczej `## Progress` skłamie.
