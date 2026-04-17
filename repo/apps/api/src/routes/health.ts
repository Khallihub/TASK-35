import Router from 'koa-router';
import knex from '../db/knex';
import { config } from '../config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string };

const router = new Router();

router.get('/healthz', async (ctx) => {
  // Get the chain head (most recent row_hash)
  const lastRow = await knex('audit_log')
    .orderBy('id', 'desc')
    .first<{ row_hash: string } | undefined>(['row_hash'])
    .catch(() => undefined);

  const chainHead = lastRow?.row_hash ?? null;

  ctx.status = 200;
  ctx.body = {
    ok: true,
    data: {
      version: pkg.version,
      status: 'ok',
      chainHead,
    },
  };
});

// GET /api/v1/config/timezone — public endpoint for install-configured timezone
router.get('/api/v1/config/timezone', async (ctx) => {
  ctx.status = 200;
  ctx.body = { ok: true, data: { timezone: config.timezone } };
});

export default router;
