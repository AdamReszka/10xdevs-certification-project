import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  githubCredential,
  jiraCredential,
  jiraProject,
  monitoredRepo,
  sprint,
  teamMember,
  user,
} from "@/db/schema";
import { encryptToken } from "@/lib/crypto";

/**
 * S-04 Phase 3 — team-step Server Action integration tests against REAL Postgres.
 * Unlike the store suites, these exercise the ACTION wrappers end-to-end: session
 * + Cloudflare context are mocked, the HTTP edge is a stubbed global `fetch`, and
 * the base-URL override seams point the clients at fixture hosts. This is where
 * the `toFailure` ladder (invalid_input / decrypt_failed / degradation-surfaced)
 * is verified, plus the no-token-in-logs guarantee.
 */

const GH_BASE = "https://gh.test";
const JIRA_BASE = "https://jira.test";
const GH_TOKEN = "gh_ActionPatABCDEFGH1234";
const JIRA_TOKEN = "jira_ActionTokenABCDEFGH1234";

let currentOwnerId = "";

vi.mock("@/lib/auth", () => ({
  requireSession: vi.fn(async () => ({ user: { id: currentOwnerId } })),
}));

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: { TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY },
  }),
}));

// Imported AFTER the mocks (vi.mock is hoisted).
import {
  importCadenceAction,
  importRosterAction,
  saveCadenceAction,
  saveRosterAction,
} from "./actions";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

// --- Fixtures + HTTP mock ---------------------------------------------------

const COLLABORATORS = [
  { login: "octocat", id: 1, type: "User", role_name: "admin" },
  { login: "devtwo", id: 2, type: "User", role_name: "write" },
];
const JIRA_MEMBERS = [
  { accountId: "acc-1", accountType: "atlassian", displayName: "Mia", active: true },
  { accountId: "acc-2", accountType: "atlassian", displayName: "Sam", active: true },
];
const BOARD = { id: 77, name: "SF Scrum", type: "scrum" };
const ACTIVE_SPRINT = {
  id: 4242,
  state: "active",
  name: "Sprint 7",
  startDate: "2026-08-17T08:00:00.000Z",
  endDate: "2026-08-31T08:00:00.000Z",
};

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Combined GitHub + Jira fetch stub; `githubStatus` forces a GH degradation. */
function makeGlobalFetch(opts?: { githubStatus?: number }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    if (url.startsWith(GH_BASE)) {
      if (url.includes("/collaborators")) {
        if (opts?.githubStatus && opts.githubStatus !== 200) {
          return jsonRes({ message: "Forbidden" }, opts.githubStatus);
        }
        return jsonRes(COLLABORATORS);
      }
    }
    if (url.startsWith(JIRA_BASE)) {
      if (url.includes("/user/assignable/search")) {
        return url.includes("startAt=0") ? jsonRes(JIRA_MEMBERS) : jsonRes([]);
      }
      if (url.includes("/sprint")) return jsonRes({ values: [ACTIVE_SPRINT] });
      if (url.includes("/board")) return jsonRes({ isLast: true, values: [BOARD] });
      if (url.includes("/myself")) return jsonRes({ accountId: "acc-owner", timeZone: "UTC" });
    }
    throw new Error(`unexpected fetch URL: ${url}`);
  }) as typeof fetch;
}

// --- Seed / cleanup ---------------------------------------------------------

async function seedOwner(opts?: { corruptJira?: boolean }): Promise<string> {
  const ownerId = randomUUID();
  await db.insert(user).values({
    id: ownerId,
    name: "Action Test",
    email: `at-${ownerId}@example.test`,
  });

  const [ghCred] = await db
    .insert(githubCredential)
    .values({
      id: randomUUID(),
      ownerId,
      encryptedToken: encryptToken(GH_TOKEN, { ownerId, provider: "GITHUB" }),
      tokenLast4: "1234",
      githubLogin: "lead",
    })
    .returning({ id: githubCredential.id });

  await db.insert(monitoredRepo).values({
    id: randomUUID(),
    ownerId,
    credentialId: ghCred.id,
    githubRepoId: 555,
    fullName: "acme/app",
  });

  const [jiraCred] = await db
    .insert(jiraCredential)
    .values({
      id: randomUUID(),
      ownerId,
      // corruptJira: encrypt under the WRONG provider AAD so decrypt (provider
      // "JIRA") fails GCM verification → TokenCryptoError → decrypt_failed.
      encryptedToken: encryptToken(JIRA_TOKEN, {
        ownerId,
        provider: opts?.corruptJira ? "GITHUB" : "JIRA",
      }),
      tokenLast4: "1234",
      workspaceUrl: "https://acme.atlassian.net",
      jiraEmail: "lead@example.com",
    })
    .returning({ id: jiraCredential.id });

  await db.insert(jiraProject).values({
    id: randomUUID(),
    ownerId,
    credentialId: jiraCred.id,
    jiraProjectId: "10000",
    projectKey: "SF",
  });

  return ownerId;
}

const owners: string[] = [];
async function newOwner(opts?: { corruptJira?: boolean }): Promise<string> {
  const id = await seedOwner(opts);
  owners.push(id);
  currentOwnerId = id;
  return id;
}

beforeAll(() => {
  process.env.GITHUB_API_BASE_URL = GH_BASE;
  process.env.JIRA_API_BASE_URL = JIRA_BASE;
});

afterAll(async () => {
  delete process.env.GITHUB_API_BASE_URL;
  delete process.env.JIRA_API_BASE_URL;
  await pool.end();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const id of owners.splice(0)) {
    await db.delete(user).where(eq(user.id, id));
  }
});

/** Capture every console channel so we can assert no token ever leaks. */
function captureConsole() {
  const captured: string[] = [];
  const channels = ["log", "info", "warn", "error", "debug"] as const;
  channels.forEach((c) =>
    vi.spyOn(console, c).mockImplementation((...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(" "));
    }),
  );
  return { captured };
}

// --- Tests ------------------------------------------------------------------

describe("team actions — happy path", () => {
  it("imports + saves roster and cadence, never leaking a token", async () => {
    const ownerId = await newOwner();
    vi.stubGlobal("fetch", makeGlobalFetch());
    const { captured } = captureConsole();

    const imported = await importRosterAction();
    if (!imported.ok) throw new Error(`importRoster failed: ${imported.error}`);
    expect(imported.githubDegraded).toBe(false);
    expect(imported.members).toHaveLength(4);

    // Import PROPOSES now (S-15): four id-less rows, and not one DB write.
    expect(imported.added).toBe(4);
    expect(imported.missing).toBe(0);
    expect(imported.members.every((m) => m.proposed === true && m.id === undefined)).toBe(true);
    const afterImport = await db
      .select()
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId));
    expect(afterImport).toHaveLength(0);

    // The owner's Save is what persists it — this is the first-run flow, with the
    // two halves of one human already mapped in the grid, so three members land.
    const saved = await saveRosterAction({
      members: [
        {
          name: "Mia Krystof",
          githubUsername: "octocat",
          jiraAccountId: "acc-1",
          role: "Tech Lead",
          fte: 0.5,
          technologyTrack: "BACKEND",
        },
        { name: "devtwo", githubUsername: "devtwo", fte: 1 },
        { name: "Sam Lee", jiraAccountId: "acc-2", fte: 1 },
      ],
    });
    expect(saved.ok).toBe(true);

    const rows = await db.select().from(teamMember).where(eq(teamMember.ownerId, ownerId));
    expect(rows).toHaveLength(3);

    const mapped = rows.find((r) => r.githubUsername === "octocat");
    expect(mapped?.source).toBe("BOTH");
    expect(mapped?.role).toBe("Tech Lead");
    // `numeric` comes back from the driver as a STRING — asserting the raw column
    // is the point: it is what every read site must convert, and what
    // `isUnchanged` would otherwise compare against a number forever.
    expect(mapped?.fte).toBe("0.50");
    // An inserted row's availability came from the owner, so it is confirmed by
    // construction and never shows the migration banner.
    expect(mapped?.fteConfirmedAt).not.toBeNull();
    expect(mapped?.technologyTrack).toBe("BACKEND");

    // A re-import against the saved roster proposes nothing and still writes nothing.
    const reimported = await importRosterAction();
    if (!reimported.ok) throw new Error(`re-import failed: ${reimported.error}`);
    expect(reimported.added).toBe(0);
    expect(reimported.missing).toBe(0);
    const afterReimport = await db
      .select({ id: teamMember.id })
      .from(teamMember)
      .where(eq(teamMember.ownerId, ownerId));
    expect(afterReimport).toHaveLength(3);

    const cadence = await importCadenceAction();
    if (!cadence.ok) throw new Error(`importCadence failed: ${cadence.error}`);
    expect(cadence.noActiveSprint).toBe(false);
    expect(cadence.cadence.lengthDays).toBe(14);

    const savedCadence = await saveCadenceAction({
      lengthDays: 21,
      startDay: "WED",
      workingDays: ["MON", "TUE", "WED"],
    });
    expect(savedCadence.ok).toBe(true);
    // A CHANGED submit records a deliberate override (S-29), PER FIELD since
    // S-30; confirming the derived values unchanged reports every field as
    // following the source and leaves auto-pull on.
    if (!savedCadence.ok) throw new Error("expected success");
    expect(savedCadence.provenance.lengthDays).toBe(true);

    const [sprintRow] = await db.select().from(sprint).where(eq(sprint.ownerId, ownerId));
    expect(sprintRow.lengthDays).toBe(21);

    expect(captured.join("\n")).not.toContain(JIRA_TOKEN);
    expect(captured.join("\n")).not.toContain(GH_TOKEN);
  });
});

describe("team actions — failure mapping", () => {
  it("saveRoster rejects invalid input with invalid_input", async () => {
    await newOwner();
    vi.stubGlobal("fetch", makeGlobalFetch());

    const result = await saveRosterAction({ members: [{ name: "" }] });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("invalid_input");
  });

  it("saveCadence rejects invalid input with invalid_input", async () => {
    await newOwner();

    const result = await saveCadenceAction({
      lengthDays: 0,
      startDay: "MON",
      workingDays: [],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("invalid_input");
  });

  it("saveCadence refuses with no_sprint when nothing has been imported (S-29)", async () => {
    const ownerId = await newOwner();
    // A roster exists, so the wizard's `no_roster` pre-check passes and the
    // refusal under test is genuinely the missing sprint row — the case that
    // used to return `{ok: true}` having written nothing.
    await db.insert(teamMember).values({
      id: randomUUID(),
      ownerId,
      name: "Mia",
      source: "JIRA",
    });

    const result = await saveCadenceAction({
      lengthDays: 14,
      startDay: "MON",
      workingDays: ["MON", "TUE", "WED", "THU", "FRI"],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("no_sprint");
  });

  it("surfaces GitHub 403 as githubDegraded (not a hard failure)", async () => {
    await newOwner();
    vi.stubGlobal("fetch", makeGlobalFetch({ githubStatus: 403 }));

    const result = await importRosterAction();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok with degradation");
    expect(result.githubDegraded).toBe(true);
    expect(result.reason).toContain("read:org");
    // Jira members still seeded despite the GitHub degradation.
    expect(result.members).toHaveLength(2);
  });

  it("maps a decrypt failure to decrypt_failed without leaking a token", async () => {
    await newOwner({ corruptJira: true });
    vi.stubGlobal("fetch", makeGlobalFetch());
    const { captured } = captureConsole();

    const result = await importCadenceAction();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toBe("decrypt_failed");
    expect(captured.join("\n")).not.toContain(JIRA_TOKEN);
  });
});
