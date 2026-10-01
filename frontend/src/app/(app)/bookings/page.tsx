"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { z } from "zod";
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
import { addDaysInput, formatDate, nightsBetween, refNumber, round2, todayInput } from "@/lib/format";
import type { Booking, BookingStatus, CustomerOption, Room } from "@/lib/types";
import { num, validate, type FormErrors } from "@/lib/validation";

const STATUSES: BookingStatus[] = ["Reserved", "Checked-In", "Checked-Out", "Cancelled"];

const schema = z
  .object({
    customer_id: z.string().min(1, "Select a customer"),
    room_id: z.string().min(1, "Select a room"),
    check_in: z.string().min(1, "Select a check-in date"),
    check_out: z.string().min(1, "Select a check-out date"),
    guests: num("Enter the number of guests").pipe(z.number().int().min(1, "At least 1 guest").max(20)),
    notes: z.string().trim().max(500),
  })
  .refine((v) => v.check_out > v.check_in, { path: ["check_out"], message: "Check-out must be after check-in" });

function BookingModal({ booking, onClose, onSaved }: { booking: Booking | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { money } = useConfig();
  const today = todayInput();
  const [values, setValues] = useState({
    customer_id: booking ? String(booking.customer_id) : "",
    room_id: booking ? String(booking.room_id) : "",
    check_in: booking?.check_in ?? today,
    check_out: booking?.check_out ?? addDaysInput(today, 1),
    guests: booking ? String(booking.guests) : "1",
    notes: booking?.notes ?? "",
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [customerModal, setCustomerModal] = useState(false);

  const customers = useFetch<CustomerOption[]>("/customers/options");
  const datesValid = !!values.check_in && !!values.check_out && values.check_out > values.check_in;
  const rooms = useFetch<Room[]>(
    "/rooms/available",
    { check_in: values.check_in, check_out: values.check_out, exclude_booking_id: booking?.id },
    datesValid,
  );

  const availableRooms = useMemo(() => (datesValid ? (rooms.data ?? []) : []), [datesValid, rooms.data]);
  const selectedRoom = availableRooms.find((r) => String(r.id) === values.room_id);
  // A previously chosen room that is no longer available for the new dates counts as unselected.
  const roomId = selectedRoom ? values.room_id : "";
  const nights = datesValid ? nightsBetween(values.check_in, values.check_out) : 0;

  const set = (k: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validate(schema, { ...values, room_id: roomId });
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      const payload = {
        customer_id: Number(result.data.customer_id),
        room_id: Number(result.data.room_id),
        check_in: result.data.check_in,
        check_out: result.data.check_out,
        guests: result.data.guests,
        notes: result.data.notes,
      };
      if (booking) await api.put(`/bookings/${booking.id}`, payload);
      else await api.post("/bookings", payload);
      toast.success(booking ? "Booking updated" : "Booking created");
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
        size="lg"
        title={booking ? `Edit booking ${refNumber("booking", booking.id)}` : "New booking"}
        onClose={onClose}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" form="booking-form" loading={saving}>
              {booking ? "Save changes" : "Create booking"}
            </Button>
          </>
        }
      >
        <form id="booking-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
          {formError && (
            <div className="sm:col-span-2">
              <Alert>{formError}</Alert>
            </div>
          )}

          <div className="sm:col-span-2">
            <Field label="Customer" error={errors.customer_id} required>
              <div className="flex gap-2">
                <Select value={values.customer_id} onChange={set("customer_id")} invalid={!!errors.customer_id}>
                  <option value="">Select a customer...</option>
                  {(customers.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} - {c.phone}
                    </option>
                  ))}
                </Select>
                <Button variant="secondary" onClick={() => setCustomerModal(true)} className="shrink-0">
                  <Icon name="plus" className="h-4 w-4" /> New
                </Button>
              </div>
            </Field>
          </div>

          <Field label="Check-in" error={errors.check_in} required>
            <Input type="date" min={booking ? undefined : today} value={values.check_in} onChange={set("check_in")} invalid={!!errors.check_in} />
          </Field>
          <Field label="Check-out" error={errors.check_out} required>
            <Input type="date" min={values.check_in || today} value={values.check_out} onChange={set("check_out")} invalid={!!errors.check_out} />
          </Field>

          <Field
            label="Room"
            error={errors.room_id}
            required
            hint={datesValid && !rooms.loading ? `${availableRooms.length} room(s) free for these dates` : undefined}
          >
            <Select value={roomId} onChange={set("room_id")} invalid={!!errors.room_id} disabled={!datesValid}>
              <option value="">{datesValid ? "Select an available room..." : "Choose valid dates first"}</option>
              {availableRooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.room_number} - {r.room_type} ({money(r.price_per_night)}/night, sleeps {r.capacity})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Guests" error={errors.guests} required>
            <Input type="number" min="1" max={selectedRoom?.capacity ?? 20} value={values.guests} onChange={set("guests")} invalid={!!errors.guests} />
          </Field>

          <Field label="Notes" error={errors.notes} className="sm:col-span-2">
            <Textarea rows={2} value={values.notes} onChange={set("notes")} placeholder="Special requests, arrival time..." />
          </Field>

          {selectedRoom && nights > 0 && (
            <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand-900 sm:col-span-2">
              {nights} night{nights === 1 ? "" : "s"} &times; {money(selectedRoom.price_per_night)} ={" "}
              <strong>{money(round2(nights * selectedRoom.price_per_night))}</strong> room charges (before tax)
            </div>
          )}
        </form>
      </Modal>
      {customerModal && (
        <CustomerModal
          open
          onClose={() => setCustomerModal(false)}
          onSaved={(c) => {
            customers.reload();
            setValues((v) => ({ ...v, customer_id: String(c.id) }));
          }}
        />
      )}
    </>
  );
}

export default function BookingsPage() {
  const toast = useToast();
  const { money } = useConfig();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const debounced = useDebounce(search);
  const { data, meta, loading, error, reload } = useFetch<Booking[]>("/bookings", { search: debounced, status, page });

  const [modal, setModal] = useState<{ booking: Booking | null } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function changeStatus(b: Booking, next: "Checked-In" | "Checked-Out" | "Cancelled") {
    setBusyId(b.id);
    try {
      await api.patch(`/bookings/${b.id}/status`, { status: next });
      toast.success(`${refNumber("booking", b.id)} ${next === "Cancelled" ? "cancelled" : next.toLowerCase()}`);
      setCancelTarget(null);
      reload();
    } catch (err) {
      toast.error("Action failed", errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  const columns: Column<Booking>[] = [
    { key: "ref", header: "Booking", cell: (b) => <span className="font-medium text-slate-900">{refNumber("booking", b.id)}</span> },
    {
      key: "customer",
      header: "Customer",
      cell: (b) => (
        <Link href={`/customers/${b.customer_id}`} className="font-medium text-brand-700 hover:underline">
          {b.customer_name}
        </Link>
      ),
    },
    { key: "room", header: "Room", cell: (b) => `${b.room_number} - ${b.room_type}` },
    { key: "in", header: "Check-in", cell: (b) => formatDate(b.check_in) },
    { key: "out", header: "Check-out", cell: (b) => formatDate(b.check_out) },
    { key: "nights", header: "Nights", align: "center", cell: (b) => nightsBetween(b.check_in, b.check_out) },
    { key: "total", header: "Room charges", align: "right", cell: (b) => money(b.total_amount) },
    { key: "status", header: "Status", cell: (b) => <StatusBadge status={b.status} /> },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (b) => (
        <div className="flex flex-wrap justify-end gap-1.5">
          {b.status === "Reserved" && (
            <>
              <Button size="sm" variant="success" loading={busyId === b.id} onClick={() => changeStatus(b, "Checked-In")}>
                Check in
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setModal({ booking: b })}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCancelTarget(b)}>
                <span className="text-red-600">Cancel</span>
              </Button>
            </>
          )}
          {b.status === "Checked-In" && (
            <Button size="sm" variant="primary" loading={busyId === b.id} onClick={() => changeStatus(b, "Checked-Out")}>
              Check out
            </Button>
          )}
          {b.status !== "Cancelled" &&
            (b.bill_id ? (
              <Link href={`/billing/${b.bill_id}`} className="inline-flex items-center rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">
                View bill
              </Link>
            ) : (
              <Link
                href={`/billing?new=1&customer_id=${b.customer_id}&booking_id=${b.id}`}
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
        title="Bookings"
        description="Reservations, check-in and check-out. Double-booking is prevented automatically."
        actions={
          <Button onClick={() => setModal({ booking: null })}>
            <Icon name="plus" className="h-4 w-4" /> New booking
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
            placeholder="Search guest, phone or room"
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
        <DataTable columns={columns} rows={data} rowKey={(b) => b.id} loading={loading} error={error} emptyTitle="No bookings found" />
        <Pagination meta={meta} onPageChange={setPage} />
      </Card>

      {modal && <BookingModal key={modal.booking?.id ?? "new"} booking={modal.booking} onClose={() => setModal(null)} onSaved={reload} />}
      <ConfirmDialog
        open={!!cancelTarget}
        title="Cancel booking"
        message={`Cancel booking ${cancelTarget ? refNumber("booking", cancelTarget.id) : ""} for ${cancelTarget?.customer_name}? The room will become available for these dates.`}
        confirmLabel="Cancel booking"
        loading={busyId !== null}
        onConfirm={() => cancelTarget && changeStatus(cancelTarget, "Cancelled")}
        onCancel={() => setCancelTarget(null)}
      />
    </>
  );
}
