# Notatki z nieudanych testów manualnych

Jeden plik = jeden test manualny, który **nie przeszedł**. Zakłada je skill
`/sprintflow-manual-testing` w trakcie sesji testowej; nikt nie pisze ich ręcznie.

**Testy zaliczone nie zostawiają tu śladu** — są odhaczane w
`context/foundation/manual-test-backlog.md` oraz w źródłowym `plan.md`. Ten
folder to wyłącznie lista rzeczy do naprawy.

## Nazewnictwo

```
<SLICE>-<NUMER>-<krótki-opis>.md      np. S-16-2.7-kreator-kadencji.md
```

Przedrostek slice'a jest obowiązkowy: numery wierszy powtarzają się między
slice'ami, więc bez niego notatki nadpisywałyby się nawzajem.

## Co jest w środku

Każda notatka rozdziela **obserwację** (co zobaczyła osoba testująca) od
**hipotezy** (co skill wywnioskował z kodu, nie uruchamiając niczego). Pełny
szablon: `.claude/skills/sprintflow-manual-testing/references/note-template.md`.

## Cykl życia

1. Test pada → powstaje notatka, wiersz w backlogu dostaje `⛔ Nieudany` z
   odnośnikiem tutaj, wiersz **zostaje nieodhaczony**.
2. Właściciel projektu naprawia i usuwa notatkę w tym samym commicie co poprawkę.
3. Wiersz wraca do kolejki i zostaje odhaczony dopiero po ponownym, udanym teście.

Notatka, która przeżyła swoją naprawę, jest myląca — usuwaj ją razem z fiksem.
