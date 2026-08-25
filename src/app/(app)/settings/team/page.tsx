import { getCloudflareContext } from "@opennextjs/cloudflare";

import RosterEditor from "@/components/organisms/setup/roster-editor";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listRosterForEditor } from "@/lib/roster";

/**
 * Team settings (S-15) — the post-setup roster surface, and the half of FR-006
 * that S-04 left unbuilt.
 *
 * WHY THIS PAGE EXISTS: FR-006 does not describe a one-time import. It says the
 * owner "can edit each member's profile … and can change the technology track
 * over time". The setup wizard closed the import half; nothing linked back to
 * `/setup/team` afterwards, so a developer growing from frontend into full-stack
 * had no surface to record it on.
 *
 * Same organism as the wizard, different chrome and different framing copy: the
 * wizard says "review what we imported", Settings says "this is your team".
 *
 * Gated server component under `(app)`: inherits `requireSession()` +
 * `force-dynamic` — do NOT re-declare either. One `getDb` handle, one
 * owner-scoped read through the shared editor reader.
 */
export default async function TeamSettingsPage() {
  const session = await requireSession();
  const { env } = getCloudflareContext();
  const db = getDb(env);

  const initialMembers = await listRosterForEditor(db, session.user.id);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-medium">Your team</h2>
        <p className="text-sm text-muted-foreground">
          Everyone SprintFlow watches. Edit a profile, change someone&apos;s
          technology track as they grow into it, map a GitHub person to their Jira
          account, or deactivate someone who has left — their recorded absences and
          anomaly history stay intact.
        </p>
      </div>

      <RosterEditor initialMembers={initialMembers} />
    </div>
  );
}
