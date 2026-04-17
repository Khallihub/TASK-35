import { createTestKnex, runTestMigrations, dropTestTables } from '../helpers/testKnex';
import { checkIdempotency, saveIdempotency } from '../../src/services/idempotency';
import { Knex as KnexType } from 'knex';
import { v4 as uuidv4 } from 'uuid';

describe('idempotency service', () => {
  let knex: KnexType;
  const userId = BigInt(1);

  beforeEach(async () => {
    knex = createTestKnex();
    await runTestMigrations(knex);
  });

  afterEach(async () => {
    await dropTestTables(knex);
    await knex.destroy();
  });

  it('first call returns exists=false', async () => {
    const key = uuidv4();
    const result = await checkIdempotency(key, userId, '/api/v1/test', 'abc123', knex);
    expect(result.exists).toBe(false);
  });

  it('second call with same key returns exists=true and stored response', async () => {
    const key = uuidv4();
    const route = '/api/v1/test';
    const hash = 'abc123';
    const body = { ok: true, data: { id: 42 } };

    await saveIdempotency(key, userId, route, hash, 200, body, knex);

    const result = await checkIdempotency(key, userId, route, hash, knex);
    expect(result.exists).toBe(true);
    expect(result.response).toBeDefined();
    expect(result.response?.status).toBe(200);
    expect(result.response?.body).toEqual(body);
  });

  it('saveIdempotency stores and can be retrieved', async () => {
    const key = uuidv4();
    const route = '/api/v1/offices';
    const hash = 'hashvalue123';
    const body = { ok: true, data: { name: 'Test Office' } };

    await saveIdempotency(key, userId, route, hash, 201, body, knex);

    const result = await checkIdempotency(key, userId, route, hash, knex);
    expect(result.exists).toBe(true);
    expect(result.response?.status).toBe(201);
  });

  it('saveIdempotency handles upsert on duplicate key gracefully', async () => {
    const key = uuidv4();
    const route = '/api/v1/test';
    const hash = 'abc123';
    const body1 = { ok: true, data: { version: 1 } };
    const body2 = { ok: true, data: { version: 2 } };

    await saveIdempotency(key, userId, route, hash, 200, body1, knex);
    await saveIdempotency(key, userId, route, hash, 200, body2, knex);

    const result = await checkIdempotency(key, userId, route, hash, knex);
    expect(result.exists).toBe(true);
    // The second save updates the snapshot
    expect(result.response?.body).toEqual(body2);
  });
});
