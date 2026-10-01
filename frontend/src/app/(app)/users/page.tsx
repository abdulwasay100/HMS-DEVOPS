"use client";

import { useState } from "react";
import { z } from "zod";
import { Badge, StatusBadge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Alert, Field, Input, Select } from "@/components/ui/Form";
import { Icon } from "@/components/ui/Icon";
import { Card, PageHeader } from "@/components/ui/Layout";
import { ConfirmDialog, Modal } from "@/components/ui/Modal";
import { useAuth } from "@/context/AuthContext";
import { useToast } from "@/context/ToastContext";
import { useFetch } from "@/hooks/useApi";
import { ApiError, api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { isAdmin } from "@/lib/permissions";
import type { Role, User } from "@/lib/types";
import { validate, type FormErrors } from "@/lib/validation";

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "staff", label: "Staff", hint: "Front desk and restaurant operations" },
  { value: "manager", label: "Manager", hint: "Staff access plus catalogue management, stock adjustment and reports" },
  { value: "admin", label: "Admin", hint: "Full access including user management" },
];

interface FormValues {
  name: string;
  email: string;
  role: Role;
  password: string;
  is_active: boolean;
}

function UserModal({ user, onClose, onSaved }: { user: User | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [values, setValues] = useState<FormValues>({
    name: user?.name ?? "",
    email: user?.email ?? "",
    role: user?.role ?? "staff",
    password: "",
    is_active: user ? !!user.is_active : true,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const schema = z.object({
    name: z.string().trim().min(2, "Name is required").max(120),
    email: z.string().trim().email("Enter a valid email").max(190),
    role: z.enum(["admin", "manager", "staff"]),
    is_active: z.boolean(),
    password: user
      ? z.string().refine((v) => v === "" || v.length >= 8, "At least 8 characters")
      : z.string().min(8, "At least 8 characters").max(128),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validate(schema, values);
    if (!result.ok) return setErrors(result.errors);
    setErrors({});
    setFormError(null);
    setSaving(true);
    try {
      const { password, ...rest } = result.data;
      if (user) await api.put(`/users/${user.id}`, password ? { ...rest, password } : rest);
      else await api.post("/users", { ...rest, password });
      toast.success(user ? "User updated" : "User created");
      onSaved();
      onClose();
    } catch (err) {
      if (err instanceof ApiError && Object.keys(err.fieldErrors).length) setErrors(err.fieldErrors);
      setFormError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const set = (k: "name" | "email" | "password") => (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  return (
    <Modal
      open
      title={user ? `Edit ${user.name}` : "Add user"}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="user-form" loading={saving}>
            {user ? "Save changes" : "Create user"}
          </Button>
        </>
      }
    >
      <form id="user-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <Field label="Full name" error={errors.name} required>
          <Input value={values.name} onChange={set("name")} invalid={!!errors.name} autoFocus />
        </Field>
        <Field label="Email" error={errors.email} required>
          <Input type="email" autoComplete="off" value={values.email} onChange={set("email")} invalid={!!errors.email} />
        </Field>
        <Field label="Role" error={errors.role} hint={ROLES.find((r) => r.value === values.role)?.hint}>
          <Select value={values.role} onChange={(e) => setValues((v) => ({ ...v, role: e.target.value as Role }))}>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={user ? "New password" : "Password"} error={errors.password} hint={user ? "Leave blank to keep the current password" : "At least 8 characters"} required={!user}>
          <Input type="password" autoComplete="new-password" value={values.password} onChange={set("password")} invalid={!!errors.password} />
        </Field>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
            checked={values.is_active}
            onChange={(e) => setValues((v) => ({ ...v, is_active: e.target.checked }))}
          />
          Account is active (inactive users cannot sign in)
        </label>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<User[]>("/users");
  const [editing, setEditing] = useState<User | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [deleting, setDeleting] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isAdmin(me?.role)) return <Alert>Only administrators can manage users.</Alert>;

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api.delete(`/users/${deleting.id}`);
      toast.success(`${deleting.name} was removed`);
      setDeleting(null);
      reload();
    } catch (err) {
      toast.error("Could not delete user", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<User>[] = [
    {
      key: "name",
      header: "Name",
      cell: (u) => (
        <span className="font-medium text-slate-900">
          {u.name} {u.id === me?.id && <span className="text-xs font-normal text-slate-400">(you)</span>}
        </span>
      ),
    },
    { key: "email", header: "Email", cell: (u) => u.email },
    { key: "role", header: "Role", cell: (u) => <StatusBadge status={u.role} /> },
    { key: "status", header: "Status", cell: (u) => (u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Inactive</Badge>) },
    { key: "login", header: "Last sign-in", cell: (u) => (u.last_login_at ? formatDateTime(u.last_login_at) : <span className="text-slate-400">Never</span>) },
    {
      key: "actions",
      header: "",
      align: "right",
      cell: (u) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Edit ${u.name}`}
            onClick={() => {
              setEditing(u);
              setModalOpen(true);
            }}
          >
            <Icon name="pencil" className="h-4 w-4" />
          </Button>
          {u.id !== me?.id && (
            <Button size="sm" variant="ghost" aria-label={`Delete ${u.name}`} onClick={() => setDeleting(u)}>
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
        title="Staff & Users"
        description="Control who can sign in and what they can do."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Icon name="plus" className="h-4 w-4" /> Add user
          </Button>
        }
      />
      <Card padded={false}>
        <DataTable columns={columns} rows={data} rowKey={(u) => u.id} loading={loading} error={error} emptyTitle="No users" />
      </Card>

      {modalOpen && <UserModal key={editing?.id ?? "new"} user={editing} onClose={() => setModalOpen(false)} onSaved={reload} />}
      <ConfirmDialog
        open={!!deleting}
        title="Delete user"
        message={`Delete ${deleting?.name}? Users with recorded activity cannot be deleted; deactivate them instead.`}
        confirmLabel="Delete"
        loading={busy}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
