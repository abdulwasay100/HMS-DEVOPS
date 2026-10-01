import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { execute, query, queryOne, withTransaction } from '../../db/pool';
import { authenticate, currentUser } from '../../middleware/auth';
import { badRequest, conflict, notFound } from '../../utils/errors';
import { likePattern, nullableText, optionalText, pageMeta, paginationSchema, parseId } from '../../utils/http';
import { computeTotals, round2 } from '../../utils/money';
import { applyStockChange } from '../inventory/inventory.service';

export const ordersRouter = Router();
ordersRouter.use(authenticate);

const ORDER_STATUSES = ['Pending', 'Preparing', 'Completed', 'Cancelled'] as const;

const TRANSITIONS: Record<string, readonly string[]> = {
  Pending: ['Preparing', 'Completed', 'Cancelled'],
  Preparing: ['Completed', 'Cancelled'],
  Completed: [],
  Cancelled: [],
};

const orderSchema = z.object({
  customer_id: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().positive().optional()),
  location: nullableText(60),
  items: z
    .array(
      z.object({
        menu_item_id: z.coerce.number().int().positive(),
        quantity: z.coerce.number().int().min(1, 'Minimum quantity is 1').max(999),
      }),
    )
    .min(1, 'Add at least one item'),
  discount: z.coerce.number().min(0, 'Discount cannot be negative').max(9_999_999).default(0),
  notes: nullableText(500),
});

const listSchema = paginationSchema.extend({
  search: optionalText(100),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(ORDER_STATUSES).optional()),
});

const SELECT_ORDER = `
  SELECT o.*, c.name AS customer_name, bo.bill_id,
    (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS items_count
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
  LEFT JOIN bill_orders bo ON bo.order_id = o.id`;

async function getOrder(id: number) {
  const order = await queryOne(`${SELECT_ORDER} WHERE o.id = ?`, [id]);
  if (!order) return null;
  const items = await query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', [id]);
  return { ...order, items };
}

ordersRouter.get('/', async (req, res) => {
  const { page, pageSize, search, status } = listSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) {
    where.push('o.status = ?');
    params.push(status);
  }
  if (search) {
    const p = likePattern(search);
    const numeric = /^\d+$/.test(search) ? Number(search) : 0;
    where.push('(c.name LIKE ? OR o.location LIKE ? OR o.id = ?)');
    params.push(p, p, numeric);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total =
    (
      await queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ${whereSql}`,
        params,
      )
    )?.n ?? 0;
  const rows = await query(`${SELECT_ORDER} ${whereSql} ORDER BY o.created_at DESC, o.id DESC LIMIT ? OFFSET ?`, [
    ...params,
    pageSize,
    (page - 1) * pageSize,
  ]);
  res.json({ data: rows, meta: pageMeta(page, pageSize, total) });
});

ordersRouter.get('/:id', async (req, res) => {
  const order = await getOrder(parseId(req.params.id));
  if (!order) throw notFound('Order not found');
  res.json({ data: order });
});

ordersRouter.post('/', async (req, res) => {
  const b = orderSchema.parse(req.body);
  const user = currentUser(req);

  // Merge duplicate lines for the same menu item.
  const merged = new Map<number, number>();
  for (const line of b.items) merged.set(line.menu_item_id, (merged.get(line.menu_item_id) ?? 0) + line.quantity);

  const id = await withTransaction(async (conn) => {
    if (b.customer_id) {
      const customer = await queryOne('SELECT id FROM customers WHERE id = ?', [b.customer_id], conn);
      if (!customer) throw badRequest('Customer not found', [{ path: 'customer_id', message: 'Customer not found' }]);
    }

    const menu = await query<{ id: number; name: string; price: number; is_available: number }>(
      'SELECT id, name, price, is_available FROM menu_items WHERE id IN (?)',
      [[...merged.keys()]],
      conn,
    );
    const byId = new Map(menu.map((m) => [m.id, m]));

    const lines = [...merged.entries()].map(([menuItemId, quantity]) => {
      const item = byId.get(menuItemId);
      if (!item) throw badRequest(`Menu item #${menuItemId} does not exist`);
      if (!item.is_available) throw conflict(`"${item.name}" is currently unavailable`);
      return { item, quantity, lineTotal: round2(item.price * quantity) };
    });

    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    if (b.discount > round2(subtotal)) {
      throw badRequest('Discount cannot exceed the order subtotal', [
        { path: 'discount', message: 'Discount cannot exceed the subtotal' },
      ]);
    }
    const totals = computeTotals(subtotal, b.discount, env.hotel.taxRatePercent);

    const result = await execute(
      `INSERT INTO orders (customer_id, location, status, subtotal, discount, tax_rate, tax, total, notes, created_by)
       VALUES (?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?)`,
      [
        b.customer_id ?? null,
        b.location,
        totals.subtotal,
        totals.discount,
        totals.taxRate,
        totals.tax,
        totals.total,
        b.notes,
        user.id,
      ],
      conn,
    );
    await execute(
      'INSERT INTO order_items (order_id, menu_item_id, item_name, unit_price, quantity, line_total) VALUES ?',
      [lines.map((l) => [result.insertId, l.item.id, l.item.name, l.item.price, l.quantity, l.lineTotal])],
      conn,
    );
    return result.insertId;
  });

  res.status(201).json({ data: await getOrder(id) });
});

ordersRouter.patch('/:id/status', async (req, res) => {
  const id = parseId(req.params.id);
  const { status } = z.object({ status: z.enum(ORDER_STATUSES) }).parse(req.body);
  const user = currentUser(req);

  const lowStock = await withTransaction(async (conn) => {
    const order = await queryOne<{ status: string; inventory_deducted: number }>(
      'SELECT status, inventory_deducted FROM orders WHERE id = ? FOR UPDATE',
      [id],
      conn,
    );
    if (!order) throw notFound('Order not found');
    if (!TRANSITIONS[order.status]?.includes(status)) {
      throw conflict(`Cannot change an order from ${order.status} to ${status}`);
    }

    if (status !== 'Completed') {
      await execute('UPDATE orders SET status = ? WHERE id = ?', [status, id], conn);
      return [];
    }

    // Recipe requirements aggregated per inventory item (an order may contain the same ingredient via several dishes).
    const needs = await query<{ inventory_item_id: number; needed: number }>(
      `SELECT mii.inventory_item_id, SUM(mii.quantity * oi.quantity) AS needed
       FROM order_items oi
       JOIN menu_item_ingredients mii ON mii.menu_item_id = oi.menu_item_id
       WHERE oi.order_id = ?
       GROUP BY mii.inventory_item_id
       ORDER BY mii.inventory_item_id`,
      [id],
      conn,
    );

    const affected = [];
    if (!order.inventory_deducted) {
      // Ascending id order keeps lock acquisition consistent and avoids deadlocks between orders.
      for (const need of needs) {
        affected.push(
          await applyStockChange(conn, {
            itemId: need.inventory_item_id,
            change: -need.needed,
            type: 'Order Usage',
            note: `Order #${id}`,
            referenceType: 'order',
            referenceId: id,
            userId: user.id,
          }),
        );
      }
    }

    await execute(
      "UPDATE orders SET status = 'Completed', completed_at = UTC_TIMESTAMP(), inventory_deducted = 1 WHERE id = ?",
      [id],
      conn,
    );
    return affected.filter((i) => i.quantity <= i.min_stock);
  });

  res.json({ data: await getOrder(id), low_stock: lowStock });
});
