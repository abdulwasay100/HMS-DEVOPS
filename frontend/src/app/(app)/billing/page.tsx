"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import { PAYMENT_METHODS, PaymentModal } from "@/components/forms/PaymentModal";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, Pagination, SearchInput, Toolbar, type Column } from "@/components/ui/DataTable";
import { Alert, Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Card, PageHeader } from "@/components/ui/Layout";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { useAuth } from "@/context/AuthContext";
import { useConfig } from "@/context/ConfigContext";
import { useToast } from "@/context/ToastContext";
import { useDebounce, useFetch } from "@/hooks/useApi";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDate, formatDateTime, refNumber, round2 } from "@/lib/format";
import { isManagerUp } from "@/lib/permissions";
import type { Bill, BillDetail, CustomerOption, PaymentMethod } from "@/lib/types";

interface Unbilled {
  bookings: { id: number; check_in: string; check_out: string; status: string; price_per_night: number; total_amount: number; room_number: string; room_type: string }[];
  orders: { id: number; subtotal: number; discount: number; total: number; location: string | null; created_at: string }[];
}

interface Preset {
  customerId?: string;
  walkin?: boolean;
  bookingId?: number;
  orderId?: number;
}

function NewBillModal({ preset, onClose }: { preset: Preset; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { money, taxRatePercent } = useConfig();
  const customers = useFetch<CustomerOption[]>("/customers/options");

  const [selection, setSelection] = useState(preset.walkin ? "walkin" : (preset.customerId ?? ""));
  const [bookingId, setBookingId] = useState<number | null>(preset.bookingId ?? null);
  const [orderIds, setOrderIds] = useState<number[]>(preset.orderId ? [preset.orderId] : []);
  const [discount, setDiscount] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("Cash");
  const [paid, setPaid] = useState("0");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const unbilled = useFetch<Unbilled>("/bills/unbilled", { customer_id: selection && selection !== "walkin" ? selection : undefined }, selection !== "");

  const data = selection !== "" ? unbilled.data : undefined;
  // Preselected ids from the URL only count if they are actually billable for this customer.
  const selectedBooking = data?.bookings.find((b) => b.id === bookingId);
  const selectedOrders = (data?.orders ?? []).filter((o) => orderIds.includes(o.id));
  const validBookingId = selectedBooking?.id ?? null;
  const validOrderIds = selectedOrders.map((o) => o.id);

  const roomCharges = selectedBooking?.total_amount ?? 0;
  const foodCharges = round2(selectedOrders.reduce((s, o) => s + o.subtotal, 0));
  const subtotal = round2(roomCharges + foodCharges);
  const suggestedDiscount = round2(selectedOrders.reduce((s, o) => s + o.discount, 0));
  const discountNum = discount === null ? suggestedDiscount : Number(discount) || 0;
  const discountApplied = Math.min(Math.max(discountNum, 0), subtotal);
  const tax = round2(((subtotal - discountApplied) * taxRatePercent) / 100);
  const grandTotal = round2(subtotal - discountApplied + tax);

  function chooseCustomer(value: string) {
    setSelection(value);
    setBookingId(null);
    setOrderIds([]);
    setDiscount(null);
  }

  async function submit() {
    const next: Record<string, string> = {};
    if (selection === "") next.customer = "Select a customer or walk-in";
    if (!validBookingId && validOrderIds.length === 0) next.items = "Select a booking or at least one completed order";
    if (discountNum < 0 || Number.isNaN(discountNum)) next.discount = "Enter a valid discount";
    else if (discountNum > subtotal) next.discount = "Discount cannot exceed the subtotal";
    const paidNum = Number(paid) || 0;
    if (paidNum < 0) next.amount_paid = "Cannot be negative";
    else if (paidNum > grandTotal) next.amount_paid = "Cannot exceed the grand total";
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    setFormError(null);
    try {
      const res = await api.post<BillDetail>("/bills", {
        customer_id: selection && selection !== "walkin" ? Number(selection) : undefined,
        booking_id: validBookingId ?? undefined,
        order_ids: validOrderIds,
        discount: discountNum,
        notes: notes.trim(),
        payment_method: paidNum > 0 ? method : undefined,
        amount_paid: paidNum,
      });
      toast.success("Bill generated");
      router.push(`/billing/${res.data.id}`);
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
      size="lg"
      title="Generate bill"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Generate bill - {money(grandTotal)}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {formError && <Alert>{formError}</Alert>}

        <Field label="Customer" error={errors.customer} required>
          <Select value={selection} onChange={(e) => chooseCustomer(e.target.value)} invalid={!!errors.customer}>
            <option value="">Select a customer...</option>
            <option value="walkin">Walk-in (orders without a customer)</option>
            {(customers.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} - {c.phone}
              </option>
            ))}
          </Select>
        </Field>

        {selection !== "" && (
          <div className="space-y-4">
            {unbilled.loading && !unbilled.data ? (
              <p className="text-sm text-slate-500">Loading unbilled charges...</p>
            ) : (
              <>
                {selection !== "walkin" && (
                  <div>
                    <p className="mb-2 text-sm font-medium text-slate-700">Room stay</p>
                    {data?.bookings.length ? (
                      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                        {data.bookings.map((b) => (
                          <li key={b.id}>
                            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-brand-600"
                                checked={validBookingId === b.id}
                                onChange={(e) => setBookingId(e.target.checked ? b.id : null)}
                              />
                              <span className="flex-1">
                                <span className="font-medium text-slate-900">
                                  {refNumber("booking", b.id)} - Room {b.room_number} ({b.room_type})
                                </span>
                                <span className="block text-xs text-slate-500">
                                  {formatDate(b.check_in)} to {formatDate(b.check_out)} - {b.status}
                                </span>
                              </span>
                              <span className="font-medium">{money(b.total_amount)}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">No unbilled bookings.</p>
                    )}
                  </div>
                )}

                <div>
                  <p className="mb-2 text-sm font-medium text-slate-700">Completed food orders</p>
                  {data?.orders.length ? (
                    <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                      {data.orders.map((o) => (
                        <li key={o.id}>
                          <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-slate-50">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-slate-300 text-brand-600"
                              checked={validOrderIds.includes(o.id)}
                              onChange={(e) => setOrderIds((ids) => (e.target.checked ? [...ids, o.id] : ids.filter((x) => x !== o.id)))}
                            />
                            <span className="flex-1">
                              <span className="font-medium text-slate-900">{refNumber("order", o.id)}</span>
                              <span className="block text-xs text-slate-500">
                                {formatDateTime(o.created_at)}
                                {o.location ? ` - ${o.location}` : ""}
                              </span>
                            </span>
                            <span className="font-medium">{money(o.subtotal)}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-300 p-3 text-sm text-slate-500">No unbilled completed orders.</p>
                  )}
                </div>
                {errors.items && <p className="text-xs text-red-600">{errors.items}</p>}
              </>
            )}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Discount" error={errors.discount} hint={suggestedDiscount > 0 ? `Order discounts applied: ${money(suggestedDiscount)}` : undefined}>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={discount ?? String(suggestedDiscount)}
              onChange={(e) => setDiscount(e.target.value)}
              invalid={!!errors.discount}
            />
          </Field>
          <Field label="Notes">
            <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          </Field>
          <Field label="Payment received now" error={errors.amount_paid} hint="Leave 0 to issue an unpaid bill">
            <div className="flex gap-2">
              <Input type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} invalid={!!errors.amount_paid} />
              <Button variant="secondary" onClick={() => setPaid(String(grandTotal))} className="shrink-0">
                Full
              </Button>
            </div>
          </Field>
          <Field label="Payment method" error={errors.payment_method}>
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
        </div>

        <dl className="ml-auto max-w-xs space-y-1.5 rounded-lg bg-slate-50 p-3 text-sm">
          <div className="flex justify-between"><dt className="text-slate-600">Room charges</dt><dd>{money(roomCharges)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">Food charges</dt><dd>{money(foodCharges)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{money(subtotal)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd>- {money(discountApplied)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-600">Tax ({taxRatePercent}%)</dt><dd>{money(tax)}</dd></div>
          <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold text-slate-900"><dt>Grand total</dt><dd>{money(grandTotal)}</dd></div>
        </dl>
      </div>
    </Modal>
  );
}

function BillingContent() {
  const { user } = useAuth();
  const { money } = useConfig();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const canDelete = isManagerUp(user?.role);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search);
  const { data, meta, loading, error, reload } = useFetch<Bill[]>("/bills", { search: debounced, payment_status: status, page });

  const preset = useMemo<Preset | null>(() => {
    if (params.get("new") !== "1") return null;
    const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);
    return {
      customerId: params.get("customer_id") ?? undefined,
      walkin: params.get("walkin") === "1",
      bookingId: num("booking_id"),
      orderId: num("order_id"),
    };
  }, [params]);
  const [manualOpen, setManualOpen] = useState(false);
  const newOpen = manualOpen || preset !== null;

  const [payTarget, setPayTarget] = useState<Bill | null>(null);
  const [deleting, setDeleting] = useState<Bill | null>(null);
  const [busy, setBusy] = useState(false);

  function closeNew() {
    setManualOpen(false);
    if (params.get("new")) router.replace("/billing");
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/bills/${deleting.id}`);
      toast.success("Bill deleted. Its booking and orders can be billed again.");
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error("Could not delete bill", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Bill>[] = [
    {
      key: "ref",
      header: "Invoice",
      cell: (b) => (
        <Link href={`/billing/${b.id}`} className="font-medium text-brand-700 hover:underline">
          {refNumber("bill", b.id)}
        </Link>
      ),
    },
    { key: "date", header: "Date", cell: (b) => formatDateTime(b.created_at) },
    { key: "customer", header: "Customer", cell: (b) => b.customer_name ?? <span className="text-slate-400">Walk-in</span> },
    { key: "total", header: "Grand total", align: "right", cell: (b) => <span className="font-medium">{money(b.grand_total)}</span> },
    { key: "paid", header: "Paid", align: "right", cell: (b) => money(b.amount_paid) },
    { key: "balance", header: "Balance", align: "right", cell: (b) => money(round2(b.grand_total - b.amount_paid)) },
    { key: "method", header: "Method", cell: (b) => b.payment_method ?? <span className="text-slate-400">-</span> },
    { key: "status", header: "Status", cell: (b) => <StatusBadge status={b.payment_status} /> },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (b) => (
        <div className="flex justify-end gap-1.5">
          {b.payment_status !== "Paid" && (
            <Button size="sm" variant="success" onClick={() => setPayTarget(b)}>
              Record payment
            </Button>
          )}
          <Link href={`/billing/${b.id}`} className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
            Receipt
          </Link>
          {canDelete && b.amount_paid === 0 && (
            <Button size="sm" variant="ghost" aria-label={`Delete ${refNumber("bill", b.id)}`} onClick={() => setDeleting(b)}>
              <Icon name="trash" className="h-4 w-4 text-red-500" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Billing"
        description="Combine room charges and food orders into a single invoice."
        actions={
          <Button onClick={() => setManualOpen(true)}>
            <Icon name="plus" className="h-4 w-4" /> Generate bill
          </Button>
        }
      />
      <Card padded={false}>
        <Toolbar>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder="Search customer or invoice #"
          />
          <Select
            aria-label="Filter by payment status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="sm:w-44"
          >
            <option value="">All payment statuses</option>
            <option>Unpaid</option>
            <option>Partial</option>
            <option>Paid</option>
          </Select>
        </Toolbar>
        <DataTable columns={columns} rows={data} rowKey={(b) => b.id} loading={loading} error={error} emptyTitle="No bills yet" emptyDescription="Generate a bill from a booking or completed orders." />
        <Pagination meta={meta} onPageChange={setPage} />
      </Card>

      {newOpen && <NewBillModal key={preset ? params.toString() : "manual"} preset={preset ?? {}} onClose={closeNew} />}
      {payTarget && (
        <PaymentModal
          billId={payTarget.id}
          balance={round2(payTarget.grand_total - payTarget.amount_paid)}
          currentMethod={payTarget.payment_method}
          onClose={() => setPayTarget(null)}
          onSaved={reload}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete bill"
        message={`Delete ${deleting ? refNumber("bill", deleting.id) : ""}? Only unpaid bills can be deleted; the linked booking and orders become billable again.`}
        confirmLabel="Delete"
        loading={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={null}>
      <BillingContent />
    </Suspense>
  );
}
