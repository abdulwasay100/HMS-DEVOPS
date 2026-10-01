"use client";

import Link from "next/link";
import { useState } from "react";
import { CustomerModal } from "@/components/forms/CustomerModal";
import { Button } from "@/components/ui/Button";
import { DataTable, Pagination, SearchInput, Toolbar, type Column } from "@/components/ui/DataTable";
import { Icon } from "@/components/ui/Icon";
import { Card, PageHeader } from "@/components/ui/Layout";
import { ConfirmDialog } from "@/components/ui/Modal";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useDebounce, useFetch } from "@/hooks/useApi";
import { api, errorMessage } from "@/lib/api";
import { isManagerUp } from "@/lib/permissions";
import type { Customer } from "@/lib/types";

export default function CustomersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const canDelete = isManagerUp(user?.role);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search);
  const { data, meta, loading, error, reload } = useFetch<Customer[]>("/customers", { search: debounced, page });

  const [editing, setEditing] = useState<Customer | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleting, setDeleting] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/customers/${deleting.id}`);
      toast.success("Customer deleted");
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error("Could not delete customer", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<Customer>[] = [
    {
      key: "name",
      header: "Customer",
      cell: (c) => (
        <Link href={`/customers/${c.id}`} className="font-medium text-brand-700 hover:underline">
          {c.name}
        </Link>
      ),
    },
    { key: "phone", header: "Phone", cell: (c) => c.phone },
    { key: "email", header: "Email", cell: (c) => c.email ?? <span className="text-slate-400">-</span> },
    { key: "address", header: "Address", className: "max-w-xs truncate", cell: (c) => c.address ?? <span className="text-slate-400">-</span> },
    { key: "bookings", header: "Bookings", align: "center", cell: (c) => c.bookings_count ?? 0 },
    { key: "orders", header: "Orders", align: "center", cell: (c) => c.orders_count ?? 0 },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (c) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Edit ${c.name}`}
            onClick={() => {
              setEditing(c);
              setModalOpen(true);
            }}
          >
            <Icon name="pencil" className="h-4 w-4" />
          </Button>
          {canDelete && (
            <Button size="sm" variant="ghost" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}>
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
        title="Customers"
        description="Guest profiles with booking and order history."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Icon name="plus" className="h-4 w-4" /> Add customer
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
            placeholder="Search name, phone or email"
          />
        </Toolbar>
        <DataTable
          columns={columns}
          rows={data}
          rowKey={(c) => c.id}
          loading={loading}
          error={error}
          emptyTitle="No customers found"
          emptyDescription="Customers are created here or while making a booking."
        />
        <Pagination meta={meta} onPageChange={setPage} />
      </Card>

      {modalOpen && (
        <CustomerModal key={editing?.id ?? "new"} open customer={editing} onClose={() => setModalOpen(false)} onSaved={() => reload()} />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete customer"
        message={`Delete ${deleting?.name}? Customers with bookings, orders or bills cannot be deleted.`}
        loading={busy}
        confirmLabel="Delete"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
