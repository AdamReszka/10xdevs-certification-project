import { describe, expect, it } from "vitest";

import {
  extractTicketKey,
  linkTicketKey,
} from "@/lib/integrations/sync/link-ticket";

/**
 * Unit suite for the pure PR↔ticket link parser. Asserts project-scoped matching
 * across branch/title/body, foreign-key rejection, canonicalization, and null.
 */

const empty = { branch: null, title: null, body: null };

describe("linkTicketKey", () => {
  it("matches the project key in the branch name", () => {
    expect(
      linkTicketKey({ ...empty, branch: "feature/SF-123-add-sync" }, "SF"),
    ).toBe("SF-123");
  });

  it("matches in the title when the branch has no key", () => {
    expect(
      linkTicketKey({ ...empty, title: "SF-42: build the engine" }, "SF"),
    ).toBe("SF-42");
  });

  it("matches in the body as the last resort", () => {
    expect(
      linkTicketKey({ ...empty, body: "This closes SF-7 finally" }, "SF"),
    ).toBe("SF-7");
  });

  it("prefers the branch over title/body", () => {
    expect(
      linkTicketKey(
        { branch: "SF-1-branch", title: "SF-2", body: "SF-3" },
        "SF",
      ),
    ).toBe("SF-1");
  });

  it("canonicalizes a lowercased branch key to uppercase", () => {
    expect(
      linkTicketKey({ ...empty, branch: "feature/sf-99-thing" }, "SF"),
    ).toBe("SF-99");
  });

  it("ignores a foreign project's key", () => {
    expect(
      linkTicketKey({ ...empty, title: "OTHER-5 unrelated ticket" }, "SF"),
    ).toBeNull();
  });

  it("does not match a key that is a suffix of a longer token", () => {
    // `XSF-1` must not satisfy project `SF` (word-boundary scoping).
    expect(linkTicketKey({ ...empty, branch: "XSF-1" }, "SF")).toBeNull();
  });

  it("captures the full number, not a prefix", () => {
    expect(linkTicketKey({ ...empty, title: "SF-12345" }, "SF")).toBe("SF-12345");
  });

  it("returns null when no reference is present", () => {
    expect(linkTicketKey({ ...empty, branch: "main", title: "chore" }, "SF")).toBeNull();
  });

  it("returns null for an empty project key", () => {
    expect(linkTicketKey({ ...empty, branch: "SF-1" }, "")).toBeNull();
  });
});

describe("extractTicketKey", () => {
  it("extracts a project-scoped key from a commit message", () => {
    expect(extractTicketKey("SF-123: wire the detector", "SF")).toBe("SF-123");
  });

  it("canonicalizes a lowercased key to uppercase", () => {
    expect(extractTicketKey("fix sf-9 flake", "SF")).toBe("SF-9");
  });

  it("ignores a foreign project's key", () => {
    expect(extractTicketKey("OTHER-5 unrelated", "SF")).toBeNull();
  });

  it("does not match a key that is a suffix of a longer token", () => {
    expect(extractTicketKey("bump XSF-1", "SF")).toBeNull();
  });

  it("returns null for null text or empty project key", () => {
    expect(extractTicketKey(null, "SF")).toBeNull();
    expect(extractTicketKey("SF-1", "")).toBeNull();
  });
});
