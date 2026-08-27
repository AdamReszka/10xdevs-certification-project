import { makeTicket } from "@/lib/refinement/test-support";
import type { CorpusFixture } from "@/lib/refinement/corpus";

/**
 * The incomplete half of the corpus (S-13 phase 4).
 *
 * Every ticket here is modelled on one the user actually brought to
 * `dor-notes.md`, in the language the team writes them in. The point is not
 * that they are bad tickets — it is that each one is bad in a NAMED way, so
 * "did the analysis find it" is an ordinary set comparison rather than a
 * judgement call.
 *
 * `expectedGapClasses` lists what the merged analysis must produce, P0 findings
 * included: the deterministic detectors fire on these tickets too, and leaving
 * their output out would make the corpus disagree with the engine.
 */
export const INCOMPLETE_FIXTURES: CorpusFixture[] = [
  {
    id: "regulamin",
    note: "dor-notes.md #3 — a document swap with the document missing. The archetype: the whole ticket is a file that was never attached.",
    expectedTaskKind: "FILE_OR_DOCUMENT_SWAP",
    expectedVerdict: "GAPS",
    expectedGapClasses: [
      "TITLE_TOO_VAGUE",
      "USER_STORY_MISSING",
      "ACCEPTANCE_CRITERIA_MISSING",
      "FILE_ATTACHMENT_MISSING",
      "EFFECTIVE_DATE_MISSING",
      "OLD_ARTIFACT_DISPOSITION_MISSING",
    ],
    ticket: makeTicket({
      key: "FM-101",
      summary: "Nowy regulamin",
      issueType: "Task",
      description:
        "Wchodzi nowa wersja regulaminu, trzeba ją wrzucić na stronę zamiast obecnej.",
      attachments: [],
    }),
  },
  {
    id: "propaganda",
    note: "dor-notes.md #2 + #5 — the title says nothing about what is to be built, and a new visual surface arrives with no mockup. Everything else about the ticket is fine, so a run that flags more than these two is over-flagging.",
    expectedTaskKind: "NEW_VIEW_OR_COMPONENT",
    expectedVerdict: "GAPS",
    expectedGapClasses: ["TITLE_TOO_VAGUE", "MOCKUP_MISSING"],
    ticket: makeTicket({
      key: "FM-102",
      summary: "Propaganda apkowa",
      issueType: "Story",
      description: [
        "Jako klient korzystający z panelu chcę widzieć zachętę do pobrania aplikacji mobilnej, żeby móc obsłużyć kartę z telefonu.",
        "",
        "Reklamy wchodzą w panelu klienta, w dwóch miejscach: na pulpicie oraz na liście transakcji. Treści i grafiki dostarcza marketing (są w zadaniu MKT-88).",
        "",
        "## Kryteria akceptacji",
        "- na pulpicie panelu widoczny jest baner z odnośnikiem do sklepu",
        "- baner da się zamknąć i nie wraca przez 30 dni",
        "- na liście transakcji widoczny jest wariant tekstowy",
      ].join("\n"),
    }),
  },
  {
    id: "feedy",
    note: "dor-notes.md #1 + #2 — 'deweloper po samym tytule się zorientuje'. A title on an epic's level of abstraction, and literally nothing else. A spike, so it is never asked for acceptance criteria.",
    expectedTaskKind: "SPIKE",
    expectedVerdict: "GAPS",
    expectedGapClasses: ["DESCRIPTION_MISSING", "TITLE_TOO_VAGUE"],
    ticket: makeTicket({
      key: "FM-103",
      summary: "Feedy produktowe",
      issueType: "Task",
      description: "",
    }),
  },
  {
    id: "podstrona-kontaktowa",
    note: "dor-notes.md #4(b) — the requester was put where the recipient belongs. Marketing asks for a contact page FOR CUSTOMERS, and the customer never appears as the actor. A new page also arrives with no mockup.",
    expectedTaskKind: "NEW_VIEW_OR_COMPONENT",
    expectedVerdict: "GAPS",
    expectedGapClasses: ["USER_STORY_WRONG_ACTOR", "MOCKUP_MISSING"],
    ticket: makeTicket({
      key: "FM-104",
      summary: "Nowa podstrona kontaktowa w serwisie",
      issueType: "Story",
      description: [
        "Jako pracownik marketingu potrzebuję, aby powstała nowa podstrona kontaktowa dla klientów, na której będą wszystkie kanały kontaktu.",
        "",
        "Podstrona ma być pod /kontakt i ma zawierać formularz, numery infolinii oraz mapę oddziałów. Dane oddziałów bierzemy z tego samego źródła co wyszukiwarka placówek.",
        "",
        "## Kryteria akceptacji",
        "- podstrona jest dostępna pod /kontakt i widoczna w stopce",
        "- formularz wysyła zgłoszenie na skrzynkę kontakt@",
        "- lista oddziałów zgadza się z wyszukiwarką placówek",
      ].join("\n"),
    }),
  },
  {
    id: "zmiana-telefonu",
    note: "dor-notes.md #6 — a content change that never says exactly where the content sits or what it becomes, nobody checked whether the same number lives elsewhere, and it is plausibly a CMS edit the stakeholder could make themselves.",
    expectedTaskKind: "CONTENT_CHANGE",
    expectedVerdict: "GAPS",
    expectedGapClasses: [
      "ACCEPTANCE_CRITERIA_MISSING",
      "CONTENT_LOCATION_UNSPECIFIED",
      "CONTENT_SCOPE_UNCHECKED",
      "CMS_EDITABLE_NOT_A_DEV_TASK",
    ],
    ticket: makeTicket({
      key: "FM-105",
      summary: "Zmiana numeru infolinii na stronie",
      issueType: "Task",
      description:
        "Jako klient chcę dzwonić pod aktualny numer infolinii, żeby nie trafiać na nieczynną linię. Zmieniamy numer infolinii na stronie — stary już nie działa.",
    }),
  },
  {
    id: "lista-zamowien",
    note: "dor-notes.md #7 — front-end work on back-end data. No endpoint is named, there is no contract, and the linked back-end subtask this depends on is not Done. The dependency is the one gap the ticket itself carries evidence for.",
    expectedTaskKind: "FRONTEND_ON_BACKEND_DATA",
    expectedVerdict: "GAPS",
    expectedGapClasses: [
      "ENDPOINTS_UNSPECIFIED",
      "API_CONTRACT_MISSING",
      "BLOCKING_DEPENDENCY_NOT_DONE",
    ],
    ticket: makeTicket({
      key: "FM-106",
      summary: "Lista zamówień klienta w panelu",
      issueType: "Story",
      description: [
        "Jako klient chcę zobaczyć w panelu listę swoich zamówień, żeby sprawdzić status realizacji bez dzwonienia na infolinię.",
        "",
        "Lista pokazuje numer zamówienia, datę, kwotę i status. Makieta jest w Figmie: https://figma.com/file/abc/panel-zamowienia",
        "",
        "## Kryteria akceptacji",
        "- lista jest stronicowana po 20 pozycji",
        "- pusty stan pokazuje komunikat 'Nie masz jeszcze zamówień'",
        "- status zamówienia zgadza się z tym, co widzi obsługa",
      ].join("\n"),
      attachments: [],
      subtasks: [
        {
          key: "FM-107",
          summary: "Endpoint listy zamówień klienta",
          status: "In Progress",
          category: "indeterminate",
          relation: "subtask",
        },
      ],
    }),
  },
];
