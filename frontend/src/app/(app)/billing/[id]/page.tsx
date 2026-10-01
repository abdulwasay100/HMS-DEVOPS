"use client";

import Link from "next/link";
import { use, useState } from "react";
import { PaymentModal } from "@/components/forms/PaymentModal";
import { StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { PageHeader, Spinner } from "@/components/ui/Layout";
import { useConfig } from "@/context/ConfigContext";
import { useFetch } from "@/hooks/useApi";
import { formatDate, formatDateTime, refNumber } from "@/lib/format";
import type { BillDetail } from "@/lib/types";

export default function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { money } = useConfig();
  const { data: bill, loading, error, reload } = useFetch<BillDetail>(`/bills/${id}`);
  const [payOpen, setPayOpen] = useState(false);

  if (loading && !bill) return <Spinner />;
  if (error || !bill) return <Alert>{error ?? "Bill not found"}</Alert>;

  const roomLines = bill.items.filter((i) => i.item_type === "Room");
  const foodLines = bill.items.filter((i) => i.item_type === "Food");
  const paid = bill.payment_status === "Paid";

  return (
    <>
      <PageHeader
        title={`Invoice ${refNumber("bill", bill.id)}`}
        actions={
          <>
            <Link href="/billing" className="text-sm font-medium text-slate-600 hover:underline">
              &larr; All bills
            </Link>
            {!paid && (
              <Button variant="success" onClick={() => setPayOpen(true)}>
                Record payment
              </Button>
            )}
            <Button onClick={() => window.print()}>
              <Icon name="printer" className="h-4 w-4" /> Print receipt
            </Button>
          </>
        }
      />

      <article className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">{bill.hotel.name}</h2>
            {bill.hotel.address && <p className="mt-1 text-sm text-slate-600">{bill.hotel.address}</p>}
            {(bill.hotel.phone || bill.hotel.email) && (
              <p className="text-sm text-slate-600">{[bill.hotel.phone, bill.hotel.email].filter(Boolean).join("  |  ")}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold uppercase tracking-wide text-slate-800">Invoice</p>
            <p className="mt-1 text-sm font-medium text-slate-900">{refNumber("bill", bill.id)}</p>
            <p className="text-sm text-slate-600">Issued {formatDateTime(bill.created_at)}</p>
            <div className="mt-2 print:hidden">
              <StatusBadge status={bill.payment_status} />
            </div>
          </div>
        </header>

        <section className="grid gap-6 border-b border-slate-200 py-6 text-sm sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Billed to</p>
            <p className="mt-1 font-medium text-slate-900">{bill.customer?.name ?? "Walk-in customer"}</p>
            {bill.customer?.phone && <p className="text-slate-600">{bill.customer.phone}</p>}
            {bill.customer?.email && <p className="text-slate-600">{bill.customer.email}</p>}
            {bill.customer?.address && <p className="text-slate-600">{bill.customer.address}</p>}
          </div>
          <div>
            {bill.booking && (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stay</p>
                <p className="mt-1 font-medium text-slate-900">
                  Room {bill.booking.room_number} ({bill.booking.room_type})
                </p>
                <p className="text-slate-600">
                  {formatDate(bill.booking.check_in)} - {formatDate(bill.booking.check_out)} &middot; {bill.booking.guests} guest(s)
                </p>
                <p className="text-slate-600">Booking {refNumber("booking", bill.booking.id)}</p>
              </>
            )}
            {bill.orders.length > 0 && (
              <p className="mt-2 text-slate-600">Orders: {bill.orders.map((o) => refNumber("order", o.id)).join(", ")}</p>
            )}
          </div>
        </section>

        <section className="py-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-2 font-semibold">Description</th>
                <th className="py-2 text-right font-semibold">Qty</th>
                <th className="py-2 text-right font-semibold">Unit price</th>
                <th className="py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {roomLines.length > 0 && (
                <tr>
                  <td colSpan={4} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Accommodation
                  </td>
                </tr>
              )}
              {roomLines.map((i) => (
                <tr key={i.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4">
                    {i.description} <span className="text-slate-500">({i.quantity} night{i.quantity === 1 ? "" : "s"})</span>
                  </td>
                  <td className="py-2 text-right">{i.quantity}</td>
                  <td className="py-2 text-right">{money(i.unit_price)}</td>
                  <td className="py-2 text-right">{money(i.line_total)}</td>
                </tr>
              ))}
              {foodLines.length > 0 && (
                <tr>
                  <td colSpan={4} className="pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Food &amp; beverage
                  </td>
                </tr>
              )}
              {foodLines.map((i) => (
                <tr key={i.id} className="border-b border-slate-100">
                  <td className="py-2 pr-4">{i.description}</td>
                  <td className="py-2 text-right">{i.quantity}</td>
                  <td className="py-2 text-right">{money(i.unit_price)}</td>
                  <td className="py-2 text-right">{money(i.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="ml-auto mt-6 w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-slate-600">Subtotal</dt><dd>{money(bill.subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Discount</dt><dd>- {money(bill.discount)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-600">Tax ({bill.tax_rate}%)</dt><dd>{money(bill.tax)}</dd></div>
            <div className="flex justify-between border-t border-slate-300 pt-2 text-lg font-bold text-slate-900"><dt>Grand total</dt><dd>{money(bill.grand_total)}</dd></div>
            <div className="flex justify-between pt-2"><dt className="text-slate-600">Amount paid</dt><dd>{money(bill.amount_paid)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Balance due</dt><dd>{money(bill.balance_due)}</dd></div>
          </dl>
        </section>

        <section className="grid gap-4 border-t border-slate-200 pt-6 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment status</p>
            <p className={`mt-1 text-base font-bold ${paid ? "text-emerald-700" : bill.payment_status === "Partial" ? "text-amber-700" : "text-red-700"}`}>
              {bill.payment_status.toUpperCase()}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment method</p>
            <p className="mt-1 font-medium text-slate-900">{bill.payment_method ?? "-"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{paid ? "Paid on" : "Issued by"}</p>
            <p className="mt-1 font-medium text-slate-900">{paid ? formatDateTime(bill.paid_at) : (bill.issued_by ?? "-")}</p>
          </div>
        </section>

        {bill.notes && <p className="mt-6 rounded-lg bg-slate-50 p-3 text-sm text-slate-600 print:bg-transparent print:p-0">Note: {bill.notes}</p>}
        <p className="mt-10 text-center text-xs text-slate-500">Thank you for staying with us. We look forward to welcoming you again.</p>
      </article>

      {payOpen && <PaymentModal billId={bill.id} balance={bill.balance_due} currentMethod={bill.payment_method} onClose={() => setPayOpen(false)} onSaved={reload} />}
    </>
  );
}
