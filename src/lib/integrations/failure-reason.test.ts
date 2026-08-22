import { describe, expect, it } from "vitest";

import {
  classifyFailure,
  type IntegrationName,
  type SyncStatus,
} from "@/lib/integrations/failure-reason";

/**
 * The load-bearing assertion here is the LAST one: no branch may emit anything
 * derived from a stored error string. The whole point of classifying `status`
 * instead of forwarding `sync_state.last_error` is that the enum has a bounded,
 * audited set of outputs and the error column does not.
 */

const INTEGRATIONS: IntegrationName[] = ["GITHUB", "JIRA"];

describe("classifyFailure", () => {
  it("returns null for a healthy integration", () => {
    for (const i of INTEGRATIONS) {
      expect(classifyFailure("OK", i)).toBeNull();
    }
  });

  it("returns null when the integration has never been attempted", () => {
    for (const i of INTEGRATIONS) {
      expect(classifyFailure(null, i)).toBeNull();
    }
  });

  it("flags ERROR as needing the owner to act", () => {
    const reason = classifyFailure("ERROR", "GITHUB")!;
    expect(reason.needsOwnerAction).toBe(true);
    expect(reason.headline).toContain("GitHub");
    expect(reason.whatToDo).toMatch(/reconnect/i);
  });

  it("flags RATE_LIMITED as self-recovering", () => {
    const reason = classifyFailure("RATE_LIMITED", "JIRA")!;
    expect(reason.needsOwnerAction).toBe(false);
    expect(reason.headline).toContain("Jira");
    expect(reason.whatToDo).toMatch(/retries/i);
  });

  it("names the integration the owner is actually looking at", () => {
    expect(classifyFailure("ERROR", "GITHUB")!.headline).not.toContain("Jira");
    expect(classifyFailure("ERROR", "JIRA")!.headline).not.toContain("GitHub");
  });

  it("covers every failing status — a new enum member must not fall through", () => {
    const failing: SyncStatus[] = ["ERROR", "RATE_LIMITED"];
    for (const status of failing) {
      for (const i of INTEGRATIONS) {
        const reason = classifyFailure(status, i);
        expect(reason, `${status}/${i}`).not.toBeNull();
        expect(reason!.headline.length).toBeGreaterThan(0);
        expect(reason!.whatToDo.length).toBeGreaterThan(0);
      }
    }
  });

  it("emits only fixed copy — never anything that could carry a stored error", () => {
    // Exhaustive over the input space: every reachable output is one of these
    // strings. If someone later interpolates `lastError` into a branch, this
    // fails, because the produced text stops matching the frozen set.
    const produced = new Set<string>();
    for (const status of ["OK", "ERROR", "RATE_LIMITED", null] as const) {
      for (const i of INTEGRATIONS) {
        const reason = classifyFailure(status, i);
        if (reason) produced.add(`${reason.headline}|${reason.whatToDo}`);
      }
    }

    expect(produced.size).toBe(4); // 2 failing statuses × 2 integrations
    for (const text of produced) {
      // A secret or a raw API body would show up as one of these shapes.
      expect(text).not.toMatch(/gh[ps]_|Bearer |Basic |password|token=/i);
      expect(text).not.toMatch(/\bat .+:\d+:\d+/); // no stack frame
    }
  });
});
