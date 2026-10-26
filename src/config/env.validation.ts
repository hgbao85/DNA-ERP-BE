import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api'),

  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES_IN: Joi.string().default('15m'),
  // Refresh token KHÔNG ký bằng secret riêng - lưu dạng random bytes hash SHA-256
  // (xem AuthService.refresh()), nên không có JWT_REFRESH_SECRET ở đây.
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  // '*' mặc định tiện cho dev/test (main.ts đọc corsOrigin==='*' -> reflect Origin header với
  // credentials:true). Ở production BẮT BUỘC khai rõ domain, không cho phép '*' - deploy quên
  // set biến này trước đây âm thầm chấp nhận credentialed request từ mọi origin.
  CORS_ORIGIN: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().disallow('*').required().messages({
      'any.required': 'CORS_ORIGIN bắt buộc khi NODE_ENV=production - không được để mặc định "*"',
      'any.invalid': 'CORS_ORIGIN không được là "*" khi NODE_ENV=production - khai rõ domain',
    }),
    otherwise: Joi.string().default('*'),
  }),

  // Số lớp proxy đứng trước app (xem AppConfig.trustProxyHops). Production sau Render/Heroku... đặt 1.
  TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(5).default(0),

  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(100),

  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  SEED_ADMIN_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .optional(),
  SEED_ADMIN_PASSWORD: Joi.string().min(8).optional(),

  // Bộ giải "Đề xuất thanh sắt" (Phase 7): HiGHS (WASM) chạy trong worker thread NGAY TRONG tiến trình BE
  // - bộ giải duy nhất của ERP (2026-10-23, changelog 2026-10-20 mục 9), không còn gọi DNA-DEXUAT qua mạng
  // nên không còn SOLVER_MODE / SOLVER_BASE_URL / SOLVER_API_KEY. Tham số TUNING của bài toán
  // (stock_lengths, trim_start, max_waste_percentage...) nằm ở SystemConfig (admin sửa qua PUT
  // /system-config), KHÔNG ở đây.
  // WORKERS=1 giữ đúng "1 lượt giải tại 1 thời điểm"; HEAP_MB = trần heap V8 mỗi worker (0 = mặc định
  // Node, KHÔNG gồm bộ nhớ WASM); MAX_RSS_MB = trần RSS toàn tiến trình khi đang giải (0 = tắt) - vượt
  // là terminate worker, API vẫn sống.
  SOLVER_TS_WORKERS: Joi.number().integer().min(1).max(4).default(1),
  SOLVER_TS_HEAP_MB: Joi.number().integer().min(0).default(0),
  SOLVER_TS_MAX_RSS_MB: Joi.number().integer().min(0).default(0),
  /// Trần cho CẢ 1 lần gọi solver (giây: chờ hàng đợi + chạy worker) - KHÁC với time_limit_seconds gửi
  /// trong body request (đó là SystemConfig.solverTimeLimitSeconds, mỗi lần giải 1 loại sắt). Để dư dả vì số lần giải/request
  /// = số loại sắt x (1 + N lần vét cạn) có thể cộng dồn khá lâu dù mỗi lần giải nhanh.
  SOLVER_TIMEOUT_SECONDS: Joi.number().default(300),

  // Cloudinary (upload ảnh, xem UploadsModule). .optional() - thiếu cấu hình không được chặn boot cả app, chỉ riêng route POST /uploads/image sẽ báo lỗi
  // khi thật sự có ai gọi mà chưa cấu hình.
  CLOUDINARY_CLOUD_NAME: Joi.string().optional(),
  CLOUDINARY_API_KEY: Joi.string().optional(),
  CLOUDINARY_API_SECRET: Joi.string().optional(),
});
