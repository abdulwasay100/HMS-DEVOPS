type Tone = "green" | "blue" | "amber" | "red" | "slate" | "violet";

const TONES: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
};

const STATUS_TONE: Record<string, Tone> = {
  // rooms
  Available: "green",
  Occupied: "blue",
  Cleaning: "amber",
  Maintenance: "red",
  // bookings
  Reserved: "violet",
  "Checked-In": "blue",
  "Checked-Out": "slate",
  Cancelled: "red",
  // orders
  Pending: "amber",
  Preparing: "blue",
  Completed: "green",
  // payments
  Unpaid: "red",
  Partial: "amber",
  Paid: "green",
  // roles
  admin: "violet",
  manager: "blue",
  staff: "slate",
  // inventory transactions
  Initial: "slate",
  "Stock In": "green",
  "Stock Out": "amber",
  "Order Usage": "blue",
};

export function Badge({ tone, children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone ?? "slate"]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "slate"}>{status}</Badge>;
}
