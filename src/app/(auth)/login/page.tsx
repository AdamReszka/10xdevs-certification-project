import type { Metadata } from "next";

import LoginForm from "@/components/organisms/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in · SprintFlow",
};

export default function LoginPage() {
  return <LoginForm />;
}
