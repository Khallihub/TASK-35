import { createApp } from './app';
import { config } from './config';
import { logger } from './logger';
import knex from './db/knex';
import { startScheduler, stopScheduler } from './jobs/runner';

async function main() {
  await knex.migrate.latest();
  await knex.seed.run();
  const app = createApp();

  const schedulerHandle = startScheduler();

  const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, 'HarborStone API listening');
  });

  const shutdown = () => {
    stopScheduler(schedulerHandle);
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
