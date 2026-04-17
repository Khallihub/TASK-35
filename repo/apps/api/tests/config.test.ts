describe('Config loader', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Reset modules so config re-evaluates process.env
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('returns default values when env vars are absent', async () => {
    // Remove relevant env vars
    delete process.env.PORT;
    delete process.env.DB_HOST;
    delete process.env.DB_PORT;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    delete process.env.JWT_SECRET;
    delete process.env.JWT_ACCESS_TTL_MINUTES;
    delete process.env.BCRYPT_COST;
    delete process.env.LOG_LEVEL;
    delete process.env.LOG_PRETTY;
    delete process.env.STORAGE_PATH;
    delete process.env.TZ_IANA;

    const { config } = await import('../src/config');

    expect(config.port).toBe(3000);
    expect(config.db.host).toBe('127.0.0.1');
    expect(config.db.port).toBe(3306);
    expect(config.db.user).toBe('harborstone');
    expect(config.db.password).toBe('');
    expect(config.db.database).toBe('harborstone');
    expect(config.jwt.secret).toBe('CHANGE_ME_BEFORE_GOING_LIVE_32chars');
    expect(config.jwt.accessTtlMinutes).toBe(30);
    expect(config.bcrypt.cost).toBe(12);
    expect(config.log.level).toBe('info');
    expect(config.log.pretty).toBe(false);
    expect(config.storage.basePath).toBe('./data/attachments');
    expect(config.timezone).toBe('America/New_York');
  });

  test('env var overrides are picked up', async () => {
    process.env.PORT = '4000';
    process.env.DB_HOST = 'db.example.com';
    process.env.DB_PORT = '3307';
    process.env.DB_USER = 'testuser';
    process.env.DB_PASSWORD = 'testpass';
    process.env.DB_NAME = 'testdb';
    process.env.JWT_SECRET = 'my-super-secret';
    process.env.JWT_ACCESS_TTL_MINUTES = '60';
    process.env.BCRYPT_COST = '10';
    process.env.LOG_LEVEL = 'debug';
    process.env.LOG_PRETTY = 'true';
    process.env.STORAGE_PATH = '/var/data/files';
    process.env.TZ_IANA = 'America/Los_Angeles';

    const { config } = await import('../src/config');

    expect(config.port).toBe(4000);
    expect(config.db.host).toBe('db.example.com');
    expect(config.db.port).toBe(3307);
    expect(config.db.user).toBe('testuser');
    expect(config.db.password).toBe('testpass');
    expect(config.db.database).toBe('testdb');
    expect(config.jwt.secret).toBe('my-super-secret');
    expect(config.jwt.accessTtlMinutes).toBe(60);
    expect(config.bcrypt.cost).toBe(10);
    expect(config.log.level).toBe('debug');
    expect(config.log.pretty).toBe(true);
    expect(config.storage.basePath).toBe('/var/data/files');
    expect(config.timezone).toBe('America/Los_Angeles');
  });
});
