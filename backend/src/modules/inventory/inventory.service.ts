import type { PoolConnection } from 'mysql2/promise';
import { execute, queryOne } from '../../db/pool';
import { conflict, notFound } from '../../utils/errors';
import { round3 } from '../../utils/money';

export type TransactionType = 'Initial' | 'Stock In' | 'Stock Out' | 'Order Usage';

export interface StockChange {
  itemId: number;
  /** Signed: positive adds stock, negative removes it. */
  change: number;
  type: TransactionType;
  note?: string | null;
  unitCost?: number | null;
  referenceType?: string | null;
  referenceId?: number | null;
  userId?: number | null;
}

interface LockedItem {
  id: number;
  name: string;
  unit: string;
  quantity: number;
  min_stock: number;
}

/**
 * Applies a stock movement inside an existing transaction: locks the item row, validates
 * the resulting quantity, updates the balance and appends an inventory_transactions record.
 */
export async function applyStockChange(conn: PoolConnection, c: StockChange) {
  const item = await queryOne<LockedItem>(
    'SELECT id, name, unit, quantity, min_stock FROM inventory_items WHERE id = ? FOR UPDATE',
    [c.itemId],
    conn,
  );
  if (!item) throw notFound('Inventory item not found');

  const after = round3(item.quantity + c.change);
  if (after < 0) {
    throw conflict(
      `Insufficient stock for "${item.name}": ${item.quantity} ${item.unit} available, ${Math.abs(c.change)} ${item.unit} requested`,
    );
  }

  await execute('UPDATE inventory_items SET quantity = ? WHERE id = ?', [after, item.id], conn);
  await execute(
    `INSERT INTO inventory_transactions
      (inventory_item_id, type, quantity_change, quantity_after, unit_cost, reference_type, reference_id, note, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      c.type,
      c.change,
      after,
      c.unitCost ?? null,
      c.referenceType ?? null,
      c.referenceId ?? null,
      c.note ?? null,
      c.userId ?? null,
    ],
    conn,
  );

  return { id: item.id, name: item.name, unit: item.unit, quantity: after, min_stock: item.min_stock };
}
