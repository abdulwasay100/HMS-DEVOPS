import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne } from '../../db/pool';
import { authenticate, managerUp } from '../../middleware/auth';
import { badRequest } from '../../utils/errors';
import { addDays, dateRangeToInstants, nightsBetween, todayString, tzOffsetMinutes } from '../../utils/dates';
import { dateString } from '../../utils/http';
import { round2 } from '../../utils/money';

export const reportsRouter = Router();
reportsRouter.use(authenticate, managerUp);

const MAX_RANGE_DAYS = 732;

const rangeSchema = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
});

function resolveRange(input: { from?: string; to?: string }, defaultDays: number) {
  const to = input.to ?? todayString();
  const from = input.from ?? addDays(to, -(defaultDays - 1));
  if (from > to) throw badRequest('"from" must be on or before "to"');
  if (nightsBetween(from, to) > MAX_RANGE_DAYS) throw badRequest('Date range is too large');
  return { from, to, ...dateRangeToInstants(from, to) };
}

reportsRouter.get('/sales', async (req, res) => {
  const { period, ...range } = rangeSchema
    .extend({ period: z.enum(['daily', 'weekly', 'monthly']).default('daily') })
    .parse(req.query);
  const defaultDays = period === 'daily' ? 30 : period === 'weekly' ? 84 : 365;
  const { from, to, start, end } = resolveRange(range, defaultDays);

  // Group by the hotel's local calendar day; offset is a server-computed integer.
  const offset = Math.trunc(tzOffsetMinutes());
  const day = `DATE(DATE_ADD(created_at, INTERVAL ${offset} MINUTE))`;
  const periodExpr =
    period === 'daily'
      ? day
      : period === 'weekly'
        ? `DATE_SUB(${day}, INTERVAL WEEKDAY(${day}) DAY)`
        : `DATE_FORMAT(${day}, '%Y-%m-01')`;

  const rows = await query(
    `SELECT ${periodExpr} AS period_start,
        COUNT(*) AS bills_count,
        SUM(room_charges) AS room_revenue,
        SUM(food_charges) AS food_revenue,
        SUM(discount) AS discount,
        SUM(tax) AS tax,
        SUM(grand_total) AS total,
        SUM(amount_paid) AS collected
     FROM bills
     WHERE created_at >= ? AND created_at < ?
     GROUP BY period_start
     ORDER BY period_start`,
    [start, end],
  );
  res.json({ data: rows, meta: { period, from, to } });
});

reportsRouter.get('/top-items', async (req, res) => {
  const q = rangeSchema.extend({ limit: z.coerce.number().int().min(1).max(50).default(10) }).parse(req.query);
  const { from, to, start, end } = resolveRange(q, 30);
  const rows = await query(
    `SELECT oi.item_name, SUM(oi.quantity) AS quantity, SUM(oi.line_total) AS revenue
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.status = 'Completed' AND o.created_at >= ? AND o.created_at < ?
     GROUP BY oi.item_name
     ORDER BY quantity DESC, revenue DESC
     LIMIT ?`,
    [start, end, q.limit],
  );
  res.json({ data: rows, meta: { from, to } });
});

reportsRouter.get('/inventory-usage', async (req, res) => {
  const { from, to, start, end } = resolveRange(rangeSchema.parse(req.query), 30);
  const rows = await query(
    `SELECT i.id, i.name, i.category, i.unit, i.quantity, i.min_stock,
        COALESCE(SUM(CASE WHEN t.type = 'Order Usage' THEN -t.quantity_change END), 0) AS used_in_orders,
        COALESCE(SUM(CASE WHEN t.type = 'Stock Out' THEN -t.quantity_change END), 0) AS stock_out,
        COALESCE(SUM(CASE WHEN t.type IN ('Stock In','Initial') THEN t.quantity_change END), 0) AS stock_in
     FROM inventory_items i
     LEFT JOIN inventory_transactions t
       ON t.inventory_item_id = i.id AND t.created_at >= ? AND t.created_at < ?
     GROUP BY i.id, i.name, i.category, i.unit, i.quantity, i.min_stock
     ORDER BY used_in_orders DESC, i.name`,
    [start, end],
  );
  res.json({ data: rows, meta: { from, to } });
});

reportsRouter.get('/low-stock', async (_req, res) => {
  const rows = await query(
    `SELECT id, name, category, quantity, unit, min_stock, supplier
     FROM inventory_items WHERE quantity <= min_stock ORDER BY (quantity - min_stock), name`,
  );
  res.json({ data: rows });
});

reportsRouter.get('/occupancy', async (req, res) => {
  const { from, to } = resolveRange(rangeSchema.parse(req.query), 30);
  const totalRooms =
    (await queryOne<{ n: number }>("SELECT COUNT(*) AS n FROM rooms WHERE status <> 'Maintenance'"))?.n ?? 0;

  const bookings = await query<{ check_in: string; check_out: string }>(
    `SELECT check_in, check_out FROM bookings
     WHERE status <> 'Cancelled' AND check_in <= ? AND check_out > ?`,
    [to, from],
  );

  const days: Array<{ date: string; occupied: number; rate: number }> = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const occupied = bookings.filter((b) => b.check_in <= d && b.check_out > d).length;
    days.push({ date: d, occupied, rate: totalRooms ? round2((occupied / totalRooms) * 100) : 0 });
  }
  const averageRate = days.length ? round2(days.reduce((s, d) => s + d.rate, 0) / days.length) : 0;
  res.json({ data: { total_rooms: totalRooms, average_rate: averageRate, days }, meta: { from, to } });
});

reportsRouter.get('/revenue-summary', async (req, res) => {
  const { from, to, start, end } = resolveRange(rangeSchema.parse(req.query), 30);
  const totals = await queryOne(
    `SELECT COUNT(*) AS bills_count,
        COALESCE(SUM(room_charges), 0) AS room_revenue,
        COALESCE(SUM(food_charges), 0) AS food_revenue,
        COALESCE(SUM(discount), 0) AS discount,
        COALESCE(SUM(tax), 0) AS tax,
        COALESCE(SUM(grand_total), 0) AS total_billed,
        COALESCE(SUM(amount_paid), 0) AS collected,
        COALESCE(SUM(grand_total - amount_paid), 0) AS outstanding
     FROM bills WHERE created_at >= ? AND created_at < ?`,
    [start, end],
  );
  const byMethod = await query(
    `SELECT payment_method, COUNT(*) AS bills_count, SUM(amount_paid) AS collected
     FROM bills
     WHERE created_at >= ? AND created_at < ? AND amount_paid > 0
     GROUP BY payment_method ORDER BY collected DESC`,
    [start, end],
  );
  const byStatus = await query(
    `SELECT payment_status, COUNT(*) AS bills_count, SUM(grand_total) AS total
     FROM bills WHERE created_at >= ? AND created_at < ? GROUP BY payment_status`,
    [start, end],
  );
  res.json({ data: { totals, by_method: byMethod, by_status: byStatus }, meta: { from, to } });
});
