import Koa from 'koa';
import healthRouter from './health';
import authRouter from './auth';
import usersRouter from './users';
import officesRouter from './offices';
import listingsRouter from './listings';
import attachmentsRouter from './attachments';
import promoRouter from './promo';
import analyticsRouter from './analytics';
import adminRouter from './admin';

export function mountRoutes(app: Koa): void {
  app.use(healthRouter.routes());
  app.use(healthRouter.allowedMethods());
  app.use(authRouter.routes());
  app.use(authRouter.allowedMethods());
  app.use(usersRouter.routes());
  app.use(usersRouter.allowedMethods());
  app.use(officesRouter.routes());
  app.use(officesRouter.allowedMethods());
  app.use(listingsRouter.routes());
  app.use(listingsRouter.allowedMethods());
  app.use(attachmentsRouter.routes());
  app.use(attachmentsRouter.allowedMethods());
  app.use(promoRouter.routes());
  app.use(promoRouter.allowedMethods());
  app.use(analyticsRouter.routes());
  app.use(analyticsRouter.allowedMethods());
  app.use(adminRouter.routes());
  app.use(adminRouter.allowedMethods());
}
