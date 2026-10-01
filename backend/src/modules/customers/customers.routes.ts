import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne } from '../../db/pool';
import { authenticate, managerUp } from '../../middleware/auth';
import { notFound } from '../../utils/errors';
import { likePattern, nullableText, optionalText, pageMeta, paginationSchema, parseId } from '../../utils/http';

export const customersRouter = Router();
customersRouter.use(authenticate);

const customerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(150),
  phone: z
    .string()
    .trim()
    .min(5, 'Enter a valid phone number')
    .max(40)
    .regex(/^[0-9+()\-\s.]+$/, 'Phone may only contain digits, spaces and + ( ) - .'),
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().toLowerCase().email('Enter a valid email').max(190).nullable().optional(),
  ),
  address: nullableText(255),
  id_number: nullableText(60),
});

const listSchema = paginationSchema.extend({ search: optionalText(100) });

customersRouter.get('/', async (req, res) => {
  const { page, pageSize, search } = listSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (search) {
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.email LIKE ?)');
    const p = likePattern(search);
    params.push(p, p, p);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM customers c ${whereSql}`, params))?.n ?? 0;
  const rows = await query(
    `SELECT c.*,
       (SELECT COUNT(*) FROM bookings b WHERE b.customer_id = c.id) AS bookings_count,
       (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders_count
     FROM customers c ${whereSql}
     ORDER BY c.name LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  res.json({ data: rows, meta: pageMeta(page, pageSize, total) });
});

// Lightweight lookup for dropdowns.
customersRouter.get('/options', async (_req, res) => {
  res.json({ data: await query('SELECT id, name, phone FROM customers ORDER BY name LIMIT 1000') });
});

customersRouter.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const customer = await queryOne('SELECT * FROM customers WHERE id = ?', [id]);
  if (!customer) throw notFound('Customer not found');

  const [bookings, orders, bills] = await Promise.all([
    query(
      `SELECT b.id, b.check_in, b.check_out, b.status, b.total_amount, r.room_number, r.room_type
       FROM bookings b JOIN rooms r ON r.id = b.room_id
       WHERE b.customer_id = ? ORDER BY b.check_in DESC LIMIT 50`,
      [id],
    ),
    query(
      `SELECT id, status, total, created_at FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
      [id],
    ),
    query(
      `SELECT id, grand_total, amount_paid, payment_status, created_at FROM bills
       WHERE customer_id = ? ORDER BY created_at DESC LIMIT 50`,
      [id],
    ),
  ]);
  res.json({ data: { ...customer, bookings, orders, bills } });
});

customersRouter.post('/', async (req, res) => {
  const b = customerSchema.parse(req.body);
  const result = await execute(
    'INSERT INTO customers (name, phone, email, address, id_number) VALUES (?, ?, ?, ?, ?)',
    [b.name, b.phone, b.email ?? null, b.address, b.id_number],
  );
  res.status(201).json({ data: await queryOne('SELECT * FROM customers WHERE id = ?', [result.insertId]) });
});

customersRouter.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const b = customerSchema.parse(req.body);
  const result = await execute(
    'UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, id_number = ? WHERE id = ?',
    [b.name, b.phone, b.email ?? null, b.address, b.id_number, id],
  );
  if (result.affectedRows === 0) throw notFound('Customer not found');
  res.json({ data: await queryOne('SELECT * FROM customers WHERE id = ?', [id]) });
});

customersRouter.delete('/:id', managerUp, async (req, res) => {
  const id = parseId(req.params.id);
  const result = await execute('DELETE FROM customers WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw notFound('Customer not found');
  res.status(204).end();
});
