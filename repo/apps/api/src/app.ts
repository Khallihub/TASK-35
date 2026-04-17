import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import { errorMiddleware } from './errors/middleware';
import { mountRoutes } from './routes';
import { csrfMiddleware } from './middleware/csrf';
import { ipRateLimitMiddleware } from './middleware/ipRateLimit';
import { idempotencyMiddleware } from './middleware/idempotency';
import { logger } from './logger';
import { config } from './config';

if (config.jwt.secret === 'CHANGE_ME_BEFORE_GOING_LIVE_32chars') {
  logger.warn('JWT secret is set to the default value. Change JWT_SECRET in production!');
}

export function createApp(): Koa {
  const app = new Koa();
  app.use(errorMiddleware());
  app.use(ipRateLimitMiddleware());
  app.use(bodyParser());
  app.use(csrfMiddleware());
  app.use(idempotencyMiddleware());
  mountRoutes(app);
  return app;
}
