export interface AppConfig {
  env: string;
  port: number;
  apiPrefix: string;
  database: {
    url: string;
  };
  jwt: {
    accessSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  cors: {
    origin: string;
  };
  throttle: {
    ttl: number;
    limit: number;
  };
  logLevel: string;
  /**
   * Số lớp proxy/CDN đứng TRƯỚC app (Render = 1, thêm Cloudflare = 2...). 0 = không tin header X-Forwarded-For (chạy local). Cần đúng
   * để BE thấy IP THẬT của client (giới hạn mạng công ty đọc IP này) - sai thì thấy IP của proxy, hoặc bị giả mạo header.
   */
  trustProxyHops: number;
  /** Bỏ trống = 1 instance (adapter bộ nhớ). Có giá trị = Redis adapter để nhiều instance cùng phát event. */
  realtime: {
    redisUrl: string;
  };
  solver: {
    baseUrl: string;
    apiKey: string;
    timeoutSeconds: number;
  };
  cloudinary: {
    cloudName: string;
    apiKey: string;
    apiSecret: string;
  };
}

export default (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  apiPrefix: process.env.API_PREFIX ?? 'api',
  database: {
    url: process.env.DATABASE_URL ?? '',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  cors: {
    origin: process.env.CORS_ORIGIN ?? '*',
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL ?? '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
  },
  logLevel: process.env.LOG_LEVEL ?? 'info',
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS ?? '0', 10),
  realtime: {
    redisUrl: process.env.REDIS_URL ?? '',
  },
  solver: {
    baseUrl: process.env.SOLVER_BASE_URL ?? '',
    apiKey: process.env.SOLVER_API_KEY ?? '',
    timeoutSeconds: parseInt(process.env.SOLVER_TIMEOUT_SECONDS ?? '300', 10),
  },
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? '',
    apiKey: process.env.CLOUDINARY_API_KEY ?? '',
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? '',
  },
});
