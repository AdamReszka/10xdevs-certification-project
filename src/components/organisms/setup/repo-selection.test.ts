import { describe, expect, it } from "vitest";

import { reposBeingDropped } from "@/components/organisms/setup/repo-selection";

/**
 * The regression these guard: the edit picker used to open with nothing checked,
 * so "add one repo" saved a selection of exactly one — silently deleting every
 * other monitored repo and cascading its synced history away.
 */

const repos = [
  { id: "555", fullName: "acme/app" },
  { id: "777", fullName: "acme/api" },
  { id: "999", fullName: "acme/web" },
];

describe("reposBeingDropped", () => {
  it("names a monitored repo that the pending selection leaves out", () => {
    expect(
      reposBeingDropped({
        repos,
        monitoredIds: ["555", "777"],
        selectedIds: new Set(["777", "999"]),
      }),
    ).toEqual(["acme/app"]);
  });

  it("is empty when the selection keeps everything monitored", () => {
    expect(
      reposBeingDropped({
        repos,
        monitoredIds: ["555"],
        selectedIds: new Set(["555", "999"]),
      }),
    ).toEqual([]);
  });

  it("is empty during first-time setup, where nothing is monitored yet", () => {
    expect(
      reposBeingDropped({ repos, monitoredIds: [], selectedIds: new Set() }),
    ).toEqual([]);
  });

  it("flags every monitored repo when the selection is emptied", () => {
    expect(
      reposBeingDropped({
        repos,
        monitoredIds: ["555", "999"],
        selectedIds: new Set(),
      }),
    ).toEqual(["acme/app", "acme/web"]);
  });

  it("ignores a monitored id the token can no longer see", () => {
    expect(
      reposBeingDropped({
        repos,
        monitoredIds: ["555", "31337"],
        selectedIds: new Set(["555"]),
      }),
    ).toEqual([]);
  });
});
