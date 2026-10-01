import { z, type ZodType } from "zod";

export type FormErrors = Record<string, string>;

/** A number typed into a text input. Rejects empty and non-numeric values instead of coercing them to 0. */
export const num = (requiredMessage = "This field is required") =>
  z
    .string()
    .trim()
    .min(1, requiredMessage)
    .transform(Number)
    .pipe(z.number({ error: "Enter a valid number" }).finite("Enter a valid number"));

/** Validates values with a zod schema and returns either parsed data or a field->message map. */
export function validate<T>(
  schema: ZodType<T>,
  values: unknown,
): { ok: true; data: T } | { ok: false; errors: FormErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const errors: FormErrors = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!errors[key]) errors[key] = issue.message;
  }
  return { ok: false, errors };
}
