import Knex, { Knex as KnexType } from 'knex';
import path from 'path';
import { config } from '../config';

// Detect whether we are running from compiled JS (production) or ts-node (development/test).
// __filename ends with '.js' when compiled; '.ts' when run via ts-node.
const isCompiled = __filename.endsWith('.js');

// Use __dirname (the directory containing this file) so paths resolve correctly
// regardless of the current working directory. In ts-node __dirname is the
// source directory; in compiled output it is the dist directory.
const migrationsDir = path.join(__dirname, 'migrations');
const seedsDir = path.join(__dirname, 'seeds');

const knex = Knex({
  client: 'mysql2',
  connection: config.db,
  pool: { min: 2, max: 10 },
  migrations: { directory: migrationsDir, extension: isCompiled ? 'js' : 'ts' },
  seeds: { directory: seedsDir, extension: isCompiled ? 'js' : 'ts' },
});

let _override: KnexType | null = null;

/**
 * Override the default knex instance (for testing with SQLite).
 */
export function setDefaultKnex(k: KnexType): void {
  _override = k;
}

export function resetDefaultKnex(): void {
  _override = null;
}

// Export a proxy that delegates to the override if set, otherwise the real knex
function createProxy(): KnexType {
  return new Proxy(knex, {
    apply(_target, _thisArg, args) {
      const instance = _override ?? knex;
      return (instance as unknown as (...a: unknown[]) => unknown)(...args);
    },
    get(_target, prop) {
      const instance = _override ?? knex;
      const val = (instance as unknown as Record<string | symbol, unknown>)[prop];
      if (typeof val === 'function') return val.bind(instance);
      return val;
    },
  }) as KnexType;
}

export default createProxy();
