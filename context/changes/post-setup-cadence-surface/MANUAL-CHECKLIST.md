# S-29 post-setup-cadence-surface — checklista testów manualnych

Krótka lista: tylko to, co realnie blokuje slice. Reszta idzie do
`context/foundation/manual-test-backlog.md` (§25). Odhaczając cokolwiek tutaj,
odhacz też odpowiedni wiersz w `plan.md` `## Progress` — **plan jest kanoniczny**.

**Wiersz 1 dotyka produkcyjnej bazy** i musi zostać wykonany **przed
wszystkimi pozostałymi**: reszta sprawdza zachowanie, które istnieje dopiero po
tej migracji. Pozostałe wiersze niczego nie kasują — zmieniają rytm sprintu,
który można ustawić z powrotem tym samym ekranem.

**Konto:** wiersze 2–4 wymagają **prawdziwego** konta z podłączoną Jirą.
Wiersz 5 wymaga tego samego konta z **załadowanym demo**.

---

## Faza 2 — migracja produkcyjna

- [ ] **1 — `0022` trafia na produkcję, zanim ktokolwiek dotknie reszty listy**
      *(faza 2, zamyka `2.4`)*

  **Gdzie:** produkcyjna baza Supabase — **nie** lokalna. `drizzle-kit` nie
  dosięgnie tego hosta z tego Maca (host jest IPv6-only), więc trasa jest ta
  sama co dla `0021`: Supabase MCP `apply_migration`, a wpis w
  `drizzle.__drizzle_migrations` dopisywany ręcznie.

  **Co zrobić:** zastosuj `src/db/migrations/0022_unfreeze_cadence_override.sql`
  na produkcji, dopisz wpis bookkeepingowy, a potem odczytaj kolumnę
  `cadence_overridden` z tabeli `sprint`.

  **Co musi być prawdą:** **każdy** wiersz `sprint` ma `cadence_overridden = f`
  — łącznie z jedynym prawdziwym kontem onboardowanym, które przed migracją
  miało `t`. Wpis w `drizzle.__drizzle_migrations` istnieje, więc kolejny
  `db:migrate` nie spróbuje zastosować `0022` po raz drugi.

  **Dlaczego to ma znaczenie:** to jest jedyny krok tego slice'u, którego kod
  nie zrobi sam. Deploy na Cloudflare wysyła **kod, nie migracje**
  (`lessons.md`: „a deploy that ships code but not migrations breaks silently"),
  a bez tego wiersza konto, które jedynie ukończyło kreator, zostaje odcięte od
  auto-pullu FR-007 na zawsze — dokładnie ta wada, którą slice zamyka.
  **Uwaga na oczekiwanie:** `start_day` **nie musi** się zmienić. Jest wyliczany
  z daty startu sprintu w Jirze, więc sprint faktycznie wystartowany w piątek
  dalej da `FRI`. Ten wiersz sprawdza, że flaga zeszła — nie że jakaś wartość
  podskoczyła.
