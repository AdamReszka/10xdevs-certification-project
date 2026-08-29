# Demo mode (S-09 / FR-008) — manual checklist

Cztery wiersze. Reszta weryfikacji jest w testach automatycznych (`npm test`,
`npm run test:integration`) i w `context/foundation/manual-test-backlog.md`.

> **Zmiana narzędzia:** `npm run db:seed:demo` **już nie istnieje**. Skrypt
> `scripts/seed-dashboard.mjs` został usunięty w fazie 5; dane demo wczytuje się
> teraz wyłącznie z aplikacji. Dawne ostrzeżenie „seed kasuje credentiale"
> przestało obowiązywać — patrz wiersz **D**, który to sprawdza.

---

## A. „Zobacz demo" wczytuje pełny dashboard w mniej niż 2 sekundy — faza 4

**Gdzie:** `/settings/demo`, na koncie bez podłączonej Jiry i GitHuba.

**Co zrobić:** zaloguj się → Ustawienia → zakładka **Demo** → kliknij
**„Zobacz demo"** → poczekaj na przeładowanie → przejdź na `/dashboard`.

**Co musi być prawdą:**
- Kliknięcie kończy się w **poniżej 2 sekund** (US-02 — brak wywołań zewnętrznych).
- Na górze każdego ekranu widać baner **„Jesteś w trybie demonstracyjnym"** z
  konkretną datą stanu danych.
- **Anomaly Inbox** ma co najmniej **cztery różne typy** anomalii, a każdy wiersz
  ma komplet: severity, opis, kontekst, sugerowaną akcję i link do źródła.
- W zakładce **Reliability** liczby są widoczne (nie stan „brak danych"), a panel
  szacowanej prędkości pokazuje wartość — nie komunikat o braku historii.
- W zakładce **Availability** nagłówek pojemności wymienia **dni wolne zespołu**.

**Dlaczego to łapie:** anomalie demo pochodzą z prawdziwego silnika detekcji na
zamrożonym zegarze. Jeśli fixture przestanie przekraczać domyślne progi
(`src/db/defaults.ts`), inbox będzie pusty przy wciąż zielonych testach
jednostkowych. Puste panele Reliability i Velocity to z kolei znak, że fixture
zgubił wiersze `sprint_measurement` — dwa z czterech paneli FR-016 otworzyłyby
się na stanie pustym w demie, którego celem jest pokazanie działającego produktu.

---

## B. Sprint Detail w demie renderuje wszystkie trzy sekcje — faza 4

**Gdzie:** `/dashboard/sprint-detail`, będąc w trybie demo.

**Co zrobić:** z `/dashboard` przejdź na Sprint Detail.

**Co musi być prawdą:**
- **Raport starzenia** listuje zadania posortowane po czasie od ostatniego ruchu,
  z kolumną **UNKNOWN** (WEB-97 ma niezmapowany status — to celowe).
- **Macierz aktywności** (Developer × Dzień) ma liczby, w tym wiersz
  `outside-contributor` spoza rosteru i komórki z „—" (commity bez churnu).
- **Sub-burndowny per technologia** rysują się dla FRONTEND / BACKEND / MOBILE / QA.

**Dlaczego to łapie:** Sprint Detail czyta z pięciu innych tabel niż Today.
Fixture, który zasila inbox, może nie zasilać reduktorów tego ekranu — a to
połowa tego, co US-02 obiecuje pokazać.

---

## C. Baner i wyjście z demo — faza 4

**Gdzie:** dowolny ekran w trybie demo.

**Co zrobić:** przejdź kolejno na `/dashboard`, `/dashboard/sprint-detail`,
`/settings/team`, `/settings/absences`, `/refinement` → na ostatnim kliknij
**„Wyjdź z demo"** w banerze.

**Co musi być prawdą:**
- Baner jest widoczny na **każdym** z tych ekranów.
- Po kliknięciu wracasz na swoje prawdziwe konto: baner znika, a `/settings/team`
  pokazuje **Twój** roster, nie sześcioosobowy zespół demo.
- Ustawienia → Demo oferuje teraz **„Wróć do demo"** (dane demo zostały
  zachowane), a nie ponowne „Zobacz demo".

**Dlaczego to łapie:** tryb siedzi w kolumnie bazy danych, nie w URL-u —
`/dashboard` wygląda identycznie w obu trybach. Baner jest jedyną rzeczą, która
mówi leadowi, że patrzy na fikcję; jeśli zniknie na którymkolwiek ekranie, dane
demo stają się nieodróżnialne od prawdziwych.

---

## D. ⚠️ Prawdziwe tokeny przeżywają load i reset — faza 4

**Gdzie:** `/settings/connections`, na koncie z **prawdziwie podłączonymi**
GitHubem i Jirą (na lokalnej bazie sprawdź **last4**, nie nazwę konta —
`context/foundation/manual-test-backlog.md` §5).

**Co zrobić:**
1. Zanotuj `token_last4` obu integracji na `/settings/connections`.
2. Ustawienia → Demo → **„Zobacz demo"**.
3. Otwórz `/settings/connections` **będąc w demie**.
4. Ustawienia → Demo → **„Usuń dane demo"**.
5. Otwórz `/settings/connections` ponownie.

**Co musi być prawdą:**
- W kroku 3 karty pokazują **prawdziwe** integracje z tymi samymi `last4`, a
  przyciski **„Sync now"** i **„Test connection"** są **wyszarzone** z
  wyjaśnieniem.
- W kroku 5 obie integracje są nadal podłączone, z **niezmienionymi last4**.

**Dlaczego to łapie:** to jedyna nieodwracalna ścieżka w tej zmianie. Poprzedni
skrypt seedujący `DELETE`-ował obie tabele credentiali po `owner_id`; przy
ustalonym zakresie („każde konto może wczytać demo") byłaby to utrata tokenów bez
możliwości odzyskania. Test integracyjny
`src/lib/demo/load.integration.test.ts` sprawdza to na poziomie wierszy — ten
wiersz sprawdza, że przez UI też nic tam nie sięga.

---

## E. Refinement i Daily Recap w demie nie wychodzą na zewnątrz — faza 5

**Gdzie:** `/refinement` i `/settings/recap`, w trybie demo.

**Co zrobić:** otwórz oba ekrany, spróbuj kliknąć przycisk uruchamiający analizę
i zapis ustawień recapu. Potem wyjdź z demo i otwórz oba ponownie.

**Co musi być prawdą:**
- `/refinement` pokazuje **zapisany przebieg** z werdyktami `DOR_MET`, `GAPS`
  **i** `NOT_VIABLE`; wszystkie przyciski „Sprawdź…" są wyszarzone z
  wyjaśnieniem.
- `/settings/recap` pokazuje podgląd recapu; **Save** jest wyszarzony, a kopia
  statusu **nie** mówi „is being sent right now".
- Po wyjściu z demo oba ekrany działają normalnie na prawdziwym koncie.

**Dlaczego to łapie:** demo nie może wydać ani jednego tokena Anthropic ani
wysłać maila w imieniu fikcyjnego zespołu. Serwer odmawia pierwszy (testy
jednostkowe to pilnują), ale jeśli kontrolki nie są wyłączone, lead odkryje to
dopiero po kliknięciu. Status `SENT` na wierszu recapu jest też tym, co trzyma
jedyny zegar przeglądarki w drzewie poza demem.
