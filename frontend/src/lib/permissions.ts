import type { Role } from "./types";

/** Mirrors the backend's route guards. The API is the source of truth; this only shapes the UI. */
export const isManagerUp = (role?: Role) => role === "admin" || role === "manager";
export const isAdmin = (role?: Role) => role === "admin";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  allow: (role?: Role) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: "dashboard", allow: () => true },
  { href: "/rooms", label: "Rooms", icon: "rooms", allow: () => true },
  { href: "/bookings", label: "Bookings", icon: "bookings", allow: () => true },
  { href: "/customers", label: "Customers", icon: "customers", allow: () => true },
  { href: "/orders", label: "Food Orders", icon: "orders", allow: () => true },
  { href: "/menu", label: "Menu", icon: "menu", allow: () => true },
  { href: "/inventory", label: "Inventory", icon: "inventory", allow: () => true },
  { href: "/billing", label: "Billing", icon: "billing", allow: () => true },
  { href: "/reports", label: "Reports", icon: "reports", allow: isManagerUp },
  { href: "/users", label: "Staff & Users", icon: "users", allow: isAdmin },
];
