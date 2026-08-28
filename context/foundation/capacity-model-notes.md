# Capacity w MD, Velocity w SP — notatki domenowe

> Wejście do `/10x-frame` dla następnej zmiany. Spisane 2026-08-27 z rozmowy
> z właścicielem produktu. **Plik nie jest jeszcze przypisany do żadnej zmiany
> i celowo nie został zacommitowany na gałęzi S-13** — ma przetrwać `/clear`,
> a nie wejść do PR #54.

## 1. Problem, słowami właściciela

> „Capacity jest w SP. To nie do końca jest zgodne z życiową prawdą. Capacity
> powinno być w man days i się przeliczać na SP."

> „Jak mamy komplet, czyli np. 6 developerów pracuje i nie mają urlopów, sprint
> ma 20 dni, to mamy 120 MD. Wyobraź sobie, że to nowy zespół i pierwszy sprint.
> Dobieramy ileś zadań na ileś SP i patrzymy, ile nam dojechało — np. dobraliśmy
> 110 SP, zespół zrobił 90 SP, no to wiem, że było za dużo i na następny sprint
> celuję około 90 SP."

> „Mamy Velocity 90 SP a Capacity 120 MD i to jest relacja właściwa. Jak ktoś
> weźmie jeden dzień urlopu, to będziemy mieć 120 MD − 1 = 119. I procentowo też
> o to trzeba obniżyć te 90 SP, bo wiemy, że kogoś nie będzie 1 dzień."

> „Jak mamy sprint, gdzie były absencje i jakiś wynik velocity w SP, to jak
> chcesz to uwzględnić do średniej, trzeba najpierw podnieść velocity do takiego,
> jakby capacity było full — żeby do średniej nie trafiały wyniki ze sprintów
> z absencją i bez, tylko trzeba to przeliczać."

> „Nie znamy dziś relacji velocity (zrealizowanych SP) do Capacity, czyli
> pojemności — ile było dni roboczych razy ilość ludzi. Ta relacja może być
> dowolna, ale jest nam niezbędna. Musimy monitorować, ile robi pełny zespół."

## 2. Model formalnie

```
capacity_pełne    = Σ (współczynnik_etatu_osoby × dni_robocze_sprintu)
capacity_aktualne = capacity_pełne − Σ (dni absencji × współczynnik_etatu)
velocity          = SP faktycznie dowiezione w sprincie

velocity_znorm    = velocity × (capacity_pełne ÷ capacity_aktualne)
cel_SP            = średnia(velocity_znorm) × (capacity_aktualne ÷ capacity_pełne)
```

Jednostką capacity jest **MD**, jednostką velocity **SP**, a przelicznik między
nimi **wynika z historii** — nikt go nie wpisuje.

## 3. Rozstrzygnięcia właściciela

| Pytanie | Decyzja |
|---|---|
| Czy osoba wnosi zawsze 1 MD/dzień? | **Nie — ułamek etatu.** Pół etatu = 0,5 MD dziennie. To zastępuje `team_member.sp_capacity`. |
| Co pokazujemy? | **Capacity i Velocity obok siebie**, i robimy użytek z ich relacji. |
| Historia | **Gromadzić z całego cyklu życia zespołu**, nie tylko 2 poprzednie sprinty. |
| Pierwszy sprint bez historii | **Uczciwe „brak danych"**. Żadnych domyślnych przeliczników — SP są lokalne dla zespołu, więc każda wartość domyślna byłaby zmyślona i zostałaby wzięta za pomiar. |
| Ręczne wpisywanie dowiezionych SP przez leada | **Poza zakresem.** „To na przyszłość, nie na zaliczenie kursu." |

## 4. Dlaczego to poprawia Reliability — przykład właściciela

> „Wzięli 100 SP, zrobili 100 SP, no to reliability 100%. Ale jak będą urlopy
> i będzie połowa osób, to wezmą 50 SP, zrobią 50 SP, capacity będzie o połowę
> mniejsze, reliability będzie 100% przy połowie capacity — od razu będzie
> widać, z czego to wynika."

Sedno: **samo reliability jest dwuznaczne**. 100% przy pełnym zespole i 100%
przy połowie zespołu to dwa różne stany, a dzisiejszy wykres pokazuje je
identycznie. Capacity w MD jest brakującym mianownikiem, który je rozróżnia.

## 5. Stan obecny w kodzie

- `team_member.sp_capacity` (`schema.ts:318`) — nullable integer, **wpisywany
  ręcznie w SP**. Jedyny czytelnik: `src/lib/dashboard/capacity.ts`.
- `computeSprintCapacity` **już liczy proporcjonalnie**:
  `spCapacity × (dni dostępne ÷ dni robocze sprintu)`. Arytmetyka obniżania za
  absencje istnieje — zmienia się **jednostka i źródło prawdy**, nie rachunek.
- `countWorkingDaysInclusive` (`anomaly/rules/helpers.ts`) — jeden licznik dni
  roboczych, domknięty przedział.
- Dashboard → Availability renderuje dziś „**20 SP capacity for this sprint**".
  Ta etykieta jest **poprawna dla obecnego modelu** — liczba naprawdę jest w SP.
  Podmiana samego napisu na „MD" bez zmiany modelu zamieniłaby prawdziwą
  etykietę nad złym modelem na fałszywą. Naprawiać razem, nie osobno.

## 6. Konflikty i ryzyka do rozstrzygnięcia we `/10x-frame`

1. **Retencja.** PRD („Non-functional non-goals") mówi: brak danych poza sprint
   bieżący + 2 poprzednie. Właściciel chce historii z całego cyklu życia zespołu.
   Sprzeczność jest pozorna, jeśli rozróżnimy **dane surowe** (tickety, PR-y,
   commity — te podlegają retencji) od **agregatu per sprint** (capacity MD,
   dowiezione SP, velocity znormalizowane — kilkadziesiąt bajtów na sprint).
   Wymaga świadomej zmiany zapisu w PRD, nie cichego obejścia.
2. **Liniowość SP względem MD.** Normalizacja zakłada, że dzień absencji kosztuje
   1/N sprintu. Nie kosztuje — dzień urlopu jedynej osoby znającej moduł płatności
   kosztuje więcej. Model jest i tak istotnie lepszy od obecnego, ale w skrajnych
   przypadkach zawyża. Znane uproszczenie, nie blokada.
3. **Co znaczy „dowiezione".** SP ticketów, które przeszły do Done przed końcem
   sprintu? A tickety zamknięte po terminie, przeniesione, częściowo zrobione?
   Nierozstrzygnięte.
4. **Guardrail PRD o braku prognozowania.** „No ML / AI prediction for sprint
   outcomes… SprintFlow will not predict »this task won't fit in the sprint« or
   forecast sprint outcomes via models." Średnia arytmetyczna z historii nie jest
   modelem ML, ale `cel_SP` **jest prognozą**. Trzeba nazwać granicę.
5. **Zasięg zmiany.** Dotyka: `team_member` (schemat + kreator + edytor rostera),
   `capacity.ts`, zakładki Availability, KPI Reliability (FR-016), reguły
   `SPRINT_AT_RISK`, oraz FR-006 i FR-010 w PRD.

## 7. Następny krok

`/10x-frame` na nowej zmianie — wybór właściciela. Framing przed planem, bo
zmiana narusza jeden zapis PRD (retencja) i jedno pole schematu, a to warto
rozstrzygnąć, zanim powstanie plan implementacji.
