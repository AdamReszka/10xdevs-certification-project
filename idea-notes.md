# # SprintFlow - Notatki o pomyśle

> Aplikacja wspierająca tech leadów i scrum masterów w wykrywaniu anomalii w przepływie pracy zespołu poprzez integrację z Jirą i GitHubem.

---

## 1. Główny problem

Tech leadzi, scrum masterzy i kierownicy zespołów programistycznych pracujący w Scrumie nie mają pojedynczego, syntetycznego widoku na **zdrowie sprintu w czasie rzeczywistym**. Problemy w przepływie pracy (taski stojące w statusach, niezaeskalowane blokery, nierównomierna aktywność, pomijane review, brak commitów dla aktywnych tasków) są zauważane **za późno** - dopiero podczas retrospektywy lub gdy sprint już się sypie.

Konkretne pain pointy:

- **Brak wczesnych sygnałów ostrzegawczych** - task wisi 4h w "Ready for Review" zamiast 25 min średnio i nikt tego nie widzi, bo nikt nie monitoruje średnich
- **Rozproszone źródła danych** - status workflow jest w Jirze, aktywność deweloperska w GitHubie, a lider musi je ręcznie łączyć w głowie, żeby ocenić sytuację
- **Niespełnione DOR (Definition of Ready)** - taski wchodzą do sprintu niedostatecznie zrefinowane, bo refinement był zbyt pobieżny przez brak czasu
- **Niewidoczne blokery** - developer ma problem z taskiem, nie eskaluje, czas leci, a lider dowiaduje się dopiero gdy task nie zostanie zamknięty w sprincie
- **Brak korelacji workflow ↔ kod** - Jira mówi "in progress", ale w branchu zero commitów od 2 dni - prawdopodobnie ktoś utknął
- **Mierzymy KPI, ale tracimy detale** - ogólne wyniki niezłe, ale "drobnostki" (godziny opóźnienia tu i tam) zabijają potencjał zespołu

Aplikacja ma być **codzienną tablicą sytuacyjną lidera** - przy porannej kawie patrzysz na dashboard, widzisz 3-5 konkretnych anomalii z sugerowanymi akcjami i wiesz, co dziś prostować w zespole.

---

## 2. Najmniejszy zestaw funkcjonalności (MVP)

### 2.1 Autentykacja i zarządzanie kontem
- Rejestracja i logowanie (email + hasło)
- Reset hasła
- Wylogowanie

### 2.2 Setup wizard (onboarding)
- Wklejenie GitHub Personal Access Token
- Wklejenie Jira API token + URL workspace
- Wybór repozytoriów GitHub do monitorowania (multi-select)
- Wybór projektu Jira do monitorowania
- Mapowanie statusów Jiry na kategorie standardowe (To Do / In Progress / Code Review / Testing / Done)
- Dodanie członków zespołu (imię + GitHub username + Jira account ID + rola + capacity w story points/sprint)
- Konfiguracja sprintu (długość, dzień startu, working days)

### 2.3 Tryb demo (seed data)
- Przycisk "Załaduj zespół demo" w ustawieniach
- Skrypt seedujący wypełnia bazę realistycznymi danymi 6-osobowego zespołu (2 sprinty wstecz)
- Dwa scenariusze do wyboru: "Healthy Sprint" i "Sprint w kryzysie"
- Przycisk "Reset demo data" do czyszczenia

### 2.4 Konfiguracja progów anomalii
- PR review timeout (domyślnie 24h)
- Task w "Code Review" (domyślnie 16h) (domyślnie max. 3 taski, powyzej alert) (czy da się monitorować ilość niesprawdzonych PR przypiętych do tasków oraz czas od wystawienia PR do czasu akceptacji lub przypisania komentarzy aby monitorować czy mr nie za długo czeka na sprawdzenie?)
- Task w "Testing" (domyślnie 24h)
- Developer bez commita (domyślnie 2 dni)
- PR size warning (domyślnie >500 zmienionych linii)
- Scope creep threshold (domyślnie >20% nowych ticketów po starcie)
- Absencje członków zespołu w sprincie (prosty kalendarzyk: urlop, choroba, training)
- Ilość tasków w statusie "Testing", jeśli zbyt duza, ryzyko, ze tester nie zdązy przetestować (domyślnie 4 taski)
- Mozliwość skonfigurowania członków zespołu oraz przypisania ich do technologii w zespole (frontend, backend, mobile, qa)
- Monitorowanie analogicznie do wykresu spalania sprintu czy zadania w ramach danej technologii, w relacji do wycen w story pointach schodzą równomiernie, aby dało się monitorować czy deweloperzy w ramach jednej technologii są w stanie sobie pomóc i czy np. 2 dni przed końcem sprintu nie pozostaje połowa tasków do realizacji
- Task w "In progress" powyzej określonego czasu, w relacji do wycen w story pointach. Nie powiązujemy story pointów z czasem ale ustalamy progi, 1 SP oraz 2 SP - 24 godziny, 3 SP - 48 godzin, 5 SP - 72 godziny, 8 oraz 13 - 5 dni, 21 SP 8 dni roboczych, progi do konfiguracji przez uzytkownika
- Czy developer nie ma więcej niz 2 taski w "In Progress" (do konfiguracji)
- Alert - lista tasków w "to do" na 48h przed zakończeniem sprintu

### 2.5 Proste monitorowanie bazowych KPI
- Na początek Reliability, prezentacja na dashboardzie w postaci wykresu (Ile zrealizowanych SP vs Ile było podjętych SP)

### 2.6 Integracja z GitHub API
- Pobieranie listy commitów per użytkownik (autor, data, liczba zmienionych linii)
- Pobieranie listy PR-ów (autor, status, czas utworzenia, czas review, liczba review)
- Pobieranie informacji o review (reviewer, czas response, czas dodawania komentarzy)
- Cache wyników (1h) dla optymalizacji rate limitów

### 2.7 Integracja z Jira API
- Pobieranie ticketów aktywnego sprintu (status, assignee, story points, czas w statusie)
- Pobieranie historii zmian statusów ticketów
- Pobieranie informacji o sprincie (start, end, scope)
- Wykrywanie ticketów dodanych po starcie sprintu (scope creep)

### 2.8 Silnik wykrywania anomalii
Reguły obliczane na podstawie połączonych danych z Jiry i GitHuba:

- **PR_REVIEW_STALLED** - PR otwarty bez review > próg
- **TICKET_STATUS_AGING** - ticket przebywa w statusie > próg
- **DEVELOPER_INACTIVE** - brak commitów developera > próg
- **TICKET_NO_COMMIT_LINK** - ticket "In Progress", brak commitów w branchu
- **SPRINT_AT_RISK** - progress poniżej oczekiwań (liniowa progresja vs dzień sprintu)
- **PR_TOO_BIG** - PR przekracza próg rozmiaru
- **SCOPE_CREEP** - dodano zbyt dużo ticketów po starcie sprintu
- **PR_TICKET_DESYNC** - PR zmergowany, ale powiązany ticket nadal w "Code Review"

Każda anomalia ma: severity (low/medium/high), opis, kontekst, sugerowaną akcję, link do źródła. Konfiguracja anomalii.

### 2.8 Dashboard "Today"
- **Anomaly Inbox** - lista wykrytych anomalii uporządkowana priorytetem
- **Sprint Pulse** - burndown chart, scope changes, distribution ticketów per status
- **Yesterday's Activity** - commity per osoba (mini wykres), PR-y (opened/reviewed/merged), tickety przesunięte do Done

### 2.9 Dashboard "Sprint Detail"
- **Workflow Health** - aging report ticketów (uporządkowane po czasie od ostatniego ruchu), heatmapa czasów w statusach
- **Team Activity Matrix** - tabela Developer × Day z aktywnością (commits, lines, PRs, reviews)
- Wyróżnione anomalie i outliery

### 2.10 Daily Recap (raport dzienny)
- Cron job o ustalonej godzinie (domyślnie 15:00)
- Generowanie raportu w formacie tekstowym (anomalie, aktywność, sprint progress, sugestie)
- Wysyłka emailem na adres użytkownika
- Historia raportów dostępna w aplikacji (lista, drill-down)

### 2.11 Refinement Helper (AI-powered)
- Wklejenie description user story (lub wybór z listy ticketów Jiry)
- AI zadaje 5-8 pytań sprawdzających DOR (acceptance criteria, dependencies, edge cases, testability, estymowalność)
- User odpowiada lub zaznacza "N/A"
- Generowanie **DOR Compliance Score** + listy rzeczy do uzupełnienia
- Zapisanie historii sesji refinement

### 2.12 Prezentacja informacji, alertów, anomalii przekraczającej progi w odniesieniu do osób i technologii w czytelny uzyteczny sposób, uwzględniający severity i przezentujązy alerty w oparciu o wagę anomalii, zaczynajac od tych najbardziej pogłębiających ryzyko niedowiezienia sprintu

---

## 3. Co NIE wchodzi w zakres MVP

### 3.1 Aplikacja nie jest...
- ...narzędziem do zastępowania Jiry/Linear/GitHub - to **warstwa analityczna nad nimi**, nie kolejny task tracker
- ...narzędziem do oceny pracowniczej (1:1, performance review) - dane mają służyć liderom do **prostowania flow**, nie do rankingowania ludzi
- ...narzędziem do automatycznego zarządzania taskami (nie zmienia statusów, nie przypisuje, nie tworzy ticketów)
- ...narzędziem prognozowania ML (nie przewidujemy przyszłości na bazie modeli, tylko wykrywamy odchylenia od progów)
- ...aplikacją mobilną (tylko web responsive)
- ...rozwiązaniem enterprise (single-tenant, brak SSO, brak audit logów, brak GDPR compliance na poziomie enterprise)

### 3.2 Funkcjonalności świadomie odsunięte na "phase 2" lub dalej
- **Integracja Slack/Discord** - daily recap idzie na razie tylko emailem
- **GitHub OAuth + GitHub App** - na MVP wystarczy Personal Access Token
- **GitHub Enterprise** - tylko github.com w MVP
- **Multi-team / multi-project** - jeden user, jeden zespół, jeden projekt Jiry, kilka repo
- **Custom dashboards** - dashboardy są ustalone, brak konstruktora
- **Custom anomaly rules** - user ustawia tylko progi, nie tworzy własnych reguł
- **Historia długoterminowa** - przechowujemy dane bieżącego sprintu + 2-3 poprzednie, nie 2 lat
- **Trendy między sprintami** (ekran "History & Trends") - być może w MVP w okrojonej formie, ale głównie phase 2
- **Wsparcie dla innych task trackerów** (Linear, ClickUp, Asana) - tylko Jira Cloud
- **Wsparcie dla GitLab/Bitbucket** - tylko GitHub
- **Predykcje "task się nie zmieści w sprincie"** - tylko detekcja odchyleń od progów, bez ML
- **Tracking branchy / mapowanie ticket ↔ branch** - tylko proste pattern matching po ticket ID
- **Integracja z CI/CD** (build status, deployment frequency, DORA metrics) - nie w MVP
- **Achievement badges / gamifikacja** - nie w MVP
- **Komentarze, dyskusje, @mentions w aplikacji** - brak warstwy social
- **Eksport raportów do PDF** - tylko widok web + email
- **Multi-language UI** - tylko jeden język (polski lub angielski - do decyzji)
- **Tryb ciemny / customizacja UI** - jeden domyślny theme

### 3.3 Świadome uproszczenia w MVP
- Standardowy workflow Jiry (To Do / In Progress / Code Review / Testing / Done) - inne workflow obsługiwane tylko przez mapowanie
- Mapowanie GitHub user ↔ Jira user robione ręcznie (nie auto-discovery)
- Brak walidacji "czy podany ticket istnieje w Jirze" przed refinement
- Anomalie generowane przy każdym fetchu danych (brak persystencji historii anomalii)
- Brak retry/queue dla failed API calls (jeśli Jira/GitHub niedostępne - błąd na ekranie)

---

## 4. Kryteria sukcesu

### 4.1 Kryteria funkcjonalne (czy aplikacja działa)

- [ ] Użytkownik może założyć konto, zalogować się, wylogować i zresetować hasło
- [ ] Użytkownik może przejść setup wizard w mniej niż 10 minut i mieć skonfigurowaną apkę
- [ ] Tryb demo działa - jeden klik ładuje realistyczne dane zespołu i można eksplorować dashboard bez prawdziwych integracji
- [ ] Aplikacja poprawnie pobiera dane z GitHub API i Jira API (testowane na demo data + na min. jednym prawdziwym repo)
- [ ] Wszystkie 8 zdefiniowanych reguł anomalii działa poprawnie - dla zdefiniowanych scenariuszy demo wykrywa oczekiwane anomalie
- [ ] Dashboard "Today" pokazuje aktualne dane, aktualizuje się przy odświeżeniu
- [ ] Dashboard "Sprint Detail" pokazuje aging report i activity matrix
- [ ] Daily Recap jest generowany przez cron i wysyłany emailem o skonfigurowanej godzinie
- [ ] Refinement Helper potrafi przyjąć user story, zadać pytania DOR i wygenerować compliance score
- [ ] Użytkownik może zmieniać progi anomalii i widzi efekt po refresh
- [ ] Aplikacja działa responsywnie (desktop + tablet, mobile niekoniecznie idealne)

### 4.2 Kryteria użytkowe (czy aplikacja rozwiązuje problem)

Po uruchomieniu apki na zespole testowym (demo data + ewentualnie realny zespół), w ciągu **jednego sprintu** powinno wydarzyć się przynajmniej kilka z poniższych:

- [ ] Wykryta i pokazana liderowi **co najmniej 1 anomalia, której nie zauważyłby gołym okiem** (np. PR czekający na review 30h, ticket w "Code Review" 2 dni, developer bez commitów)
- [ ] Daily Recap zawiera **konkretną, actionable sugestię** ("ping reviewer dla PR #X", "check-in z osobą Y") - lider rozumie co zrobić bez interpretacji
- [ ] Refinement Helper pokazuje **co najmniej 2 brakujące elementy DOR** w typowym story napisanym pobieżnie - i to nie są oczywiste banały, tylko realnie pomijane rzeczy
- [ ] Korelacja Jira+GitHub generuje **co najmniej 1 anomalię niemożliwą do wykrycia osobno** (np. ticket "In Progress" + brak commitów; PR zmergowany + ticket nadal w "Code Review")
- [ ] Lider używający apki przez tydzień stwierdza, że **przynajmniej raz** podjął akcję na bazie alertu, której bez apki nie podjąłby na czas

### 4.3 Kryteria techniczne (poziom rzemiosła)

- [ ] Kod w TypeScript w Next.js, zorganizowany w czytelną strukturę modułów
- [ ] Reguły anomalii pokryte unit testami (każda reguła ma min. 2 test case'y: positive + negative)
- [ ] Integracja API ma obsługę błędów (rate limits, network errors, invalid tokens)
- [ ] Tokeny GitHub/Jira przechowywane zaszyfrowane w bazie
- [ ] Aplikacja deployowalna jednym poleceniem (Vercel deploy)
- [ ] Setup wizard waliduje wprowadzane dane (sprawdza czy token działa zanim zapisze)
- [ ] Brak hardkodowanych sekretów w repo, .env.example obecny

### 4.4 Kryteria demonstracyjne (czy da się to pokazać)

- [ ] Pełne demo aplikacji można pokazać w **10-15 minut** używając trybu demo (bez zależności od zewnętrznych API)
- [ ] Dwa scenariusze demo (healthy sprint vs sprint w kryzysie) pokazują różnicę w wykrywanych anomaliach
- [ ] Dashboard wygląda profesjonalnie i czytelnie (clean UI, sensowne wykresy, brak placeholder text)
- [ ] Daily Recap email wygląda jak coś, co realny lider chciałby dostawać codziennie

### 4.5 Definicja "Done" dla całego projektu kursowego

Projekt uznaję za **ukończony i udany**, jeśli:

1. ✅ Mogę pokazać aplikację w trybie demo komuś z branży (np. innemu tech leadowi) i ta osoba w ciągu 5 minut rozumie wartość produktu
2. ✅ Aplikacja faktycznie używa wszystkich kluczowych elementów z kursu 10xdevs (auth, baza, API integrations, AI, deployment)
3. ✅ Wszystkie funkcjonalności z sekcji 2 (MVP) działają na demo data
4. ✅ Kod jest na GitHubie, czytelny, z README opisującym setup
5. ✅ Aplikacja jest zdeployowana na Vercel i dostępna pod publicznym URL

---

## Notatki dodatkowe

### Stack techniczny (wstępnie, do uściślenia w kursie)
- **Frontend + Backend:** Next.js (SSR/App Router) + TypeScript
- **Baza danych + Auth:** Supabase (Postgres + Auth)
- **Hosting + Cron:** Vercel + Vercel Cron
- **Email:** Resend (free tier 3000 maili/m)
- **AI:** Claude API (Haiku 4.5 - tani, szybki) lub OpenAI GPT-4o-mini
- **Integracje:** GitHub REST API, Jira REST API v3

### Szacowany czas wykonania
- **Realistycznie:** 18-20h przy pełnym scope MVP
- **Z odcięciem Refinement Helpera i Sprint Detail:** ~15-16h
- **Buforowy plan:** zacząć od GitHub-only, Jira jako "phase 1.5" jeśli zostanie czas

### Główni użytkownicy docelowi
- Tech leadzi małych i średnich zespołów (3-10 osób)
- Scrum masterzy bez dedykowanego narzędzia do monitoringu flow
- Engineering managerowie prowadzący 1-3 zespoły programistyczne