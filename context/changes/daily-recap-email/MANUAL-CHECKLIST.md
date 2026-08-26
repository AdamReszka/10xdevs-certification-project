# S-11 Daily Recap — manual checklist (owner side)

> Pięć pozycji. Wszystko poza nimi jest zielone automatycznie i **nie jest tu
> powtarzane**: 550 testów jednostkowych, 210 integracyjnych, `typecheck`,
> `lint`. Reszta — wiersze deferred, długi cross-slice — siedzi w
> `context/foundation/manual-test-backlog.md`.

**Jak to się ma do `plan.md` `## Progress`** (który zostaje kanoniczny): każdy
wiersz niesie numer fazy, do której należy. Odhacz go w tej fazie w `## Progress`,
kiedy przejdzie.

---

## ⚠️ Zanim zaczniesz — dwie rzeczy specyficzne dla tego slice'a

**1. Bez zweryfikowanej domeny w Resend nic się nie wyśle.** To jednorazowe
zadanie operatorskie, nie kod:

1. Załóż konto na resend.com, dodaj domenę `sprintflow.pl`.
2. Wklej rekordy SPF / DKIM / DMARC do Cloudflare DNS (`sprintflow.pl` ma tam
   DNS i **nie ma rekordów MX**, więc to zadanie w panelu, nie migracja
   rejestratora).
3. `wrangler secret put RESEND_API_KEY` oraz `wrangler secret put
   RESEND_FROM_ADDRESS` (np. `SprintFlow <recap@sprintflow.pl>`).

Oba **muszą** być Workers *secrets*, nie `vars` — zwykłe `vars` rozwiązują się do
`null` w `getCloudflareContext().env` na tej wersji OpenNext. `RESEND_FROM_ADDRESS`
nie jest wrażliwy; jest sekretem wyłącznie z tego powodu.

**Do czasu, aż to zrobisz, lokalny dev używa transportu konsolowego** — logu
`[email] no RESEND_API_KEY — not sending. to=… subject=…` — i wszystkie bramki
automatyczne dalej przechodzą. Nic się nie blokuje poza wierszami 1, 2 i 3 niżej.

**2. Które konto.** `demo@sprintflow.test` trzyma **prawdziwe** credentiale
GitHub/Jira na tej maszynie; `adam.reszka85@gmail.com` trzyma zasiane fejki.
Nazewnictwo jest odwrócone względem intuicji, więc **identyfikuj cel po last4
tokena, nigdy po nazwie konta.** `npm run db:seed:demo` kasuje obie tabele
credentiali swojego celu — żaden wiersz poniżej go nie potrzebuje.

---

## 1. (faza 3) Reset hasła dowozi prawdziwy e-mail

**Gdzie:** wdrożony Worker, `/reset`. Konto z adresem, do którego masz dostęp.

**Co zrobić:**
1. W panelu Resend sprawdź, że `sprintflow.pl` ma SPF, DKIM i DMARC na zielono.
2. Wejdź na `/reset`, podaj adres istniejącego konta, wyślij.
3. Otwórz skrzynkę, kliknij link w mailu.
4. `wrangler tail` (albo panel Workers → Logs) na ten sam request.

**Co musi być prawdą:**
- Mail przychodzi od nadawcy z domeny `sprintflow.pl` (nie `onboarding@resend.dev`).
- Link ląduje na `/reset/confirm` i pozwala ustawić nowe hasło, po którym da się
  zalogować.
- **W logu Workera nie ma URL-a resetu.** Ani w całości, ani samego tokena.

**Co to łapie:** to jest najtańszy możliwy konsument transportu — jeśli tu
zadziała, to klucz API, weryfikacja domeny i DKIM są ustawione, zanim zależy od
nich znacznie większa powierzchnia recapa. A URL resetu jest sekretem na
okaziciela: wyciek do logu oznacza przejęcie konta przez każdego, kto ma dostęp
do logów.

---

## 2. (faza 5) Pierwszy prawdziwy recap zgadza się z dashboardem

**Gdzie:** wdrożony Worker, konto `demo@sprintflow.test` (to z prawdziwymi
credentialami, last4 `B9D0`).

**Co zrobić:**
1. Na `/settings/recap` ustaw godzinę na kilka minut w przyszłość i zapisz.
2. Poczekaj na najbliższy tick crona (`*/15`), maksymalnie ~15 minut.
3. Otwórz maila obok `/dashboard` w drugim oknie.

**Co musi być prawdą:**
- Lista anomalii w mailu jest **ta sama i w tej samej kolejności** co w Anomaly
  Inbox — te same opisy, te same jednolinijkowe sugerowane akcje, co do znaku.
- Anomalia `DEVELOPER_INACTIVE` (to konto ma dziś jedną z `source_url` = NULL)
  renderuje się jako **zwykły tekst z akcją**, a nie jako martwy link — w HTML nie
  ma dla niej `<a href>`, jest zdanie „No direct link".
- Stopka podaje czas ostatniego udanego synca osobno dla GitHuba i Jiry.

**Co to łapie:** rozbieżność inbox↔mail to nagłówkowe ryzyko tego slice'a i
jedyny wariant, którego automat nie zamyka — testy dowodzą, że obie
powierzchnie wołają tę samą funkcję, ale nie że wynik czyta się sensownie w
prawdziwym kliencie pocztowym. Gałąź NULL-owego `source_url` jest w **pierwszym
mailu, jaki ten system w ogóle wyśle**.

---

## 3. (faza 5) Kolejny tick nie wysyła drugiego maila

**Gdzie:** ta sama skrzynka, zaraz po wierszu 2.

**Co zrobić:** odczekaj dwa kolejne ticki crona (~30 minut) i odśwież skrzynkę.
Potem `select recap_day, send_status, attempt_count from daily_recap order by
recap_day desc limit 3;` na bazie produkcyjnej.

**Co musi być prawdą:**
- W skrzynce jest **dokładnie jeden** recap za dzisiaj.
- Jest **dokładnie jeden** wiersz `daily_recap` na dzisiejszy `recap_day`, ze
  statusem `SENT` i `attempt_count = 1`.

**Co to łapie:** gwarancja exactly-once jest w bazie (`unique(owner_id,
recap_day)` + claim-first insert), a nie w aplikacji. Testy integracyjne
dowodzą jej na lokalnym Postgresie; ten wiersz dowodzi, że na produkcji cron
faktycznie wchodzi w tę ścieżkę, a nie omija ją np. przez inną strefę czasową.

---

## 4. (faza 6) Zmiana godziny zapisuje się i widać ostatnią wysyłkę

**Gdzie:** `/settings/recap` (zakładka **Daily recap** w Settings).

**Co zrobić:**
1. Wejdź w Settings — zakładka „Daily recap" musi być widoczna w pasku.
2. Zmień „Earliest send time" na inną godzinę, kliknij **Save**.
3. Przeładuj stronę (F5).

**Co musi być prawdą:**
- Pojawia się toast „Daily recap settings saved."
- Po przeładowaniu pole pokazuje **nową** godzinę, nie starą.
- Sekcja „Last send" opisuje ostatni recap z wiersza 2 (`Last recap sent for
  <data>.`), a nie „No recap has been sent yet".
- Tekst pod polem godziny mówi wprost, że to **najwcześniejszy** czas i że
  SprintFlow sprawdza co 15 minut.

**Co to łapie:** cron ma rozdzielczość 15 minut, więc nie jest w stanie dotrzymać
dokładnej minuty. Picker, który po cichu zaokrągla, jest defektem; ten wiersz
sprawdza, że powiedzieliśmy o tym użytkownikowi. Plus: „Last send" to jedyne
miejsce w produkcie, gdzie w ogóle widać, czy wysyłka zadziałała.

---

## 5. (faza 6) Wyłączenie zatrzymuje wysyłkę

**Gdzie:** `/settings/recap`, to samo konto.

**Co zrobić:**
1. Przestaw „Send me a daily recap" na off, zapisz.
2. Następnego dnia po ustawionej godzinie sprawdź skrzynkę i bazę.
3. Osobno: na `/settings/connections` kliknij zmianę projektu Jira i **przeczytaj
   ostrzeżenie, nie potwierdzaj go**.

**Co musi być prawdą:**
- Nazajutrz nie ma maila i **nie ma nowego wiersza** `daily_recap` (skip
  następuje przed claimem, więc baza zostaje czysta).
- Ostrzeżenie przy zmianie projektu Jira wymienia **„daily recaps"** wśród
  rzeczy, które kasuje — obok sprintów, ticketów i historii statusów.

**Co to łapie:** `enabled: false` jest jedynym wyłącznikiem w tym slice'ie — nie
ma preference centre ani double-opt-in — więc musi działać naprawdę. A
`daily_recap` kaskaduje po `sprint`: przełączenie projektu Jira kasuje archiwum
recapów razem ze sprintami. To świadomie zaakceptowana konsekwencja (naprawa
należy do S-12), ale potwierdzenie, które niedomawia, co kasuje, jest defektem.

---

## Poza tą listą

- **Bounce/complaint handling nie istnieje** i to jest świadome (plan §What We're
  NOT Doing). 200 od Resenda znaczy „przyjęte", nie „dostarczone", więc wiersz
  `SENT` niczego nie dowodzi o doręczeniu. Przy `requireEmailVerification: false`
  literówka w adresie rejestracji dostaje maila codziennie i codziennie twardo
  odbija — tak umiera reputacja świeżej domeny. Zamknięcie tego to webhook
  Resenda + ścieżka bounce → `enabled: false`, zapisane jako zakres **S-12**.
  Do tego czasu: **jeśli w panelu Resend zobaczysz bounce'y, wyłącz recap dla
  tego konta ręcznie.**
- Historia recapów (lista + drill-down) i purge to **S-12 / FR-019**.
