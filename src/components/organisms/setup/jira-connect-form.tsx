"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { OctagonXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  type ClientProject,
  type ClientStatus,
  type JiraCredentialsInput,
  fetchProjectStatuses,
  storeJiraIntegration,
  validateJiraCredentials,
} from "@/app/(app)/setup/jira/actions";
import JiraProjectSelector from "@/components/organisms/setup/jira-project-selector";
import JiraStatusMapper from "@/components/organisms/setup/jira-status-mapper";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  type JiraCredentialValues,
  jiraCredentialSchema,
} from "@/lib/validations/jira";

/**
 * Jira connect step (S-03). Three-stage flow: validate credentials (no write) →
 * pick a project → map statuses. The credentials are held in client memory across
 * stages (as `github-connect-form` holds the token) and passed into each Server
 * Action; they are never echoed back in an action return. Failures surface as a
 * PERSISTENT inline Alert (PRD graceful-degradation), not a transient toast.
 */

type Stage =
  | { step: "credentials" }
  | {
      step: "project";
      creds: JiraCredentialsInput;
      projects: ClientProject[];
    }
  | {
      step: "mapping";
      creds: JiraCredentialsInput;
      projects: ClientProject[];
      jiraProjectId: string;
      projectKey: string;
      statuses: ClientStatus[];
      recoveryNote: string | null;
    };

export default function JiraConnectForm() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ step: "credentials" });
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<JiraCredentialValues>({
    resolver: zodResolver(jiraCredentialSchema),
    defaultValues: { workspaceUrl: "", email: "", token: "" },
  });

  async function onValidate(values: JiraCredentialValues) {
    setFormError(null);
    try {
      const result = await validateJiraCredentials(
        values.workspaceUrl,
        values.email,
        values.token,
      );
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      setStage({
        step: "project",
        creds: values,
        projects: result.projects,
      });
    } catch {
      setFormError("Something went wrong reaching Jira. Please try again.");
    }
  }

  if (stage.step === "project") {
    return (
      <JiraProjectSelector
        email={stage.creds.email}
        projects={stage.projects}
        onBack={() => setStage({ step: "credentials" })}
        onContinue={async (jiraProjectId) => {
          const result = await fetchProjectStatuses(
            stage.creds.workspaceUrl,
            stage.creds.email,
            stage.creds.token,
            jiraProjectId,
          );
          if (!result.ok) return { ok: false as const, message: result.message };
          const project = stage.projects.find((p) => p.id === jiraProjectId);
          setStage({
            step: "mapping",
            creds: stage.creds,
            projects: stage.projects,
            jiraProjectId,
            projectKey: project?.key ?? jiraProjectId,
            statuses: result.statuses,
            recoveryNote: null,
          });
          return { ok: true as const };
        }}
      />
    );
  }

  if (stage.step === "mapping") {
    return (
      <JiraStatusMapper
        // Re-key on the status set so an F4 refresh re-seeds the Selects.
        key={`${stage.jiraProjectId}:${stage.statuses.map((s) => s.id).join(",")}`}
        projectKey={stage.projectKey}
        statuses={stage.statuses}
        recoveryNote={stage.recoveryNote}
        onBack={() =>
          setStage({
            step: "project",
            creds: stage.creds,
            projects: stage.projects,
          })
        }
        onSave={async (mappings) => {
          const result = await storeJiraIntegration(
            stage.creds,
            stage.jiraProjectId,
            mappings,
          );
          if (!result.ok) {
            // F4 recovery: statuses changed since render → re-fetch and re-seed
            // the mapper with the fresh set rather than dead-ending.
            if (result.error === "incomplete_mapping") {
              const refreshed = await fetchProjectStatuses(
                stage.creds.workspaceUrl,
                stage.creds.email,
                stage.creds.token,
                stage.jiraProjectId,
              );
              if (refreshed.ok) {
                setStage({
                  ...stage,
                  statuses: refreshed.statuses,
                  recoveryNote: result.message,
                });
              }
            }
            return { ok: false as const, message: result.message };
          }
          toast.success(
            `Connected to ${result.projectKey} — ${result.mappedCount} ` +
              `${result.mappedCount === 1 ? "status" : "statuses"} mapped.`,
          );
          router.refresh();
          return { ok: true as const };
        }}
      />
    );
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a Jira workspace</CardTitle>
      </CardHeader>
      <Form {...form}>
        <form
          onSubmit={form.handleSubmit(onValidate)}
          className="flex flex-col gap-6"
        >
          <CardContent className="flex flex-col gap-4">
            {formError ? (
              <Alert variant="destructive">
                <OctagonXIcon />
                <AlertTitle>Couldn&apos;t connect</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <FormField
              control={form.control}
              name="workspaceUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Workspace URL</FormLabel>
                  <FormControl>
                    <Input placeholder="yourteam.atlassian.net" autoComplete="off" {...field} />
                  </FormControl>
                  <FormDescription>
                    Your Jira Cloud site, e.g. <code>yourteam.atlassian.net</code>.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Account email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="you@example.com"
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="token"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>API token</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="Your Jira API token"
                      autoComplete="off"
                      spellCheck={false}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Create one at id.atlassian.com → Security → API tokens. We
                    validate it with Jira before storing anything, and encrypt it
                    at rest.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Validating…" : "Connect"}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
