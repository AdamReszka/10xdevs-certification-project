import type { Metadata } from "next";
import Link from "next/link";

import ResetPasswordForm from "@/components/organisms/auth/reset-password-form";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Set a new password · SprintFlow",
};

/**
 * Landing page for the password-reset link. Reads the `token` Better Auth
 * appended to the redirect URL and hands it to the new-password form. Lives at
 * `/reset/confirm` so it matches middleware's existing `/reset` public prefix
 * and stays reachable while unauthenticated (see plan Critical Details).
 */
export default async function ResetConfirmPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Invalid or expired link</CardTitle>
          <CardDescription>
            This password-reset link is missing or no longer valid. Request a
            new one to continue.
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <p className="text-sm text-muted-foreground">
            <Link
              href="/reset"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Request a new reset link
            </Link>
          </p>
        </CardFooter>
      </Card>
    );
  }

  return <ResetPasswordForm token={token} />;
}
