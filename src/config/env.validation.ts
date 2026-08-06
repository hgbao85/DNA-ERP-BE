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
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),

  CORS_ORIGIN: Joi.string().default('*'),

  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(100),

  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),

  SEED_ADMIN_EMAIL: Joi.string()
    .email({ tlds: { allow: false } })
    .optional(),
  SEED_ADMIN_PASSWORD: Joi.string().min(8).optional(),

  // cat_sat_iea solver (Phase 7 - Đề xuất cắt sắt). Tham số TUNING của bài toán (stock_lengths,
  // trim_start, max_waste_percentage...) nằm ở SystemConfig (admin sửa qua PUT /system-config),
  // KHÔNG ở đây - 3 biến này chỉ là thông tin KẾT NỐI tới solver.
  SOLVER_BASE_URL: Joi.string().uri().required(),
  SOLVER_API_KEY: Joi.string().required(),
  /// Timeout HTTP CLIENT (giây) - KHÁC với time_limit_seconds gửi trong body request (đó là
  /// SystemConfig.solverTimeLimitSeconds, mỗi lần giải solver). Để dư dả vì số lần giải/request
  /// = số loại sắt x (1 + N lần vét cạn) có thể cộng dồn khá lâu dù mỗi lần giải nhanh.
  SOLVER_TIMEOUT_SECONDS: Joi.number().default(300),
});
