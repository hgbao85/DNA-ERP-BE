import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { performance } from 'node:perf_hooks';
import { AppConfig } from '../../config/configuration';
import { AppClsStore, RequestTiming } from '../interfaces/cls-store.interface';

const ms = (value: number): string => value.toFixed(1);

/** Dựng giá trị header. Chỉ ASCII: Node từ chối ký tự ngoài Latin-1 trong giá trị header. */
export function buildServerTimingHeader(t: RequestTiming, nowMs: number): string {
  const parts = [
    `total;dur=${ms(nowMs - t.startMs)}`,
    `db;dur=${ms(t.dbMs)};desc="${t.dbCount} queries"`,
  ];
  // Request không gọi bộ giải thì bỏ mục này cho header gọn.
  if (t.solverCount > 0) parts.push(`solver;dur=${ms(t.solverMs)};desc="${t.solverCount} calls"`);
  return parts.join(', ');
}

/**
 * Chạy ngay sau ClsMiddleware: ghi mốc bắt đầu vào CLS rồi bọc `res.writeHead` để chèn `Server-Timing`
 * đúng lúc ghi header (đúng cho mọi kiểu response, kể cả lỗi do AllExceptionsFilter) - sau thời điểm
 * đó không thể đặt header nữa. Dùng để biết thời gian nằm ở DB, bộ giải hay CPU.
 *
 * `Timing-Allow-Origin`: FE và BE khác origin nên JS chỉ đọc được `serverTiming` khi có header này.
 * Chỉ đặt cho origin nằm trong danh sách CORS đang cho phép - không mở rộng CORS.
 */
@Injectable()
export class ServerTimingMiddleware implements NestMiddleware {
  private readonly enabled: boolean;
  private readonly allowAll: boolean;
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly cls: ClsService<AppClsStore>,
    configService: ConfigService<AppConfig, true>,
  ) {
    this.enabled = configService.get('serverTiming.enabled', { infer: true }) !== false;
    const corsOrigin = configService.get('cors.origin', { infer: true }) ?? '';
    this.allowAll = corsOrigin === '*';
    this.allowedOrigins = new Set(
      corsOrigin
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    );
  }

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.enabled) {
      next();
      return;
    }
    const timing: RequestTiming = {
      startMs: performance.now(),
      dbMs: 0,
      dbCount: 0,
      solverMs: 0,
      solverCount: 0,
    };
    this.cls.set('timing', timing);

    const origin = req.headers.origin;
    const originAllowed = typeof origin === 'string' && this.allowedOrigins.has(origin);

    // eslint-disable-next-line @typescript-eslint/unbound-method -- gọi lại bằng .apply(res) bên dưới
    const originalWriteHead = res.writeHead as (...args: unknown[]) => Response;
    res.writeHead = ((...args: unknown[]) => {
      if (!res.headersSent) {
        res.setHeader('Server-Timing', buildServerTimingHeader(timing, performance.now()));
        if (this.allowAll) res.setHeader('Timing-Allow-Origin', '*');
        else if (originAllowed) res.setHeader('Timing-Allow-Origin', origin);
      }
      return originalWriteHead.apply(res, args);
    }) as typeof res.writeHead;
    next();
  }
}
