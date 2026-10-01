import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne, withTransaction } from '../../db/pool';
import { authenticate, currentUser, managerUp } from '../../middleware/auth';
import { notFound } from '../../utils/errors';
import { likePattern, nullableText, optionalText, pageMeta, paginationSchema, parseId } from '../../utils/http';
import { applyStockChange } from './inventory.service';

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

const itemSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(150),
  category: z.string().trim().min(1, 'Category is required').max(80),
  unit: z.string().trim().min(1, 'Unit is required').max(20),
  min_stock: z.coerce.number().min(0, 'Cannot be negative').max(99_999_999),
  purchase_price: z.coerce.number().min(0, 'Cannot be negative').max(9_999_999),
  supplier: nullableText(150),
});

const createSchema = itemSchema.extend({
  quantity: z.coerce.number().min(0, 'Cannot be negative').max(99_999_999).default(0),
});

const adjustSchema = z.object({
  type: z.enum(['Stock In', 'Stock Out']),
  quantity: z.coerce.number().positive('Quantity must be greater than 0').max(99_999_999),
  unit_cost: z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.number().min(0).max(9_999_999).optional(),
  ),
  note: nullableText(255),
});

const listSchema = z.object({
  search: optionalText(100),
  category: optionalText(80),
  low_only: z.preprocess((v) => v === 'true' || v === '1', z.boolean()),
});

const txListSchema = paginationSchema.extend({
  item_id: z.coerce.number().int().positive().optional(),
  type: z.preprocess((v) => (v === '' ? undefined : v), z.enum(['Initial', 'Stock In', 'Stock Out', 'Order Usage']).optional()),
});

const SELECT_ITEM = `SELECT i.*, (i.quantity <= i.min_stock) AS is_low_stock FROM inventory_items i`;

async function getItem(id: number) {
  return queryOne(`${SELECT_ITEM} WHERE i.id = ?`, [id]);
}

inventoryRouter.get('/', async (req, res) => {
  const { search, category, low_only } = listSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (search) {
    where.push('(i.name LIKE ? OR i.supplier LIKE ?)');
    params.push(likePattern(search), likePattern(search));
  }
  if (category) {
    where.push('i.category = ?');
    params.push(category);
  }
  if (low_only) where.push('i.quantity <= i.min_stock');
  const rows = await query(`${SELECT_ITEM} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.name`, params);
  res.json({ data: rows });
});

inventoryRouter.get('/categories', async (_req, res) => {
  const rows = await query<{ category: string }>('SELECT DISTINCT category FROM inventory_items ORDER BY category');
  res.json({ data: rows.map((r) => r.category) });
});

inventoryRouter.get('/low-stock', async (_req, res) => {
  const rows = await query(`${SELECT_ITEM} WHERE i.quantity <= i.min_stock ORDER BY (i.quantity - i.min_stock), i.name`);
  res.json({ data: rows });
});

inventoryRouter.get('/transactions', async (req, res) => {
  const { page, pageSize, item_id, type } = txListSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (item_id) {
    where.push('t.inventory_item_id = ?');
    params.push(item_id);
  }
  if (type) {
    where.push('t.type = ?');
    params.push(type);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total =
    (await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM inventory_transactions t ${whereSql}`, params))?.n ?? 0;
  const rows = await query(
    `SELECT t.*, i.name AS item_name, i.unit, u.name AS user_name
     FROM inventory_transactions t
     JOIN inventory_items i ON i.id = t.inventory_item_id
     LEFT JOIN users u ON u.id = t.created_by
     ${whereSql}
     ORDER BY t.created_at DESC, t.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  res.json({ data: rows, meta: pageMeta(page, pageSize, total) });
});

inventoryRouter.get('/:id', async (req, res) => {
  const item = await getItem(parseId(req.params.id));
  if (!item) throw notFound('Inventory item not found');
  res.json({ data: item });
});

inventoryRouter.post('/', managerUp, async (req, res) => {
  const b = createSchema.parse(req.body);
  const user = currentUser(req);
  const id = await withTransaction(async (conn) => {
    const result = await execute(
      `INSERT INTO inventory_items (name, category, quantity, unit, min_stock, purchase_price, supplier)
       VALUES (?, ?, 0, ?, ?, ?, ?)`,
      [b.name, b.category, b.unit, b.min_stock, b.purchase_price, b.supplier],
      conn,
    );
    if (b.quantity > 0) {
      await applyStockChange(conn, {
        itemId: result.insertId,
        change: b.quantity,
        type: 'Initial',
        note: 'Opening balance',
        unitCost: b.purchase_price,
        userId: user.id,
      });
    }
    return result.insertId;
  });
  res.status(201).json({ data: await getItem(id) });
});

inventoryRouter.put('/:id', managerUp, async (req, res) => {
  const id = parseId(req.params.id);
  const b = itemSchema.parse(req.body);
  const result = await execute(
    `UPDATE inventory_items SET name = ?, category = ?, unit = ?, min_stock = ?, purchase_price = ?, supplier = ?
     WHERE id = ?`,
    [b.name, b.category, b.unit, b.min_stock, b.purchase_price, b.supplier, id],
  );
  if (result.affectedRows === 0) throw notFound('Inventory item not found');
  res.json({ data: await getItem(id) });
});

inventoryRouter.delete('/:id', managerUp, async (req, res) => {
  const result = await execute('DELETE FROM inventory_items WHERE id = ?', [parseId(req.params.id)]);
  if (result.affectedRows === 0) throw notFound('Inventory item not found');
  res.status(204).end();
});

inventoryRouter.post('/:id/adjust', managerUp, async (req, res) => {
  const id = parseId(req.params.id);
  const b = adjustSchema.parse(req.body);
  const user = currentUser(req);

  await withTransaction(async (conn) => {
    await applyStockChange(conn, {
      itemId: id,
      change: b.type === 'Stock In' ? b.quantity : -b.quantity,
      type: b.type,
      note: b.note,
      unitCost: b.type === 'Stock In' ? (b.unit_cost ?? null) : null,
      userId: user.id,
    });
    if (b.type === 'Stock In' && b.unit_cost !== undefined) {
      await execute('UPDATE inventory_items SET purchase_price = ? WHERE id = ?', [b.unit_cost, id], conn);
    }
  });

  res.json({ data: await getItem(id) });
});
