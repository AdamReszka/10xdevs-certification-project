import { redirect } from "next/navigation";

/**
 * Setup wizard entry — always lands on the first step (GitHub). Kept as a
 * dedicated redirect so `/setup` is a stable URL as later steps are added.
 */
export default function SetupPage() {
  redirect("/setup/github");
}
