import { randomUUID } from "node:crypto";

import { expect, type Browser, type BrowserContext } from "@playwright/test";
import pg from "pg";

/**
 * Account fixtures shared by the E2E specs (`onboarding-routing` Phase 3).
 *
 * Not a `.spec.ts`: Playwright's default `testMatch` collects only
 * `**​/*.spec.ts`, and importing one spec file from another would re-register
 * its tests inside the importing suite. The plan asked for "both helpers in one
 * place"; a plain module is the only shape that satisfies that without
 * duplicating every test in `dashboard-sprint-detail.spec.ts`.
 *
 * WHY AN ONBOARDED ACCOUNT IS NEEDED AT ALL. `/dashboard` is gated on
 * `isOnboardingComplete` since Phase 3, so any spec that asserts the real
 * dashboard needs an account that satisfies the predicate. The obvious move —
 * onboard the shared `storageState` account once in `auth.setup.ts` — does NOT
 * work: `setup-github.spec.ts` and `setup-jira.spec.ts` each click *Disconnect*
 * in `afterEach` by design, which drops the credential the predicate checks
 * first, and under `fullyParallel: true` the ordering is a coin flip. The shared
 * account is deliberately left un-onboarded; specs that need the dashboard take
 * an account of their own from here.
 */

export const DB_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

/**
 * HARD-REFUSE any database that is not local Supabase.
 *
 * This module runs `delete from "user"` and writes six tables directly. The
 * integration project already refuses a non-local `DATABASE_URL` for exactly
 * that reason (`test/integration/setup.ts`), and the repo has a
 * `DATABASE_URL_OVERRIDE` convention precisely because people DO point
 * `DATABASE_URL` somewhere else — at which point `npm run test:e2e` would delete
 * rows there. A wrong URL must fail at import, before any spec runs.
 */
{
  let host: string;
  let port: string;
  try {
    const parsed = new URL(DB_URL);
    host = parsed.hostname;
    port = parsed.port;
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  const isLocal = (host === "127.0.0.1" || host === "localhost") && port === "54322";
  if (!isLocal) {
    throw new Error(
      `E2E specs write and DELETE rows directly; they refuse any database that is not local Supabase (127.0.0.1:54322). Got ${host}:${port}.`,
    );
  }
}

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

export const PASSWORD = "Sprint-Flow-1!";

/**
 * Create a brand-new authenticated browser context, without going through the
 * login UI.
 *
 * Used by every describe that cannot share the suite's `storageState` account:
 * the setup specs connect GitHub and Jira on it, so under `fullyParallel` any
 * assertion about the unconnected state is a coin flip there.
 */
export async function signUpFreshAccount(
  browser: Browser,
  email: string,
  name = "E2E User",
): Promise<BrowserContext> {
  const context = await browser.newContext();
  const res = await context.request.post("/api/auth/sign-up/email", {
    // Better Auth rejects a cross-origin-looking POST (MISSING_OR_NULL_ORIGIN);
    // APIRequestContext sends no Origin by default, so set it explicitly.
    headers: { origin: BASE_URL },
    data: { name, email, password: PASSWORD },
  });
  expect(res.ok(), `sign-up failed: ${res.status()} ${await res.text()}`).toBeTruthy();
  return context;
}

/** Resolve the `user.id` a sign-up just created. */
export async function resolveOwnerId(client: pg.Client, email: string): Promise<string> {
  const { rows } = await client.query('select id from "user" where email = $1', [email]);
  expect(rows, "the sign-up did not create a user row").toHaveLength(1);
  return rows[0].id;
}

export type OnboardedAccount = {
  context: BrowserContext;
  ownerId: string;
  email: string;
};

/**
 * Sign up an account and write the six rows `isOnboardingComplete` probes, so
 * `/dashboard` renders instead of redirecting to the doorstep.
 *
 * COUPLED TO THE PREDICATE BY CONSTRUCTION. The rows below are exactly
 * `src/lib/onboarding.ts`'s `ONBOARDING_PROBES`, in order: a GitHub credential
 * + one monitored repo (S-02), a Jira credential + project + one status mapping
 * (S-03), and one team member (S-04). If a seventh condition is ever added, the
 * specs that use this helper start redirecting — read that as a seeding gap
 * here, not as a routing bug in `/dashboard`.
 *
 * Deliberately NOT seeded: sprint, tickets, commits. The predicate does not read
 * them (cadence is excluded on purpose — S-04 finding F1), and leaving them out
 * keeps the "no active sprint" empty states assertable on an onboarded account.
 *
 * The encrypted-token columns hold placeholders. Nothing on `/dashboard`
 * decrypts them — the gate asks only whether the row exists.
 */
export async function signUpOnboardedAccount(
  browser: Browser,
  email: string,
): Promise<OnboardedAccount> {
  const context = await signUpFreshAccount(browser, email);

  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    const ownerId = await resolveOwnerId(client, email);

    const ghCredId = randomUUID();
    await client.query(
      `insert into github_credential (id, owner_id, encrypted_token, token_last4, github_login)
       values ($1,$2,$3,$4,'ada-e2e')`,
      [ghCredId, ownerId, "e2e-placeholder-not-a-real-token", "0000"],
    );
    await client.query(
      `insert into monitored_repo (id, owner_id, credential_id, github_repo_id, full_name, is_active)
       values ($1,$2,$3,$4,'acme/e2e-onboarded',true)`,
      [randomUUID(), ownerId, ghCredId, 920001],
    );

    const jiraCredId = randomUUID();
    await client.query(
      `insert into jira_credential (id, owner_id, encrypted_token, token_last4, workspace_url, jira_email)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        jiraCredId,
        ownerId,
        "e2e-placeholder-not-a-real-token",
        "0000",
        "https://e2e.atlassian.net",
        email,
      ],
    );
    const projId = randomUUID();
    await client.query(
      `insert into jira_project (id, owner_id, credential_id, jira_project_id, project_key, time_zone)
       values ($1,$2,$3,$4,$5,$6)`,
      [projId, ownerId, jiraCredId, "10001", "E2E", "Europe/Warsaw"],
    );
    await client.query(
      `insert into status_mapping (id, owner_id, jira_project_id, jira_status_id, jira_status_name, category)
       values ($1,$2,$3,'10000','To Do','TODO')`,
      [randomUUID(), ownerId, projId],
    );

    await client.query(
      `insert into team_member (id, owner_id, name, github_username, jira_account_id,
                                technology_track, source, is_active)
       values ($1,$2,'Ada Lovelace','ada-e2e','acc-ada-e2e','BACKEND','MANUAL',true)`,
      [randomUUID(), ownerId],
    );

    return { context, ownerId, email };
  } finally {
    await client.end();
  }
}

/**
 * Delete an account by the address it signed up with, if it still exists.
 *
 * The by-email variant exists for specs that sign up through the UI: the owner
 * id is not known until the row is written, so a cleanup keyed on an id captured
 * inside the test body would leak the account whenever the test fails early.
 */
export async function deleteAccountByEmail(email: string): Promise<void> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('delete from "user" where email = $1', [email]);
  } finally {
    await client.end();
  }
}

/**
 * Delete an account and everything under it. Every owner-scoped table cascades
 * from `user.id` — including the demo tenancy row, whose `demo_of` FK is
 * `ON DELETE CASCADE` — so this is the whole cleanup.
 */
export async function deleteAccount(ownerId: string): Promise<void> {
  const client = new pg.Client({ connectionString: DB_URL });
  await client.connect();
  try {
    await client.query('delete from "user" where id = $1', [ownerId]);
  } finally {
    await client.end();
  }
}
