# S-16 sprint-reconciliation — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md`. Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Konto:** wszystkie wiersze poza 3 wymagają konta z **prawdziwymi** credentialami
Jiry. Na lokalnej bazie to `demo@sprintflow.test` — nazwy kont są mylące, patrz
`manual-test-backlog.md` §5. Identyfikuj po `token_last4`, nigdy po nazwie.

⚠️ **Nie odpalaj `db:seed:demo` na koncie z prawdziwymi tokenami** — seed je kasuje.

---

## Faza 2

- [ ] **2.7 — kreator nadal działa po przepięciu na reconciler** *(faza 2)*

  **Gdzie:** `/setup/team`, konto z prawdziwymi credentialami Jiry.

  **Co zrobić:**
  1. Wejdź na `/setup/team` i przejdź do kroku kadencji.
  2. Zobacz, co pokazuje pole nazwy sprintu i długości sprintu.
  3. Jeśli monitorowany projekt ma **więcej niż jedną** tablicę scrumową —
     sprawdź, czy nadal renderuje się wybór tablicy (chooser), i wybierz jedną.

  **Co musi być prawdą:** krok kadencji pokazuje nazwę **aktualnie aktywnego**
  sprintu z Jiry i wyliczoną długość (nie „14 dni" z defaultu, chyba że sprint
  faktycznie trwa 14 dni). Przy wielu tablicach chooser się pojawia i po wyborze
  kadencja się dociąga. Żaden ekran nie wyrzuca błędu.

  **Dlaczego to ma znaczenie:** Faza 2 wypatroszyła `importCadence` — board
  selection i upsert przeniosły się do `reconcile-sprint.ts`. Testy
  integracyjne pokrywają ścieżkę serwisową, ale **nie** pokrywają tego, że
  Server Action → formularz → chooser nadal się spinają. To jedyna ścieżka,
  która dziś istnieje w produkcie; jeśli ją zepsuliśmy, kreator jest martwy.

---

## Faza 3

- [ ] **3.6 / 3.8 — rollover na prawdziwych danych** *(faza 3)*

  **Gdzie:** Jira (panel admina/scrum mastera) + `/settings/connections`.

  **Co zrobić:**
  1. W Jirze zamknij bieżący sprint i wystartuj nowy.
  2. W SprintFlow wejdź na `/settings/connections` → kliknij **„Sync now"**.
  3. Poczekaj aż sync się zakończy (status zielony, świeży timestamp).
  4. Sprawdź w bazie: `select jira_sprint_id, name, state from sprint where owner_id = '<id>';`

  **Co musi być prawdą:** istnieje wiersz z `jira_sprint_id` **nowego** sprintu
  i `state = 'ACTIVE'`; poprzedni sprint ma `state = 'CLOSED'`;
  `select count(*) from sprint where owner_id = '<id>' and state = 'ACTIVE'`
  zwraca dokładnie **1**.

  **Dlaczego to ma znaczenie:** to jest cały sens slice'u (FR-007). Jeśli ten
  wiersz nie przechodzi, S-16 nie dowiózł niczego — a wygląda na dowiezione,
  bo sync raportuje zielono. Dokładnie ten tryb porażki (zielony sync + pusty
  dashboard) uzasadnił powstanie tej zmiany.

- [ ] **3.7 — dashboard renderuje nowy sprint** *(faza 3)*

  **Gdzie:** Dashboard „Today", zaraz po wierszu 3.6.

  **Co zrobić:** otwórz „Today" po zakończonym syncu.

  **Co musi być prawdą:** Anomaly Inbox i Sprint Pulse pokazują ticket'y
  **nowego** sprintu (nie starego, nie pusto), a timestamp ostatniego udanego
  syncu jest świeży.

  **Dlaczego to ma znaczenie:** reconcile może poprawnie zapisać wiersz `sprint`,
  a mimo to dashboard będzie czytał stary — `getActiveSprintRow` sortuje po
  `start_date desc`, więc źle zapisana data cofa nas do punktu wyjścia.

- [ ] **Nadpisana kadencja przeżywa cykl _i rollover_** *(faza 3)*

  **Gdzie:** `/setup/team`, potem `/settings/connections`.

  **Co zrobić:**
  1. Na `/setup/team` ustaw **własną** długość sprintu (np. 21 dni zamiast
     auto-wyliczonych) i zapisz.
  2. Kliknij „Sync now". Sprawdź, że `length_days` się **nie** zmieniło.
  3. Teraz zrób rollover w Jirze (zamknij sprint, otwórz nowy) i zsynchronizuj
     ponownie.
  4. Sprawdź `length_days` i `cadence_overridden` na **nowym** wierszu sprintu.

  **Co musi być prawdą:** po kroku 2 `length_days = 21`, po kroku 4 **nowy**
  wiersz też ma `length_days = 21` i `cadence_overridden = true`.

  **Dlaczego to ma znaczenie:** druga połowa **nie jest opcjonalna**. Cykl na
  tym samym sprincie idzie gałęzią CONFLICT, która nigdy nie była zagrożona;
  rollover idzie gałęzią INSERT, gdzie `importCadence` wpisuje na sztywno
  `cadence_overridden: false`. To najbardziej szkodliwy i całkowicie cichy
  sposób, w jaki ten slice może zawieść — a użytkownik nie ma jak przywrócić
  nadpisania, bo `/setup/team` to jedyny mount `CadenceForm` (S-19 poza zakresem).

- [ ] **Okno pustki po rollowerze** *(faza 3)*

  **Gdzie:** Dashboard „Today", w trakcie pierwszego syncu po rollowerze.

  **Co zrobić:** odświeżaj „Today" wielokrotnie od momentu kliknięcia
  „Sync now" aż do zakończenia cyklu.

  **Co musi być prawdą:** ewentualny pusty inbox trwa **sekundy**, nie minuty —
  i znika sam, bez ponownego klikania „Sync now".

  **Dlaczego to ma znaczenie:** transakcja zapisująca nowy sprint commituje się
  przed transakcją przestemplowującą ticket'y, więc krótkie okno pustki jest
  udokumentowane i zaakceptowane. Jeśli trwa dłużej niż sekundy, znaczy że
  reconcile i pull **nie** są w jednym cyklu — a wtedy owner widzi pusty inbox
  bez żadnego bannera błędu, co łamie US-01.

---

## Faza 4

- [ ] **4.6 — zmiana projektu Jiry w kreatorze kasuje stary sprint** *(faza 4)*

  **Gdzie:** `/setup/jira` na koncie lokalnym (**nie** na tym z prawdziwymi
  tokenami — ten wiersz celowo niszczy dane).

  **Co zrobić:**
  1. Ustaw projekt A, dojedź kreator do końca tak, żeby powstał wiersz `sprint`.
  2. Wróć do kroku Jiry i wybierz **inny** projekt (B).
  3. Sprawdź: `select count(*) from sprint where owner_id = '<id>';`

  **Co musi być prawdą:** zero wierszy `sprint` po zmianie projektu — tak samo
  jak robi to już ścieżka z `/settings/connections`.

  **Dlaczego to ma znaczenie:** to jest wejście do udokumentowanego incydentu
  `jira_sprint_id=1001` — sprint z demo-seeda przeżywał podłączenie prawdziwej
  Jiry i był cicho przepinany pod prawdziwy projekt, przez co sync raportował
  zielono, a dashboard był pusty.
