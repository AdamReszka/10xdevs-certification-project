import { makeTicket } from "@/lib/refinement/test-support";
import type { CorpusFixture } from "@/lib/refinement/corpus";

/**
 * The complete half of the corpus (S-13 phase 4) — the half that is easy to
 * forget and impossible to do without.
 *
 * FR-020's over-flagging counter is recorded in the PRD: *a mechanism that finds
 * eight gaps on every ticket dies as fast as one that asks templated questions —
 * the lead stops opening it.* Recall on broken tickets says nothing about that.
 * These four tickets are genuinely ready, and the only correct answer for each
 * is `DOR_MET` with an empty gap list. A single reported gap here is a failure
 * of the whole mechanism, not a stylistic quibble.
 *
 * They are deliberately spread across task kinds, because the failure mode being
 * guarded is kind-specific: it is one kind's obligations firing on a ticket that
 * does not owe them.
 */
export const COMPLETE_FIXTURES: CorpusFixture[] = [
  {
    id: "regulamin-ok",
    note: "The FM-101 swap done right — file attached under a name that matches, effective date stated, old version's fate decided. The direct control for the 'regulamin' fixture.",
    expectedTaskKind: "FILE_OR_DOCUMENT_SWAP",
    expectedVerdict: "DOR_MET",
    expectedGapClasses: [],
    ticket: makeTicket({
      key: "FM-201",
      summary: "Aktualizacja regulaminu karty kredytowej do wersji 4.2",
      issueType: "Task",
      description: [
        "Jako klient posiadający kartę kredytową chcę mieć dostęp do aktualnego regulaminu, żeby znać obowiązujące mnie zasady.",
        "",
        "Podmieniamy plik regulaminu karty kredytowej na stronie /dokumenty/karty na wersję 4.2 (w załączniku).",
        "Nowa wersja obowiązuje od pierwszego dnia miesiąca następującego po publikacji — data jest wpisana na pierwszej stronie dokumentu.",
        "Stara wersja 4.1 zostaje na stronie w sekcji 'Archiwum dokumentów', pod tym samym adresem co dotychczas, bez przekierowania.",
        "",
        "## Kryteria akceptacji",
        "- pod /dokumenty/karty pobiera się regulamin w wersji 4.2",
        "- wersja 4.1 jest dostępna w sekcji Archiwum dokumentów",
        "- w stopce dokumentu widnieje data wejścia w życie",
      ].join("\n"),
      attachments: [
        {
          filename: "regulamin-karty-kredytowej-4.2.pdf",
          mimeType: "application/pdf",
        },
      ],
    }),
  },
  {
    id: "widok-ok",
    note: "A new view with a mockup linked, the data source named, and testable acceptance criteria. The control for MOCKUP_MISSING and DATA_SOURCE_UNSPECIFIED.",
    expectedTaskKind: "NEW_VIEW_OR_COMPONENT",
    expectedVerdict: "DOR_MET",
    expectedGapClasses: [],
    ticket: makeTicket({
      key: "FM-202",
      summary: "Widok historii logowań w ustawieniach konta",
      issueType: "Story",
      description: [
        "Jako klient chcę zobaczyć historię logowań do mojego konta, żeby wychwycić logowanie, którego nie wykonałem.",
        "",
        "Nowa zakładka 'Bezpieczeństwo' w ustawieniach konta. Makieta: https://figma.com/file/xyz/historia-logowan (ramki 3-5).",
        "Dane pochodzą z istniejącej tabeli zdarzeń audytowych, tej samej, z której korzysta raport bezpieczeństwa — pokazujemy datę, adres IP, przeglądarkę i wynik logowania.",
        "",
        "## Kryteria akceptacji",
        "- zakładka Bezpieczeństwo jest widoczna w ustawieniach konta",
        "- lista pokazuje 30 ostatnich logowań, najnowsze na górze",
        "- nieudane logowanie jest oznaczone czerwoną etykietą",
        "- brak zdarzeń pokazuje komunikat zamiast pustej tabeli",
      ].join("\n"),
      attachments: [],
    }),
  },
  {
    id: "backend-ok",
    note: "Back-end work with the endpoint, its contract and its data source all written down. The control for ENDPOINTS_UNSPECIFIED and API_CONTRACT_MISSING.",
    expectedTaskKind: "BACKEND",
    expectedVerdict: "DOR_MET",
    expectedGapClasses: [],
    ticket: makeTicket({
      key: "FM-203",
      summary: "Endpoint zwracający historię logowań klienta",
      issueType: "Task",
      description: [
        "Jako klient chcę, żeby panel mógł pobrać moją historię logowań, aby zakładka Bezpieczeństwo miała co pokazać.",
        "",
        "Nowy endpoint GET /api/v2/account/login-history w API panelu klienta.",
        "Autoryzacja: token sesji panelu, ten sam co pozostałe endpointy /api/v2/account/*.",
        "Parametry: limit (domyślnie 30, maksymalnie 100), cursor (opcjonalny).",
        "Odpowiedź: { items: [{ occurredAt: ISO-8601, ip: string, userAgent: string, outcome: 'SUCCESS' | 'FAILURE' }], nextCursor: string | null }.",
        "Źródło danych: tabela audit_event, filtrowana po typie LOGIN i po identyfikatorze klienta z tokenu.",
        "",
        "## Kryteria akceptacji",
        "- endpoint zwraca 200 i opisany kształt odpowiedzi",
        "- bez ważnego tokenu zwraca 401 i nie ujawnia, czy konto istnieje",
        "- limit powyżej 100 zwraca 400",
        "- klient nigdy nie widzi zdarzeń innego klienta",
      ].join("\n"),
    }),
  },
  {
    id: "bug-ok",
    note: "A defect with reproduction steps and a checkable 'fixed' condition. A bug is never asked for a user story, so this fixture also proves the gate narrows rather than the model simply staying quiet.",
    expectedTaskKind: "BUG",
    expectedVerdict: "DOR_MET",
    expectedGapClasses: [],
    ticket: makeTicket({
      key: "FM-204",
      summary: "Kwota transakcji zaokrągla się w dół na liście transakcji",
      issueType: "Bug",
      description: [
        "Na liście transakcji w panelu klienta kwoty z groszami wyświetlają się bez części dziesiętnej, zaokrąglone w dół.",
        "",
        "Kroki: zaloguj się na konto testowe 4444, wejdź w Transakcje, znajdź przelew z 12 lipca na 129,90 zł.",
        "Jest: '129 zł'. Powinno być: '129,90 zł'. Na szczegółach tej samej transakcji kwota jest poprawna, więc problem dotyczy wyłącznie listy.",
        "Regresja po zmianie formatowania kwot z zadania FM-98.",
        "",
        "## Kryteria akceptacji",
        "- na liście transakcji kwota z groszami pokazuje część dziesiętną",
        "- kwota na liście zgadza się z kwotą na szczegółach transakcji",
        "- kwoty bez groszy nadal pokazują się bez zbędnych zer",
      ].join("\n"),
    }),
  },
];
