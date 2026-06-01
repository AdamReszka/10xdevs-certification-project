import type { Metadata } from "next";

import SignupForm from "@/components/organisms/auth/signup-form";

export const metadata: Metadata = {
  title: "Get started · SprintFlow",
};

export default function SignupPage() {
  return <SignupForm />;
}
