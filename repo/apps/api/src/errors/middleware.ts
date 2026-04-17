import { Context, Next } from 'koa';
import { AppError, ErrorCodes } from './index';
import { logger } from '../logger';
import { config } from '../config';

export function errorMiddleware() {
  return async (ctx: Context, next: Next): Promise<void> => {
    try {
      await next();
    } catch (err: unknown) {
      if (err instanceof AppError) {
        ctx.status = err.statusCode;
        ctx.body = {
          ok: false,
          error: {
            code: err.code,
            message: err.message,
            ...(err.details ? { details: err.details } : {}),
            ...(config.env === 'development' && err.stack
              ? { stack: err.stack }
              : {}),
          },
        };
        logger.warn({ code: err.code, status: err.statusCode }, err.message);
      } else {
        const error = err instanceof Error ? err : new Error(String(err));
        ctx.status = 500;
        ctx.body = {
          ok: false,
          error: {
            code: ErrorCodes.INTERNAL_ERROR,
            message: 'An unexpected error occurred.',
            ...(config.env === 'development' ? { stack: error.stack } : {}),
          },
        };
        logger.error({ err: error }, 'Unhandled error');
      }
    }
  };
}
