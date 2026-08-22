"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { OctagonXIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import RepoSelector from "@/components/organisms/setup/repo-selector";
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
  type ClientRepo,
  storeGithubIntegration,
  validateGithubToken,
} from "@/app/(app)/setup/github/actions";
import {
  githubTokenSchema,
  type GithubTokenValues,
} from "@/lib/validations/github";

/**
 * GitHub connect step (S-02). Two-stage flow: validate the PAT (no write), then
 * render the repo picker. Copies the S-01 form pattern (zodResolver, try/catch
 * onSubmit, isSubmitting, Card/Form). Client-only — holds a reference to the
 * Server Actions but never imports `auth`/`crypto`/`db`.
 *
 * Failures surface as a PERSISTENT inline Alert (not a transient toast) so a
 * server/network error is never missed — the PRD graceful-degradation guardrail.
 */

type ValidatedState = {
  token: string;
  login: string;
  likelyFineGrained: boolean;
  hasRepoScope: boolean;
  repos: ClientRepo[];
};

export default function GithubConnectForm({
  redirectTo,
}: {
  /**
   * Where to go after a successful connect. Omitted (the wizard) → `refresh()`,
   * so the page re-renders into its connected-status card and the wizard's
   * "Continue to Jira" CTA. Set (Settings) → navigate there instead, because
   * that caller asked to connect ONE integration, not to enter a 3-step flow.
   *
   * A string, not a callback: this is a client component rendered from a server
   * component, and a function prop cannot cross that boundary.
   */
  redirectTo?: string;
} = {}) {
  const router = useRouter();
  const [validated, setValidated] = useState<ValidatedState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<GithubTokenValues>({
    resolver: zodResolver(githubTokenSchema),
    defaultValues: { token: "" },
  });

  async function onValidate(values: GithubTokenValues) {
    setFormError(null);
    try {
      const result = await validateGithubToken(values.token);
      if (!result.ok) {
        setFormError(result.message);
        return;
      }
      setValidated({
        token: values.token,
        login: result.login,
        likelyFineGrained: result.likelyFineGrained,
        hasRepoScope: result.hasRepoScope,
        repos: result.repos,
      });
    } catch {
      setFormError("Something went wrong reaching GitHub. Please try again.");
    }
  }

  if (validated) {
    return (
      <RepoSelector
        login={validated.login}
        repos={validated.repos}
        likelyFineGrained={validated.likelyFineGrained}
        hasRepoScope={validated.hasRepoScope}
        onBack={() => setValidated(null)}
        onSave={async (selectedRepoIds) => {
          const result = await storeGithubIntegration(
            validated.token,
            selectedRepoIds,
          );
          if (!result.ok) {
            return { ok: false as const, message: result.message };
          }
          toast.success(
            `Connected as ${result.login} — monitoring ${result.repoCount} ` +
              `${result.repoCount === 1 ? "repository" : "repositories"}.`,
          );
          if (redirectTo) router.push(redirectTo);
          else router.refresh();
          return { ok: true as const };
        }}
      />
    );
  }

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connect a GitHub token</CardTitle>
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
              name="token"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Personal access token</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="ghp_…"
                      autoComplete="off"
                      spellCheck={false}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    A classic token with the <code>repo</code> scope. We validate
                    it with GitHub before storing anything, and encrypt it at rest.
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
