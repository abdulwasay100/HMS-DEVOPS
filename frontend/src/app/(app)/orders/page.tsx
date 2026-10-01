"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CustomerModal } from "@/components/forms/CustomerModal";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, Pagination, SearchInput, Toolbar, type Column } from "@/components/ui/DataTable";
import { Alert, Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Card, PageHeader } from "@/components/ui/Layout";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { useConfig } from "@/context/ConfigContext";
import { useToast } from "@/context/ToastContext";
import { useDebounce, useFetch } from "@/hooks/useApi";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDateTime, formatQty, refNumber, round2 } from "@/lib/format";
import type { CustomerOption, MenuCategory, MenuItem, Order, OrderStatus } from "@/lib/types";

const STATUSES: OrderStatus[] = ["Pending", "Preparing", "Completed", "Cancelled"];

function NewOrderModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { money, taxRatePercent } = useConfig();
  const menu = useFetch<MenuItem[]>("/menu/items");
  const categories = useFetch<MenuCategory[]>("/menu/categories");
  const customers = useFetch<CustomerOption[]>("/customers/options");

  const [customerId, setCustomerId] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [cart, setCart] = useState<Record<number, number>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customerModal, setCustomerModal] = useState(false);

  const items = useMemo(() => menu.data ?? [], [menu.data]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const visible = items.filter(
    (i) =>
      !!i.is_available &&
      (!category || String(i.category_id) === category) &&
      (!search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase())),
  );

  const lines = Object.entries(cart)
    .map(([id, qty]) => ({ item: byId.get(Number(id)), qty }))
    .filter((l): l is { item: MenuItem; qty: number } => !!l.item && l.qty > 0);
  const subtotal = round2(lines.reduce((s, l) => s + l.item.price * l.qty, 0));
  const discountNum = Number(discount) || 0;
  const discountApplied = Math.min(Math.max(discountNum, 0), subtotal);
  const tax = round2(((subtotal - discountApplied) * taxRatePercent) / 100);
  const total = round2(subtotal - discountApplied + tax);

  function setQty(id: number, qty: number) {
    setCart((c) => {
      const next = { ...c };
      if (qty <= 0) delete next[id];
      else next[id] = Math.min(qty, 999);
      return next;
    });
  }

  async function submit() {
    const nextErrors: Record<string, string> = {};
    if (lines.length === 0) nextErrors.items = "Add at least one item to the order";
    if (discount.trim() !== "" && (Number.isNaN(discountNum) || discountNum < 0)) nextErrors.discount = "Enter a valid discount";
    else if (discountNum > subtotal) nextErrors.discount = "Discount cannot exceed the subtotal";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setSaving(true);
    setFormError(null);
    try {
      await api.post("/orders", {
        customer_id: customerId ? Number(customerId) : undefined,
        location: location.trim(),
        notes: notes.trim(),
        discount: discountNum,
        items: lines.map((l) => ({ menu_item_id: l.item.id, quantity: l.qty })),
      });
      toast.success("Order created");
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
    <>
      <Modal
        open
        size="xl"
        title="New order"
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving}>
              Place order - {money(total)}
            </Button>
          </>
        }
      >
        {formError && (
          <div className="mb-4">
            <Alert>{formError}</Alert>
          </div>
        )}
        <div className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-3">
            <div className="mb-3 flex flex-col gap-2 sm:flex-row">
              <SearchInput value={search} onChange={setSearch} placeholder="Search menu" />
              <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-48">
                <option value="">All categories</option>
                {(categories.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            {menu.loading && !menu.data ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading menu...</p>
            ) : visible.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-500">No available menu items match.</p>
            ) : (
              <div className="grid max-h-[26rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {visible.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => setQty(i.id, (cart[i.id] ?? 0) + 1)}
                    className="rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-brand-400 hover:bg-brand-50"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">{i.name}</span>
                      {cart[i.id] ? (
                        <span className="rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{cart[i.id]}</span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">{i.category_name}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{money(i.price)}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-4 lg:col-span-2">
            <Field label="Customer" hint="Leave empty for walk-in guests">
              <div className="flex gap-2">
                <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Walk-in customer</option>
                  {(customers.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} - {c.phone}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" onClick={() => setCustomerModal(true)} aria-label="Add customer">
                  <Icon name="plus" className="h-4 w-4" />
                </Button>
              </div>
            </Field>
            <Field label="Table / room">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="e.g. Table 4, Room 203" maxLength={60} />
            </Field>

            <div className="rounded-lg border border-slate-200">
              <p className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Order items</p>
              {lines.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-slate-500">Tap menu items to add them.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {lines.map((l) => (
                    <li key={l.item.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{l.item.name}</p>
                        <p className="text-xs text-slate-500">{money(l.item.price)} each</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="secondary" aria-label={`Decrease ${l.item.name}`} onClick={() => setQty(l.item.id, l.qty - 1)}>
                          -
                        </Button>
                        <span className="w-7 text-center font-medium">{l.qty}</span>
                        <Button size="sm" variant="secondary" aria-label={`Increase ${l.item.name}`} onClick={() => setQty(l.item.id, l.qty + 1)}>
                          +
                        </Button>
                      </div>
                      <span className="w-20 text-right font-medium">{money(round2(l.item.price * l.qty))}</span>
                    </li>
                  ))}
                </ul>
              )}
              {errors.items && <p className="px-3 pb-2 text-xs text-red-600">{errors.items}</p>}
            </div>

            <Field label="Discount" error={errors.discount}>
              <Input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} invalid={!!errors.discount} />
            </Field>
            <Field label="Notes">
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergies, special requests..." />
            </Field>

            <dl className="space-y-1.5 rounded-lg bg-slate-50 p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-600">Subtotal</dt>
                <dd>{money(subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Discount</dt>
                <dd>- {money(discountApplied)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-600">Tax ({taxRatePercent}%)</dt>
                <dd>{money(tax)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-200 pt-1.5 text-base font-semibold text-slate-900">
                <dt>Total</dt>
                <dd>{money(total)}</dd>
              </div>
            </dl>
          </div>
        </div>
      </Modal>
      {customerModal && (
        <CustomerModal
          open
          onClose={() => setCustomerModal(false)}
          onSaved={(c) => {
            customers.reload();
            setCustomerId(String(c.id));
          }}
        />
      )}
    </>
  );
}

function OrderDetailModal({ orderId, onClose }: { orderId: number; onClose: () => void }) {
  const { money } = useConfig();
  const { data, loading, error } = useFetch<Order>(`/orders/${orderId}`);
  return (
    <Modal open title={`Order ${refNumber("order", orderId)}`} onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      {loading && !data ? (
        <p className="py-6 text-center text-sm text-slate-500">Loading...</p>
      ) : error || !data ? (
        <Alert>{error ?? "Order not found"}</Alert>
      ) : (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-slate-600">
            <StatusBadge status={data.status} />
            <span>{data.customer_name ?? "Walk-in customer"}</span>
            {data.location && <span>{data.location}</span>}
            <span>{formatDateTime(data.created_at)}</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th className="py-2">Item</th>
                <th className="py-2 text-right">Qty</th>
                <th className="py-2 text-right">Price</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.items?.map((i) => (
                <tr key={i.id}>
                  <td className="py-2">{i.item_name}</td>
                  <td className="py-2 text-right">{i.quantity}</td>
                  <td className="py-2 text-right">{money(i.unit_price)}</td>
                  <td className="py-2 text-right">{money(i.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto w-full max-w-xs space-y-1">
            <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{money(data.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd>- {money(data.discount)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Tax ({data.tax_rate}%)</dt><dd>{money(data.tax)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold text-slate-900"><dt>Total</dt><dd>{money(data.total)}</dd></div>
          </dl>
          {data.notes && <p className="rounded-lg bg-slate-50 p-3 text-slate-600">{data.notes}</p>}
        </div>
      )}
    </Modal>
  );
}

export default function OrdersPage() {
  const toast = useToast();
  const { money } = useConfig();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search);
  const { data, meta, loading, error, reload } = useFetch<Order[]>("/orders", { search: debounced, status, page });

  const [newOpen, setNewOpen] = useState(false);
  const [viewId, setViewId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function changeStatus(order: Order, next: OrderStatus) {
    setBusyId(order.id);
    try {
      const res = await api.patch<Order>(`/orders/${order.id}/status`, { status: next });
      toast.success(`${refNumber("order", order.id)} is now ${next}`);
      const low = (res.low_stock as { name: string; quantity: number; unit: string; min_stock: number }[] | undefined) ?? [];
      if (low.length) {
        toast.warning(
          "Low stock warning",
          low.map((i) => `${i.name}: ${formatQty(i.quantity)} ${i.unit} left (min ${formatQty(i.min_stock)})`).join("\n"),
        );
      }
      setCancelTarget(null);
      reload();
    } catch (err) {
      toast.error(`Could not mark order as ${next}`, errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<Order>[] = [
    { key: "ref", header: "Order", cell: (o) => <span className="font-medium text-slate-900">{refNumber("order", o.id)}</span> },
    { key: "date", header: "Placed", cell: (o) => formatDateTime(o.created_at) },
    { key: "customer", header: "Customer", cell: (o) => o.customer_name ?? <span className="text-slate-400">Walk-in</span> },
    { key: "location", header: "Table / room", cell: (o) => o.location ?? <span className="text-slate-400">-</span> },
    { key: "items", header: "Items", align: "center", cell: (o) => o.items_count },
    { key: "total", header: "Total", align: "right", cell: (o) => <span className="font-medium">{money(o.total)}</span> },
    { key: "status", header: "Status", cell: (o) => <StatusBadge status={o.status} /> },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (o) => (
        <div className="flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          {o.status === "Pending" && (
            <Button size="sm" variant="secondary" loading={busyId === o.id} onClick={() => changeStatus(o, "Preparing")}>
              Start preparing
            </Button>
          )}
          {(o.status === "Pending" || o.status === "Preparing") && (
            <>
              <Button size="sm" variant="success" loading={busyId === o.id} onClick={() => changeStatus(o, "Completed")}>
                Complete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCancelTarget(o)}>
                <span className="text-red-600">Cancel</span>
              </Button>
            </>
          )}
          {o.status === "Completed" &&
            (o.bill_id ? (
              <Link href={`/billing/${o.bill_id}`} className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
                View bill
              </Link>
            ) : (
              <Link
                href={`/billing?new=1${o.customer_id ? `&customer_id=${o.customer_id}` : "&walkin=1"}&order_id=${o.id}`}
                className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50"
              >
                Create bill
              </Link>
            ))}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Food orders"
        description="Take orders, track kitchen progress. Stock is deducted automatically when an order is completed."
        actions={
          <Button onClick={() => setNewOpen(true)}>
            <Icon name="plus" className="h-4 w-4" /> New order
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
            placeholder="Search order #, customer, table"
          />
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
            className="sm:w-44"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={data}
          rowKey={(o) => o.id}
          loading={loading}
          error={error}
          onRowClick={(o) => setViewId(o.id)}
          emptyTitle="No orders found"
        />
        <Pagination meta={meta} onPageChange={setPage} />
      </Card>

      {newOpen && <NewOrderModal onClose={() => setNewOpen(false)} onSaved={reload} />}
      {viewId !== null && <OrderDetailModal orderId={viewId} onClose={() => setViewId(null)} />}
      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel order"
        message={`Cancel order ${cancelTarget ? refNumber("order", cancelTarget.id) : ""}? No stock will be deducted.`}
        confirmLabel="Cancel order"
        loading={busyId !== null}
        onConfirm={() => cancelTarget && changeStatus(cancelTarget, "Cancelled")}
        onCancel={() => setCancelTarget(null)}
      />
    </>
  );
}
