import { Knex as KnexType } from 'knex';
import { createTestKnex, runTestMigrations, dropTestTables } from './helpers/testKnex';
import {
  appendAuditEvent,
  verifyChain,
  setAuditKnex,
  resetAuditKnex,
} from '../src/audit/chain';
import { TestClock } from '../src/clock';

describe('Audit Chain', () => {
  let knex: KnexType;
  let clock: TestClock;

  beforeEach(async () => {
    knex = createTestKnex();
    await runTestMigrations(knex);
    setAuditKnex(knex);
    clock = new TestClock(new Date('2024-01-01T00:00:00.000Z'));
  });

  afterEach(async () => {
    resetAuditKnex();
    await dropTestTables(knex);
    await knex.destroy();
  });

  test('appends 3 events and verifies chain returns { valid: true }', async () => {
    await appendAuditEvent({ action: 'USER_LOGIN', entity_type: 'user', entity_id: '1' }, clock);
    clock.advance(1000);
    await appendAuditEvent({ action: 'LISTING_CREATE', entity_type: 'listing', entity_id: '42' }, clock);
    clock.advance(1000);
    await appendAuditEvent({ action: 'LISTING_UPDATE', entity_type: 'listing', entity_id: '42' }, clock);

    const result = await verifyChain();
    expect(result).toEqual({ valid: true });
  });

  test('corrupting the 2nd row causes verifyChain to return { valid: false, brokenAt: <row2_id> }', async () => {
    const id1 = await appendAuditEvent({ action: 'EVENT_ONE' }, clock);
    clock.advance(1000);
    const id2 = await appendAuditEvent({ action: 'EVENT_TWO' }, clock);
    clock.advance(1000);
    await appendAuditEvent({ action: 'EVENT_THREE' }, clock);

    // Corrupt the row_hash of the 2nd row
    await knex('audit_log')
      .where({ id: Number(id2) })
      .update({ row_hash: 'a'.repeat(64) });

    const result = await verifyChain();
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBeDefined();
    // The broken row should be row 2 (either because prev_hash mismatch on row 3,
    // or because row 2's row_hash doesn't match computed hash)
    expect(result.brokenAt).toEqual(BigInt(id2));

    // Suppress unused variable warning
    void id1;
  });

  test('genesis row uses prev_hash of 64 zeros', async () => {
    await appendAuditEvent({ action: 'GENESIS_TEST' }, clock);

    const firstRow = await knex('audit_log').orderBy('id', 'asc').first();
    expect(firstRow).toBeDefined();
    expect(firstRow.prev_hash).toBe('0'.repeat(64));
  });

  test('verifyChain succeeds after compaction deletes old rows', async () => {
    // Insert 5 events
    const id1 = await appendAuditEvent({ action: 'OLD_EVENT_1' }, clock);
    clock.advance(1000);
    const id2 = await appendAuditEvent({ action: 'OLD_EVENT_2' }, clock);
    clock.advance(1000);
    await appendAuditEvent({ action: 'KEEP_EVENT_3' }, clock);
    clock.advance(1000);
    await appendAuditEvent({ action: 'KEEP_EVENT_4' }, clock);
    clock.advance(1000);
    await appendAuditEvent({ action: 'KEEP_EVENT_5' }, clock);

    // Verify chain intact before compaction
    const before = await verifyChain();
    expect(before).toEqual({ valid: true });

    // Simulate retention compaction: delete the first two rows
    await knex('audit_log').where('id', Number(id1)).delete();
    await knex('audit_log').where('id', Number(id2)).delete();

    // Verify chain remains valid after compaction — the verifier
    // should accept the first remaining row's prev_hash as anchor
    const after = await verifyChain();
    expect(after).toEqual({ valid: true });
  });

  test('each row prev_hash equals the previous row row_hash', async () => {
    await appendAuditEvent({ action: 'ROW_ONE' }, clock);
    clock.advance(500);
    await appendAuditEvent({ action: 'ROW_TWO' }, clock);
    clock.advance(500);
    await appendAuditEvent({ action: 'ROW_THREE' }, clock);

    const rows = await knex('audit_log').orderBy('id', 'asc').select();
    expect(rows).toHaveLength(3);

    // Row 1: prev_hash must be genesis
    expect(rows[0].prev_hash).toBe('0'.repeat(64));

    // Each subsequent row's prev_hash must equal the previous row's row_hash
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].prev_hash).toBe(rows[i - 1].row_hash);
    }
  });
});
