"use client";

import Link from "next/link";
import { StatusBadge } from "@/components/ui/Badge";
import { Card, PageHeader, Spinner, StatCard } from "@/components/ui/Layout";
import { Alert } from "@/components/ui/Form";
import { useConfig } from "@/context/ConfigContext";
import { useFetch } from "@/hooks/useApi";
import { formatDate, formatDateTime, formatQty, refNumber } from "@/lib/format";

interface Dashboard {
  date: string;
  sales: { bills_count: number; total: number; collected: number };
  orders: { total: number; pending: number; preparing: number; completed: number };
  rooms: { total: number; Available: number; Occupied: number; Cleaning: number; Maintenance: number };
  arrivals_today: number;
  departures_today: number;
  unpaid_bills: { n: number; amount: number };
  low_stock_count: number;
  low_stock: { id: number; name: string; category: string; quantity: number; unit: string; min_stock: number }[];
  recent_orders: { id: number; status: string; total: number; location: string | null; customer_name: string | null; created_at: string }[];
  recent_bookings: { id: number; status: string; check_in: string; check_out: string; customer_name: string; room_number: string }[];
}

const ROOM_COLORS: Record<string, string> = {
  Occupied: "bg-sky-500",
  Available: "bg-emerald-500",
  Cleaning: "bg-amber-400",
  Maintenance: "bg-red-500",
};

export default function DashboardPage() {
  const { money } = useConfig();
  const { data, loading, error } = useFetch<Dashboard>("/dashboard");

  if (loading && !data) return <Spinner />;
  if (error || !data) return <Alert>{error ?? "Could not load the dashboard"}</Alert>;

  const roomTotal = data.rooms.total || 1;

  return (
    <>
      <PageHeader title="Dashboard" description={`Overview for ${formatDate(data.date)}`} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Today's sales"
          value={money(data.sales.total)}
          sub={`${data.sales.bills_count} bill${data.sales.bills_count === 1 ? "" : "s"} - ${money(data.sales.collected)} collected`}
          icon="billing"
          accent="green"
        />
        <StatCard
          label="Today's orders"
          value={data.orders.total}
          sub={`${data.orders.pending} pending - ${data.orders.preparing} preparing - ${data.orders.completed} completed`}
          icon="orders"
          accent="brand"
        />
        <StatCard
          label="Rooms occupied"
          value={`${data.rooms.Occupied} / ${data.rooms.total}`}
          sub={`${data.rooms.Available} available - ${data.rooms.Cleaning} cleaning - ${data.rooms.Maintenance} maintenance`}
          icon="rooms"
          accent="sky"
        />
        <StatCard
          label="Low-stock items"
          value={data.low_stock_count}
          sub={data.low_stock_count ? "Needs restocking" : "All stock levels healthy"}
          icon="inventory"
          accent={data.low_stock_count ? "red" : "amber"}
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-sm text-slate-500">Arrivals today</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{data.arrivals_today}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Departures today</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">{data.departures_today}</p>
        </Card>
        <Card>
          <p className="text-sm text-slate-500">Outstanding bills</p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {money(data.unpaid_bills.amount)} <span className="text-sm font-normal text-slate-500">({data.unpaid_bills.n})</span>
          </p>
        </Card>
      </div>

      <Card title="Room status" className="mt-4">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
          {(["Occupied", "Available", "Cleaning", "Maintenance"] as const).map((s) => (
            <div
              key={s}
              className={ROOM_COLORS[s]}
              style={{ width: `${(data.rooms[s] / roomTotal) * 100}%` }}
              title={`${s}: ${data.rooms[s]}`}
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600">
          {(["Occupied", "Available", "Cleaning", "Maintenance"] as const).map((s) => (
            <span key={s} className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-full ${ROOM_COLORS[s]}`} />
              {s} <strong className="text-slate-900">{data.rooms[s]}</strong>
            </span>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="Recent orders" padded={false} actions={<Link href="/orders" className="text-sm font-medium text-brand-600 hover:underline">View all</Link>}>
          {data.recent_orders.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No orders yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recent_orders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {refNumber("order", o.id)} <span className="font-normal text-slate-500">- {o.customer_name ?? "Walk-in"}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDateTime(o.created_at)}
                      {o.location ? ` - ${o.location}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-slate-900">{money(o.total)}</span>
                    <StatusBadge status={o.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Recent bookings" padded={false} actions={<Link href="/bookings" className="text-sm font-medium text-brand-600 hover:underline">View all</Link>}>
          {data.recent_bookings.length === 0 ? (
            <p className="p-5 text-sm text-slate-500">No bookings yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recent_bookings.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900">
                      {b.customer_name} <span className="font-normal text-slate-500">- Room {b.room_number}</span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatDate(b.check_in)} to {formatDate(b.check_out)}
                    </p>
                  </div>
                  <StatusBadge status={b.status} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Low-stock inventory"
        className="mt-4"
        padded={false}
        actions={<Link href="/inventory" className="text-sm font-medium text-brand-600 hover:underline">Manage inventory</Link>}
      >
        {data.low_stock.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">Nothing is running low.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.low_stock.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-900">{i.name}</p>
                  <p className="text-xs text-slate-500">{i.category}</p>
                </div>
                <p className="text-right">
                  <span className="font-semibold text-red-600">
                    {formatQty(i.quantity)} {i.unit}
                  </span>
                  <span className="block text-xs text-slate-500">
                    min {formatQty(i.min_stock)} {i.unit}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
