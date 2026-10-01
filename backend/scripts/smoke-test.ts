/**
 * End-to-end smoke test against a RUNNING API. It creates real records, so only run it against a
 * development/test database.
 *
 *   API_URL=http://localhost:4000 SMOKE_EMAIL=admin@example.com SMOKE_PASSWORD=... npm run smoke
 */
import assert from 'node:assert/strict';

const BASE = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '') + '/api';
const EMAIL = process.env.SMOKE_EMAIL;
const PASSWORD = process.env.SMOKE_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error('Set SMOKE_EMAIL and SMOKE_PASSWORD (an admin account).');
  process.exit(1);
}

type Json = any;

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  const json: Json = text ? JSON.parse(text) : null;
  return { status: res.status, json };
}

let passed = 0;
async function step(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return fmt(d);
};

async function main() {
  const suffix = Date.now().toString().slice(-6);
  let token = '';
  let customerId = 0;
  let roomId = 0;
  let bookingId = 0;
  let orderId = 0;
  let billId = 0;
  let staffToken = '';
  const stock = async (name: string) => {
    const r = await call('GET', `/inventory?search=${encodeURIComponent(name)}`, { token });
    return r.json.data.find((i: Json) => i.name === name);
  };

  console.log(`Smoke testing ${BASE}`);

  await step('login + /auth/me', async () => {
    const bad = await call('POST', '/auth/login', { body: { email: EMAIL, password: 'definitely-wrong' } });
    assert.equal(bad.status, 401);
    const r = await call('POST', '/auth/login', { body: { email: EMAIL, password: PASSWORD } });
    assert.equal(r.status, 200);
    token = r.json.data.token;
    const me = await call('GET', '/auth/me', { token });
    assert.equal(me.json.data.role, 'admin');
    assert.equal((await call('GET', '/rooms')).status, 401);
  });

  await step('validation errors are structured', async () => {
    const r = await call('POST', '/customers', { token, body: { name: 'A', phone: 'abc' } });
    assert.equal(r.status, 400);
    assert.ok(Array.isArray(r.json.error.details) && r.json.error.details.length >= 2);
  });

  await step('create customer', async () => {
    const r = await call('POST', '/customers', {
      token,
      body: { name: `Smoke Guest ${suffix}`, phone: '+1 555 010 0000', email: `smoke${suffix}@example.com` },
    });
    assert.equal(r.status, 201);
    customerId = r.json.data.id;
  });

  await step('booking + double-booking prevention', async () => {
    const rooms = await call('GET', `/rooms/available?check_in=${addDays(0)}&check_out=${addDays(2)}`, { token });
    const room = rooms.json.data.find((r: Json) => r.status === 'Available');
    assert.ok(room, 'no available room');
    roomId = room.id;

    const b = await call('POST', '/bookings', {
      token,
      body: { customer_id: customerId, room_id: roomId, check_in: addDays(0), check_out: addDays(2), guests: 1 },
    });
    assert.equal(b.status, 201, JSON.stringify(b.json));
    bookingId = b.json.data.id;
    assert.equal(b.json.data.total_amount, room.price_per_night * 2);

    const overlap = await call('POST', '/bookings', {
      token,
      body: { customer_id: customerId, room_id: roomId, check_in: addDays(1), check_out: addDays(3), guests: 1 },
    });
    assert.equal(overlap.status, 409);

    // Back-to-back stay (check-in on the previous check-out day) is allowed.
    const adjacent = await call('POST', '/bookings', {
      token,
      body: { customer_id: customerId, room_id: roomId, check_in: addDays(2), check_out: addDays(3), guests: 1 },
    });
    assert.equal(adjacent.status, 201);
    await call('PATCH', `/bookings/${adjacent.json.data.id}/status`, { token, body: { status: 'Cancelled' } });
  });

  await step('check-in / check-out updates room status', async () => {
    let r = await call('PATCH', `/bookings/${bookingId}/status`, { token, body: { status: 'Checked-In' } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    let room = (await call('GET', '/rooms', { token })).json.data.find((x: Json) => x.id === roomId);
    assert.equal(room.status, 'Occupied');
    r = await call('PATCH', `/bookings/${bookingId}/status`, { token, body: { status: 'Checked-Out' } });
    assert.equal(r.status, 200);
    room = (await call('GET', '/rooms', { token })).json.data.find((x: Json) => x.id === roomId);
    assert.equal(room.status, 'Cleaning');
    await call('PATCH', `/rooms/${roomId}/status`, { token, body: { status: 'Available' } });
  });

  await step('order totals + automatic inventory deduction', async () => {
    const menu = (await call('GET', '/menu/items', { token })).json.data;
    const burger = menu.find((m: Json) => m.name === 'Chicken Burger');
    const fries = menu.find((m: Json) => m.name === 'French Fries');
    assert.ok(burger && fries, 'demo menu missing - run npm run seed:demo');

    const before = { chicken: await stock('Chicken'), bun: await stock('Burger Bun'), sauce: await stock('Special Sauce') };

    const o = await call('POST', '/orders', {
      token,
      body: {
        customer_id: customerId,
        items: [
          { menu_item_id: burger.id, quantity: 2 },
          { menu_item_id: fries.id, quantity: 1 },
        ],
        discount: 1,
      },
    });
    assert.equal(o.status, 201, JSON.stringify(o.json));
    orderId = o.json.data.id;
    assert.equal(o.json.data.subtotal, burger.price * 2 + fries.price);
    const taxRate = o.json.data.tax_rate;
    const expectedTax = Math.round((o.json.data.subtotal - 1) * taxRate) / 100;
    assert.equal(o.json.data.tax, expectedTax);

    assert.equal((await stock('Chicken')).quantity, before.chicken.quantity, 'pending order must not deduct');
    const done = await call('PATCH', `/orders/${orderId}/status`, { token, body: { status: 'Completed' } });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.equal((await stock('Chicken')).quantity, before.chicken.quantity - 2);
    assert.equal((await stock('Burger Bun')).quantity, before.bun.quantity - 2);
    assert.equal((await stock('Special Sauce')).quantity, before.sauce.quantity - 2);

    const again = await call('PATCH', `/orders/${orderId}/status`, { token, body: { status: 'Cancelled' } });
    assert.equal(again.status, 409, 'completed orders are final');

    const tx = await call('GET', `/inventory/transactions?item_id=${before.chicken.id}&type=Order%20Usage`, { token });
    assert.ok(tx.json.data.length >= 1);
  });

  await step('insufficient stock blocks completion and rolls back', async () => {
    const menu = (await call('GET', '/menu/items', { token })).json.data;
    const burger = menu.find((m: Json) => m.name === 'Chicken Burger');
    const bunBefore = (await stock('Burger Bun')).quantity;
    const o = await call('POST', '/orders', { token, body: { items: [{ menu_item_id: burger.id, quantity: 999 }] } });
    assert.equal(o.status, 201);
    const r = await call('PATCH', `/orders/${o.json.data.id}/status`, { token, body: { status: 'Completed' } });
    assert.equal(r.status, 409);
    assert.equal((await stock('Burger Bun')).quantity, bunBefore);
    const cancelled = await call('PATCH', `/orders/${o.json.data.id}/status`, { token, body: { status: 'Cancelled' } });
    assert.equal(cancelled.status, 200);
  });

  await step('low-stock warning is returned', async () => {
    const water = await stock('Bottled Water');
    const menu = (await call('GET', '/menu/items', { token })).json.data;
    const item = menu.find((m: Json) => m.name === 'Bottled Water');
    const target = water.min_stock; // drop to exactly min stock
    const excess = Math.max(0, water.quantity - target);
    if (excess > 0) {
      const r = await call('POST', `/inventory/${water.id}/adjust`, {
        token,
        body: { type: 'Stock Out', quantity: excess, note: 'smoke test' },
      });
      assert.equal(r.status, 200);
    }
    const o = await call('POST', '/orders', { token, body: { items: [{ menu_item_id: item.id, quantity: 1 }] } });
    const done = await call('PATCH', `/orders/${o.json.data.id}/status`, { token, body: { status: 'Completed' } });
    assert.equal(done.status, 200, JSON.stringify(done.json));
    assert.ok(done.json.low_stock.some((i: Json) => i.name === 'Bottled Water'));
    const low = await call('GET', '/inventory/low-stock', { token });
    assert.ok(low.json.data.some((i: Json) => i.name === 'Bottled Water'));
  });

  await step('billing: room + food, discount, tax, partial then full payment', async () => {
    const unbilled = await call('GET', `/bills/unbilled?customer_id=${customerId}`, { token });
    assert.ok(unbilled.json.data.bookings.some((b: Json) => b.id === bookingId));
    assert.ok(unbilled.json.data.orders.some((o: Json) => o.id === orderId));

    const order = (await call('GET', `/orders/${orderId}`, { token })).json.data;
    const booking = (await call('GET', `/bookings/${bookingId}`, { token })).json.data;

    const created = await call('POST', '/bills', {
      token,
      body: {
        customer_id: customerId,
        booking_id: bookingId,
        order_ids: [orderId],
        discount: 10,
        payment_method: 'Cash',
        amount_paid: 50,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const bill = created.json.data;
    billId = bill.id;
    const subtotal = booking.total_amount + order.subtotal;
    const tax = Math.round((subtotal - 10) * bill.tax_rate) / 100;
    assert.equal(bill.subtotal, subtotal);
    assert.equal(bill.tax, tax);
    assert.equal(bill.grand_total, Math.round((subtotal - 10 + tax) * 100) / 100);
    assert.equal(bill.payment_status, 'Partial');
    assert.ok(bill.items.some((i: Json) => i.item_type === 'Room') && bill.items.some((i: Json) => i.item_type === 'Food'));

    const dup = await call('POST', '/bills', { token, body: { booking_id: bookingId } });
    assert.equal(dup.status, 409, 'booking cannot be billed twice');
    const dupOrder = await call('POST', '/bills', { token, body: { order_ids: [orderId] } });
    assert.equal(dupOrder.status, 409, 'order cannot be billed twice');

    const over = await call('POST', `/bills/${billId}/payments`, {
      token,
      body: { payment_method: 'Card', amount: bill.grand_total },
    });
    assert.equal(over.status, 400, 'overpayment rejected');
    const paid = await call('POST', `/bills/${billId}/payments`, {
      token,
      body: { payment_method: 'Card', amount: Math.round((bill.grand_total - 50) * 100) / 100 },
    });
    assert.equal(paid.status, 200, JSON.stringify(paid.json));
    assert.equal(paid.json.data.payment_status, 'Paid');
    assert.equal(paid.json.data.balance_due, 0);
    assert.equal((await call('DELETE', `/bills/${billId}`, { token })).status, 409, 'paid bills are protected');
  });

  await step('dashboard, customer history and reports respond', async () => {
    const dash = await call('GET', '/dashboard', { token });
    assert.equal(dash.status, 200);
    assert.ok(dash.json.data.sales.bills_count >= 1);
    const cust = await call('GET', `/customers/${customerId}`, { token });
    assert.ok(cust.json.data.bookings.length >= 1 && cust.json.data.orders.length >= 1 && cust.json.data.bills.length >= 1);
    for (const p of ['sales?period=daily', 'sales?period=weekly', 'sales?period=monthly', 'top-items', 'inventory-usage', 'low-stock', 'occupancy', 'revenue-summary']) {
      const r = await call('GET', `/reports/${p}`, { token });
      assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.json)}`);
    }
    const top = await call('GET', '/reports/top-items', { token });
    assert.ok(top.json.data.some((i: Json) => i.item_name === 'Chicken Burger'));
  });

  await step('role permissions', async () => {
    const email = `staff${suffix}@example.com`;
    const pw = `Sm0ke-${suffix}-pw!`;
    const created = await call('POST', '/users', { token, body: { name: 'Smoke Staff', email, password: pw, role: 'staff' } });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const login = await call('POST', '/auth/login', { body: { email, password: pw } });
    staffToken = login.json.data.token;
    assert.equal((await call('GET', '/rooms', { token: staffToken })).status, 200);
    assert.equal((await call('POST', '/rooms', { token: staffToken, body: { room_number: 'X1', room_type: 'Single', price_per_night: 10 } })).status, 403);
    assert.equal((await call('GET', '/users', { token: staffToken })).status, 403);
    assert.equal((await call('GET', '/reports/sales', { token: staffToken })).status, 403);
    assert.equal((await call('DELETE', `/bills/${billId}`, { token: staffToken })).status, 403);
    assert.equal((await call('POST', `/inventory/1/adjust`, { token: staffToken, body: { type: 'Stock In', quantity: 1 } })).status, 403);
    await call('PUT', `/users/${created.json.data.id}`, {
      token,
      body: { name: 'Smoke Staff', email, role: 'staff', is_active: false },
    });
    assert.equal((await call('GET', '/rooms', { token: staffToken })).status, 401, 'deactivated user is locked out');
    await call('DELETE', `/users/${created.json.data.id}`, { token });
  });

  console.log(`\nAll ${passed} smoke checks passed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
