"use client";

import { useMemo, useState } from "react";
import { z } from "zod";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, SearchInput, Toolbar, type Column } from "@/components/ui/DataTable";
import { Alert, Field, Input, Select, Textarea } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Card, PageHeader } from "@/components/ui/Layout";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { useAuth } from "@/context/AuthContext";
import { useConfig } from "@/context/ConfigContext";
import { useToast } from "@/context/ToastContext";
import { useFetch } from "@/hooks/useApi";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatQty } from "@/lib/format";
import { isManagerUp } from "@/lib/permissions";
import type { InventoryItem, MenuCategory, MenuItem } from "@/lib/types";
import { num, validate, type FormErrors } from "@/lib/validation";

const schema = z.object({
  category_id: z.string().min(1, "Select a category"),
  name: z.string().trim().min(2, "Enter a name").max(150),
  price: num("Enter a price").pipe(z.number().min(0, "Price cannot be negative")),
  description: z.string().trim().max(500),
  is_available: z.boolean(),
});

interface RecipeRow {
  inventory_item_id: string;
  quantity: string;
}

function ItemModal({
  item,
  categories,
  onClose,
  onSaved,
}: {
  item: MenuItem | null;
  categories: MenuCategory[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const inventory = useFetch<InventoryItem[]>("/inventory");
  const [values, setValues] = useState({
    category_id: item ? String(item.category_id) : "",
    name: item?.name ?? "",
    price: item ? String(item.price) : "",
    description: item?.description ?? "",
    is_available: item ? !!item.is_available : true,
  });
  const [recipe, setRecipe] = useState<RecipeRow[]>(
    item?.ingredients.map((i) => ({ inventory_item_id: String(i.inventory_item_id), quantity: String(i.quantity) })) ?? [],
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const invById = useMemo(() => new Map((inventory.data ?? []).map((i) => [String(i.id), i])), [inventory.data]);

  function updateRow(idx: number, patch: Partial<RecipeRow>) {
    setRecipe((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validate(schema, values);
    const nextErrors: FormErrors = result.ok ? {} : { ...result.errors };

    const seen = new Set<string>();
    const ingredients: { inventory_item_id: number; quantity: number }[] = [];
    for (const row of recipe) {
      const qty = Number(row.quantity);
      if (!row.inventory_item_id || !(qty > 0) || seen.has(row.inventory_item_id)) {
        nextErrors.ingredients = "Each ingredient needs a unique inventory item and a quantity above 0";
        break;
      }
      seen.add(row.inventory_item_id);
      ingredients.push({ inventory_item_id: Number(row.inventory_item_id), quantity: qty });
    }
    if (!result.ok || nextErrors.ingredients) return setErrors(nextErrors);

    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      const payload = { ...result.data, category_id: Number(result.data.category_id), ingredients };
      if (item) await api.put(`/menu/items/${item.id}`, payload);
      else await api.post("/menu/items", payload);
      toast.success(item ? "Menu item updated" : "Menu item added");
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
      title={item ? `Edit ${item.name}` : "Add menu item"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="menu-item-form" loading={saving}>
            {item ? "Save changes" : "Add item"}
          </Button>
        </>
      }
    >
      <form id="menu-item-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <div className="sm:col-span-2">
            <Alert>{formError}</Alert>
          </div>
        )}
        <Field label="Name" error={errors.name} required>
          <Input value={values.name} onChange={(e) => setValues({ ...values, name: e.target.value })} invalid={!!errors.name} autoFocus />
        </Field>
        <Field label="Category" error={errors.category_id} required>
          <Select value={values.category_id} onChange={(e) => setValues({ ...values, category_id: e.target.value })} invalid={!!errors.category_id}>
            <option value="">Select...</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Price" error={errors.price} required>
          <Input type="number" min="0" step="0.01" value={values.price} onChange={(e) => setValues({ ...values, price: e.target.value })} invalid={!!errors.price} />
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
            checked={values.is_available}
            onChange={(e) => setValues({ ...values, is_available: e.target.checked })}
          />
          Available for ordering
        </label>
        <Field label="Description" error={errors.description} className="sm:col-span-2">
          <Textarea rows={2} value={values.description} onChange={(e) => setValues({ ...values, description: e.target.value })} />
        </Field>

        <div className="sm:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Recipe (inventory used per serving)</p>
              <p className="text-xs text-slate-500">Deducted automatically when an order containing this item is completed.</p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setRecipe((r) => [...r, { inventory_item_id: "", quantity: "1" }])}>
              <Icon name="plus" className="h-3.5 w-3.5" /> Ingredient
            </Button>
          </div>
          {recipe.length === 0 && <p className="rounded-lg border border-dashed border-slate-300 p-3 text-center text-sm text-slate-500">No ingredients - this item will not affect stock.</p>}
          <div className="space-y-2">
            {recipe.map((row, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <Select
                  aria-label="Inventory item"
                  value={row.inventory_item_id}
                  onChange={(e) => updateRow(idx, { inventory_item_id: e.target.value })}
                  className="flex-1"
                >
                  <option value="">Select inventory item...</option>
                  {(inventory.data ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="Quantity"
                  type="number"
                  min="0"
                  step="0.001"
                  value={row.quantity}
                  onChange={(e) => updateRow(idx, { quantity: e.target.value })}
                  className="w-28"
                />
                <span className="w-14 text-sm text-slate-500">{invById.get(row.inventory_item_id)?.unit ?? ""}</span>
                <Button size="sm" variant="ghost" aria-label="Remove ingredient" onClick={() => setRecipe((r) => r.filter((_, i) => i !== idx))}>
                  <Icon name="x" className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          {errors.ingredients && <p className="mt-1 text-xs text-red-600">{errors.ingredients}</p>}
        </div>
      </form>
    </Modal>
  );
}

function CategoriesModal({ categories, onClose, onChanged }: { categories: MenuCategory[]; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(success);
      onChanged();
    } catch (err) {
      toast.error("Action failed", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open size="md" title="Menu categories" onClose={onClose} footer={<Button variant="secondary" onClick={onClose}>Done</Button>}>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (newName.trim().length < 2) return toast.error("Category name is too short");
          run(async () => {
            await api.post("/menu/categories", { name: newName.trim() });
            setNewName("");
          }, "Category added");
        }}
      >
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New category name" aria-label="New category name" />
        <Button type="submit" loading={busy}>
          Add
        </Button>
      </form>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {categories.map((c) => (
          <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
            {editingId === c.id ? (
              <>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} aria-label="Category name" />
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    loading={busy}
                    onClick={() =>
                      run(async () => {
                        await api.put(`/menu/categories/${c.id}`, { name: editName.trim() });
                        setEditingId(null);
                      }, "Category renamed")
                    }
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                </div>
              </>
            ) : (
              <>
                <span>
                  <span className="font-medium text-slate-900">{c.name}</span>
                  <span className="ml-2 text-xs text-slate-500">{c.items_count} item(s)</span>
                </span>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Rename ${c.name}`}
                    onClick={() => {
                      setEditingId(c.id);
                      setEditName(c.name);
                    }}
                  >
                    <Icon name="pencil" className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => run(() => api.delete(`/menu/categories/${c.id}`), "Category deleted")}>
                    <Icon name="trash" className="h-4 w-4 text-red-500" />
                  </Button>
                </div>
              </>
            )}
          </li>
        ))}
        {categories.length === 0 && <li className="px-3 py-4 text-center text-sm text-slate-500">No categories yet.</li>}
      </ul>
      <p className="mt-2 text-xs text-slate-500">A category can only be deleted when it has no menu items.</p>
    </Modal>
  );
}

export default function MenuPage() {
  const { user } = useAuth();
  const { money } = useConfig();
  const toast = useToast();
  const canManage = isManagerUp(user?.role);
  const items = useFetch<MenuItem[]>("/menu/items");
  const categories = useFetch<MenuCategory[]>("/menu/categories");

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [modal, setModal] = useState<{ item: MenuItem | null } | null>(null);
  const [catModal, setCatModal] = useState(false);
  const [deleting, setDeleting] = useState<MenuItem | null>(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (items.data ?? []).filter(
      (i) => (!category || String(i.category_id) === category) && (!term || i.name.toLowerCase().includes(term)),
    );
  }, [items.data, search, category]);

  async function toggleAvailability(item: MenuItem) {
    try {
      await api.patch(`/menu/items/${item.id}/availability`, { is_available: !item.is_available });
      items.reload();
    } catch (err) {
      toast.error("Could not update availability", errorMessage(err));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/menu/items/${deleting.id}`);
      toast.success("Menu item deleted");
      setDeleting(null);
      items.reload();
      categories.reload();
    } catch (err) {
      toast.error("Could not delete item", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<MenuItem>[] = [
    {
      key: "name",
      header: "Item",
      cell: (i) => (
        <div>
          <p className="font-medium text-slate-900">{i.name}</p>
          {i.description && <p className="max-w-xs truncate text-xs text-slate-500">{i.description}</p>}
        </div>
      ),
    },
    { key: "cat", header: "Category", cell: (i) => i.category_name },
    { key: "price", header: "Price", align: "right", cell: (i) => money(i.price) },
    {
      key: "recipe",
      header: "Recipe",
      cell: (i) =>
        i.ingredients.length ? (
          <span className="text-xs text-slate-600">{i.ingredients.map((g) => `${g.name} ${formatQty(g.quantity)} ${g.unit}`).join(", ")}</span>
        ) : (
          <span className="text-xs text-slate-400">No stock link</span>
        ),
    },
    {
      key: "avail",
      header: "Availability",
      cell: (i) => (
        <button type="button" onClick={() => toggleAvailability(i)} aria-label={`Toggle availability of ${i.name}`}>
          <Badge tone={i.is_available ? "green" : "slate"}>{i.is_available ? "Available" : "Unavailable"}</Badge>
        </button>
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            cell: (i: MenuItem) => (
              <div className="flex justify-end gap-1">
                <Button size="sm" variant="ghost" aria-label={`Edit ${i.name}`} onClick={() => setModal({ item: i })}>
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
        title="Menu"
        description="Food & beverage items, prices and the inventory each dish consumes."
        actions={
          canManage && (
            <>
              <Button variant="secondary" onClick={() => setCatModal(true)}>
                Categories
              </Button>
              <Button
                onClick={() => {
                  if ((categories.data ?? []).length === 0) {
                    toast.warning("Create a category first");
                    setCatModal(true);
                  } else setModal({ item: null });
                }}
              >
                <Icon name="plus" className="h-4 w-4" /> Add item
              </Button>
            </>
          )
        }
      />
      <Card padded={false}>
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search menu" />
          <Select aria-label="Filter by category" value={category} onChange={(e) => setCategory(e.target.value)} className="sm:w-52">
            <option value="">All categories</option>
            {(categories.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={items.data ? rows : undefined}
          rowKey={(i) => i.id}
          loading={items.loading}
          error={items.error}
          emptyTitle="No menu items"
          emptyDescription={canManage ? "Add categories and items to start taking orders." : undefined}
        />
      </Card>

      {modal && (
        <ItemModal key={modal.item?.id ?? "new"} item={modal.item} categories={categories.data ?? []} onClose={() => setModal(null)} onSaved={items.reload} />
      )}
      {catModal && (
        <CategoriesModal
          categories={categories.data ?? []}
          onClose={() => setCatModal(false)}
          onChanged={() => {
            categories.reload();
            items.reload();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete menu item"
        message={`Delete "${deleting?.name}"? Past orders keep their recorded item names.`}
        confirmLabel="Delete"
        loading={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
