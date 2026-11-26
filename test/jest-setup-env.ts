import { TEST_DATABASE_URL } from './test-db.constants';

process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-at-least-32-characters-long';
process.env.JWT_ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN ?? '15m';
process.env.JWT_REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN ?? '7d';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
process.env.THROTTLE_TTL = process.env.THROTTLE_TTL ?? '60';
process.env.THROTTLE_LIMIT = process.env.THROTTLE_LIMIT ?? '1000';
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'silent';
process.env.API_PREFIX = process.env.API_PREFIX ?? 'api';
process.env.PORT = process.env.PORT ?? '0';
// Công tắc tính năng: test luôn bắt đầu ở trạng thái TẮT (mặc định production), không lấy theo .env của máy đang
// chạy (ConfigModule đọc .env nhưng không ghi đè biến đã có). Suite cần bật thì tự bật / trả lại trong beforeAll / afterAll.
process.env.SEGMENT_STOCK_ENABLED = 'false';
process.env.STAGE_HANDOVER_ENABLED = 'false';
process.env.PALLET_SON_ENABLED = 'false';
process.env.CK_DG_QR_ENABLED = 'false';
process.env.VI_TRI_KHO_ENABLED = 'false';
process.env.DIEU_PHOI_DAN_ENABLED = 'false';
