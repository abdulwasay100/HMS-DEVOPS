"use client";

import Link from "next/link";
import { use, useState } from "react";
import { CustomerModal } from "@/components/forms/CustomerModal";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Alert } from "@/components/ui/Form";
import { Card, PageHeader, Spinner } from "@/components/ui/Layout";
import { useConfig } from "@/context/ConfigContext";
import { useFetch } from "@/hooks/useApi";
import { formatDate, formatDateTime, refNumber } from "@/lib/format";
import type { Customer, PaymentStatus } from "@/lib/types";

interface CustomerDetail extends Customer {
  bookings: { id: number; check_in: string; check_out: string; status: string; total_amount: number; room_number: string; room_type: string }[];
  orders: { id: number; status: string; total: number; created_at: string }[];
  bills: { id: number; grand_total: number; amount_paid: number; payment_status: PaymentStatus; created_at: string }[];
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { money } = useConfig();
  const { data, loading, error, reload } = useFetch<CustomerDetail>(`/customers/${id}`);
  const [editOpen, setEditOpen] = useState(false);

  if (loading && !data) return <Spinner />;
  if (error || !data) return <Alert>{error ?? "Customer not found"}</Alert>;

  const bookingCols: Column<CustomerDetail["bookings"][number]>[] = [
    { key: "ref", header: "Booking", cell: (b) => refNumber("booking", b.id) },
    { key: "room", header: "Room", cell: (b) => `${b.room_number} (${b.room_type})` },
    { key: "stay", header: "Stay", cell: (b) => `${formatDate(b.check_in)} - ${formatDate(b.check_out)}` },
    { key: "amount", header: "Amount", align: "right", cell: (b) => money(b.total_amount) },
    { key: "status", header: "Status", cell: (b) => <StatusBadge status={b.status} /> },
  ];
  const orderCols: Column<CustomerDetail["orders"][number]>[] = [
    { key: "ref", header: "Order", cell: (o) => refNumber("order", o.id) },
    { key: "date", header: "Date", cell: (o) => formatDateTime(o.created_at) },
    { key: "total", header: "Total", align: "right", cell: (o) => money(o.total) },
    { key: "status", header: "Status", cell: (o) => <StatusBadge status={o.status} /> },
  ];
  const billCols: Column<CustomerDetail["bills"][number]>[] = [
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
    { key: "total", header: "Total", align: "right", cell: (b) => money(b.grand_total) },
    { key: "paid", header: "Paid", align: "right", cell: (b) => money(b.amount_paid) },
    { key: "status", header: "Status", cell: (b) => <StatusBadge status={b.payment_status} /> },
  ];

  return (
    <>
      <PageHeader
        title={data.name}
        description="Customer profile and history"
        actions={
          <>
            <Link href="/customers" className="text-sm font-medium text-slate-600 hover:underline">
              &larr; All customers
            </Link>
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              Edit
            </Button>
          </>
        }
      />

      <Card className="mb-4">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-slate-500">Phone</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{data.phone}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{data.email ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">ID / passport</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{data.id_number ?? "-"}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Address</dt>
            <dd className="mt-0.5 font-medium text-slate-900">{data.address ?? "-"}</dd>
          </div>
        </dl>
      </Card>

      <div className="space-y-4">
        <Card title={`Bookings (${data.bookings.length})`} padded={false}>
          <DataTable columns={bookingCols} rows={data.bookings} rowKey={(b) => b.id} emptyTitle="No bookings yet" />
        </Card>
        <Card title={`Food orders (${data.orders.length})`} padded={false}>
          <DataTable columns={orderCols} rows={data.orders} rowKey={(o) => o.id} emptyTitle="No orders yet" />
        </Card>
        <Card title={`Bills (${data.bills.length})`} padded={false}>
          <DataTable columns={billCols} rows={data.bills} rowKey={(b) => b.id} emptyTitle="No bills yet" />
        </Card>
      </div>

      {editOpen && <CustomerModal open customer={data} onClose={() => setEditOpen(false)} onSaved={() => reload()} />}
    </>
  );
}
