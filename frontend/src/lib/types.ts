export type Role = "admin" | "manager" | "staff";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  is_active?: number;
  last_login_at?: string | null;
  created_at?: string;
}

export interface AppConfig {
  hotelName: string;
  hotelAddress: string;
  hotelPhone: string;
  hotelEmail: string;
  currency: string;
  taxRatePercent: number;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export type RoomStatus = "Available" | "Occupied" | "Cleaning" | "Maintenance";

export interface Room {
  id: number;
  room_number: string;
  room_type: string;
  price_per_night: number;
  capacity: number;
  status: RoomStatus;
  notes: string | null;
  current_guest?: string | null;
}

export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
  id_number: string | null;
  bookings_count?: number;
  orders_count?: number;
  created_at: string;
}

export interface CustomerOption {
  id: number;
  name: string;
  phone: string;
}

export type BookingStatus = "Reserved" | "Checked-In" | "Checked-Out" | "Cancelled";

export interface Booking {
  id: number;
  customer_id: number;
  room_id: number;
  check_in: string;
  check_out: string;
  guests: number;
  status: BookingStatus;
  price_per_night: number;
  total_amount: number;
  notes: string | null;
  customer_name: string;
  customer_phone: string;
  room_number: string;
  room_type: string;
  bill_id: number | null;
}

export interface MenuCategory {
  id: number;
  name: string;
  items_count?: number;
}

export interface Ingredient {
  inventory_item_id: number;
  name?: string;
  unit?: string;
  quantity: number;
}

export interface MenuItem {
  id: number;
  category_id: number;
  category_name: string;
  name: string;
  description: string | null;
  price: number;
  is_available: number;
  ingredients: Ingredient[];
}

export interface InventoryItem {
  id: number;
  name: string;
  category: string;
  quantity: number;
  unit: string;
  min_stock: number;
  purchase_price: number;
  supplier: string | null;
  is_low_stock: number;
}

export type TransactionType = "Initial" | "Stock In" | "Stock Out" | "Order Usage";

export interface InventoryTransaction {
  id: number;
  inventory_item_id: number;
  item_name: string;
  unit: string;
  type: TransactionType;
  quantity_change: number;
  quantity_after: number;
  unit_cost: number | null;
  note: string | null;
  user_name: string | null;
  created_at: string;
}

export type OrderStatus = "Pending" | "Preparing" | "Completed" | "Cancelled";

export interface OrderItem {
  id: number;
  item_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
}

export interface Order {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  location: string | null;
  status: OrderStatus;
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax: number;
  total: number;
  notes: string | null;
  items_count: number;
  bill_id: number | null;
  created_at: string;
  items?: OrderItem[];
}

export type PaymentStatus = "Unpaid" | "Partial" | "Paid";
export type PaymentMethod = "Cash" | "Card" | "Bank Transfer" | "Online";

export interface BillItem {
  id: number;
  item_type: "Room" | "Food";
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface Bill {
  id: number;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  booking_id: number | null;
  room_charges: number;
  food_charges: number;
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax: number;
  grand_total: number;
  amount_paid: number;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface BillDetail extends Bill {
  balance_due: number;
  items: BillItem[];
  orders: { id: number; total: number }[];
  customer: Customer | null;
  booking: {
    id: number;
    check_in: string;
    check_out: string;
    guests: number;
    room_number: string;
    room_type: string;
  } | null;
  issued_by: string | null;
  hotel: { name: string; address: string; phone: string; email: string; currency: string };
}
