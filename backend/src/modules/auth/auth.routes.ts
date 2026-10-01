import bcrypt from 'bcryptjs';
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { getJwtSecret } from '../../config/jwt';
import { execute, queryOne } from '../../db/pool';
import { authenticate, currentUser, type Role } from '../../middleware/auth';
import { badRequest, unauthorized } from '../../utils/errors';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Too many login attempts. Please try again later.' } },
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
});

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: Role;
  password_hash: string;
  is_active: number;
}

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const user = await queryOne<UserRow>(
    'SELECT id, name, email, role, password_hash, is_active FROM users WHERE email = ?',
    [email],
  );

  const valid = user ? await bcrypt.compare(password, user.password_hash) : false;
  if (!user || !valid || !user.is_active) throw unauthorized('Invalid email or password');

  await execute('UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?', [user.id]);

  const token = jwt.sign({ role: user.role }, getJwtSecret(), {
    subject: String(user.id),
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });

  res.json({
    data: { token, user: { id: user.id, name: user.name, email: user.email, role: user.role } },
  });
});

authRouter.get('/me', authenticate, (req, res) => {
  res.json({ data: currentUser(req) });
});

authRouter.post('/change-password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  const user = currentUser(req);
  const row = await queryOne<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', [
    user.id,
  ]);
  if (!row || !(await bcrypt.compare(currentPassword, row.password_hash))) {
    throw badRequest('Current password is incorrect', [
      { path: 'currentPassword', message: 'Current password is incorrect' },
    ]);
  }
  await execute('UPDATE users SET password_hash = ? WHERE id = ?', [
    await bcrypt.hash(newPassword, 12),
    user.id,
  ]);
  res.json({ data: { message: 'Password updated' } });
});
