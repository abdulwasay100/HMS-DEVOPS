import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { execute, query, queryOne, withTransaction } from '../../db/pool';
import { authenticate, currentUser, managerUp } from '../../middleware/auth';
import { nightsBetween } from '../../utils/dates';
import { badRequest, conflict, notFound } from '../../utils/errors';
import { likePattern, nullableText, optionalText, pageMeta, paginationSchema, parseId } from '../../utils/http';
import { computeTotals, round2 } from '../../utils/money';

export const billingRouter = Router();
billingRouter.use(authenticate);

const PAYMENT_METHODS = ['Cash', 'Card', 'Bank Transfer', 'Online'] as const;
const PAYMENT_STATUSES = ['Unpaid', 'Partial', 'Paid'] as const;

const optionalId = z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().positive().optional());

const createSchema = z
  .object({
    customer_id: optionalId,
    booking_id: optionalId,
    order_ids: z.array(z.coerce.number().int().positive()).default([]),
    discount: z.coerce.number().min(0, 'Discount cannot be negative').max(9_999_999).default(0),
    notes: nullableText(500),
    payment_method: z.preprocess((v) => (v === '' ? undefined : v), z.enum(PAYMENT_METHODS).optional()),
    amount_paid: z.coerce.number().min(0, 'Cannot be negative').max(99_999_999).default(0),
  })
  .refine((b) => b.booking_id !== undefined || b.order_ids.length > 0, {
    path: ['order_ids'],
    message: 'Select a booking or at least one order to bill',
  });

const paymentSchema = z.object({
  payment_method: z.enum(PAYMENT_METHODS, { error: 'Select a payment method' }),
  amount: z.coerce.number().positive('Amount must be greater than 0').max(99_999_999),
});

const listSchema = paginationSchema.extend({
  search: optionalText(100),
  payment_status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(PAYMENT_STATUSES).optional()),
});

function derivePaymentStatus(grandTotal: number, paid: number): (typeof PAYMENT_STATUSES)[number] {
  if (grandTotal <= 0 || paid >= grandTotal) return 'Paid';
  return paid > 0 ? 'Partial' : 'Unpaid';
}

const SELECT_BILL = `
  SELECT b.*, c.name AS customer_name, c.phone AS customer_phone
  FROM bills b LEFT JOIN customers c ON c.id = b.customer_id`;

async function getBillDetail(id: number) {
  const bill = await queryOne<{ id: number; customer_id: number | null; booking_id: number | null; created_by: number | null }>(
    `${SELECT_BILL} WHERE b.id = ?`,
    [id],
  );
  if (!bill) return null;

  const [items, orders, customer, booking, creator] = await Promise.all([
    query('SELECT * FROM bill_items WHERE bill_id = ? ORDER BY item_type DESC, id', [id]),
    query('SELECT o.id, o.total FROM bill_orders bo JOIN orders o ON o.id = bo.order_id WHERE bo.bill_id = ?', [id]),
    bill.customer_id ? queryOne('SELECT * FROM customers WHERE id = ?', [bill.customer_id]) : null,
    bill.booking_id
      ? queryOne(
          `SELECT b.id, b.check_in, b.check_out, b.guests, b.price_per_night, b.total_amount, r.room_number, r.room_type
           FROM bookings b JOIN rooms r ON r.id = b.room_id WHERE b.id = ?`,
          [bill.booking_id],
        )
      : null,
    bill.created_by ? queryOne<{ name: string }>('SELECT name FROM users WHERE id = ?', [bill.created_by]) : null,
  ]);

  return {
    ...bill,
    balance_due: round2((bill as any).grand_total - (bill as any).amount_paid),
    items,
    orders,
    customer,
    booking,
    issued_by: creator?.name ?? null,
    hotel: {
      name: env.hotel.name,
      address: env.hotel.address,
      phone: env.hotel.phone,
      email: env.hotel.email,
      currency: env.hotel.currency,
    },
  };
}

billingRouter.get('/', async (req, res) => {
  const { page, pageSize, search, payment_status } = listSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (payment_status) {
    where.push('b.payment_status = ?');
    params.push(payment_status);
  }
  if (search) {
    const numeric = /^\d+$/.test(search) ? Number(search) : 0;
    where.push('(c.name LIKE ? OR b.id = ?)');
    params.push(likePattern(search), numeric);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total =
    (
      await queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM bills b LEFT JOIN customers c ON c.id = b.customer_id ${whereSql}`,
        params,
      )
    )?.n ?? 0;
  const rows = await query(`${SELECT_BILL} ${whereSql} ORDER BY b.created_at DESC, b.id DESC LIMIT ? OFFSET ?`, [
    ...params,
    pageSize,
    (page - 1) * pageSize,
  ]);
  res.json({ data: rows, meta: pageMeta(page, pageSize, total) });
});

// Bookings and completed orders that have not been billed yet (customer_id omitted = walk-in orders).
billingRouter.get('/unbilled', async (req, res) => {
  const { customer_id } = z.object({ customer_id: optionalId }).parse(req.query);

  const bookings = customer_id
    ? await query(
        `SELECT b.id, b.check_in, b.check_out, b.status, b.price_per_night, b.total_amount, r.room_number, r.room_type
         FROM bookings b JOIN rooms r ON r.id = b.room_id
         WHERE b.customer_id = ? AND b.status <> 'Cancelled'
           AND NOT EXISTS (SELECT 1 FROM bills bl WHERE bl.booking_id = b.id)
         ORDER BY b.check_in DESC`,
        [customer_id],
      )
    : [];

  const orders = await query(
    `SELECT o.id, o.subtotal, o.discount, o.total, o.location, o.created_at
     FROM orders o
     WHERE o.status = 'Completed' AND ${customer_id ? 'o.customer_id = ?' : 'o.customer_id IS NULL'}
       AND NOT EXISTS (SELECT 1 FROM bill_orders bo WHERE bo.order_id = o.id)
     ORDER BY o.created_at DESC`,
    customer_id ? [customer_id] : [],
  );

  res.json({ data: { bookings, orders }, taxRatePercent: env.hotel.taxRatePercent });
});

billingRouter.get('/:id', async (req, res) => {
  const bill = await getBillDetail(parseId(req.params.id));
  if (!bill) throw notFound('Bill not found');
  res.json({ data: bill });
});

interface BookingRow {
  id: number;
  customer_id: number;
  status: string;
  check_in: string;
  check_out: string;
  price_per_night: number;
  total_amount: number;
  room_number: string;
  room_type: string;
}

interface OrderRow {
  id: number;
  customer_id: number | null;
  status: string;
  subtotal: number;
  discount: number;
}

billingRouter.post('/', async (req, res) => {
  const b = createSchema.parse(req.body);
  const user = currentUser(req);

  const billId = await withTransaction(async (conn) => {
    let booking: BookingRow | null = null;
    if (b.booking_id) {
      booking = await queryOne<BookingRow>(
        `SELECT b.id, b.customer_id, b.status, b.check_in, b.check_out, b.price_per_night, b.total_amount,
                r.room_number, r.room_type
         FROM bookings b JOIN rooms r ON r.id = b.room_id WHERE b.id = ? FOR UPDATE`,
        [b.booking_id],
        conn,
      );
      if (!booking) throw badRequest('Booking not found', [{ path: 'booking_id', message: 'Booking not found' }]);
      if (booking.status === 'Cancelled') throw conflict('A cancelled booking cannot be billed');
      if (await queryOne('SELECT id FROM bills WHERE booking_id = ?', [booking.id], conn)) {
        throw conflict('This booking has already been billed');
      }
    }

    let orders: OrderRow[] = [];
    if (b.order_ids.length > 0) {
      const ids = [...new Set(b.order_ids)];
      orders = await query<OrderRow>(
        'SELECT id, customer_id, status, subtotal, discount FROM orders WHERE id IN (?) ORDER BY id FOR UPDATE',
        [ids],
        conn,
      );
      if (orders.length !== ids.length) throw badRequest('One or more orders were not found');
      const notDone = orders.find((o) => o.status !== 'Completed');
      if (notDone) throw conflict(`Order #${notDone.id} is ${notDone.status} - only completed orders can be billed`);
      const billed = await query<{ order_id: number }>('SELECT order_id FROM bill_orders WHERE order_id IN (?)', [ids], conn);
      if (billed.length) throw conflict(`Order #${billed[0].order_id} has already been billed`);
    }

    const customerId = booking?.customer_id ?? b.customer_id ?? orders[0]?.customer_id ?? null;
    if (b.customer_id && booking && booking.customer_id !== b.customer_id) {
      throw badRequest('The booking belongs to a different customer');
    }
    if (orders.some((o) => (o.customer_id ?? null) !== customerId)) {
      throw badRequest('The selected orders and booking belong to different customers');
    }

    const lines: Array<[string, string, number, number, number]> = [];
    let roomCharges = 0;
    if (booking) {
      const nights = nightsBetween(booking.check_in, booking.check_out);
      roomCharges = booking.total_amount;
      lines.push([
        'Room',
        `Room ${booking.room_number} (${booking.room_type}) ${booking.check_in} to ${booking.check_out}`,
        nights,
        booking.price_per_night,
        booking.total_amount,
      ]);
    }

    let foodCharges = 0;
    if (orders.length) {
      const items = await query<{
        order_id: number;
        item_name: string;
        quantity: number;
        unit_price: number;
        line_total: number;
      }>('SELECT order_id, item_name, quantity, unit_price, line_total FROM order_items WHERE order_id IN (?) ORDER BY order_id, id', [
        orders.map((o) => o.id),
      ], conn);
      for (const i of items) {
        lines.push(['Food', `${i.item_name} (Order #${i.order_id})`, i.quantity, i.unit_price, i.line_total]);
      }
      foodCharges = round2(orders.reduce((s, o) => s + o.subtotal, 0));
    }

    const subtotal = round2(roomCharges + foodCharges);
    if (b.discount > subtotal) {
      throw badRequest('Discount cannot exceed the subtotal', [
        { path: 'discount', message: 'Discount cannot exceed the subtotal' },
      ]);
    }
    const totals = computeTotals(subtotal, b.discount, env.hotel.taxRatePercent);

    if (b.amount_paid > totals.total) {
      throw badRequest('Amount paid cannot exceed the grand total', [
        { path: 'amount_paid', message: 'Cannot exceed the grand total' },
      ]);
    }
    if (b.amount_paid > 0 && !b.payment_method) {
      throw badRequest('Select a payment method', [{ path: 'payment_method', message: 'Select a payment method' }]);
    }

    const status = derivePaymentStatus(totals.total, b.amount_paid);
    const result = await execute(
      `INSERT INTO bills
        (customer_id, booking_id, room_charges, food_charges, subtotal, discount, tax_rate, tax, grand_total,
         amount_paid, payment_status, payment_method, paid_at, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${status === 'Paid' ? 'UTC_TIMESTAMP()' : 'NULL'}, ?, ?)`,
      [
        customerId,
        booking?.id ?? null,
        roomCharges,
        foodCharges,
        totals.subtotal,
        totals.discount,
        totals.taxRate,
        totals.tax,
        totals.total,
        b.amount_paid,
        status,
        b.amount_paid > 0 ? b.payment_method : null,
        b.notes,
        user.id,
      ],
      conn,
    );

    if (lines.length) {
      await execute(
        'INSERT INTO bill_items (bill_id, item_type, description, quantity, unit_price, line_total) VALUES ?',
        [lines.map((l) => [result.insertId, ...l])],
        conn,
      );
    }
    if (orders.length) {
      await execute('INSERT INTO bill_orders (bill_id, order_id) VALUES ?', [orders.map((o) => [result.insertId, o.id])], conn);
    }
    return result.insertId;
  });

  res.status(201).json({ data: await getBillDetail(billId) });
});

billingRouter.post('/:id/payments', async (req, res) => {
  const id = parseId(req.params.id);
  const b = paymentSchema.parse(req.body);

  await withTransaction(async (conn) => {
    const bill = await queryOne<{ grand_total: number; amount_paid: number }>(
      'SELECT grand_total, amount_paid FROM bills WHERE id = ? FOR UPDATE',
      [id],
      conn,
    );
    if (!bill) throw notFound('Bill not found');

    const balance = round2(bill.grand_total - bill.amount_paid);
    if (b.amount > balance) {
      throw badRequest(`Amount exceeds the outstanding balance (${balance.toFixed(2)})`, [
        { path: 'amount', message: `Cannot exceed the balance of ${balance.toFixed(2)}` },
      ]);
    }
    const paid = round2(bill.amount_paid + b.amount);
    const status = derivePaymentStatus(bill.grand_total, paid);
    await execute(
      `UPDATE bills SET amount_paid = ?, payment_status = ?, payment_method = ?,
         paid_at = ${status === 'Paid' ? 'UTC_TIMESTAMP()' : 'paid_at'} WHERE id = ?`,
      [paid, status, b.payment_method, id],
      conn,
    );
  });

  res.json({ data: await getBillDetail(id) });
});

billingRouter.delete('/:id', managerUp, async (req, res) => {
  const id = parseId(req.params.id);
  const bill = await queryOne<{ amount_paid: number }>('SELECT amount_paid FROM bills WHERE id = ?', [id]);
  if (!bill) throw notFound('Bill not found');
  if (bill.amount_paid > 0) throw conflict('Bills with recorded payments cannot be deleted');
  await execute('DELETE FROM bills WHERE id = ?', [id]);
  res.status(204).end();
});
