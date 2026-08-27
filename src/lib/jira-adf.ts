/**
 * Atlassian Document Format → plain text (S-13 phase 2).
 *
 * Jira REST v3 returns `description` and every `comment.body` as an ADF tree,
 * not as text. The Refinement analysis reads text, so the tree is flattened
 * once, here, in a pure function with no I/O — the same separation that puts
 * `absence-dates.ts` and `inbox-controls.ts` beside their components rather than
 * inside them.
 *
 * Two properties are load-bearing:
 *
 *  1. **It never throws.** A description Jira wrote in a node type we have not
 *     seen, or a tree that arrived truncated, must read as "description present
 *     but unreadable" — never as a run that died on one ticket in a batch of ten.
 *     Recursion is depth-capped and every step is defensive; whatever text was
 *     recovered before the trouble is what comes back.
 *  2. **Structure that carries evidence survives.** A link's target is evidence
 *     for `MOCKUP_MISSING`, a heading is how an acceptance-criteria section is
 *     located, and a list is how criteria are usually written. Those are emitted
 *     as text the model (and the P0 detectors) can still see, not collapsed into
 *     one undifferentiated blob.
 */

/** Recursion bound. ADF nests through lists and tables; ~30 is far past any
 * hand-written description and short of a stack overflow on a hostile tree. */
const MAX_DEPTH = 30;

type AdfNode = {
  type?: unknown;
  text?: unknown;
  attrs?: Record<string, unknown>;
  content?: unknown;
  marks?: unknown;
};

function asNode(value: unknown): AdfNode | null {
  return value && typeof value === "object" ? (value as AdfNode) : null;
}

function childrenOf(node: AdfNode): unknown[] {
  return Array.isArray(node.content) ? node.content : [];
}

function attr(node: AdfNode, key: string): unknown {
  return node.attrs && typeof node.attrs === "object"
    ? (node.attrs as Record<string, unknown>)[key]
    : undefined;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The `href` of a text node's link mark, when it carries one. */
function linkHref(node: AdfNode): string | null {
  if (!Array.isArray(node.marks)) return null;
  for (const raw of node.marks) {
    const mark = asNode(raw);
    if (!mark || mark.type !== "link") continue;
    const href = str(attr(mark, "href"));
    if (href) return href;
  }
  return null;
}

/** Render a node that sits inside a line (text, breaks, mentions, cards). */
function renderInline(value: unknown, depth: number): string {
  if (depth > MAX_DEPTH) return "";
  const node = asNode(value);
  if (!node) return "";

  switch (node.type) {
    case "text": {
      const body = typeof node.text === "string" ? node.text : "";
      const href = linkHref(node);
      // The URL is emitted, not dropped: a link's target is the evidence a
      // mockup or a contract was actually attached.
      return href ? `${body} (${href})` : body;
    }
    case "hardBreak":
      return "\n";
    case "mention":
      return str(attr(node, "text")) ?? `@${str(attr(node, "id")) ?? "unknown"}`;
    case "emoji":
      return str(attr(node, "text")) ?? str(attr(node, "shortName")) ?? "";
    case "inlineCard":
    case "blockCard":
    case "embedCard":
      return str(attr(node, "url")) ?? "";
    case "media":
      return `[${str(attr(node, "type")) ?? "media"}: ${
        str(attr(node, "alt")) ?? str(attr(node, "id")) ?? "attached"
      }]`;
    default:
      return childrenOf(node)
        .map((child) => renderInline(child, depth + 1))
        .join("");
  }
}

/** Join a node's children as one line's worth of inline text. */
function inlineOf(node: AdfNode, depth: number): string {
  return childrenOf(node)
    .map((child) => renderInline(child, depth + 1))
    .join("");
}

/** Render one table cell down to a single line. */
function cellText(value: unknown, depth: number): string {
  const node = asNode(value);
  if (!node) return "";
  const lines: string[] = [];
  for (const child of childrenOf(node)) renderBlock(child, lines, depth + 1);
  return lines.join(" ").trim();
}

/** Render a block-level node, appending whole lines to `out`. */
function renderBlock(value: unknown, out: string[], depth: number): void {
  if (depth > MAX_DEPTH) return;
  const node = asNode(value);
  if (!node) return;

  switch (node.type) {
    case "paragraph": {
      const line = inlineOf(node, depth);
      if (line.trim().length > 0) out.push(line);
      return;
    }
    case "heading": {
      const rawLevel = attr(node, "level");
      const level =
        typeof rawLevel === "number" && rawLevel >= 1 && rawLevel <= 6
          ? rawLevel
          : 1;
      const line = inlineOf(node, depth);
      if (line.trim().length > 0) out.push(`${"#".repeat(level)} ${line}`);
      return;
    }
    case "bulletList":
    case "orderedList": {
      const ordered = node.type === "orderedList";
      let index = 0;
      for (const item of childrenOf(node)) {
        index += 1;
        const sub: string[] = [];
        const itemNode = asNode(item);
        if (itemNode) {
          for (const child of childrenOf(itemNode)) {
            renderBlock(child, sub, depth + 1);
          }
        }
        if (sub.length === 0) continue;
        const marker = ordered ? `${index}. ` : "- ";
        out.push(`${marker}${sub[0]}`);
        // Continuation lines stay attached to their item by indentation.
        for (const rest of sub.slice(1)) out.push(`  ${rest}`);
      }
      return;
    }
    case "codeBlock": {
      const body = inlineOf(node, depth);
      out.push("```");
      if (body.length > 0) out.push(body);
      out.push("```");
      return;
    }
    case "table": {
      for (const row of childrenOf(node)) {
        const rowNode = asNode(row);
        if (!rowNode) continue;
        const cells = childrenOf(rowNode).map((cell) =>
          cellText(cell, depth + 1),
        );
        if (cells.length > 0) out.push(cells.join("\t"));
      }
      return;
    }
    case "rule":
      out.push("---");
      return;
    case "mediaSingle":
    case "mediaGroup":
    case "media": {
      const line = node.type === "media" ? renderInline(node, depth) : inlineOf(node, depth);
      if (line.trim().length > 0) out.push(line);
      return;
    }
    default: {
      // `doc`, `panel`, `blockquote`, `expand`, and anything Jira adds later:
      // descend rather than drop the subtree. An unknown wrapper must not cost
      // us the paragraphs inside it.
      const children = childrenOf(node);
      if (children.length === 0) {
        const line = renderInline(node, depth);
        if (line.trim().length > 0) out.push(line);
        return;
      }
      for (const child of children) renderBlock(child, out, depth + 1);
      return;
    }
  }
}

/**
 * Flatten an ADF tree (or any fragment of one) to plain text.
 *
 * Returns `""` for `null`/`undefined`/a non-object — Jira sends `null` for an
 * empty description, and that is a legitimate answer, not an error.
 */
export function flattenAdf(node: unknown): string {
  const lines: string[] = [];
  try {
    renderBlock(node, lines, 0);
  } catch {
    // Whatever was recovered before the trouble is the answer. An unreadable
    // description is a fact about the ticket, never a crashed analysis.
  }
  return lines.join("\n").trim();
}
