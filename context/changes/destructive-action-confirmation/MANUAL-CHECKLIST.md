# S-24 destructive-action-confirmation — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md`. Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Konto:** wiersze 2.5 i 2.6 wymagają konta z **prawdziwymi** credentialami
GitHuba i Jiry. Na lokalnej bazie to `demo@sprintflow.test` — nazwy kont są
mylące, patrz `manual-test-backlog.md` §5. Identyfikuj po `token_last4`, nigdy
po nazwie.

⚠️ **Nie odpalaj `db:seed:demo` na koncie z prawdziwymi tokenami** — seed je kasuje.

⚠️ **Żaden wiersz poniżej nie każe Ci klikać „Disconnect …" do końca.** Cały
sens tego slice'a to możliwość wycofania się. Gdybyś jednak potwierdziła
odłączenie, konto traci całą zsynchronizowaną historię **i ręcznie wpisane
nieobecności** — po stronie Jiry nic ich nie odtworzy.

---

## Faza 2

- [ ] **2.5 — Disconnect pyta, a Cancel niczego nie kasuje** *(faza 2)*

  **Gdzie:** `/setup/github`, konto z podłączonym GitHubem.

  **Co zrobić:**
  1. Wejdź na `/setup/github`. Powinna być widoczna karta „GitHub connected".
  2. Kliknij **Disconnect**.
  3. Przeczytaj treść okna, które się pojawi.
  4. Kliknij **Cancel**.

  **Co musi być prawdą:** po kroku 2 **nic się nie odłączyło** — pojawiło się
  okno z tytułem „Disconnect GitHub?", które wymienia *monitorowane
  repozytoria* oraz *commity, pull requesty i recenzje* jako rzeczy do
  skasowania, i osobno mówi, co **zostaje** (m.in. zespół, dni wolne, pomiary
  zamkniętych sprintów, połączenie z Jirą). Przyciski to **Cancel** i
  **Disconnect GitHub** — nie dwa razy „Disconnect". Po kroku 4 okno znika, a
  karta „GitHub connected" wygląda **dokładnie tak jak przed kliknięciem**:
  ten sam login, ta sama liczba repozytoriów, żadnego formularza „Connect".

  **Dlaczego to ma znaczenie:** to jedyna ścieżka, na której jeden klik kasował
  bezpowrotnie całą historię commitów, PR-ów i recenzji, bez żadnego pytania.
  Jeśli Cancel jednak coś skasował, dialog jest gorszy niż jego brak — daje
  fałszywe poczucie bezpieczeństwa.

- [ ] **2.6 — okno Jiry nazywa nieobecności po imieniu** *(faza 2)*

  **Gdzie:** `/settings/connections`, karta **Jira**, konto z podłączoną Jirą.
  Najlepiej takie, które ma co najmniej jedną wpisaną nieobecność
  (`/settings/absences`).

  **Co zrobić:**
  1. Wejdź na `/settings/connections`.
  2. Na karcie **Jira** kliknij **Disconnect**.
  3. Przeczytaj treść okna.
  4. Kliknij **Cancel**.

  **Co musi być prawdą:** okno mówi wprost, że kasowane są **wpisane ręcznie
  nieobecności i że nie da się ich zsynchronizować z powrotem** — nie samo
  „dane Jiry". Wymienia też sprinty, ticket'y, historię statusów i anomalie, a
  po stronie „zostaje": zespół, dni wolne całego zespołu, pomiary zamkniętych
  sprintów, połączenie z GitHubem oraz to, że **dotychczasowe raporty dzienne
  zostają**, tylko przestają być powiązane ze sprintem. Po Cancel na
  `/settings/absences` nadal widać tę samą nieobecność.

  **Dlaczego to ma znaczenie:** nieobecności to jedyna rzecz na tej liście,
  której żaden sync nie odtworzy — a poprzednie (i jedyne) ostrzeżenie w całej
  aplikacji pomijało je i w zamian wymieniało raporty dzienne, które w
  rzeczywistości **przeżywają**. Jeśli okno znowu je pominie, lead zgodzi się na
  utratę czegoś, o czym nie został poinformowany.

---

## Faza 3

- [ ] **3.6 — demo nie sięga prawdziwego konta** *(faza 3)*

  **Gdzie:** `/settings/connections`, konto z **załadowanym demo** (baner „Jesteś
  w trybie demonstracyjnym" na górze) i z prawdziwie podłączonymi integracjami.

  **Co zrobić:**
  1. Załaduj demo (`/settings/demo` → „Załaduj demo", jeśli nie jest aktywne).
  2. Wejdź na `/settings/connections`.
  3. Popatrz na obie karty — GitHub i Jira.

  **Co musi być prawdą:** przycisk **Disconnect** jest **wyszarzony i nieklikalny**
  na obu kartach (tak samo jak „Test connection"). Pod przyciskami jest zdanie po
  polsku, które wymienia, co dokładnie jest wyłączone — w tym *odłączenie
  integracji* oraz *zmiana monitorowanego projektu i repozytoriów*. Sekcje do
  zmiany projektu Jiry i wyboru repozytoriów **w ogóle się nie pojawiają**.

  **Dlaczego to ma znaczenie:** karta Connections celowo pokazuje **prawdziwe**
  konto nawet w demo. Do tej pory oznaczało to, że z ekranu demo można było
  jednym klikiem skasować prawdziwe dane — baner obiecywał „Twoje prawdziwe dane
  i integracje są nietknięte", a kod tego nie dotrzymywał.

- [ ] **3.7 — wyjście z demo i powrót niczego nie gubi** *(faza 3)*

  **Gdzie:** baner demo → `/settings/demo` → dowolny ekran z danymi demo.

  **Co zrobić:**
  1. W demo zmień coś drobnego, co da się zobaczyć — np. na `/settings/team`
     zmień imię jednego członka zespołu i zapisz.
  2. Wyjdź z demo (przycisk w banerze albo `/settings/demo` → „Wyjdź z demo").
  3. Wejdź ponownie w demo.
  4. Wróć na `/settings/team` i na `/dashboard`.

  **Co musi być prawdą:** po powrocie widzisz **ten sam** sprint demo i **tę samą
  zmianę**, którą zrobiłaś w kroku 1. Wyjście z demo niczego nie skasowało —
  kasuje wyłącznie osobny przycisk „Resetuj dane demo".

  **Dlaczego to ma znaczenie:** faza 3 dokłada sprawdzenie trybu demo do dziewięciu
  akcji serwerowych. Gdyby przy okazji zepsuła cykl życia demo, dane demo
  znikałyby przy każdym wyjściu — a właściciel wprost chce, żeby demo zostawało
  dostępne w każdej chwili.

---

**Faza 1 i faza 4 nie mają własnych wierszy manualnych.** Faza 1 nie dodaje
żadnego ekranu (to moduł + test), a faza 4 poprawia teksty i dokumenty —
zmienione zdania widać w wierszach 2.5, 2.6 i 3.6 powyżej.
