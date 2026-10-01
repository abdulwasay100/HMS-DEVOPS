"use client";

import { useMemo, useState } from "react";
import { z } from "zod";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, Pagination, SearchInput, Toolbar, type Column } from "@/components/ui/DataTable";
import { Alert, Field, Input, Select } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Card, PageHeader, Tabs } from "@/components/ui/Layout";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { useAuth } from "@/context/AuthContext";
import { useConfig } from "@/context/ConfigContext";
import { useToast } from "@/context/ToastContext";
import { useFetch } from "@/hooks/useApi";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDateTime, formatQty } from "@/lib/format";
import { isManagerUp } from "@/lib/permissions";
import type { InventoryItem, InventoryTransaction, TransactionType } from "@/lib/types";
import { num, validate, type FormErrors } from "@/lib/validation";

const TX_TYPES: TransactionType[] = ["Initial", "Stock In", "Stock Out", "Order Usage"];

const itemSchema = z.object({
  name: z.string().trim().min(2, "Enter a name").max(150),
  category: z.string().trim().min(1, "Enter a category").max(80),
  unit: z.string().trim().min(1, "Enter a unit").max(20),
  quantity: num("Enter the opening quantity").pipe(z.number().min(0, "Cannot be negative")),
  min_stock: num("Enter the minimum stock").pipe(z.number().min(0, "Cannot be negative")),
  purchase_price: num("Enter a purchase price").pipe(z.number().min(0, "Cannot be negative")),
  supplier: z.string().trim().max(150),
});

function ItemModal({ item, categories, onClose, onSaved }: { item: InventoryItem | null; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState({
    name: item?.name ?? "",
    category: item?.category ?? "",
    unit: item?.unit ?? "",
    quantity: item ? String(item.quantity) : "0",
    min_stock: item ? String(item.min_stock) : "0",
    purchase_price: item ? String(item.purchase_price) : "0",
    supplier: item?.supplier ?? "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validate(itemSchema, values);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      if (item) {
        const { quantity: _ignored, ...rest } = result.data;
        void _ignored;
        await api.put(`/inventory/${item.id}`, rest);
      } else {
        await api.post("/inventory", result.data);
      }
      toast.success(item ? "Inventory item updated" : "Inventory item added");
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
      size="lg"
      title={item ? `Edit ${item.name}` : "Add inventory item"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="inventory-form" loading={saving}>
            {item ? "Save changes" : "Add item"}
          </Button>
        </>
      }
    >
      <form id="inventory-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <div className="sm:col-span-2">
            <Alert>{formError}</Alert>
          </div>
        )}
        <Field label="Item name" error={errors.name} required>
          <Input value={values.name} onChange={set("name")} invalid={!!errors.name} autoFocus />
        </Field>
        <Field label="Category" error={errors.category} required>
          <Input value={values.category} onChange={set("category")} invalid={!!errors.category} list="inv-categories" placeholder="e.g. Meat, Dairy, Beverages" />
          <datalist id="inv-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
        <Field label="Unit" error={errors.unit} required hint="pcs, kg, l, bottle...">
          <Input value={values.unit} onChange={set("unit")} invalid={!!errors.unit} />
        </Field>
        <Field
          label={item ? "Current quantity" : "Opening quantity"}
          error={errors.quantity}
          hint={item ? "Use Stock In / Stock Out to change quantity" : undefined}
          required
        >
          <Input type="number" min="0" step="0.001" value={values.quantity} onChange={set("quantity")} invalid={!!errors.quantity} disabled={!!item} />
        </Field>
        <Field label="Minimum stock level" error={errors.min_stock} required>
          <Input type="number" min="0" step="0.001" value={values.min_stock} onChange={set("min_stock")} invalid={!!errors.min_stock} />
        </Field>
        <Field label="Purchase price (per unit)" error={errors.purchase_price} required>
          <Input type="number" min="0" step="0.01" value={values.purchase_price} onChange={set("purchase_price")} invalid={!!errors.purchase_price} />
        </Field>
        <Field label="Supplier" error={errors.supplier} className="sm:col-span-2">
          <Input value={values.supplier} onChange={set("supplier")} />
        </Field>
      </form>
    </Modal>
  );
}

const adjustSchema = z.object({
  quantity: num("Enter a quantity").pipe(z.number().positive("Quantity must be greater than 0")),
  unit_cost: z.string().trim().refine((v) => v === "" || (!Number.isNaN(Number(v)) && Number(v) >= 0), "Enter a valid cost"),
  note: z.string().trim().max(255),
});

function AdjustModal({ item, type, onClose, onSaved }: { item: InventoryItem; type: "Stock In" | "Stock Out"; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState({ quantity: "", unit_cost: "", note: "" });
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validate(adjustSchema, values);
    if (!result.ok) return setErrors(result.errors);
    if (type === "Stock Out" && result.data.quantity > item.quantity) {
      return setErrors({ quantity: `Only ${formatQty(item.quantity)} ${item.unit} in stock` });
    }
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      await api.post(`/inventory/${item.id}/adjust`, {
        type,
        quantity: result.data.quantity,
        unit_cost: type === "Stock In" && result.data.unit_cost !== "" ? Number(result.data.unit_cost) : undefined,
        note: result.data.note,
      });
      toast.success(type === "Stock In" ? "Stock increased" : "Stock decreased");
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
      title={`${type}: ${item.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="adjust-form" loading={saving} variant={type === "Stock In" ? "success" : "primary"}>
            {type === "Stock In" ? "Add stock" : "Remove stock"}
          </Button>
        </>
      }
    >
      <form id="adjust-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <p className="text-sm text-slate-600">
          Current stock: <strong>{formatQty(item.quantity)} {item.unit}</strong>
        </p>
        <Field label={`Quantity (${item.unit})`} error={errors.quantity} required>
          <Input type="number" min="0" step="0.001" value={values.quantity} onChange={(e) => setValues({ ...values, quantity: e.target.value })} invalid={!!errors.quantity} autoFocus />
        </Field>
        {type === "Stock In" && (
          <Field label="Purchase price per unit" error={errors.unit_cost} hint="Optional. Updates the item's purchase price.">
            <Input type="number" min="0" step="0.01" value={values.unit_cost} onChange={(e) => setValues({ ...values, unit_cost: e.target.value })} invalid={!!errors.unit_cost} />
          </Field>
        )}
        <Field label="Note" error={errors.note} hint={type === "Stock Out" ? "e.g. spoilage, wastage, correction" : "e.g. supplier invoice number"}>
          <Input value={values.note} onChange={(e) => setValues({ ...values, note: e.target.value })} maxLength={255} />
        </Field>
      </form>
    </Modal>
  );
}

function HistoryTab({ items }: { items: InventoryItem[] }) {
  const [itemId, setItemId] = useState("");
  const [type, setType] = useState("");
  const [page, setPage] = useState(1);
  const { data, meta, loading, error } = useFetch<InventoryTransaction[]>("/inventory/transactions", { item_id: itemId, type, page });

  const columns: Column<InventoryTransaction>[] = [
    { key: "date", header: "Date", cell: (t) => formatDateTime(t.created_at) },
    { key: "item", header: "Item", cell: (t) => <span className="font-medium text-slate-900">{t.item_name}</span> },
    { key: "type", header: "Type", cell: (t) => <StatusBadge status={t.type} /> },
    {
      key: "change",
      header: "Change",
      align: "right",
      cell: (t) => (
        <span className={t.quantity_change < 0 ? "font-medium text-red-600" : "font-medium text-emerald-600"}>
          {t.quantity_change > 0 ? "+" : ""}
          {formatQty(t.quantity_change)} {t.unit}
        </span>
      ),
    },
    { key: "after", header: "Balance", align: "right", cell: (t) => `${formatQty(t.quantity_after)} ${t.unit}` },
    { key: "note", header: "Note", className: "max-w-xs truncate", cell: (t) => t.note ?? <span className="text-slate-400">-</span> },
    { key: "user", header: "By", cell: (t) => t.user_name ?? <span className="text-slate-400">System</span> },
  ];

  return (
    <Card padded={false}>
      <Toolbar>
        <Select
          aria-label="Filter by item"
          value={itemId}
          onChange={(e) => {
            setItemId(e.target.value);
            setPage(1);
          }}
          className="sm:w-64"
        >
          <option value="">All items</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by type"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setPage(1);
          }}
          className="sm:w-44"
        >
          <option value="">All types</option>
          {TX_TYPES.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </Select>
      </Toolbar>
      <DataTable columns={columns} rows={data} rowKey={(t) => t.id} loading={loading} error={error} emptyTitle="No stock movements yet" />
      <Pagination meta={meta} onPageChange={setPage} />
    </Card>
  );
}

export default function InventoryPage() {
  const { user } = useAuth();
  const { money } = useConfig();
  const toast = useToast();
  const canManage = isManagerUp(user?.role);
  const [tab, setTab] = useState<"items" | "history">("items");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const { data, loading, error, reload } = useFetch<InventoryItem[]>("/inventory");

  const [itemModal, setItemModal] = useState<{ item: InventoryItem | null } | null>(null);
  const [adjust, setAdjust] = useState<{ item: InventoryItem; type: "Stock In" | "Stock Out" } | null>(null);
  const [deleting, setDeleting] = useState<InventoryItem | null>(null);
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => data ?? [], [data]);
  const categories = useMemo(() => Array.from(new Set(all.map((i) => i.category))).sort(), [all]);
  const lowItems = all.filter((i) => i.is_low_stock);
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return all.filter(
      (i) =>
        (!category || i.category === category) &&
        (!lowOnly || i.is_low_stock) &&
        (!term || i.name.toLowerCase().includes(term) || (i.supplier ?? "").toLowerCase().includes(term)),
    );
  }, [all, search, category, lowOnly]);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/inventory/${deleting.id}`);
      toast.success("Inventory item deleted");
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error("Could not delete item", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<InventoryItem>[] = [
    {
      key: "name",
      header: "Item",
      cell: (i) => (
        <div>
          <p className="font-medium text-slate-900">{i.name}</p>
          <p className="text-xs text-slate-500">{i.category}</p>
        </div>
      ),
    },
    {
      key: "qty",
      header: "In stock",
      cell: (i) => (
        <div className="flex items-center gap-2">
          <span className={`font-semibold ${i.is_low_stock ? "text-red-600" : "text-slate-900"}`}>
            {formatQty(i.quantity)} {i.unit}
          </span>
          {i.is_low_stock ? <Badge tone="red">Low stock</Badge> : null}
        </div>
      ),
    },
    { key: "min", header: "Minimum", align: "right", cell: (i) => `${formatQty(i.min_stock)} ${i.unit}` },
    { key: "price", header: "Purchase price", align: "right", cell: (i) => money(i.purchase_price) },
    { key: "supplier", header: "Supplier", cell: (i) => i.supplier ?? <span className="text-slate-400">-</span> },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "Actions",
            align: "right" as const,
            cell: (i: InventoryItem) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="success" onClick={() => setAdjust({ item: i, type: "Stock In" })}>
                  + Stock
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setAdjust({ item: i, type: "Stock Out" })}>
                  - Stock
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Edit ${i.name}`} onClick={() => setItemModal({ item: i })}>
                  <Icon name="pencil" className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${i.name}`} onClick={() => setDeleting(i)}>
                  <Icon name="trash" className="h-4 w-4 text-red-500" />
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Inventory"
        description="Stock levels, purchases and a full history of every movement."
        actions={
          canManage && (
            <Button onClick={() => setItemModal({ item: null })}>
              <Icon name="plus" className="h-4 w-4" /> Add item
            </Button>
          )
        }
      />

      {lowItems.length > 0 && (
        <div className="mb-4">
          <Alert kind="warning">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>
                <strong>{lowItems.length} item(s) at or below minimum stock:</strong>{" "}
                {lowItems.slice(0, 6).map((i) => i.name).join(", ")}
                {lowItems.length > 6 ? "..." : ""}
              </span>
              <Button size="sm" variant="secondary" onClick={() => { setTab("items"); setLowOnly(true); }}>
                Show low stock
              </Button>
            </div>
          </Alert>
        </div>
      )}

      <Tabs
        tabs={[
          { id: "items", label: "Stock items" },
          { id: "history", label: "Transaction history" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "items" ? (
        <Card padded={false}>
          <Toolbar>
            <SearchInput value={search} onChange={setSearch} placeholder="Search item or supplier" />
            <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-48">
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-brand-600" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />
              Low stock only
            </label>
          </Toolbar>
          <DataTable
            columns={columns}
            rows={data ? rows : undefined}
            rowKey={(i) => i.id}
            loading={loading}
            error={error}
            emptyTitle="No inventory items"
            emptyDescription={canManage ? "Add your first stock item to begin tracking." : undefined}
          />
        </Card>
      ) : (
        <HistoryTab items={all} />
      )}

      {itemModal && <ItemModal key={itemModal.item?.id ?? "new"} item={itemModal.item} categories={categories} onClose={() => setItemModal(null)} onSaved={reload} />}
      {adjust && <AdjustModal key={`${adjust.item.id}-${adjust.type}`} item={adjust.item} type={adjust.type} onClose={() => setAdjust(null)} onSaved={reload} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete inventory item"
        message={`Delete "${deleting?.name}" and its stock history? Items used in a menu recipe cannot be deleted.`}
        confirmLabel="Delete"
        loading={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
