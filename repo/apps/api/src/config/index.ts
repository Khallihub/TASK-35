export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  db: {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: parseInt(process.env.DB_PORT ?? '3306', 10),
    user: process.env.DB_USER ?? 'harborstone',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_NAME ?? 'harborstone',
  },
  jwt: {
    secret: process.env.JWT_SECRET ?? 'CHANGE_ME_BEFORE_GOING_LIVE_32chars',
    accessTtlMinutes: parseInt(process.env.JWT_ACCESS_TTL_MINUTES ?? '30', 10),
  },
  bcrypt: {
    cost: parseInt(process.env.BCRYPT_COST ?? '12', 10),
  },
  log: {
    level: process.env.LOG_LEVEL ?? 'info',
    pretty: process.env.LOG_PRETTY === 'true',
  },
  storage: {
    basePath: process.env.STORAGE_PATH ?? './data/attachments',
  },
  timezone: process.env.TZ_IANA ?? 'America/New_York',
};
