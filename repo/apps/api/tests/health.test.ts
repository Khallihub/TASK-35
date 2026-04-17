import request from 'supertest';
import { Server } from 'http';
import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from './helpers/testKnex';

// We need to override the knex singleton before importing the app
// so that health route queries go to SQLite instead of MySQL.
// We do this by mocking the db/knex module.

let testKnex: KnexType;

jest.mock('../src/db/knex', () => {
  // Return a getter so the mock resolves after testKnex is assigned
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (!testKnex) throw new Error('testKnex not initialized');
      const val = (testKnex as unknown as Record<string, unknown>)[prop as string];
      if (typeof val === 'function') {
        return val.bind(testKnex);
      }
      return val;
    },
    apply(_target, _thisArg, args) {
      return (testKnex as unknown as (...a: unknown[]) => unknown)(...args);
    },
  };
  return new Proxy(function () { /* placeholder */ }, handler);
});

describe('GET /healthz', () => {
  let server: Server;

  beforeAll(async () => {
    testKnex = createTestKnex();
    await runTestMigrations(testKnex);

    // Now import the app (after mock is set up)
    const { createApp } = await import('../src/app');
    const app = createApp();
    server = app.listen(0);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    await dropTestTables(testKnex);
    await testKnex.destroy();
  });

  test('GET /healthz returns 200 with ok: true and status: ok', async () => {
    const res = await request(server).get('/healthz');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.version).toBeDefined();
    expect(typeof res.body.data.version).toBe('string');
    // chainHead is null when audit_log is empty
    expect(res.body.data.chainHead).toBeNull();
  });
});
