import { redirect } from "next/navigation";

/**
 * Team entry — always lands on the first section. Kept as a dedicated redirect
 * so `/team` is a stable URL as later tabs are added (S-19), mirroring
 * `settings/page.tsx`. The header nav points here, not at a tab, so adding a tab
 * never moves where the nav goes.
 */
export default function TeamPage() {
  redirect("/team/roster");
}
