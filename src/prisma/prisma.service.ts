import { PrismaPg } from '@prisma/adapter-pg';
import { ClsService } from 'nestjs-cls';
import { PrismaClient } from '../generated/prisma/client';
import { AppClsStore } from '../common/interfaces/cls-store.interface';
import { withAuditLog } from './extensions/audit-log.extension';
import { withSoftDelete } from './extensions/soft-delete.extension';
import { withQueryTiming } from './extensions/query-timing.extension';

/**
 * Extension order matters: audit-log is applied first (inner layer), soft-delete
 * second (outer layer). This way, when soft-delete rewrites a `delete` into an
 * `update` on a tracked model, that rewritten call re-enters the chain and is
 * picked up exactly once by audit-log's `update` hook - avoiding double logging
 * that would happen if the layers were reversed.
 *
 * query-timing là lớp TRONG CÙNG (áp đầu tiên): chỉ đo rồi gọi tiếp, không đổi args/kết quả nên không ảnh
 * hưởng hành vi 2 lớp kia, và mỗi truy vấn thật xuống DB (kể cả cái do soft-delete viết lại) chỉ bị đếm 1 lần.
 */
export function createExtendedPrismaClient(cls: ClsService<AppClsStore>) {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const client = new PrismaClient({ adapter });
  const extended = client
    .$extends(withQueryTiming(cls))
    .$extends(withAuditLog(cls))
    .$extends(withSoftDelete());
  return withTransactionContext(extended, cls);
}

/**
 * B5 (23/11/2026): bọc `$transaction(async (tx) => ...)` để callback chạy trong ngữ cảnh CLS con có `prismaTx = tx`.
 * Extension audit-log đọc nó để ghi nhật ký TRONG transaction nghiệp vụ - trước đây nhật ký ghi qua client gốc (kết nối
 * riêng, ngoài transaction): nghiệp vụ bị huỷ thì dữ liệu về như cũ nhưng dòng nhật ký "đã tạo / đã sửa" vẫn còn (thử sống
 * trên bản sao: phiếu xuất sắt 146 + giữ chỗ 157), và mỗi lần ghi trong transaction tốn thêm 1 kết nối của pool.
 * Ngữ cảnh con kế thừa userId / ip / correlationId của request (ifNested 'inherit'); 2 transaction song song mỗi cái có ngữ
 * cảnh riêng. Dạng mảng `$transaction([...])` để nguyên.
 */
export function withTransactionContext<T extends object>(
  extended: T,
  cls: ClsService<AppClsStore>,
): T {
  return new Proxy(extended, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target) as unknown;
      if (typeof value !== 'function') return value;
      const bound = (value as (...a: unknown[]) => unknown).bind(target);
      if (prop !== '$transaction') return bound;
      return (arg: unknown, ...rest: unknown[]) => {
        if (typeof arg !== 'function') return bound(arg, ...rest);
        const callback = arg as (tx: unknown) => unknown;
        return bound(
          (tx: unknown) =>
            cls.run({ ifNested: 'inherit' }, () => {
              cls.set('prismaTx', tx);
              return callback(tx);
            }),
          ...rest,
        );
      };
    },
  });
}

export type PrismaServiceType = ReturnType<typeof createExtendedPrismaClient>;

/**
 * Client bên trong `$transaction(async (tx) => ...)`. Giống PrismaServiceType nhưng không có các
 * method cấp kết nối (không lồng transaction, không đóng/mở kết nối từ trong một transaction).
 *
 * Có kiểu đặt tên riêng để service nào cần GHI TRONG transaction của service khác thì nhận được
 * `tx` qua tham số - xem StockLedgerService.postEntry(). Không dùng `Prisma.TransactionClient` của
 * Prisma sinh sẵn: client ở đây đã qua 2 lớp `$extends` (audit-log + soft-delete) nên kiểu đó
 * KHÔNG khớp, và mất luôn 2 lớp extension khi gọi.
 */
export type PrismaTx = Omit<
  PrismaServiceType,
  '$transaction' | '$connect' | '$disconnect' | '$extends' | '$on'
>;

/** DI token for the extended Prisma client. Inject with `@Inject(PRISMA_SERVICE)`. */
export const PRISMA_SERVICE = Symbol('PRISMA_SERVICE');
