import { requireSession } from "@/lib/auth";

/**
 * Post-auth landing target. Stub for now — the Anomaly Inbox and sprint panels
 * arrive in S-07. Lives under the gated `(app)` group so middleware + the
 * layout's requireSession() guard both apply.
 */
export default async function DashboardPage() {
  const { user } = await requireSession();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">
        Dashboard — coming in S-07
      </h1>
      <p className="text-muted-foreground">
        Signed in as {user.name}. The Anomaly Inbox and sprint panels arrive in
        a later slice.
      </p>
    </div>
  );
}
