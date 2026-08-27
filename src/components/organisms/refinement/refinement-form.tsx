"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { runRefinementAction } from "@/app/(app)/refinement/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { BacklogResult } from "@/lib/refinement/backlog";
import type { RefinementRequest } from "@/lib/refinement/run-service";

/**
 * FR-020's three input routes, side by side (S-13 phase 6).
 *
 * ALL THREE ARE RENDERED, always. Each one maps to exactly one
 * `refinement_source` value, and a route that no surface can reach is an enum
 * value with no producer — the shape `frame.md` was written to close at
 * `dor_score`. The paste route in particular needs no credentials, so it stays
 * available even when the Jira read failed entirely; that is the PRD's
 * graceful-degradation requirement expressed as a layout rather than a banner.
 *
 * The cap is stated BEFORE the lead spends anything, and enforced again in the
 * action — the number here is a courtesy, the server's is the contract.
 */
export default function RefinementForm({
  backlog,
  maxTickets,
  aiConfigured,
}: {
  backlog: BacklogResult;
  maxTickets: number;
  /** False when no Claude key is resolvable. The form stays usable — the lead
   * may be reading history — but the run button says why it will not work
   * rather than letting them find out after picking tickets. */
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [typedKeys, setTypedKeys] = useState("");
  const [pasted, setPasted] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jiraReady = backlog.status === "ok";

  function toggle(key: string) {
    setSelected((current) =>
      current.includes(key)
        ? current.filter((k) => k !== key)
        : [...current, key],
    );
  }

  async function run(request: RefinementRequest) {
    setPending(true);
    setError(null);
    try {
      const result = await runRefinementAction(request);
      if (!result.ok) {
        // The selection is deliberately NOT cleared: an unknown key or a
        // transient Jira failure costs one edit to fix, and re-picking eight
        // tickets is what makes a lead stop using the tool.
        setError(result.message);
        return;
      }
      router.push(`/refinement/runs/${result.runId}`);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!aiConfigured ? (
        <Alert variant="destructive">
          <AlertDescription>
            SprintFlow has no Claude API key configured, so refinement cannot run.
            Set <code className="font-mono">ANTHROPIC_API_KEY</code> for this
            deployment. Nothing will be saved until it is.
          </AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs defaultValue="backlog">
        <TabsList>
          <TabsTrigger value="backlog">From the backlog</TabsTrigger>
          <TabsTrigger value="keys">By ticket key</TabsTrigger>
          <TabsTrigger value="paste">Paste a story</TabsTrigger>
        </TabsList>

        <TabsContent value="backlog" className="flex flex-col gap-3 pt-4">
          {jiraReady ? (
            <BacklogPicker
              tickets={backlog.tickets}
              boardId={backlog.boardId}
              selected={selected}
              onToggle={toggle}
            />
          ) : (
            <BacklogUnavailable backlog={backlog} />
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={pending || selected.length === 0 || !jiraReady}
              onClick={() => run({ source: "BACKLOG", ticketKeys: selected })}
            >
              {pending
                ? "Analysing…"
                : `Refine ${selected.length || ""} selected`.trim()}
            </Button>
            <p className="text-sm text-muted-foreground">
              {selected.length} of at most {maxTickets} per run.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="keys" className="flex flex-col gap-3 pt-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="refinement-keys">Ticket keys</Label>
            <Input
              id="refinement-keys"
              placeholder="FM-12, FM-18"
              value={typedKeys}
              onChange={(e) => setTypedKeys(e.target.value)}
              disabled={!jiraReady && backlog.status === "not_connected"}
            />
            <p className="text-sm text-muted-foreground">
              Comma- or space-separated. A ticket outside the backlog is analysed
              too; a key this project does not have is reported rather than
              skipped. At most {maxTickets} per run.
            </p>
          </div>
          <div>
            <Button
              disabled={pending || typedKeys.trim() === ""}
              onClick={() =>
                run({ source: "KEYS", ticketKeys: splitKeys(typedKeys) })
              }
            >
              {pending ? "Analysing…" : "Refine these keys"}
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="paste" className="flex flex-col gap-3 pt-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="refinement-paste">Ticket text</Label>
            <Textarea
              id="refinement-paste"
              rows={10}
              placeholder={"Eksport raportu do CSV\n\nJako pracownik marketingu…"}
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
            />
            <p className="text-sm text-muted-foreground">
              First line is the title, the rest is the description. Needs no Jira
              connection — a paste carries no attachments or links, and the
              analysis knows not to report them as missing.
            </p>
          </div>
          <div>
            <Button
              disabled={pending || pasted.trim() === ""}
              onClick={() => run({ source: "PASTED_TEXT", text: pasted })}
            >
              {pending ? "Analysing…" : "Refine this story"}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Accepts commas, whitespace or both — the lead pastes keys out of Jira, they
 * do not type a delimiter the form specified. */
function splitKeys(raw: string): string[] {
  return raw.split(/[\s,]+/).filter((part) => part !== "");
}

function BacklogPicker({
  tickets,
  boardId,
  selected,
  onToggle,
}: {
  tickets: { key: string; summary: string }[];
  boardId: number;
  selected: string[];
  onToggle: (key: string) => void;
}) {
  if (tickets.length === 0) {
    return (
      <Alert>
        <AlertDescription>
          Board {boardId}&apos;s backlog is empty — every ticket is already in a
          sprint, or the backlog lives on another board. Use a ticket key or paste
          the text instead.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <ScrollArea className="h-72 rounded-md border">
      <ul className="divide-y">
        {tickets.map((ticket) => (
          <li key={ticket.key}>
            <label className="flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/50">
              <Checkbox
                className="mt-0.5"
                checked={selected.includes(ticket.key)}
                onCheckedChange={() => onToggle(ticket.key)}
              />
              <span className="flex flex-col gap-0.5">
                <span className="font-mono text-xs text-muted-foreground">
                  {ticket.key}
                </span>
                <span className="text-sm">{ticket.summary}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}

/** Why the backlog is not there, in the lead's terms — never a blank list. Each
 * case names the fix, and the other two input routes stay open regardless. */
function BacklogUnavailable({ backlog }: { backlog: BacklogResult }) {
  if (backlog.status === "ok") return null;

  const message =
    backlog.status === "not_connected"
      ? "Jira is not connected, so there is no backlog to pick from."
      : backlog.status === "no_board"
        ? "Your Jira project has no board, so it has no backlog. Paste the ticket text instead."
        : backlog.status === "board_ambiguous"
          ? "Your Jira project has several boards. Pick the one SprintFlow should follow in setup."
          : backlog.message;

  return (
    <Alert variant="destructive">
      <AlertDescription className="flex flex-col gap-2">
        <span>{message}</span>
        <Link href="/settings/connections" className="underline underline-offset-4">
          Open connection settings
        </Link>
      </AlertDescription>
    </Alert>
  );
}
