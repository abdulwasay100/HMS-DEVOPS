import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getJwtSecret } from '../config/jwt';
import { queryOne } from '../db/pool';
import { forbidden, unauthorized } from '../utils/errors';

export type Role = 'admin' | 'manager' | 'staff';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

interface TokenPayload {
  sub: string;
}

/** Verifies the bearer token and loads the current user (so deactivation/role changes apply immediately). */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();

  let payload: TokenPayload;
  try {
    payload = jwt.verify(header.slice(7), getJwtSecret()) as TokenPayload;
  } catch {
    throw unauthorized('Session expired or invalid. Please sign in again.');
  }

  const user = await queryOne<AuthUser & { is_active: number }>(
    'SELECT id, name, email, role, is_active FROM users WHERE id = ?',
    [Number(payload.sub)],
  );
  if (!user || !user.is_active) throw unauthorized('Account is disabled or no longer exists');

  req.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  next();
}

export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw unauthorized();
    if (!roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

export const adminOnly = authorize('admin');
export const managerUp = authorize('admin', 'manager');

export function currentUser(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
