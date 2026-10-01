import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env';
import { pool } from './db/pool';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authRouter } from './modules/auth/auth.routes';
import { billingRouter } from './modules/billing/billing.routes';
import { bookingsRouter } from './modules/bookings/bookings.routes';
import { customersRouter } from './modules/customers/customers.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { menuRouter } from './modules/menu/menu.routes';
import { ordersRouter } from './modules/orders/orders.routes';
import { reportsRouter } from './modules/reports/reports.routes';
import { roomsRouter } from './modules/rooms/rooms.routes';
import { usersRouter } from './modules/users/users.routes';

export function createApp() {
  const app = express();

  // Behind a load balancer (Cloud Run / GCLB) the client IP comes from X-Forwarded-For.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => {
        if (!origin || env.corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  if (env.nodeEnv !== 'test') app.use(morgan(env.isProd ? 'combined' : 'dev'));

  // Liveness: process is up. Readiness: database reachable.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/health/ready', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'database unavailable' });
    }
  });

  const api = express.Router();
  api.get('/config', (_req, res) => {
    res.json({
      data: {
        hotelName: env.hotel.name,
        hotelAddress: env.hotel.address,
        hotelPhone: env.hotel.phone,
        hotelEmail: env.hotel.email,
        currency: env.hotel.currency,
        taxRatePercent: env.hotel.taxRatePercent,
      },
    });
  });
  api.use('/auth', authRouter);
  api.use('/users', usersRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/rooms', roomsRouter);
  api.use('/customers', customersRouter);
  api.use('/bookings', bookingsRouter);
  api.use('/menu', menuRouter);
  api.use('/inventory', inventoryRouter);
  api.use('/orders', ordersRouter);
  api.use('/bills', billingRouter);
  api.use('/reports', reportsRouter);
  app.use('/api', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
