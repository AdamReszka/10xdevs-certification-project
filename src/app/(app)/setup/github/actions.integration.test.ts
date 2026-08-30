import { randomUUID } from "node:crypto";

import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import {
  githubCommit,
  githubCredential,
  githubPullRequest,
  githubReview,
  monitoredRepo,
  user,
} from "@/db/schema";
import { GithubAuthError } from "@/lib/github";
import {
  disconnectGithub,
  storeGithubIntegration,
  validateAndListRepos,
} from "@/lib/integrations/github-store";

/**
 * S-02 Phase 3 — credential-security integration tests against REAL Postgres
 * (local Supabase `:54322`). These target the request-context-free service core
 * (`github-store.ts`), NOT the Server Action: the service takes `{ db, ownerId }`
 * explicitly, so it runs in Vitest node with a real `getDb()`-shaped drizzle
 * instance and no `getCloudflareContext`/`requireSession`.
 *
 * Assertions mandated by test-plan §5 / change.md:
 *  - #3  the plaintext token never appears in a return value or a log line
 *        (success path + validation-failure path); the stored envelope ≠ token.
 *  - F4  re-connecting keeps the credential row's id stable so
 *        `monitored_repo.credential_id` always references a live credential.
 *  - #4  cross-account IDOR: account B cannot read account A's rows, and B's
 *        disconnect leaves A intact (ownership is enforced ONLY by the
 *        `where eq(ownerId, …)` predicate — Data API off, no RLS).
 *
 * The GitHub HTTP edge is mocked via the injectable `fetchImpl` (no network).
 */

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = drizzle(pool);

afterAll(async () => {
  await pool.end();
});

// --- GitHub edge mock -------------------------------------------------------

const REPOS = [
  { id: 111111, full_name: "octo/frontend" },
  { id: 222222, full_name: "octo/backend" },
];

/**
 * A `fetch` stand-in answering the two GitHub GETs the service makes. `/user`
 * returns 200 with a login + classic `x-oauth-scopes`; `/user/repos` returns the
 * fixture repo list (single page, no `Link`). Pass `{ userStatus: 401 }` to
 * exercise the validation-failure path (#3).
 */
function makeFetch(opts?: { userStatus?: number }): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = typeof input === "string" ? input : (input as Request).url;

    if (url.includes("/user/repos")) {
      return new Response(JSON.stringify(REPOS), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/user") || url.includes("/user?")) {
      const status = opts?.userStatus ?? 200;
      if (status !== 200) {
        return new Response("{}", { status });
      }
      return new Response(JSON.stringify({ login: "octocat" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-oauth-scopes": "repo, read:org",
        },
      });
    }
    throw new Error(`unexpected mock fetch URL: ${url}`);
  }) as typeof fetch;
}

// --- Seed / cleanup helpers -------------------------------------------------

/** Insert a bare `user` row (satisfies the ownerId FK). Returns the id. */
async function seedUser(): Promise<string> {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    name: "Integration Test",
    email: `it-${id}@example.test`,
  });
  return id;
}

/** Delete users → cascades their credential + monitored-repo rows. */
async function cleanupUsers(ids: string[]): Promise<void> {
  for (const id of ids) {
    await db.delete(user).where(eq(user.id, id));
  }
}

// --- Console capture (leak detection) --------------------------------------

/** Spy every console channel and collect the stringified args. */
function captureConsole() {
  const captured: string[] = [];
  const channels = ["log", "info", "warn", "error", "debug"] as const;
  const spies = channels.map((c) =>
    vi.spyOn(console, c).mockImplementation((...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(" "));
    }),
  );
  return {
    captured,
    restore: () => spies.forEach((s) => s.mockRestore()),
  };
}

// A token shaped like a classic PAT (passes the zod regex used upstream).
const TOKEN = "ghp_IntegrationTokenABCDEFGHIJKLMNOP1234";

describe("github-store service — credential security (integration)", () => {
  const owners: string[] = [];

  afterEach(async () => {
    await cleanupUsers(owners.splice(0));
    vi.restoreAllMocks();
  });

  describe("#3 credential never leaks (success path)", () => {
    it("stores an encrypted envelope, never the plaintext, and logs nothing sensitive", async () => {
      const ownerId = await seedUser();
      owners.push(ownerId);
      const console = captureConsole();

      const result = await storeGithubIntegration({
        db,
        ownerId,
        token: TOKEN,
        selectedRepoIds: [String(REPOS[0].id)],
        opts: { fetchImpl: makeFetch() },
      });

      console.restore();

      // Return value carries only non-secret meta.
      expect(result).toEqual({
        login: "octocat",
        tokenLast4: "1234",
        repoCount: 1,
      });
      expect(JSON.stringify(result)).not.toContain(TOKEN);

      // No console channel saw the raw token.
      expect(console.captured.join("\n")).not.toContain(TOKEN);

      // The persisted envelope is encrypted, not the plaintext.
      const [row] = await db
        .select()
        .from(githubCredential)
        .where(eq(githubCredential.ownerId, ownerId));
      expect(row).toBeDefined();
      expect(row.encryptedToken).not.toContain(TOKEN);
      expect(row.encryptedToken).not.toEqual(TOKEN);
      expect(row.encryptedToken.startsWith("v1:")).toBe(true);
      expect(row.tokenLast4).toBe("1234");
      expect(row.githubLogin).toBe("octocat");

      const repos = await db
        .select()
        .from(monitoredRepo)
        .where(eq(monitoredRepo.ownerId, ownerId));
      expect(repos).toHaveLength(1);
      expect(repos[0].githubRepoId).toBe(REPOS[0].id);
    });
  });

  describe("#3 credential never leaks (validation-failure path)", () => {
    it("throws GithubAuthError without the token, writes nothing, logs nothing sensitive", async () => {
      const ownerId = await seedUser();
      owners.push(ownerId);
      const console = captureConsole();

      let thrown: unknown;
      try {
        await validateAndListRepos({
          token: TOKEN,
          opts: { fetchImpl: makeFetch({ userStatus: 401 }) },
        });
      } catch (err) {
        thrown = err;
      }

      console.restore();

      expect(thrown).toBeInstanceOf(GithubAuthError);
      expect(String((thrown as Error).message)).not.toContain(TOKEN);
      expect(String((thrown as Error).stack ?? "")).not.toContain(TOKEN);
      expect(console.captured.join("\n")).not.toContain(TOKEN);

      // Nothing was persisted on the failure path.
      const rows = await db
        .select()
        .from(githubCredential)
        .where(eq(githubCredential.ownerId, ownerId));
      expect(rows).toHaveLength(0);
    });
  });

  describe("F4 re-connect keeps a valid credential FK", () => {
    it("re-storing for the same owner keeps one credential and a valid monitored_repo FK", async () => {
      const ownerId = await seedUser();
      owners.push(ownerId);

      await storeGithubIntegration({
        db,
        ownerId,
        token: TOKEN,
        selectedRepoIds: [String(REPOS[0].id)],
        opts: { fetchImpl: makeFetch() },
      });

      const [firstCred] = await db
        .select()
        .from(githubCredential)
        .where(eq(githubCredential.ownerId, ownerId));
      const firstCredId = firstCred.id;

      // Re-connect with a DIFFERENT selection.
      await storeGithubIntegration({
        db,
        ownerId,
        token: TOKEN,
        selectedRepoIds: [String(REPOS[1].id)],
        opts: { fetchImpl: makeFetch() },
      });

      // Exactly one credential row, and its id is unchanged (row kept, not
      // re-created — otherwise the repo FK would dangle).
      const creds = await db
        .select()
        .from(githubCredential)
        .where(eq(githubCredential.ownerId, ownerId));
      expect(creds).toHaveLength(1);
      expect(creds[0].id).toBe(firstCredId);

      // The new repo set points at the live credential id.
      const repos = await db
        .select()
        .from(monitoredRepo)
        .where(eq(monitoredRepo.ownerId, ownerId));
      expect(repos).toHaveLength(1);
      expect(repos[0].githubRepoId).toBe(REPOS[1].id);
      expect(repos[0].credentialId).toBe(firstCredId);
    });
  });

  describe("#4 cross-account IDOR isolation", () => {
    it("account B cannot read account A's rows and B's disconnect leaves A intact", async () => {
      const ownerA = await seedUser();
      const ownerB = await seedUser();
      owners.push(ownerA, ownerB);

      // A connects; B connects nothing.
      await storeGithubIntegration({
        db,
        ownerId: ownerA,
        token: TOKEN,
        selectedRepoIds: [String(REPOS[0].id), String(REPOS[1].id)],
        opts: { fetchImpl: makeFetch() },
      });

      // Read isolation: the owner-scoped select (exactly what the page runs)
      // returns A's row for A and nothing for B.
      const aRows = await db
        .select()
        .from(githubCredential)
        .where(eq(githubCredential.ownerId, ownerA));
      const bRows = await db
        .select()
        .from(githubCredential)
        .where(eq(githubCredential.ownerId, ownerB));
      expect(aRows).toHaveLength(1);
      expect(bRows).toHaveLength(0);

      // B disconnects — must NOT touch A's rows (ownerId is the only guard).
      await disconnectGithub({ db, ownerId: ownerB });

      const aCredAfter = await db
        .select()
        .from(githubCredential)
        .where(eq(githubCredential.ownerId, ownerA));
      const aReposAfter = await db
        .select()
        .from(monitoredRepo)
        .where(eq(monitoredRepo.ownerId, ownerA));
      expect(aCredAfter).toHaveLength(1);
      expect(aReposAfter).toHaveLength(2);
    });
  });
});

/**
 * S-26 — the GitHub subtree survives a disconnect.
 *
 * `monitored_repo.credential_id` moved from CASCADE to SET NULL, so the repo
 * rows and everything hanging off their internal ids stay put with no
 * credential. This is what makes the dialog's default outcome real rather than
 * copy: the ids are what a reconnect re-links through
 * `monitored_repo_owner_repo_uq`.
 */
describe("S-26: disconnecting GitHub keeps the repos and their synced history", () => {
  const owners: string[] = [];

  afterEach(async () => {
    await cleanupUsers(owners.splice(0));
  });

  it("leaves monitored_repo, commits, PRs and reviews in place with credential_id null", async () => {
    const ownerId = await seedUser();
    owners.push(ownerId);

    await storeGithubIntegration({
      db,
      ownerId,
      token: TOKEN,
      selectedRepoIds: [String(REPOS[0].id)],
      opts: { fetchImpl: makeFetch() },
    });

    const [repo] = await db
      .select()
      .from(monitoredRepo)
      .where(eq(monitoredRepo.ownerId, ownerId));
    const repoId = repo.id;

    const prId = randomUUID();
    await db.insert(githubCommit).values({
      id: randomUUID(),
      ownerId,
      repoId,
      sha: "abc1234",
      authorGithubUsername: "octocat",
      authoredAt: new Date("2026-08-20T10:00:00.000Z"),
    });
    await db.insert(githubPullRequest).values({
      id: prId,
      ownerId,
      repoId,
      githubPrId: 987654,
      number: 42,
      title: "Add the thing",
    });
    await db.insert(githubReview).values({
      id: randomUUID(),
      ownerId,
      pullRequestId: prId,
      reviewerGithubUsername: "hubot",
    });

    await disconnectGithub({ db, ownerId });

    // The credential really is gone — otherwise this passes vacuously.
    const creds = await db
      .select()
      .from(githubCredential)
      .where(eq(githubCredential.ownerId, ownerId));
    expect(creds).toHaveLength(0);

    const reposAfter = await db
      .select()
      .from(monitoredRepo)
      .where(eq(monitoredRepo.ownerId, ownerId));
    expect(reposAfter).toHaveLength(1);
    expect(reposAfter[0].id).toBe(repoId);
    expect(reposAfter[0].credentialId).toBeNull();
    // The durable GitHub-side key a reconnect re-links on.
    expect(reposAfter[0].githubRepoId).toBe(REPOS[0].id);

    const commits = await db
      .select()
      .from(githubCommit)
      .where(eq(githubCommit.ownerId, ownerId));
    const prs = await db
      .select()
      .from(githubPullRequest)
      .where(eq(githubPullRequest.ownerId, ownerId));
    const reviews = await db
      .select()
      .from(githubReview)
      .where(eq(githubReview.ownerId, ownerId));
    expect(commits).toHaveLength(1);
    expect(prs).toHaveLength(1);
    expect(reviews).toHaveLength(1);
  });
});
