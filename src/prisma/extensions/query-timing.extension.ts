/* eslint-disable @typescript-eslint/no-unsafe-return -- hook `$allOperations` của Prisma trả `any` theo thiết kế, chỉ chuyển tiếp kết quả. */
import { performance } from 'node:perf_hooks';
import { ClsService } from 'nestjs-cls';
import { Prisma } from '../../generated/prisma/client';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';

/**
 * Đo thời gian mỗi truy vấn Prisma và cộng vào số đo của request hiện tại (CLS) để xuất `Server-Timing: db`.
 *
 * Ngoài request (cron, worker, khởi động) CLS không có context, hoặc request không bật đo -> bỏ qua êm,
 * chỉ chạy truy vấn như bình thường.
 * Cộng dồn theo từng truy vấn nên truy vấn chạy song song (Promise.all) được cộng cả hai -> tổng có thể
 * lớn hơn thời gian thực của request; con số này cho biết "tải DB" chứ không phải thời gian chờ.
 */
export function withQueryTiming(cls: ClsService<AppClsStore>) {
  return Prisma.defineExtension((client) =>
    client.$extends({
      name: 'query-timing',
      query: {
        async $allOperations({ args, query }) {
          const timing = cls.isActive() ? cls.get('timing') : undefined;
          if (!timing) return query(args);
          const startedAt = performance.now();
          try {
            return await query(args);
          } finally {
            timing.dbMs += performance.now() - startedAt;
            timing.dbCount += 1;
          }
        },
      },
    }),
  );
}
