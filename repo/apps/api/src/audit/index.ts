import { Context, Next } from 'koa';
import { appendAuditEvent, verifyChain, repairChain, setAuditKnex, resetAuditKnex, AuditEventInput } from './chain';

export { appendAuditEvent, verifyChain, repairChain, setAuditKnex, resetAuditKnex };
export type { AuditEventInput };

/**
 * Koa middleware that attaches ctx.audit as a bound helper for appending audit events.
 */
export function auditMiddleware() {
  return async (ctx: Context, next: Next): Promise<void> => {
    ctx.audit = (data: AuditEventInput) => appendAuditEvent(data);
    await next();
  };
}

// Augment Koa's Context interface
declare module 'koa' {
  interface DefaultContext {
    audit?: (data: AuditEventInput) => Promise<bigint>;
  }
}
