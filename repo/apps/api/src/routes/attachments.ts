import Router from 'koa-router';
import multer = require('@koa/multer');
import { AppError, ErrorCodes } from '../errors';
import { requireAuth, requireConsent } from '../middleware/auth';
import {
  uploadAttachment,
  replaceAttachment,
  getAttachments,
  softDeleteAttachment,
  getRevisions,
  rollbackAttachment,
  getRejections,
  toPublicAttachment,
} from '../services/attachment';
import { Attachment } from '../types/attachment';
import { systemClock } from '../clock';
import { UserRole } from '../services/listingStateMachine';

const router = new Router({ prefix: '/api/v1/listings/:listingId/attachments' });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 201 * 1024 * 1024, files: 1 },
});

function getClientIp(ctx: Router.RouterContext): string {
  const forwarded = ctx.get('X-Forwarded-For');
  if (forwarded) return forwarded.split(',')[0].trim();
  return ctx.ip ?? 'unknown';
}

function getActor(ctx: Router.RouterContext) {
  const user = ctx.state.user;
  return {
    id: Number(user.id),
    role: user.role as UserRole,
    officeId: user.officeId ? Number(user.officeId) : null,
  };
}

// POST /api/v1/listings/:listingId/attachments
router.post(
  '/',
  requireAuth(),
  requireConsent(),
  upload.single('file'),
  async (ctx) => {
    const actor = getActor(ctx);
    const listingId = parseInt(ctx.params.listingId, 10);
    if (isNaN(listingId)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);
    }

    // @koa/multer places the uploaded file on ctx.file
    const ctxAny = ctx as unknown as Record<string, unknown>;
    const file = ctxAny.file as {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    } | undefined;
    if (!file) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'No file uploaded', 400);
    }

    const ip = getClientIp(ctx);

    const result = await uploadAttachment({
      listingId,
      actor,
      file: {
        buffer: file.buffer,
        originalname: file.originalname,
        size: file.size,
      },
      ip,
    });

    if ('rejected' in result && result.rejected) {
      ctx.status = 422;
      ctx.body = {
        ok: false,
        error: {
          code: ErrorCodes.ATTACHMENT_REJECTED,
          message: `Attachment rejected: ${result.rejectionCode}`,
          details: {
            rejectionCode: result.rejectionCode,
            rejectionDetail: result.rejectionDetail,
          },
        },
      };
      return;
    }

    const uploadResult = result as { attachment: Attachment; duplicate: boolean };
    // Strip internal storage metadata — see toPublicAttachment.
    const publicAtt = toPublicAttachment(uploadResult.attachment);

    if (uploadResult.duplicate) {
      ctx.status = 200;
      ctx.body = { ok: true, data: { attachment: publicAtt, duplicate: true } };
    } else {
      ctx.status = 201;
      ctx.body = { ok: true, data: { attachment: publicAtt, duplicate: false } };
    }
  },
);

// GET /api/v1/listings/:listingId/attachments
router.get('/', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const listingId = parseInt(ctx.params.listingId, 10);
  if (isNaN(listingId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);
  }

  const attachments = await getAttachments(listingId, actor);

  ctx.status = 200;
  // Strip internal storage metadata per attachment before returning the list.
  ctx.body = { ok: true, data: attachments.map(toPublicAttachment) };
});

// PUT /api/v1/listings/:listingId/attachments/:id — replace attachment content (new revision)
router.put(
  '/:id',
  requireAuth(),
  requireConsent(),
  upload.single('file'),
  async (ctx) => {
    const actor = getActor(ctx);
    const listingId = parseInt(ctx.params.listingId, 10);
    const attachmentId = parseInt(ctx.params.id, 10);

    if (isNaN(listingId) || isNaN(attachmentId)) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid id', 400);
    }

    const ctxAny = ctx as unknown as Record<string, unknown>;
    const file = ctxAny.file as {
      fieldname: string;
      originalname: string;
      encoding: string;
      mimetype: string;
      size: number;
      buffer: Buffer;
    } | undefined;
    if (!file) {
      throw new AppError(ErrorCodes.VALIDATION_ERROR, 'No file uploaded', 400);
    }

    const ip = getClientIp(ctx);

    const result = await replaceAttachment({
      attachmentId,
      actor,
      file: {
        buffer: file.buffer,
        originalname: file.originalname,
        size: file.size,
      },
      ip,
    });

    if ('rejected' in result && result.rejected) {
      ctx.status = 422;
      ctx.body = {
        ok: false,
        error: {
          code: ErrorCodes.ATTACHMENT_REJECTED,
          message: `Attachment rejected: ${result.rejectionCode}`,
          details: {
            rejectionCode: result.rejectionCode,
            rejectionDetail: result.rejectionDetail,
          },
        },
      };
      return;
    }

    const uploadResult = result as { attachment: Attachment; duplicate: boolean };
    ctx.status = 200;
    ctx.body = { ok: true, data: { attachment: toPublicAttachment(uploadResult.attachment) } };
  },
);

// DELETE /api/v1/listings/:listingId/attachments/:id
router.delete('/:id', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const listingId = parseInt(ctx.params.listingId, 10);
  const attachmentId = parseInt(ctx.params.id, 10);

  if (isNaN(listingId) || isNaN(attachmentId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid id', 400);
  }

  const ip = getClientIp(ctx);

  await softDeleteAttachment(attachmentId, actor, ip, undefined, systemClock);

  ctx.status = 200;
  ctx.body = { ok: true };
});

// GET /api/v1/listings/:listingId/attachments/:id/revisions
// Tiered access — only rollback-capable roles (merchant own_office, admin)
// may see revision history. Defense-in-depth: the role check is also
// enforced inside getRevisions.
router.get('/:id/revisions', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const attachmentId = parseInt(ctx.params.id, 10);

  if (isNaN(attachmentId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid attachment id', 400);
  }

  if (actor.role !== 'merchant' && actor.role !== 'administrator') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Only merchant or administrator can view revisions', 403);
  }

  const revisions = await getRevisions(attachmentId, actor);

  ctx.status = 200;
  ctx.body = { ok: true, data: revisions };
});

// POST /api/v1/listings/:listingId/attachments/:id/rollback
router.post('/:id/rollback', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const listingId = parseInt(ctx.params.listingId, 10);
  const attachmentId = parseInt(ctx.params.id, 10);

  if (isNaN(listingId) || isNaN(attachmentId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid id', 400);
  }

  if (actor.role !== 'merchant' && actor.role !== 'administrator') {
    throw new AppError(ErrorCodes.FORBIDDEN, 'Only merchant or administrator can rollback', 403);
  }

  const body = ctx.request.body as { revisionNo?: number };
  if (!body.revisionNo || isNaN(Number(body.revisionNo))) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'revisionNo is required', 400);
  }

  const ip = getClientIp(ctx);
  const attachment = await rollbackAttachment(
    attachmentId,
    Number(body.revisionNo),
    actor,
    ip,
    undefined,
    undefined,
    systemClock,
  );

  ctx.status = 200;
  // Even though rollback is restricted to merchant/administrator, the response
  // still flows back to the UI — keep the public projection consistent with
  // upload/list/replace so storage_key/sha256 never leak to the browser.
  ctx.body = { ok: true, data: toPublicAttachment(attachment) };
});

// GET /api/v1/listings/:listingId/attachments/rejections
router.get('/rejections', requireAuth(), requireConsent(), async (ctx) => {
  const actor = getActor(ctx);
  const listingId = parseInt(ctx.params.listingId, 10);

  if (isNaN(listingId)) {
    throw new AppError(ErrorCodes.VALIDATION_ERROR, 'Invalid listing id', 400);
  }

  const rejections = await getRejections(listingId, actor);

  ctx.status = 200;
  ctx.body = { ok: true, data: rejections };
});

export default router;
