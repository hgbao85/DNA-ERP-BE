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
  // KHÔNG ở đây - 2 biến này chỉ là thông tin KẾT NỐI tới solver. Cố ý để .optional() (không
  // .required()) dù đây là 1 tính năng thật - thiếu 2 biến này KHÔNG được phép chặn boot cả app
  // (mọi module khác không liên quan gì tới Đề xuất cắt sắt), chỉ riêng CuttingProposalsService
  // sẽ tự báo FAILED khi thật sự có ai gọi mà chưa cấu hình (xem runSolverAndSave).
  SOLVER_BASE_URL: Joi.string().uri().optional(),
  SOLVER_API_KEY: Joi.string().optional(),
  /// Timeout HTTP CLIENT (giây) - KHÁC với time_limit_seconds gửi trong body request (đó là
  /// SystemConfig.solverTimeLimitSeconds, mỗi lần giải solver). Để dư dả vì số lần giải/request
  /// = số loại sắt x (1 + N lần vét cạn) có thể cộng dồn khá lâu dù mỗi lần giải nhanh.
  SOLVER_TIMEOUT_SECONDS: Joi.number().default(300),

  // Cloudinary (upload ảnh, xem UploadsModule). .optional() cùng lý do với SOLVER_* ở trên -
  // thiếu cấu hình không được chặn boot cả app, chỉ riêng route POST /uploads/image sẽ báo lỗi
  // khi thật sự có ai gọi mà chưa cấu hình.
  CLOUDINARY_CLOUD_NAME: Joi.string().optional(),
  CLOUDINARY_API_KEY: Joi.string().optional(),
  CLOUDINARY_API_SECRET: Joi.string().optional(),
});
