import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne } from '../../db/pool';
import { adminOnly, authenticate, currentUser } from '../../middleware/auth';
import { conflict, notFound } from '../../utils/errors';
import { parseId } from '../../utils/http';

export const usersRouter = Router();
usersRouter.use(authenticate, adminOnly);

const roleSchema = z.enum(['admin', 'manager', 'staff']);

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(190),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  role: roleSchema,
  is_active: z.boolean().default(true),
});

const updateSchema = createSchema
  .omit({ password: true })
  .extend({ password: z.string().min(8, 'Password must be at least 8 characters').max(128).optional() });

const COLUMNS = 'id, name, email, role, is_active, last_login_at, created_at';

async function activeAdminCount(excludeId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND is_active = 1 AND id <> ?",
    [excludeId],
  );
  return row?.n ?? 0;
}

usersRouter.get('/', async (_req, res) => {
  const rows = await query(`SELECT ${COLUMNS} FROM users ORDER BY name`);
  res.json({ data: rows });
});

usersRouter.post('/', async (req, res) => {
  const body = createSchema.parse(req.body);
  const result = await execute(
    'INSERT INTO users (name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?)',
    [body.name, body.email, await bcrypt.hash(body.password, 12), body.role, body.is_active ? 1 : 0],
  );
  const created = await queryOne(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [result.insertId]);
  res.status(201).json({ data: created });
});

usersRouter.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const body = updateSchema.parse(req.body);
  const me = currentUser(req);

  const existing = await queryOne<{ id: number }>('SELECT id FROM users WHERE id = ?', [id]);
  if (!existing) throw notFound('User not found');

  if (id === me.id && (body.role !== 'admin' || !body.is_active)) {
    throw conflict('You cannot remove your own admin access or deactivate yourself');
  }
  if ((body.role !== 'admin' || !body.is_active) && (await activeAdminCount(id)) === 0) {
    throw conflict('At least one active admin is required');
  }

  await execute('UPDATE users SET name = ?, email = ?, role = ?, is_active = ? WHERE id = ?', [
    body.name,
    body.email,
    body.role,
    body.is_active ? 1 : 0,
    id,
  ]);
  if (body.password) {
    await execute('UPDATE users SET password_hash = ? WHERE id = ?', [await bcrypt.hash(body.password, 12), id]);
  }
  res.json({ data: await queryOne(`SELECT ${COLUMNS} FROM users WHERE id = ?`, [id]) });
});

usersRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (id === currentUser(req).id) throw conflict('You cannot delete your own account');

  const target = await queryOne<{ role: string; is_active: number }>(
    'SELECT role, is_active FROM users WHERE id = ?',
    [id],
  );
  if (!target) throw notFound('User not found');
  if (target.role === 'admin' && target.is_active && (await activeAdminCount(id)) === 0) {
    throw conflict('At least one active admin is required');
  }

  await execute('DELETE FROM users WHERE id = ?', [id]);
  res.status(204).end();
});
