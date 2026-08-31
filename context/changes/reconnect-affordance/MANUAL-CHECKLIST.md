# S-31 reconnect-affordance — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md` (§24). Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Nic tutaj nie kasuje danych.** Ten slice zmienia wyłącznie wygląd i teksty —
żadnej migracji, żadnej zmiany w bazie, żadnej nowej akcji serwerowej. Każdy
wiersz poniżej kończy się na patrzeniu albo na `Cancel`. To jest też powód, dla
którego warto go zrobić w całości: jeśli któryś z tych ekranów kłamie, lead
kliknie przycisk, który **naprawdę** kasuje.

**Konto:** wiersze 1–3 i 5 wymagają **prawdziwego** konta z podłączonym
GitHubem **i** Jirą (karta Connections nigdy nie pokazuje danych demo). Wiersz 4
wymaga tego samego konta z **załadowanym demo**.

---

## Faza 2 — karta w Ustawieniach

- [ ] **1 — rząd trzech zadań, z jednym wyróżnionym** *(faza 2, zamyka `2.5`
      i `2.6`)*

  **Gdzie:** `/settings/connections`, prawdziwe konto, obie integracje
  podłączone.

  **Co zrobić:** popatrz na kartę **GitHub**, potem na kartę **Jira**. Nic nie
  klikaj.

  **Co musi być prawdą:** na każdej karcie **Test connection** stoi **osobno,
  nad** zdaniem opisowym — nie w rzędzie z pozostałymi. Pod nim jest zdanie
  zaczynające się od „Three jobs live here", które wymienia w cudzysłowie
  **dokładnie te trzy napisy, które widać na przyciskach**: „Reconnect",
  „Change monitored repositories" (na karcie Jira: „Change monitored project")
  i „Disconnect". Poniżej jest rząd trzech kontrolek w tej kolejności:
  **Reconnect** (wypełniony, najmocniejszy na całej karcie), **Change
  monitored …** (obrysowany) i **Disconnect** (sam napis, bez ramki i bez tła —
  **najlżejszy element karty**).

  **Dlaczego to ma znaczenie:** to jest cały slice. Do tej pory te przyciski
  miały równą wagę i trzy z nich były nazwane mechanizmem, więc lead z wygasłym
  tokenem musiał zgadywać, który z nich nic go nie kosztuje. Jeśli
  **Disconnect** jest choćby równie mocny jak **Reconnect**, zmiana nie dotarła
  na ekran — a S-24 wprost zdecydował, że przycisk niszczący ma zostać
  najcichszy. Jeśli zdanie cytuje napis, którego na ekranie nie ma, tekst i kod
  się rozjechały.

- [ ] **2 — obietnica pod przyciskiem mówi prawdę, i to inną dla każdej
      integracji** *(faza 2, zamyka `2.7` i `2.11`)*

  **Gdzie:** `/settings/connections`, obie karty. Nic nie klikaj.

  **Co zrobić:** przeczytaj **całe** zdanie stojące bezpośrednio pod rzędem
  przycisków, najpierw na karcie GitHub, potem na karcie Jira.

  **Co musi być prawdą:**
  - **GitHub:** zdanie mówi, że ponowne wysłanie formularza wymienia token i
    „costs you nothing", a repozytoria i ich historia zostają. Jedyna
    wymieniona strata jest przypisana **odznaczeniu repozytorium**
    („Deselecting a repository is what removes …"). Zdanie **nie** grozi utratą
    commitów, PR-ów ani recenzji przy samym ponownym podłączeniu.
  - **Jira:** zdanie stawia warunek — „with the same project … costs you
    nothing" — a dopiero wskazanie **innego** projektu kasuje sprinty, ich
    tickety, historię statusów i anomalie, po czym „the next sync re-freezes the
    sprint's committed scope…". Ostatnie zdanie kieruje do **„Change monitored
    project"** jako do miejsca, gdzie ten sam koszt jest **pokazany przed
    pobraniem** — a **nie** jako do tańszej drogi. Nie ma tam słów w rodzaju
    „instead", „safely", „without losing", „avoid".

  **Dlaczego to ma znaczenie:** te dwa zdania są jedynym miejscem, w którym lead
  dowiaduje się, że rotacja tokena jest bezstratna. Gdyby oba brzmiały tak samo
  („na wszelki wypadek ostrożnie"), karta GitHuba groziłaby stratą, którą S-26
  **usunął** — dokładnie defekt, który S-26 naprawił jedno okno wyżej — i lead
  przestałby ufać obu. Odwrotnie: gdyby zdanie Jiry pominęło warunek „ten sam
  projekt" albo zamrożenie zobowiązania, obiecywałoby bezstratność tam, gdzie
  jej nie ma, i lead straciłby liczbę, której żaden sync nie odtworzy.

- [ ] **3 — otwarty edytor bierze własną linię, a obie karty trzymają
      równanie** *(faza 2, zamyka `2.8` i `2.10`)*

  **Gdzie:** `/settings/connections`, prawdziwe konto.

  **Co zrobić:**
  1. Kliknij **Change monitored repositories** na karcie GitHub i popatrz, co
     zrobił rząd przycisków.
  2. Zamknij go (**Back** / **Cancel**) i sprawdź, że rząd wrócił.
  3. Powtórz z **Change monitored project** na karcie Jira — zatrzymaj się na
     ekranie ostrzeżenia i wyjdź **Cancel**. ⚠️ **Nie klikaj** żadnego z dwóch
     przycisków akcji w ostrzeżeniu: one kasują sprinty.
  4. Na koniec popatrz na obie karty obok siebie w miejscu, gdzie jedna ma
     czerwony/żółty pasek błędu, a druga nie (jeśli akurat obie są zdrowe,
     wystarczy sprawdzić, że dolne bloki obu kart zaczynają się na tej samej
     wysokości).

  **Co musi być prawdą:** otwarty panel zajmuje **całą szerokość karty** we
  własnej linii, a **Disconnect** przechodzi pod niego — panel **nigdy** nie
  dzieli linii z **Reconnect**. Po zamknięciu wracają trzy kontrolki w jednej
  linii. Dolne bloki obu kart (od **Test connection** w dół) są wyrównane
  względem siebie, nawet gdy tylko jedna karta ma pasek błędu.

  **Dlaczego to ma znaczenie:** przycisk otwierający edytor dołączył do
  zawijanego rzędu, więc jego otwarty stan może próbować się w tym rzędzie
  zmieścić — wyszedłby ściśnięty panel obok przycisku, na ekranie, na którym
  lead właśnie decyduje o skasowaniu sprintów. Druga połowa pilnuje tego, co
  komentarz w kodzie nazywa wprost: **Test connection** został **wewnątrz**
  dolnego, przyklejonego bloku; gdyby ktoś przeniósł go wyżej, karty przestałyby
  się równać, gdy jedna z nich ma alert.

- [ ] **4 — w demo rząd jest wyłączony, a polskie zdanie nadal pod
      przyciskami** *(faza 2, zamyka `2.9`)*

  **Gdzie:** `/settings/connections`, to samo konto z **załadowanym demo**
  (baner na górze).

  **Co zrobić:** załaduj demo, wejdź na `/settings/connections`, popatrz na obie
  karty. Spróbuj kliknąć **Reconnect**.

  **Co musi być prawdą:** w rzędzie są **dwie** kontrolki — **Reconnect** i
  **Disconnect** — obie wyszarzone i nieklikalne (tak jak **Test connection**
  nad nimi). **Reconnect nigdzie nie prowadzi**: kliknięcie nie zmienia adresu.
  Przycisków **Change monitored …** w ogóle nie ma. Polskie zdanie
  („W trybie demonstracyjnym nic, co robisz…") stoi **pod** przyciskami.

  **Dlaczego to ma znaczenie:** karta Connections celowo pokazuje prawdziwe
  konto nawet w demo, więc każdy nowy element rzędu jest nową drogą z ekranu
  demo do prawdziwych danych. **Reconnect** został właśnie awansowany na
  najbardziej zachęcający przycisk na karcie — jeśli w demo pozostał linkiem,
  slice zrobił z niego najkrótszą drogę do nadpisania prawdziwego credentiala.
  Położenie polskiego zdania jest osobnym warunkiem, bo wiersz **16.C** w
  backlogu przypina je **pod** przyciskami, a przyciski się przesunęły.

---

## Faza 3 — kreator

- [ ] **5 — kreator ma wreszcie bezstratną drogę do nowego tokena** *(faza 3,
      zamyka `3.4`, `3.5`, `3.6` i `3.7`)*

  **Gdzie:** `/setup/github` i `/setup/jira`, prawdziwe konto z podłączonymi
  integracjami. Potem to samo w demo.

  **Co zrobić:**
  1. Wejdź na `/setup/github`. Popatrz na stopkę karty i przeczytaj zdanie nad
     nią, w treści karty.
  2. Kliknij **Reconnect**. Popatrz na nagłówek strony, na którą trafiłeś,
     potem kliknij **Back to connections**.
  3. Powtórz punkty 1–2 na `/setup/jira`.
  4. Załaduj demo i wejdź na oba te adresy jeszcze raz; spróbuj kliknąć
     **Reconnect** i **Disconnect**.

  **Co musi być prawdą:** w stopce są po lewej **Reconnect** (obrysowany) i
  **Disconnect** (sam napis, wyraźnie lżejszy), a po prawej **Continue** /
  **Continue to Jira** — nadal najmocniejszy. **Reconnect** prowadzi na
  `/settings/connections/github` z nagłówkiem **„Reconnect GitHub"**
  (odpowiednio **„Reconnect Jira"**), a **Back to connections** wraca na listę
  integracji. Zdanie w treści karty jest tym samym zdaniem co na karcie
  Ustawień, **minus** końcówka o „Change monitored …" — na tym ekranie **nie ma
  wolno** pojawić się nazwa kontrolki, której na nim nie widać. W demo oba
  przyciski są wyszarzone i **Reconnect nigdzie nie prowadzi**.

  **Dlaczego to ma znaczenie:** to najostrzejszy przypadek problemu, dla którego
  powstał ten slice. Do dziś jedyną drogą do wpisania nowego tokena z tego
  ekranu było kliknięcie **Disconnect** — czyli, na Jirze, ścieżki, która kasuje
  sprinty i zamrożone zobowiązanie sprintu. Lead robił nieodwracalną rzecz,
  bo nie było innej. Ostatni warunek (zdanie nie nazywa nieobecnej kontrolki)
  jest tą samą regułą, co cytowanie napisów w wierszu 1, tylko od drugiej
  strony: tekst wskazujący przycisk, którego czytelnik nie widzi, jest równie
  bezużyteczny jak tekst wskazujący przycisk, który już nie istnieje.

---

## Fazy 1, 4 i 5 — bez wierszy blokujących

**Faza 1** (moduł tekstów) nic nie zmienia na ekranie — jest w całości pokryta
`integration-card-copy.test.ts`, w tym asercją, że zdania nie mogą się rozjechać
z `disconnect-impact.ts`. **Faza 4** to testy przeglądarkowe; jej jedyny wiersz
manualny (`4.5`) to potwierdzenie, że druga sesja worktree stała bezczynnie
podczas przebiegu, i jest zamknięty. **Faza 5** ma jeden wiersz — `5.3` — który
jest przeczytaniem tej checklisty przez właściciela, nie klikaniem, i zamyka go
implementujący razem z nią.
