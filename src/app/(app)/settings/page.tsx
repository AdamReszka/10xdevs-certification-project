import { redirect } from "next/navigation";

/**
 * Settings entry — always lands on the first section. Kept as a dedicated
 * redirect so `/settings` is a stable URL as later sections are added (S-14),
 * mirroring `setup/page.tsx`.
 */
export default function SettingsPage() {
  redirect("/settings/connections");
}
