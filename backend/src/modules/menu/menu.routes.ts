import type { PoolConnection } from 'mysql2/promise';
import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne, withTransaction } from '../../db/pool';
import { authenticate, managerUp } from '../../middleware/auth';
import { badRequest, notFound } from '../../utils/errors';
import { nullableText, parseId } from '../../utils/http';

export const menuRouter = Router();
menuRouter.use(authenticate);

const categorySchema = z.object({ name: z.string().trim().min(2, 'Name is required').max(80) });

const ingredientSchema = z.object({
  inventory_item_id: z.coerce.number().int().positive('Select an inventory item'),
  quantity: z.coerce.number().positive('Quantity must be greater than 0').max(1_000_000),
});

const itemSchema = z.object({
  category_id: z.coerce.number().int().positive('Select a category'),
  name: z.string().trim().min(2, 'Name is required').max(150),
  description: nullableText(500),
  price: z.coerce.number().min(0, 'Price cannot be negative').max(9_999_999),
  is_available: z.boolean().default(true),
  ingredients: z.array(ingredientSchema).default([]),
});

interface IngredientRow {
  menu_item_id: number;
  inventory_item_id: number;
  quantity: number;
  name: string;
  unit: string;
}

async function attachIngredients<T extends { id: number }>(items: T[]) {
  if (items.length === 0) return [];
  const rows = await query<IngredientRow>(
    `SELECT mii.menu_item_id, mii.inventory_item_id, mii.quantity, ii.name, ii.unit
     FROM menu_item_ingredients mii JOIN inventory_items ii ON ii.id = mii.inventory_item_id
     WHERE mii.menu_item_id IN (?) ORDER BY ii.name`,
    [items.map((i) => i.id)],
  );
  return items.map((item) => ({
    ...item,
    ingredients: rows
      .filter((r) => r.menu_item_id === item.id)
      .map((r) => ({
        inventory_item_id: r.inventory_item_id,
        name: r.name,
        unit: r.unit,
        quantity: r.quantity,
      })),
  }));
}

const SELECT_ITEMS = `
  SELECT m.*, c.name AS category_name
  FROM menu_items m JOIN menu_categories c ON c.id = m.category_id`;

async function getItem(id: number) {
  const item = await queryOne<{ id: number }>(`${SELECT_ITEMS} WHERE m.id = ?`, [id]);
  if (!item) return null;
  return (await attachIngredients([item]))[0];
}

async function saveIngredients(conn: PoolConnection, menuItemId: number, ingredients: z.infer<typeof ingredientSchema>[]) {
  const ids = ingredients.map((i) => i.inventory_item_id);
  if (new Set(ids).size !== ids.length) {
    throw badRequest('An inventory item can only appear once per recipe', [
      { path: 'ingredients', message: 'Duplicate ingredient' },
    ]);
  }
  await execute('DELETE FROM menu_item_ingredients WHERE menu_item_id = ?', [menuItemId], conn);
  if (ingredients.length === 0) return;
  await execute(
    'INSERT INTO menu_item_ingredients (menu_item_id, inventory_item_id, quantity) VALUES ?',
    [ingredients.map((i) => [menuItemId, i.inventory_item_id, i.quantity])],
    conn,
  );
}

// ---- Categories -------------------------------------------------------------

menuRouter.get('/categories', async (_req, res) => {
  const rows = await query(`
    SELECT c.*, (SELECT COUNT(*) FROM menu_items m WHERE m.category_id = c.id) AS items_count
    FROM menu_categories c ORDER BY c.name`);
  res.json({ data: rows });
});

menuRouter.post('/categories', managerUp, async (req, res) => {
  const { name } = categorySchema.parse(req.body);
  const result = await execute('INSERT INTO menu_categories (name) VALUES (?)', [name]);
  res.status(201).json({ data: await queryOne('SELECT * FROM menu_categories WHERE id = ?', [result.insertId]) });
});

menuRouter.put('/categories/:id', managerUp, async (req, res) => {
  const id = parseId(req.params.id);
  const { name } = categorySchema.parse(req.body);
  const result = await execute('UPDATE menu_categories SET name = ? WHERE id = ?', [name, id]);
  if (result.affectedRows === 0) throw notFound('Category not found');
  res.json({ data: await queryOne('SELECT * FROM menu_categories WHERE id = ?', [id]) });
});

menuRouter.delete('/categories/:id', managerUp, async (req, res) => {
  const result = await execute('DELETE FROM menu_categories WHERE id = ?', [parseId(req.params.id)]);
  if (result.affectedRows === 0) throw notFound('Category not found');
  res.status(204).end();
});

// ---- Items ------------------------------------------------------------------

menuRouter.get('/items', async (_req, res) => {
  const items = await query<{ id: number }>(`${SELECT_ITEMS} ORDER BY c.name, m.name`);
  res.json({ data: await attachIngredients(items) });
});

menuRouter.post('/items', managerUp, async (req, res) => {
  const b = itemSchema.parse(req.body);
  const id = await withTransaction(async (conn) => {
    const result = await execute(
      'INSERT INTO menu_items (category_id, name, description, price, is_available) VALUES (?, ?, ?, ?, ?)',
      [b.category_id, b.name, b.description, b.price, b.is_available ? 1 : 0],
      conn,
    );
    await saveIngredients(conn, result.insertId, b.ingredients);
    return result.insertId;
  });
  res.status(201).json({ data: await getItem(id) });
});

menuRouter.put('/items/:id', managerUp, async (req, res) => {
  const id = parseId(req.params.id);
  const b = itemSchema.parse(req.body);
  await withTransaction(async (conn) => {
    const result = await execute(
      'UPDATE menu_items SET category_id = ?, name = ?, description = ?, price = ?, is_available = ? WHERE id = ?',
      [b.category_id, b.name, b.description, b.price, b.is_available ? 1 : 0, id],
      conn,
    );
    if (result.affectedRows === 0) {
      const exists = await queryOne('SELECT id FROM menu_items WHERE id = ?', [id], conn);
      if (!exists) throw notFound('Menu item not found');
    }
    await saveIngredients(conn, id, b.ingredients);
  });
  res.json({ data: await getItem(id) });
});

menuRouter.patch('/items/:id/availability', async (req, res) => {
  const id = parseId(req.params.id);
  const { is_available } = z.object({ is_available: z.boolean() }).parse(req.body);
  const result = await execute('UPDATE menu_items SET is_available = ? WHERE id = ?', [is_available ? 1 : 0, id]);
  if (result.affectedRows === 0) throw notFound('Menu item not found');
  res.json({ data: await getItem(id) });
});

menuRouter.delete('/items/:id', managerUp, async (req, res) => {
  const result = await execute('DELETE FROM menu_items WHERE id = ?', [parseId(req.params.id)]);
  if (result.affectedRows === 0) throw notFound('Menu item not found');
  res.status(204).end();
});
