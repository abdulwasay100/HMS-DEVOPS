import { Router } from 'express';
import { query, queryOne } from '../../db/pool';
import { authenticate } from '../../middleware/auth';
import { dateRangeToInstants, todayString } from '../../utils/dates';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get('/', async (_req, res) => {
  const today = todayString();
  const { start, end } = dateRangeToInstants(today, today);

  const [sales, orders, rooms, arrivals, departures, lowStock, recentOrders, recentBookings, unpaid] =
    await Promise.all([
      queryOne(
        `SELECT COUNT(*) AS bills_count, COALESCE(SUM(grand_total), 0) AS total, COALESCE(SUM(amount_paid), 0) AS collected
         FROM bills WHERE created_at >= ? AND created_at < ?`,
        [start, end],
      ),
      queryOne(
        `SELECT COUNT(*) AS total,
            COALESCE(SUM(status = 'Pending'), 0) AS pending,
            COALESCE(SUM(status = 'Preparing'), 0) AS preparing,
            COALESCE(SUM(status = 'Completed'), 0) AS completed
         FROM orders WHERE created_at >= ? AND created_at < ?`,
        [start, end],
      ),
      query<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM rooms GROUP BY status'),
      queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM bookings WHERE status = 'Reserved' AND check_in = ?", [today]),
      queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM bookings WHERE status = 'Checked-In' AND check_out = ?", [today]),
      query(
        `SELECT id, name, category, quantity, unit, min_stock FROM inventory_items
         WHERE quantity <= min_stock ORDER BY (quantity - min_stock), name LIMIT 8`,
      ),
      query(
        `SELECT o.id, o.status, o.total, o.location, o.created_at, c.name AS customer_name
         FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
         ORDER BY o.created_at DESC, o.id DESC LIMIT 6`,
      ),
      query(
        `SELECT b.id, b.status, b.check_in, b.check_out, c.name AS customer_name, r.room_number
         FROM bookings b JOIN customers c ON c.id = b.customer_id JOIN rooms r ON r.id = b.room_id
         ORDER BY b.created_at DESC, b.id DESC LIMIT 6`,
      ),
      queryOne(
        "SELECT COUNT(*) AS n, COALESCE(SUM(grand_total - amount_paid), 0) AS amount FROM bills WHERE payment_status <> 'Paid'",
      ),
    ]);

  const roomCounts: Record<string, number> = { Available: 0, Occupied: 0, Cleaning: 0, Maintenance: 0 };
  for (const r of rooms) roomCounts[r.status] = r.n;
  const totalRooms = Object.values(roomCounts).reduce((a, b) => a + b, 0);

  const lowStockCount =
    (await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM inventory_items WHERE quantity <= min_stock'))?.n ?? 0;

  res.json({
    data: {
      date: today,
      sales,
      orders,
      rooms: { total: totalRooms, ...roomCounts },
      arrivals_today: arrivals?.n ?? 0,
      departures_today: departures?.n ?? 0,
      unpaid_bills: unpaid,
      low_stock_count: lowStockCount,
      low_stock: lowStock,
      recent_orders: recentOrders,
      recent_bookings: recentBookings,
    },
  });
});
