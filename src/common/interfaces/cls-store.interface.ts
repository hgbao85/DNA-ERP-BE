import { ClsStore } from 'nestjs-cls';

/**
 * Số đo thời gian của MỘT request, cộng dồn trong lúc xử lý rồi ServerTimingMiddleware đọc ra
 * header `Server-Timing`. Là object đổi tại chỗ (không set lại vào CLS) để mọi nơi cùng ghi vào một bản.
 */
export interface RequestTiming {
  /** Mốc bắt đầu (performance.now(), ms). */
  startMs: number;
  /** Tổng thời gian truy vấn Prisma - cộng dồn kể cả truy vấn chạy song song nên có thể lớn hơn `total`. */
  dbMs: number;
  dbCount: number;
  /** Tổng thời gian chờ + chạy bộ giải. */
  solverMs: number;
  solverCount: number;
}

/** Request-scoped values threaded through AsyncLocalStorage (nestjs-cls). */
export interface AppClsStore extends ClsStore {
  userId?: string;
  ip?: string;
  /** Chỉ có khi SERVER_TIMING_ENABLED bật. */
  timing?: RequestTiming;
}
