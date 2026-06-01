import type { Metadata } from "next";

import ResetForm from "@/components/organisms/auth/reset-form";

export const metadata: Metadata = {
  title: "Reset password · SprintFlow",
};

export default function ResetPage() {
  return <ResetForm />;
}
