import { TEST_DATABASE_URL } from './test-db.constants';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-at-least-32-characters-long';
process.env.JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
process.env.THROTTLE_TTL = process.env.THROTTLE_TTL ?? '60';
process.env.THROTTLE_LIMIT = process.env.THROTTLE_LIMIT ?? '1000';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.API_PREFIX = process.env.API_PREFIX ?? 'api';
process.env.PORT = process.env.PORT ?? '0';
