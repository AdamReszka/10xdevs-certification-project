import { z } from "zod";

/**
 * Shared zod schemas for the auth forms. Centralized so client validation is
 * consistent and `useForm` types are inferred from one source.
 *
 * The password `min(8)` matches Better Auth's default minimum so the client and
 * server agree on what's acceptable (avoids a client-pass / server-reject gap).
 */

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export const signupSchema = z
  .object({
    name: z.string().min(1, "Name is required"),
    email: z.string().email("Enter a valid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export const resetRequestSchema = z.object({
  email: z.string().email("Enter a valid email address"),
});

export const resetConfirmSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type SignupValues = z.infer<typeof signupSchema>;
export type ResetRequestValues = z.infer<typeof resetRequestSchema>;
export type ResetConfirmValues = z.infer<typeof resetConfirmSchema>;
