import { describe, expect, it } from "vitest";

import { flattenAdf } from "@/lib/jira-adf";

/**
 * Unit suite for the ADF flattener (`src/lib/jira-adf.ts`).
 *
 * Jira REST v3 returns `description` and every `comment.body` as an Atlassian
 * Document Format tree, not text. The analysis (S-13 phase 4) reads text, so the
 * tree is flattened once, here, in a pure function — the same reason
 * `absence-dates.ts` and `inbox-controls.ts` exist apart from their components.
 *
 * The load-bearing property is that this NEVER throws: an unreadable description
 * has to reach the lead as "description present but unreadable", not as a run
 * that crashed on one malformed ticket.
 */

const doc = (...content: unknown[]) => ({ type: "doc", version: 1, content });
const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const para = (...content: unknown[]) => ({ type: "paragraph", content });

describe("flattenAdf — block structure", () => {
  it("renders each paragraph on its own line", () => {
    const out = flattenAdf(
      doc(para(text("First paragraph.")), para(text("Second paragraph."))),
    );
    expect(out).toBe("First paragraph.\nSecond paragraph.");
  });

  it("prefixes a heading with hashes matching its level", () => {
    const out = flattenAdf(
      doc(
        { type: "heading", attrs: { level: 2 }, content: [text("Kryteria akceptacji")] },
        para(text("body")),
      ),
    );
    expect(out).toBe("## Kryteria akceptacji\nbody");
  });

  it("renders a bullet list as one dashed line per item", () => {
    const out = flattenAdf(
      doc({
        type: "bulletList",
        content: [
          { type: "listItem", content: [para(text("alpha"))] },
          { type: "listItem", content: [para(text("beta"))] },
        ],
      }),
    );
    expect(out).toBe("- alpha\n- beta");
  });

  it("numbers an ordered list", () => {
    const out = flattenAdf(
      doc({
        type: "orderedList",
        content: [
          { type: "listItem", content: [para(text("alpha"))] },
          { type: "listItem", content: [para(text("beta"))] },
        ],
      }),
    );
    expect(out).toBe("1. alpha\n2. beta");
  });

  it("fences a code block so the model can tell code from prose", () => {
    const out = flattenAdf(
      doc({ type: "codeBlock", content: [text("GET /api/policies")] }),
    );
    expect(out).toBe("```\nGET /api/policies\n```");
  });

  it("renders a table as one tab-separated line per row, header included", () => {
    const cell = (t: string, type = "tableCell") => ({
      type,
      content: [para(text(t))],
    });
    const out = flattenAdf(
      doc({
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [cell("Pole", "tableHeader"), cell("Wartość", "tableHeader")],
          },
          { type: "tableRow", content: [cell("Data"), cell("2026-09-01")] },
        ],
      }),
    );
    expect(out).toBe("Pole\tWartość\nData\t2026-09-01");
  });

  it("emits panel content as ordinary lines", () => {
    const out = flattenAdf(
      doc({
        type: "panel",
        attrs: { panelType: "warning" },
        content: [para(text("Uwaga: regulamin wchodzi 1 września."))],
      }),
    );
    expect(out).toBe("Uwaga: regulamin wchodzi 1 września.");
  });

  it("turns a hardBreak into a line break inside one paragraph", () => {
    const out = flattenAdf(
      doc(para(text("line one"), { type: "hardBreak" }, text("line two"))),
    );
    expect(out).toBe("line one\nline two");
  });

  it("returns an empty string for a null or absent description", () => {
    expect(flattenAdf(null)).toBe("");
    expect(flattenAdf(undefined)).toBe("");
  });
});

describe("flattenAdf — inline nodes and marks", () => {
  it("emits a link's target next to its text, because the target is the evidence", () => {
    const out = flattenAdf(
      doc(
        para(
          text("Makieta: "),
          text("Figma", [
            { type: "link", attrs: { href: "https://figma.com/file/abc" } },
          ]),
        ),
      ),
    );
    expect(out).toBe("Makieta: Figma (https://figma.com/file/abc)");
  });

  it("emits a bare inlineCard as its URL", () => {
    const out = flattenAdf(
      doc(
        para({
          type: "inlineCard",
          attrs: { url: "https://acme.atlassian.net/browse/FM-2" },
        }),
      ),
    );
    expect(out).toBe("https://acme.atlassian.net/browse/FM-2");
  });

  it("renders a mention by display text, falling back to its account id", () => {
    expect(
      flattenAdf(doc(para({ type: "mention", attrs: { text: "@Ala", id: "5b10" } }))),
    ).toBe("@Ala");
    expect(flattenAdf(doc(para({ type: "mention", attrs: { id: "5b10" } })))).toBe(
      "@5b10",
    );
  });

  it("renders an emoji as its shortName when it has no text", () => {
    expect(
      flattenAdf(doc(para({ type: "emoji", attrs: { shortName: ":warning:" } }))),
    ).toBe(":warning:");
  });

  it("names the media type in a placeholder instead of dropping the node", () => {
    const out = flattenAdf(
      doc({
        type: "mediaSingle",
        content: [
          { type: "media", attrs: { type: "file", id: "regulamin.pdf" } },
        ],
      }),
    );
    expect(out).toBe("[file: regulamin.pdf]");
  });
});

describe("flattenAdf — robustness", () => {
  it("descends into an unknown node type rather than dropping its subtree", () => {
    const out = flattenAdf(
      doc({
        type: "someNodeTypeAtlassianAddedLater",
        content: [para(text("still readable"))],
      }),
    );
    expect(out).toBe("still readable");
  });

  it("returns the text recovered so far from a malformed tree, never throwing", () => {
    const malformed = {
      type: "doc",
      content: [
        para(text("readable")),
        "a bare string where a node should be",
        { type: "paragraph", content: "not an array" },
        null,
        { noTypeAtAll: true },
      ],
    };
    expect(() => flattenAdf(malformed)).not.toThrow();
    expect(flattenAdf(malformed)).toBe("readable");
  });

  it("caps depth instead of overflowing on a self-referential tree", () => {
    const cycle: Record<string, unknown> = { type: "paragraph", content: [] };
    (cycle.content as unknown[]).push(text("top"), cycle);
    expect(() => flattenAdf(doc(cycle))).not.toThrow();
    expect(flattenAdf(doc(cycle))).toContain("top");
  });

  it("caps depth on a legitimately over-deep tree and still returns text", () => {
    let node: unknown = para(text("buried"));
    for (let i = 0; i < 200; i += 1) {
      node = { type: "blockquote", content: [node] };
    }
    expect(() => flattenAdf(doc(node))).not.toThrow();
    expect(flattenAdf(doc(node))).toBe("");
  });

  it("flattens a comment body fragment given without a doc wrapper", () => {
    expect(flattenAdf(para(text("a comment")))).toBe("a comment");
  });
});
