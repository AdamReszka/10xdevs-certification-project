"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import RepoSelector from "@/components/organisms/setup/repo-selector";
import {
  loadAvailableRepos,
  updateMonitoredRepos,
  type ClientRepo,
} from "@/app/(app)/settings/connections/actions";

/**
 * Change the monitored repositories without re-entering the PAT (S-10 Phase 8).
 *
 * Reuses the wizard's `RepoSelector` verbatim — it takes data plus callbacks and
 * carries no wizard-specific chrome, so the picker behaves identically in both
 * places. Only the token source differs: here it is already stored.
 */
export default function RepoSelectionEditor() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    login: string;
    likelyFineGrained: boolean;
    hasRepoScope: boolean;
    repos: ClientRepo[];
  } | null>(null);

  async function handleOpen() {
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const result = await loadAvailableRepos();
      if (result.ok) {
        setData({
          login: result.login,
          likelyFineGrained: result.likelyFineGrained,
          hasRepoScope: result.hasRepoScope,
          repos: result.repos,
        });
      } else {
        setError(result.message);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" onClick={handleOpen}>
        Change monitored repositories
      </Button>
    );
  }

  return (
    <div className="rounded-lg border p-4">
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading repositories from GitHub…</p>
      ) : error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : data ? (
        <RepoSelector
          login={data.login}
          repos={data.repos}
          likelyFineGrained={data.likelyFineGrained}
          hasRepoScope={data.hasRepoScope}
          onSave={async (selectedRepoIds) => {
            const result = await updateMonitoredRepos(selectedRepoIds);
            if (!result.ok) return { ok: false, message: result.message };
            setOpen(false);
            router.refresh();
            return { ok: true };
          }}
          onBack={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
