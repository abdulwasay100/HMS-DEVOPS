"use client";

import { useMemo, useState } from "react";
import { z } from "zod";
import { StatusBadge } from "@/components/ui/Badge";
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
import { isManagerUp } from "@/lib/permissions";
import type { Room, RoomStatus } from "@/lib/types";
import { num, validate, type FormErrors } from "@/lib/validation";

const STATUSES: RoomStatus[] = ["Available", "Occupied", "Cleaning", "Maintenance"];
const TYPE_SUGGESTIONS = ["Single", "Double", "Twin", "Deluxe", "Suite", "Family"];

const schema = z.object({
  room_number: z.string().trim().min(1, "Room number is required").max(20),
  room_type: z.string().trim().min(1, "Room type is required").max(50),
  price_per_night: num("Enter a price").pipe(z.number().min(0, "Price cannot be negative")),
  capacity: num("Enter a capacity").pipe(z.number().int("Whole number").min(1, "At least 1").max(20, "At most 20")),
  status: z.enum(["Available", "Occupied", "Cleaning", "Maintenance"]),
  notes: z.string().trim().max(255).optional(),
});

interface FormValues {
  room_number: string;
  room_type: string;
  price_per_night: string;
  capacity: string;
  status: RoomStatus;
  notes: string;
}

const EMPTY: FormValues = { room_number: "", room_type: "", price_per_night: "", capacity: "2", status: "Available", notes: "" };

function RoomModal({ room, open, onClose, onSaved }: { room: Room | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState<FormValues>(
    room
      ? {
          room_number: room.room_number,
          room_type: room.room_type,
          price_per_night: String(room.price_per_night),
          capacity: String(room.capacity),
          status: room.status,
          notes: room.notes ?? "",
        }
      : EMPTY,
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validate(schema, values);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      if (room) await api.put(`/rooms/${room.id}`, result.data);
      else await api.post("/rooms", result.data);
      toast.success(room ? "Room updated" : "Room added");
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
      open={open}
      title={room ? `Edit room ${room.room_number}` : "Add room"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="room-form" loading={saving}>
            {room ? "Save changes" : "Add room"}
          </Button>
        </>
      }
    >
      <form id="room-form" onSubmit={submit} noValidate className="grid gap-4 sm:grid-cols-2">
        {formError && (
          <div className="sm:col-span-2">
            <Alert>{formError}</Alert>
          </div>
        )}
        <Field label="Room number" error={errors.room_number} required>
          <Input value={values.room_number} onChange={set("room_number")} invalid={!!errors.room_number} placeholder="e.g. 101" />
        </Field>
        <Field label="Room type" error={errors.room_type} required>
          <Input value={values.room_type} onChange={set("room_type")} invalid={!!errors.room_type} list="room-types" placeholder="e.g. Deluxe" />
          <datalist id="room-types">
            {TYPE_SUGGESTIONS.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </Field>
        <Field label="Price per night" error={errors.price_per_night} required>
          <Input type="number" min="0" step="0.01" value={values.price_per_night} onChange={set("price_per_night")} invalid={!!errors.price_per_night} />
        </Field>
        <Field label="Capacity (guests)" error={errors.capacity} required>
          <Input type="number" min="1" max="20" value={values.capacity} onChange={set("capacity")} invalid={!!errors.capacity} />
        </Field>
        <Field label="Status" error={errors.status} className="sm:col-span-2">
          <Select value={values.status} onChange={set("status")}>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Notes" error={errors.notes} className="sm:col-span-2">
          <Textarea value={values.notes} onChange={set("notes")} placeholder="Optional (view, bed type, amenities...)" />
        </Field>
      </form>
    </Modal>
  );
}

export default function RoomsPage() {
  const { user } = useAuth();
  const { money } = useConfig();
  const toast = useToast();
  const canManage = isManagerUp(user?.role);
  const { data, loading, error, reload } = useFetch<Room[]>("/rooms");

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [editing, setEditing] = useState<Room | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleting, setDeleting] = useState<Room | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const types = useMemo(() => Array.from(new Set((data ?? []).map((r) => r.room_type))).sort(), [data]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { Available: 0, Occupied: 0, Cleaning: 0, Maintenance: 0 };
    (data ?? []).forEach((r) => (c[r.status] += 1));
    return c;
  }, [data]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data ?? []).filter(
      (r) =>
        (!status || r.status === status) &&
        (!type || r.room_type === type) &&
        (!term || r.room_number.toLowerCase().includes(term) || r.room_type.toLowerCase().includes(term) || (r.current_guest ?? "").toLowerCase().includes(term)),
    );
  }, [data, search, status, type]);

  async function changeStatus(room: Room, next: RoomStatus) {
    try {
      await api.patch(`/rooms/${room.id}/status`, { status: next });
      toast.success(`Room ${room.room_number} is now ${next}`);
      reload();
    } catch (err) {
      toast.error("Could not update status", errorMessage(err));
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api.delete(`/rooms/${deleting.id}`);
      toast.success(`Room ${deleting.room_number} deleted`);
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error("Could not delete room", errorMessage(err));
    } finally {
      setDeleteBusy(false);
    }
  }

  const columns: Column<Room>[] = [
    { key: "number", header: "Room", cell: (r) => <span className="font-semibold text-slate-900">{r.room_number}</span> },
    { key: "type", header: "Type", cell: (r) => r.room_type },
    { key: "capacity", header: "Sleeps", cell: (r) => r.capacity },
    { key: "price", header: "Price / night", align: "right", cell: (r) => money(r.price_per_night) },
    { key: "status", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
    { key: "guest", header: "Current guest", cell: (r) => r.current_guest ?? <span className="text-slate-400">-</span> },
    {
      key: "set",
      header: "Set status",
      cell: (r) => (
        <Select
          aria-label={`Change status of room ${r.room_number}`}
          value={r.status}
          onChange={(e) => changeStatus(r, e.target.value as RoomStatus)}
          className="!py-1 !text-xs"
        >
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
      ),
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "",
            align: "right" as const,
            cell: (r: Room) => (
              <div className="flex justify-end gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit room ${r.room_number}`}
                  onClick={() => {
                    setEditing(r);
                    setModalOpen(true);
                  }}
                >
                  <Icon name="pencil" className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Delete room ${r.room_number}`} onClick={() => setDeleting(r)}>
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
        title="Rooms"
        description="Manage room inventory, pricing and live status."
        actions={
          canManage && (
            <Button
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              <Icon name="plus" className="h-4 w-4" /> Add room
            </Button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(status === s ? "" : s)}
            className={`rounded-xl border bg-white p-4 text-left shadow-sm transition hover:border-brand-300 ${status === s ? "border-brand-500 ring-2 ring-brand-500/20" : "border-slate-200"}`}
          >
            <p className="text-sm text-slate-500">{s}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{counts[s]}</p>
          </button>
        ))}
      </div>

      <Card padded={false}>
        <Toolbar>
          <SearchInput value={search} onChange={setSearch} placeholder="Search room, type or guest" />
          <Select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-44">
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
          <Select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)} className="sm:w-44">
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Toolbar>
        <DataTable
          columns={columns}
          rows={data ? rows : undefined}
          rowKey={(r) => r.id}
          loading={loading}
          error={error}
          emptyTitle="No rooms found"
          emptyDescription={canManage ? "Add your first room or adjust the filters." : "Try adjusting the filters."}
        />
      </Card>

      {modalOpen && (
        <RoomModal key={editing?.id ?? "new"} room={editing} open={modalOpen} onClose={() => setModalOpen(false)} onSaved={reload} />
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete room"
        message={`Delete room ${deleting?.room_number}? Rooms with booking history cannot be deleted.`}
        confirmLabel="Delete"
        loading={deleteBusy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
