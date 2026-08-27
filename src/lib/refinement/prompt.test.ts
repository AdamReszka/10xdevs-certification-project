import { describe, expect, it } from "vitest";

import { buildSystemPrompt, buildUserMessage } from "@/lib/refinement/prompt";
import { makeTicket } from "@/lib/refinement/test-support";
import {
  GAP_CLASSES,
  GAP_CLASS_OBLIGATIONS,
  TASK_KINDS,
} from "@/lib/refinement/types";

describe("buildSystemPrompt", () => {
  // The rubric is the CACHED prefix. Anything volatile inside it — a timestamp,
  // a run id, a ticket key — invalidates the cache for every subsequent ticket
  // in the run, which is a silent cost regression nothing else would catch.
  it("is byte-identical across calls", () => {
    expect(buildSystemPrompt()).toBe(buildSystemPrompt());
  });

  it("carries no date- or clock-shaped text", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(prompt).not.toMatch(/\d{1,2}:\d{2}/);
  });

  // The corpus asserts gap classes as a set comparison. That only means
  // anything if the vocabulary the model is handed is the same closed set.
  it("names every task kind and every gap class", () => {
    const prompt = buildSystemPrompt();
    for (const kind of TASK_KINDS) expect(prompt).toContain(kind);
    for (const gapClass of GAP_CLASSES) expect(prompt).toContain(gapClass);
  });

  it("states each kind's obligations, so the gate drops what the model was told not to send", () => {
    const prompt = buildSystemPrompt();
    for (const [kind, obligations] of Object.entries(GAP_CLASS_OBLIGATIONS)) {
      const section = prompt.slice(prompt.indexOf(`${kind}:`));
      for (const obligation of obligations) {
        expect(
          section.slice(0, section.indexOf("\n")),
          `${kind} must list ${obligation}`,
        ).toContain(obligation);
      }
    }
  });

  it("requires the grounded sentence shape and forbids the generic DOR question", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain("This ticket is about");
    expect(prompt).toMatch(/groundingClause/);
  });
});

describe("buildUserMessage", () => {
  it("renders the ticket's own content", () => {
    const message = buildUserMessage(
      makeTicket({
        key: "FM-14",
        summary: "Nowy regulamin",
        description: "Podmieniamy PDF regulaminu.",
        comments: ["Kiedy to wchodzi?"],
        attachments: [{ filename: "regulamin.pdf", mimeType: "application/pdf" }],
      }),
    );

    expect(message).toContain("FM-14");
    expect(message).toContain("Nowy regulamin");
    expect(message).toContain("Podmieniamy PDF regulaminu.");
    expect(message).toContain("Kiedy to wchodzi?");
    expect(message).toContain("regulamin.pdf");
  });

  // BLOCKING_DEPENDENCY_NOT_DONE fires only on evidence the ticket already
  // carries. Dropping the status from the rendering removes the evidence and
  // the class can never fire.
  it("carries subtask and link statuses", () => {
    const message = buildUserMessage(
      makeTicket({
        subtasks: [
          {
            key: "FM-15",
            summary: "Endpoint listy",
            status: "In Progress",
            category: "indeterminate",
            relation: "subtask",
          },
        ],
        links: [
          {
            key: "FM-9",
            summary: "Model danych",
            status: "Done",
            category: "done",
            relation: "is blocked by",
          },
        ],
      }),
    );

    expect(message).toContain("FM-15");
    expect(message).toContain("In Progress");
    expect(message).toContain("is blocked by");
    expect(message).toContain("Done");
  });

  // A paste carries no attachments BY CONSTRUCTION. Rendering its empty list
  // the same way a Jira ticket's is rendered invites FILE_ATTACHMENT_MISSING
  // and MOCKUP_MISSING on every single paste — the over-flagging failure mode.
  it("says attachment state is unknown for a pasted story", () => {
    const message = buildUserMessage(
      makeTicket({ origin: "PASTE", attachments: [], links: [], subtasks: [] }),
    );

    expect(message).toMatch(/unknown/i);
    expect(message).not.toMatch(/no attachments/i);
  });

  it("reports a Jira ticket's genuinely empty attachment list as absent", () => {
    const message = buildUserMessage(
      makeTicket({ origin: "JIRA", attachments: [] }),
    );

    expect(message).toMatch(/none/i);
  });
});
