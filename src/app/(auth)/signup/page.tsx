import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { Metadata } from "next";

import SignupForm from "@/components/organisms/auth/signup-form";
import { resolveCaptchaSiteKey } from "@/lib/captcha";

export const metadata: Metadata = {
  title: "Get started · SprintFlow",
};

/**
 * The reCAPTCHA site key is read HERE, in the server component, and handed down
 * as a prop — not inlined as `NEXT_PUBLIC_*` at build time. Two reasons: this
 * repo has no proven build-time path for a public var (Workers Builds clones a
 * tree with no `.env`), and `wrangler.jsonc` records that plain `vars` do not
 * surface in `getCloudflareContext().env` on this OpenNext version. `(auth)` is
 * already `force-dynamic`, so a runtime read costs nothing extra here.
 */
export default function SignupPage() {
  const { env } = getCloudflareContext();
  return <SignupForm siteKey={resolveCaptchaSiteKey(env as { RECAPTCHA_SITE_KEY?: string })} />;
}
