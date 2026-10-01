"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert, Field, Input, Select } from "@/components/ui/Form";
import { Modal } from "@/components/ui/Modal";
import { useConfig } from "@/context/ConfigContext";
import { useToast } from "@/context/ToastContext";
import { ApiError, api, errorMessage } from "@/lib/api";
import { refNumber, round2 } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";

const METHODS: PaymentMethod[] = ["Cash", "Card", "Bank Transfer", "Online"];

interface Props {
  billId: number;
  balance: number;
  currentMethod?: PaymentMethod | null;
  onClose: () => void;
  onSaved: () => void;
}

export function PaymentModal({ billId, balance, currentMethod, onClose, onSaved }: Props) {
  const { money } = useConfig();
  const toast = useToast();
  const [amount, setAmount] = useState(String(round2(balance)));
  const [method, setMethod] = useState<PaymentMethod>(currentMethod ?? "Cash");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(amount);
    if (amount.trim() === "" || Number.isNaN(value) || value <= 0) return setErrors({ amount: "Enter an amount above 0" });
    if (value > round2(balance)) return setErrors({ amount: `Cannot exceed the balance of ${money(balance)}` });
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      await api.post(`/bills/${billId}/payments`, { payment_method: method, amount: value });
      toast.success("Payment recorded");
      onSaved();
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
      open
      size="sm"
      title={`Record payment - ${refNumber("bill", billId)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="payment-form" variant="success" loading={saving}>
            Record payment
          </Button>
        </>
      }
    >
      <form id="payment-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <p className="text-sm text-slate-600">
          Outstanding balance: <strong>{money(balance)}</strong>
        </p>
        <Field label="Amount received" error={errors.amount} required>
          <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} invalid={!!errors.amount} autoFocus />
        </Field>
        <Field label="Payment method" error={errors.payment_method} required>
          <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {METHODS.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
        </Field>
      </form>
    </Modal>
  );
}

export { METHODS as PAYMENT_METHODS };
