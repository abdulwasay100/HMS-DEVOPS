import { execute, pool, queryOne, withTransaction } from './pool';
import { applyStockChange } from '../modules/inventory/inventory.service';

/**
 * Optional sample data (rooms, menu, recipes, inventory) so a fresh install is usable immediately.
 * Creates no users and no credentials. Safe to run repeatedly: each block is skipped if data exists.
 */

const ROOMS: Array<[string, string, number, number]> = [
  ['101', 'Single', 60, 1],
  ['102', 'Single', 60, 2],
  ['103', 'Single', 60, 2],
  ['201', 'Double', 90, 2],
  ['202', 'Double', 90, 3],
  ['203', 'Double', 90, 3],
  ['204', 'Double', 90, 3],
  ['301', 'Deluxe', 140, 3],
  ['302', 'Deluxe', 140, 3],
  ['401', 'Suite', 250, 4],
];

// name, category, quantity, unit, min_stock, purchase_price, supplier
const INVENTORY: Array<[string, string, number, string, number, number, string]> = [
  ['Chicken', 'Meat', 40, 'pcs', 10, 1.8, 'Fresh Farms Ltd'],
  ['Beef Patty', 'Meat', 40, 'pcs', 10, 2.2, 'Fresh Farms Ltd'],
  ['Burger Bun', 'Bakery', 60, 'pcs', 15, 0.4, 'City Bakery'],
  ['Special Sauce', 'Condiments', 80, 'portion', 20, 0.15, 'Sauce Co.'],
  ['Cheese Slice', 'Dairy', 60, 'pcs', 15, 0.25, 'Dairy Direct'],
  ['Lettuce', 'Produce', 5, 'kg', 1, 2.5, 'Green Market'],
  ['Tomato', 'Produce', 6, 'kg', 2, 1.8, 'Green Market'],
  ['Potatoes', 'Produce', 30, 'kg', 8, 0.9, 'Green Market'],
  ['Basmati Rice', 'Dry Goods', 25, 'kg', 5, 2.1, 'Grain House'],
  ['Spaghetti', 'Dry Goods', 12, 'kg', 3, 1.9, 'Grain House'],
  ['Tomato Sauce', 'Condiments', 10, 'l', 3, 2.4, 'Sauce Co.'],
  ['Cooking Oil', 'Dry Goods', 20, 'l', 5, 2.2, 'Grain House'],
  ['Coffee Beans', 'Beverages', 4, 'kg', 1, 14, 'Roast & Co'],
  ['Milk', 'Dairy', 20, 'l', 5, 1.1, 'Dairy Direct'],
  ['Bottled Water', 'Beverages', 100, 'bottle', 24, 0.3, 'AquaPure'],
  ['Cola Can', 'Beverages', 80, 'can', 24, 0.5, 'Fizz Distributors'],
];

// category, name, price, description, recipe [[inventory name, qty]]
type MenuSeed = [string, string, number, string, Array<[string, number]>];
const MENU: MenuSeed[] = [
  ['Burgers', 'Chicken Burger', 8.5, 'Grilled chicken with special sauce', [['Chicken', 1], ['Burger Bun', 1], ['Special Sauce', 1]]],
  ['Burgers', 'Beef Burger', 9.5, 'Beef patty, cheese and special sauce', [['Beef Patty', 1], ['Burger Bun', 1], ['Cheese Slice', 1], ['Special Sauce', 1]]],
  ['Main Course', 'Chicken Biryani', 12, 'Spiced rice with tender chicken', [['Chicken', 1], ['Basmati Rice', 0.25]]],
  ['Main Course', 'Spaghetti Bolognese', 11, 'Classic tomato and herb sauce', [['Spaghetti', 0.15], ['Tomato Sauce', 0.1]]],
  ['Sides', 'French Fries', 4, 'Crispy golden fries', [['Potatoes', 0.3], ['Cooking Oil', 0.05]]],
  ['Salads', 'Garden Salad', 6, 'Fresh lettuce and tomato', [['Lettuce', 0.15], ['Tomato', 0.1]]],
  ['Beverages', 'Coffee', 3.5, 'Freshly brewed with milk', [['Coffee Beans', 0.02], ['Milk', 0.15]]],
  ['Beverages', 'Bottled Water', 1, '500ml', [['Bottled Water', 1]]],
  ['Beverages', 'Cola', 1.5, '330ml can', [['Cola Can', 1]]],
];

async function count(table: string): Promise<number> {
  return (await queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`))?.n ?? 0;
}

async function main() {
  if ((await count('rooms')) === 0) {
    await execute('INSERT INTO rooms (room_number, room_type, price_per_night, capacity) VALUES ?', [ROOMS]);
    console.log(`Added ${ROOMS.length} rooms`);
  }

  const inventoryIds = new Map<string, number>();
  if ((await count('inventory_items')) === 0) {
    await withTransaction(async (conn) => {
      for (const [name, category, quantity, unit, min, price, supplier] of INVENTORY) {
        const r = await execute(
          'INSERT INTO inventory_items (name, category, quantity, unit, min_stock, purchase_price, supplier) VALUES (?, ?, 0, ?, ?, ?, ?)',
          [name, category, unit, min, price, supplier],
          conn,
        );
        inventoryIds.set(name, r.insertId);
        await applyStockChange(conn, {
          itemId: r.insertId,
          change: quantity,
          type: 'Initial',
          note: 'Opening balance (demo data)',
          unitCost: price,
        });
      }
    });
    console.log(`Added ${INVENTORY.length} inventory items`);
  }

  if ((await count('menu_items')) === 0) {
    if (inventoryIds.size === 0) {
      const rows = await pool.query('SELECT id, name FROM inventory_items');
      for (const r of rows[0] as Array<{ id: number; name: string }>) inventoryIds.set(r.name, r.id);
    }
    await withTransaction(async (conn) => {
      const categoryIds = new Map<string, number>();
      for (const [category, name, price, description, recipe] of MENU) {
        if (!categoryIds.has(category)) {
          const c = await execute('INSERT INTO menu_categories (name) VALUES (?)', [category], conn);
          categoryIds.set(category, c.insertId);
        }
        const item = await execute(
          'INSERT INTO menu_items (category_id, name, description, price) VALUES (?, ?, ?, ?)',
          [categoryIds.get(category), name, description, price],
          conn,
        );
        const ingredients = recipe
          .filter(([inv]) => inventoryIds.has(inv))
          .map(([inv, qty]) => [item.insertId, inventoryIds.get(inv), qty]);
        if (ingredients.length) {
          await execute('INSERT INTO menu_item_ingredients (menu_item_id, inventory_item_id, quantity) VALUES ?', [ingredients], conn);
        }
      }
    });
    console.log(`Added ${MENU.length} menu items with recipes`);
  }

  console.log('Demo data ready.');
}

main()
  .catch((err) => {
    console.error('Demo seed failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
