import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { HttpError, type ErrorDetail } from '../utils/errors';

interface MysqlError extends Error {
  code?: string;
  errno?: number;
  sqlMessage?: string;
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.path}`));
}

function fromZod(err: ZodError): ErrorDetail[] {
  return err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
}

function friendlyDuplicate(err: MysqlError): string {
  const key = /for key '(?:[^.']*\.)?([^']+)'/.exec(err.sqlMessage ?? '')?.[1] ?? '';
  const known: Record<string, string> = {
    uq_users_email: 'A user with this email already exists',
    uq_rooms_number: 'A room with this number already exists',
    uq_menu_categories_name: 'A category with this name already exists',
    uq_menu_items_name: 'A menu item with this name already exists',
    uq_inventory_items_name: 'An inventory item with this name already exists',
    uq_bills_booking: 'This booking has already been billed',
    uq_bill_orders_order: 'One of the selected orders has already been billed',
  };
  return known[key] ?? 'A record with the same unique value already exists';
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  if (err instanceof ZodError) {
    return res.status(400).json({ error: { message: 'Validation failed', details: fromZod(err) } });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { message: err.message, details: err.details } });
  }

  const e = err as MysqlError & { type?: string; status?: number };

  if (e.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { message: 'Malformed JSON body' } });
  }

  switch (e.code) {
    case 'ER_DUP_ENTRY':
      return res.status(409).json({ error: { message: friendlyDuplicate(e) } });
    case 'ER_ROW_IS_REFERENCED_2':
      return res.status(409).json({
        error: { message: 'This record is in use by other records and cannot be deleted' },
      });
    case 'ER_NO_REFERENCED_ROW_2':
      return res.status(400).json({ error: { message: 'A referenced record does not exist' } });
    case 'ER_CHECK_CONSTRAINT_VIOLATED':
      return res.status(400).json({ error: { message: 'A value violates a data constraint' } });
    default:
      break;
  }

  console.error(`[${req.method} ${req.originalUrl}]`, err);
  return res.status(500).json({
    error: { message: env.isProd ? 'Internal server error' : e.message || 'Internal server error' },
  });
}
