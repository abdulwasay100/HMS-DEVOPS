"use client";

import { useState } from "react";
import { z } from "zod";
import { Alert, Field, Input } from "@/components/ui/Form";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/context/ToastContext";
import { ApiError, api, errorMessage } from "@/lib/api";
import { validate, type FormErrors } from "@/lib/validation";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Use at least 8 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, { path: ["confirm"], message: "Passwords do not match" });

const EMPTY = { currentPassword: "", newPassword: "", confirm: "" };

export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function close() {
    setValues(EMPTY);
    setErrors({});
    setFormError(null);
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validate(schema, values);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      await api.post("/auth/change-password", {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });
      toast.success("Password updated");
      close();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      else setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Change password"
      onClose={close}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" form="change-password-form" loading={saving}>
            Update password
          </Button>
        </>
      }
    >
      <form id="change-password-form" onSubmit={submit} className="space-y-4" noValidate>
        {formError && <Alert>{formError}</Alert>}
        <Field label="Current password" error={errors.currentPassword} required>
          <Input
            type="password"
            autoComplete="current-password"
            value={values.currentPassword}
            invalid={!!errors.currentPassword}
            onChange={(e) => setValues({ ...values, currentPassword: e.target.value })}
          />
        </Field>
        <Field label="New password" error={errors.newPassword} hint="At least 8 characters" required>
          <Input
            type="password"
            autoComplete="new-password"
            value={values.newPassword}
            invalid={!!errors.newPassword}
            onChange={(e) => setValues({ ...values, newPassword: e.target.value })}
          />
        </Field>
        <Field label="Confirm new password" error={errors.confirm} required>
          <Input
            type="password"
            autoComplete="new-password"
            value={values.confirm}
            invalid={!!errors.confirm}
            onChange={(e) => setValues({ ...values, confirm: e.target.value })}
          />
        </Field>
      </form>
    </Modal>
  );
}
