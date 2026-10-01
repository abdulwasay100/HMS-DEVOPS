"use client";

import { useMemo, useState } from "react";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Alert, Field, Input, Select } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Card, PageHeader, Spinner, StatCard, Tabs } from "@/components/ui/Layout";
import { useAuth } from "@/context/AuthContext";
import { useConfig } from "@/context/ConfigContext";
import { useFetch } from "@/hooks/useApi";
import { addDaysInput, formatDate, formatQty, todayInput } from "@/lib/format";
import { isManagerUp } from "@/lib/permissions";

type TabId = "sales" | "top" | "usage" | "low" | "occupancy" | "summary";

const TABS: { id: TabId; label: string }[] = [
  { id: "sales", label: "Sales" },
  { id: "top", label: "Most ordered food" },
  { id: "usage", label: "Inventory usage" },
  { id: "low", label: "Low stock" },
  { id: "occupancy", label: "Room occupancy" },
  { id: "summary", label: "Revenue summary" },
];

interface SalesRow {
  period_start: string;
  bills_count: number;
  room_revenue: number;
  food_revenue: number;
  discount: number;
  tax: number;
  total: number;
  collected: number;
}
interface TopItem {
  item_name: string;
  quantity: number;
  revenue: number;
}
interface UsageRow {
  id: number;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  min_stock: number;
  used_in_orders: number;
  stock_out: number;
  stock_in: number;
}
interface LowStockRow {
  id: number;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  min_stock: number;
  supplier: string | null;
}
interface Occupancy {
  total_rooms: number;
  average_rate: number;
  days: { date: string; occupied: number; rate: number }[];
}
interface Summary {
  totals: {
    bills_count: number;
    room_revenue: number;
    food_revenue: number;
    discount: number;
    tax: number;
    total_billed: number;
    collected: number;
    outstanding: number;
  };
  by_method: { payment_method: string | null; bills_count: number; collected: number }[];
  by_status: { payment_status: string; bills_count: number; total: number }[];
}

function periodLabel(start: string, period: string) {
  if (period === "monthly") {
    return new Date(`${start}T00:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }
  return period === "weekly" ? `Week of ${formatDate(start)}` : formatDate(start);
}

function Bar({ value, max, className = "bg-brand-500" }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-slate-100" aria-hidden>
      <div className={`h-2 rounded-full ${className}`} style={{ width: `${value > 0 ? pct : 0}%` }} />
    </div>
  );
}

function ReportBody({ tab, from, to, period }: { tab: TabId; from: string; to: string; period: string }) {
  const { money } = useConfig();
  const range = { from, to };

  const sales = useFetch<SalesRow[]>("/reports/sales", { ...range, period }, tab === "sales");
  const top = useFetch<TopItem[]>("/reports/top-items", { ...range, limit: 15 }, tab === "top");
  const usage = useFetch<UsageRow[]>("/reports/inventory-usage", range, tab === "usage");
  const low = useFetch<LowStockRow[]>("/reports/low-stock", undefined, tab === "low");
  const occupancy = useFetch<Occupancy>("/reports/occupancy", range, tab === "occupancy");
  const summary = useFetch<Summary>("/reports/revenue-summary", range, tab === "summary");

  const salesTotals = useMemo(() => {
    const rows = sales.data ?? [];
    return {
      bills: rows.reduce((s, r) => s + r.bills_count, 0),
      total: rows.reduce((s, r) => s + r.total, 0),
      collected: rows.reduce((s, r) => s + r.collected, 0),
      max: Math.max(0, ...rows.map((r) => r.total)),
    };
  }, [sales.data]);

  if (tab === "sales") {
    const cols: Column<SalesRow>[] = [
      { key: "p", header: "Period", cell: (r) => <span className="font-medium text-slate-900">{periodLabel(r.period_start, period)}</span> },
      { key: "n", header: "Bills", align: "right", cell: (r) => r.bills_count },
      { key: "room", header: "Room", align: "right", cell: (r) => money(r.room_revenue) },
      { key: "food", header: "Food", align: "right", cell: (r) => money(r.food_revenue) },
      { key: "disc", header: "Discount", align: "right", cell: (r) => money(r.discount) },
      { key: "tax", header: "Tax", align: "right", cell: (r) => money(r.tax) },
      { key: "total", header: "Total", align: "right", cell: (r) => <span className="font-semibold">{money(r.total)}</span> },
      { key: "col", header: "Collected", align: "right", cell: (r) => money(r.collected) },
      { key: "bar", header: "", className: "w-40", cell: (r) => <Bar value={r.total} max={salesTotals.max} /> },
    ];
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Total billed" value={money(salesTotals.total)} icon="billing" />
          <StatCard label="Collected" value={money(salesTotals.collected)} icon="check" accent="green" />
          <StatCard label="Bills issued" value={salesTotals.bills} icon="reports" accent="sky" />
        </div>
        <Card padded={false}>
          <DataTable columns={cols} rows={sales.data} rowKey={(r) => r.period_start} loading={sales.loading} error={sales.error} emptyTitle="No sales in this range" />
        </Card>
      </div>
    );
  }

  if (tab === "top") {
    const max = Math.max(0, ...(top.data ?? []).map((r) => r.quantity));
    const cols: Column<TopItem>[] = [
      { key: "rank", header: "#", cell: (r) => (top.data ?? []).indexOf(r) + 1 },
      { key: "name", header: "Item", cell: (r) => <span className="font-medium text-slate-900">{r.item_name}</span> },
      { key: "qty", header: "Quantity sold", align: "right", cell: (r) => formatQty(r.quantity) },
      { key: "rev", header: "Revenue", align: "right", cell: (r) => money(r.revenue) },
      { key: "bar", header: "", className: "w-48", cell: (r) => <Bar value={r.quantity} max={max} className="bg-accent-500" /> },
    ];
    return (
      <Card padded={false}>
        <DataTable columns={cols} rows={top.data} rowKey={(r) => r.item_name} loading={top.loading} error={top.error} emptyTitle="No completed orders in this range" />
      </Card>
    );
  }

  if (tab === "usage") {
    const cols: Column<UsageRow>[] = [
      { key: "name", header: "Item", cell: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
      { key: "cat", header: "Category", cell: (r) => r.category },
      { key: "order", header: "Used by orders", align: "right", cell: (r) => `${formatQty(r.used_in_orders)} ${r.unit}` },
      { key: "out", header: "Other stock out", align: "right", cell: (r) => `${formatQty(r.stock_out)} ${r.unit}` },
      { key: "in", header: "Stock in", align: "right", cell: (r) => `${formatQty(r.stock_in)} ${r.unit}` },
      {
        key: "now",
        header: "On hand",
        align: "right",
        cell: (r) => (
          <span className={r.quantity <= r.min_stock ? "font-semibold text-red-600" : ""}>
            {formatQty(r.quantity)} {r.unit}
          </span>
        ),
      },
    ];
    return (
      <Card padded={false}>
        <DataTable columns={cols} rows={usage.data} rowKey={(r) => r.id} loading={usage.loading} error={usage.error} emptyTitle="No inventory items" />
      </Card>
    );
  }

  if (tab === "low") {
    const cols: Column<LowStockRow>[] = [
      { key: "name", header: "Item", cell: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
      { key: "cat", header: "Category", cell: (r) => r.category },
      { key: "qty", header: "On hand", align: "right", cell: (r) => <span className="font-semibold text-red-600">{formatQty(r.quantity)} {r.unit}</span> },
      { key: "min", header: "Minimum", align: "right", cell: (r) => `${formatQty(r.min_stock)} ${r.unit}` },
      { key: "sup", header: "Supplier", cell: (r) => r.supplier ?? <span className="text-slate-400">-</span> },
    ];
    return (
      <Card padded={false}>
        <DataTable columns={cols} rows={low.data} rowKey={(r) => r.id} loading={low.loading} error={low.error} emptyTitle="All stock levels are healthy" />
      </Card>
    );
  }

  if (tab === "occupancy") {
    const o = occupancy.data;
    if (occupancy.error) return <Alert>{occupancy.error}</Alert>;
    if (!o) return <Spinner />;
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <StatCard label="Average occupancy" value={`${o.average_rate}%`} icon="rooms" sub={`Across ${o.days.length} day(s)`} />
          <StatCard label="Total rooms" value={o.total_rooms} icon="rooms" accent="sky" />
        </div>
        <Card title="Daily occupancy">
          {o.days.length === 0 ? (
            <p className="text-sm text-slate-500">No data in this range.</p>
          ) : (
            <ul className="space-y-2">
              {o.days.map((d) => (
                <li key={d.date} className="grid grid-cols-[7rem_1fr_7rem] items-center gap-3 text-sm">
                  <span className="text-slate-600">{formatDate(d.date)}</span>
                  <Bar value={d.rate} max={100} className="bg-emerald-500" />
                  <span className="text-right text-slate-700">
                    {d.occupied}/{o.total_rooms} ({d.rate}%)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  }

  const s = summary.data;
  if (summary.error) return <Alert>{summary.error}</Alert>;
  if (!s) return <Spinner />;
  const t = s.totals;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total billed" value={money(t.total_billed)} sub={`${t.bills_count} bill(s)`} icon="billing" />
        <StatCard label="Collected" value={money(t.collected)} icon="check" accent="green" />
        <StatCard label="Outstanding" value={money(t.outstanding)} icon="warning" accent={t.outstanding > 0 ? "amber" : "green"} />
        <StatCard label="Discounts given" value={money(t.discount)} icon="reports" accent="sky" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Revenue breakdown">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Room revenue</dt><dd>{money(t.room_revenue)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Food revenue</dt><dd>{money(t.food_revenue)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Discounts</dt><dd>- {money(t.discount)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Tax</dt><dd>{money(t.tax)}</dd></div>
            <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold"><dt>Total billed</dt><dd>{money(t.total_billed)}</dd></div>
          </dl>
        </Card>
        <Card title="Collected by payment method">
          {s.by_method.length === 0 ? (
            <p className="text-sm text-slate-500">No payments recorded.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {s.by_method.map((m) => (
                <li key={m.payment_method ?? "none"} className="flex justify-between">
                  <span className="text-slate-600">{m.payment_method ?? "Not specified"} ({m.bills_count})</span>
                  <span className="font-medium">{money(m.collected)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Bills by payment status">
          {s.by_status.length === 0 ? (
            <p className="text-sm text-slate-500">No bills in this range.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {s.by_status.map((b) => (
                <li key={b.payment_status} className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <StatusBadge status={b.payment_status} /> <span className="text-slate-500">{b.bills_count}</span>
                  </span>
                  <span className="font-medium">{money(b.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<TabId>("sales");
  const [period, setPeriod] = useState("daily");
  const [from, setFrom] = useState(() => addDaysInput(todayInput(), -29));
  const [to, setTo] = useState(() => todayInput());
  const rangeError = from && to && from > to ? "Start date must be on or before the end date" : null;

  if (!isManagerUp(user?.role)) {
    return <Alert>You do not have permission to view reports.</Alert>;
  }

  function preset(days: number) {
    const end = todayInput();
    setTo(end);
    setFrom(addDaysInput(end, -(days - 1)));
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="Sales, food, inventory and occupancy insights."
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            <Icon name="printer" className="h-4 w-4" /> Print
          </Button>
        }
      />

      <Card className="mb-4 print:hidden">
        <div className="flex flex-wrap items-end gap-4">
          <Field label="From" error={rangeError ?? undefined}>
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </Field>
          {tab === "sales" && (
            <Field label="Group by">
              <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </Select>
            </Field>
          )}
          <div className="flex gap-2 pb-0.5">
            <Button size="sm" variant="secondary" onClick={() => preset(7)}>Last 7 days</Button>
            <Button size="sm" variant="secondary" onClick={() => preset(30)}>Last 30 days</Button>
            <Button size="sm" variant="secondary" onClick={() => preset(90)}>Last 90 days</Button>
          </div>
        </div>
      </Card>

      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {rangeError ? <Alert>{rangeError}</Alert> : from && to ? <ReportBody tab={tab} from={from} to={to} period={period} /> : <Alert>Choose a date range.</Alert>}
    </>
  );
}
