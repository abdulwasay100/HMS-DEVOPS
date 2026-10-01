"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Alert, Field, Input } from "@/components/ui/Form";
import { useAuth } from "@/context/AuthContext";
import { useConfig } from "@/context/ConfigContext";
import { errorMessage } from "@/lib/api";
import { validate, type FormErrors } from "@/lib/validation";

const schema = z.object({
  email: z.string().trim().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const { hotelName } = useConfig();
  const router = useRouter();
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [loading, user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = validate(schema, values);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    try {
      await login(result.data.email, result.data.password);
      router.replace("/");
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      <div className="relative hidden flex-1 flex-col justify-between bg-slate-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500 text-lg font-bold text-slate-900">
            {hotelName.charAt(0).toUpperCase()}
          </span>
          <span className="text-lg font-semibold">{hotelName}</span>
        </div>
        <div>
          <h2 className="max-w-md text-4xl font-semibold leading-tight">
            Rooms, restaurant, stock and billing - all in one place.
          </h2>
          <p className="mt-4 max-w-md text-slate-300">
            Manage bookings, kitchen orders and inventory with a single, streamlined console built for hotel teams.
          </p>
        </div>
        <p className="text-sm text-slate-400">Authorized staff only.</p>
      </div>

      <div className="flex flex-1 items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use the account provided by your administrator.</p>

          <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
            {formError && <Alert>{formError}</Alert>}
            <Field label="Email" error={errors.email}>
              <Input
                type="email"
                autoComplete="username"
                autoFocus
                value={values.email}
                invalid={!!errors.email}
                onChange={(e) => setValues({ ...values, email: e.target.value })}
              />
            </Field>
            <Field label="Password" error={errors.password}>
              <Input
                type="password"
                autoComplete="current-password"
                value={values.password}
                invalid={!!errors.password}
                onChange={(e) => setValues({ ...values, password: e.target.value })}
              />
            </Field>
            <Button type="submit" className="w-full" loading={submitting}>
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
