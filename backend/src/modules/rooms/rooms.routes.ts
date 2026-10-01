import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne } from '../../db/pool';
import { authenticate, managerUp } from '../../middleware/auth';
import { badRequest, notFound } from '../../utils/errors';
import { dateString, nullableText, parseId } from '../../utils/http';

export const roomsRouter = Router();
roomsRouter.use(authenticate);

const ROOM_STATUSES = ['Available', 'Occupied', 'Cleaning', 'Maintenance'] as const;

const roomSchema = z.object({
  room_number: z.string().trim().min(1, 'Room number is required').max(20),
  room_type: z.string().trim().min(1, 'Room type is required').max(50),
  price_per_night: z.coerce.number().min(0, 'Price cannot be negative').max(9_999_999),
  capacity: z.coerce.number().int().min(1).max(20).default(2),
  status: z.enum(ROOM_STATUSES).default('Available'),
  notes: nullableText(255),
});

const availabilitySchema = z.object({
  check_in: dateString,
  check_out: dateString,
  exclude_booking_id: z.coerce.number().int().positive().optional(),
});

roomsRouter.get('/', async (_req, res) => {
  const rooms = await query(`
    SELECT r.*,
      (SELECT c.name FROM bookings b JOIN customers c ON c.id = b.customer_id
        WHERE b.room_id = r.id AND b.status = 'Checked-In' LIMIT 1) AS current_guest
    FROM rooms r
    ORDER BY r.room_number
  `);
  res.json({ data: rooms });
});

roomsRouter.get('/available', async (req, res) => {
  const q = availabilitySchema.parse(req.query);
  if (q.check_out <= q.check_in) throw badRequest('Check-out must be after check-in');

  const rooms = await query(
    `SELECT r.* FROM rooms r
     WHERE r.status <> 'Maintenance'
       AND NOT EXISTS (
         SELECT 1 FROM bookings b
         WHERE b.room_id = r.id
           AND b.status IN ('Reserved','Checked-In')
           AND b.check_in < ? AND b.check_out > ?
           AND (? IS NULL OR b.id <> ?)
       )
     ORDER BY r.room_number`,
    [q.check_out, q.check_in, q.exclude_booking_id ?? null, q.exclude_booking_id ?? null],
  );
  res.json({ data: rooms });
});

roomsRouter.post('/', managerUp, async (req, res) => {
  const b = roomSchema.parse(req.body);
  const result = await execute(
    'INSERT INTO rooms (room_number, room_type, price_per_night, capacity, status, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [b.room_number, b.room_type, b.price_per_night, b.capacity, b.status, b.notes],
  );
  res.status(201).json({ data: await queryOne('SELECT * FROM rooms WHERE id = ?', [result.insertId]) });
});

roomsRouter.put('/:id', managerUp, async (req, res) => {
  const id = parseId(req.params.id);
  const b = roomSchema.parse(req.body);
  const result = await execute(
    `UPDATE rooms SET room_number = ?, room_type = ?, price_per_night = ?, capacity = ?, status = ?, notes = ?
     WHERE id = ?`,
    [b.room_number, b.room_type, b.price_per_night, b.capacity, b.status, b.notes, id],
  );
  if (result.affectedRows === 0) throw notFound('Room not found');
  res.json({ data: await queryOne('SELECT * FROM rooms WHERE id = ?', [id]) });
});

// Housekeeping/front desk can change status without full edit rights.
roomsRouter.patch('/:id/status', async (req, res) => {
  const id = parseId(req.params.id);
  const { status } = z.object({ status: z.enum(ROOM_STATUSES) }).parse(req.body);
  const result = await execute('UPDATE rooms SET status = ? WHERE id = ?', [status, id]);
  if (result.affectedRows === 0) throw notFound('Room not found');
  res.json({ data: await queryOne('SELECT * FROM rooms WHERE id = ?', [id]) });
});

roomsRouter.delete('/:id', managerUp, async (req, res) => {
  const id = parseId(req.params.id);
  const result = await execute('DELETE FROM rooms WHERE id = ?', [id]);
  if (result.affectedRows === 0) throw notFound('Room not found');
  res.status(204).end();
});
