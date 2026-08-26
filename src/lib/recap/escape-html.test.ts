import { describe, expect, it } from "vitest";

import { escapeHtml } from "@/lib/recap/escape-html";

/**
 * The recap builds HTML by concatenation, so this is the ONLY thing standing
 * between a Jira ticket summary and the email body. Every assertion here is a
 * neutralization claim, not a formatting preference.
 */

describe("escapeHtml", () => {
  it("neutralizes a script tag", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;",
    );
  });

  it("escapes all five entities", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("escapes the ampersand FIRST, so nothing is double-encoded", () => {
    // Replacing `<` before `&` would turn this into `&amp;lt;` — the classic way
    // an escaper leaks a tag through.
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    expect(escapeHtml("a & b < c")).toBe("a &amp; b &lt; c");
  });

  it("escapes an attribute-breaking quote", () => {
    // The renderer interpolates URLs into href="…" — an unescaped quote there is
    // an attribute injection.
    expect(escapeHtml('" onmouseover="evil()')).toBe(
      "&quot; onmouseover=&quot;evil()",
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("SF-123 Add the sync engine")).toBe("SF-123 Add the sync engine");
    expect(escapeHtml("")).toBe("");
  });

  it("escapes every occurrence, not just the first", () => {
    expect(escapeHtml("<<>>")).toBe("&lt;&lt;&gt;&gt;");
  });
});
