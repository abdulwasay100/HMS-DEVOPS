import type { PoolConnection } from 'mysql2/promise';
import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne, withTransaction } from '../../db/pool';
import { authenticate, currentUser } from '../../middleware/auth';
import { badRequest, conflict, notFound } from '../../utils/errors';
import {
  dateString,
  likePattern,
  nullableText,
  optionalText,
  pageMeta,
  paginationSchema,
  parseId,
} from '../../utils/http';
import { nightsBetween, todayString } from '../../utils/dates';
import { round2 } from '../../utils/money';

export const bookingsRouter = Router();
bookingsRouter.use(authenticate);

const BOOKING_STATUSES = ['Reserved', 'Checked-In', 'Checked-Out', 'Cancelled'] as const;

const bookingSchema = z
  .object({
    customer_id: z.coerce.number().int().positive('Select a customer'),
    room_id: z.coerce.number().int().positive('Select a room'),
    check_in: dateString,
    check_out: dateString,
    guests: z.coerce.number().int().min(1, 'At least 1 guest').max(20).default(1),
    notes: nullableText(500),
  })
  .refine((b) => b.check_out > b.check_in, {
    path: ['check_out'],
    message: 'Check-out must be after check-in',
  });

const listSchema = paginationSchema.extend({
  search: optionalText(100),
  status: z.preprocess((v) => (v === '' ? undefined : v), z.enum(BOOKING_STATUSES).optional()),
});

const SELECT_BOOKING = `
  SELECT b.*, c.name AS customer_name, c.phone AS customer_phone,
         r.room_number, r.room_type,
         bl.id AS bill_id
  FROM bookings b
  JOIN customers c ON c.id = b.customer_id
  JOIN rooms r ON r.id = b.room_id
  LEFT JOIN bills bl ON bl.booking_id = b.id`;

async function getBooking(id: number, conn?: PoolConnection) {
  return queryOne(`${SELECT_BOOKING} WHERE b.id = ?`, [id], conn);
}

interface RoomRow {
  id: number;
  room_number: string;
  price_per_night: number;
  capacity: number;
  status: string;
}

/** Locks the room row so concurrent bookings for the same room are serialized. */
async function lockRoom(conn: PoolConnection, roomId: number): Promise<RoomRow> {
  const room = await queryOne<RoomRow>(
    'SELECT id, room_number, price_per_night, capacity, status FROM rooms WHERE id = ? FOR UPDATE',
    [roomId],
    conn,
  );
  if (!room) throw notFound('Room not found');
  return room;
}

async function assertNoOverlap(
  conn: PoolConnection,
  roomId: number,
  checkIn: string,
  checkOut: string,
  excludeBookingId = 0,
) {
  const clash = await queryOne<{ id: number; check_in: string; check_out: string }>(
    `SELECT id, check_in, check_out FROM bookings
     WHERE room_id = ? AND status IN ('Reserved','Checked-In')
       AND check_in < ? AND check_out > ? AND id <> ?
     LIMIT 1`,
    [roomId, checkOut, checkIn, excludeBookingId],
    conn,
  );
  if (clash) {
    throw conflict(
      `Room is already booked from ${clash.check_in} to ${clash.check_out}. Choose different dates or another room.`,
    );
  }
}

async function validateAssignment(
  conn: PoolConnection,
  b: z.infer<typeof bookingSchema>,
  excludeBookingId = 0,
) {
  if (b.check_in < todayString()) {
    throw badRequest('Check-in date cannot be in the past', [
      { path: 'check_in', message: 'Check-in date cannot be in the past' },
    ]);
  }
  const customer = await queryOne('SELECT id FROM customers WHERE id = ?', [b.customer_id], conn);
  if (!customer) throw badRequest('Customer not found', [{ path: 'customer_id', message: 'Customer not found' }]);

  const room = await lockRoom(conn, b.room_id);
  if (room.status === 'Maintenance') {
    throw conflict(`Room ${room.room_number} is under maintenance and cannot be booked`);
  }
  if (b.guests > room.capacity) {
    throw badRequest(`Room ${room.room_number} sleeps at most ${room.capacity} guests`, [
      { path: 'guests', message: `Maximum ${room.capacity} guests for this room` },
    ]);
  }
  await assertNoOverlap(conn, b.room_id, b.check_in, b.check_out, excludeBookingId);
  return room;
}

bookingsRouter.get('/', async (req, res) => {
  const { page, pageSize, search, status } = listSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) {
    where.push('b.status = ?');
    params.push(status);
  }
  if (search) {
    const p = likePattern(search);
    where.push('(c.name LIKE ? OR c.phone LIKE ? OR r.room_number LIKE ?)');
    params.push(p, p, p);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total =
    (
      await queryOne<{ n: number }>(
        `SELECT COUNT(*) AS n FROM bookings b
         JOIN customers c ON c.id = b.customer_id JOIN rooms r ON r.id = b.room_id ${whereSql}`,
        params,
      )
    )?.n ?? 0;

  const rows = await query(
    `${SELECT_BOOKING} ${whereSql} ORDER BY b.check_in DESC, b.id DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, (page - 1) * pageSize],
  );
  res.json({ data: rows, meta: pageMeta(page, pageSize, total) });
});

bookingsRouter.get('/:id', async (req, res) => {
  const booking = await getBooking(parseId(req.params.id));
  if (!booking) throw notFound('Booking not found');
  res.json({ data: booking });
});

bookingsRouter.post('/', async (req, res) => {
  const b = bookingSchema.parse(req.body);
  const user = currentUser(req);

  const id = await withTransaction(async (conn) => {
    const room = await validateAssignment(conn, b);
    const nights = nightsBetween(b.check_in, b.check_out);
    const result = await execute(
      `INSERT INTO bookings
        (customer_id, room_id, check_in, check_out, guests, status, price_per_night, total_amount, notes, created_by)
       VALUES (?, ?, ?, ?, ?, 'Reserved', ?, ?, ?, ?)`,
      [
        b.customer_id,
        b.room_id,
        b.check_in,
        b.check_out,
        b.guests,
        room.price_per_night,
        round2(nights * room.price_per_night),
        b.notes,
        user.id,
      ],
      conn,
    );
    return result.insertId;
  });

  res.status(201).json({ data: await getBooking(id) });
});

bookingsRouter.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  const b = bookingSchema.parse(req.body);

  await withTransaction(async (conn) => {
    const existing = await queryOne<{ status: string }>(
      'SELECT status FROM bookings WHERE id = ? FOR UPDATE',
      [id],
      conn,
    );
    if (!existing) throw notFound('Booking not found');
    if (existing.status !== 'Reserved') throw conflict('Only reserved bookings can be edited');

    const room = await validateAssignment(conn, b, id);
    const nights = nightsBetween(b.check_in, b.check_out);
    await execute(
      `UPDATE bookings SET customer_id = ?, room_id = ?, check_in = ?, check_out = ?, guests = ?,
         price_per_night = ?, total_amount = ?, notes = ? WHERE id = ?`,
      [
        b.customer_id,
        b.room_id,
        b.check_in,
        b.check_out,
        b.guests,
        room.price_per_night,
        round2(nights * room.price_per_night),
        b.notes,
        id,
      ],
      conn,
    );
  });

  res.json({ data: await getBooking(id) });
});

bookingsRouter.patch('/:id/status', async (req, res) => {
  const id = parseId(req.params.id);
  const { status } = z.object({ status: z.enum(['Checked-In', 'Checked-Out', 'Cancelled']) }).parse(req.body);

  await withTransaction(async (conn) => {
    const booking = await queryOne<{ status: string; room_id: number; check_in: string }>(
      'SELECT status, room_id, check_in FROM bookings WHERE id = ? FOR UPDATE',
      [id],
      conn,
    );
    if (!booking) throw notFound('Booking not found');

    if (status === 'Checked-In') {
      if (booking.status !== 'Reserved') throw conflict('Only reserved bookings can be checked in');
      if (booking.check_in > todayString()) {
        throw conflict(`Guest cannot check in before the arrival date (${booking.check_in})`);
      }
      const room = await lockRoom(conn, booking.room_id);
      if (room.status !== 'Available') {
        throw conflict(`Room ${room.room_number} is ${room.status.toLowerCase()} and not ready for check-in`);
      }
      await execute("UPDATE rooms SET status = 'Occupied' WHERE id = ?", [booking.room_id], conn);
      await execute("UPDATE bookings SET status = 'Checked-In', actual_check_in = UTC_TIMESTAMP() WHERE id = ?", [id], conn);
    } else if (status === 'Checked-Out') {
      if (booking.status !== 'Checked-In') throw conflict('Only checked-in bookings can be checked out');
      await lockRoom(conn, booking.room_id);
      await execute("UPDATE rooms SET status = 'Cleaning' WHERE id = ? AND status = 'Occupied'", [booking.room_id], conn);
      await execute("UPDATE bookings SET status = 'Checked-Out', actual_check_out = UTC_TIMESTAMP() WHERE id = ?", [id], conn);
    } else {
      if (booking.status !== 'Reserved') throw conflict('Only reserved bookings can be cancelled');
      await execute("UPDATE bookings SET status = 'Cancelled' WHERE id = ?", [id], conn);
    }
  });

  res.json({ data: await getBooking(id) });
});
