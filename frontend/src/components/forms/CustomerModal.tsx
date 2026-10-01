"use client";

import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { Alert, Field, Input, Textarea } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/context/ToastContext";
import { ApiError, api, errorMessage } from "@/lib/api";
import type { Customer } from "@/lib/types";
import { validate, type FormErrors } from "@/lib/validation";

const schema = z.object({
  name: z.string().trim().min(2, "Enter the customer's name").max(150),
  phone: z
    .string()
    .trim()
    .min(5, "Enter a valid phone number")
    .max(40)
    .regex(/^[0-9+()\-\s.]+$/, "Only digits, spaces and + ( ) - . are allowed"),
  email: z.string().trim().max(190).refine((v) => v === "" || z.email().safeParse(v).success, "Enter a valid email"),
  address: z.string().trim().max(255),
  id_number: z.string().trim().max(60),
});

interface Props {
  open: boolean;
  customer?: Customer | null;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}

export function CustomerModal({ open, customer, onClose, onSaved }: Props) {
  const toast = useToast();
  const [values, setValues] = useState({
    name: customer?.name ?? "",
    phone: customer?.phone ?? "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    id_number: customer?.id_number ?? "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const result = validate(schema, values);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      const res = customer
        ? await api.put<Customer>(`/customers/${customer.id}`, result.data)
        : await api.post<Customer>("/customers", result.data);
      toast.success(customer ? "Customer updated" : "Customer added");
      onSaved(res.data);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      title={customer ? "Edit customer" : "Add customer"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="customer-form" loading={saving}>
            {customer ? "Save changes" : "Add customer"}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <div className="sm:col-span-2">
            <Alert>{formError}</Alert>
          </div>
        )}
        <Field label="Full name" error={errors.name} required>
          <Input value={values.name} onChange={set("name")} invalid={!!errors.name} autoFocus />
        </Field>
        <Field label="Phone" error={errors.phone} required>
          <Input value={values.phone} onChange={set("phone")} invalid={!!errors.phone} inputMode="tel" placeholder="+1 555 000 0000" />
        </Field>
        <Field label="Email" error={errors.email}>
          <Input type="email" value={values.email} onChange={set("email")} invalid={!!errors.email} />
        </Field>
        <Field label="ID / passport number" error={errors.id_number}>
          <Input value={values.id_number} onChange={set("id_number")} invalid={!!errors.id_number} />
        </Field>
        <Field label="Address" error={errors.address} className="sm:col-span-2">
          <Textarea rows={2} value={values.address} onChange={set("address")} />
        </Field>
      </form>
    </Modal>
  );
}
