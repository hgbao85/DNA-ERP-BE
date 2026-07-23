import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../interfaces/cls-store.interface';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Runs after ClsModule's own middleware (which opens the AsyncLocalStorage store).
 * Echoes the correlation id (CLS request id) back on the response so callers can
 * correlate their request with server-side logs and audit-log rows, and stashes
 * the caller's IP for the audit-log Prisma extension to read.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  constructor(private readonly cls: ClsService<AppClsStore>) {}

  use(req: Request, res: Response, next: NextFunction): void {
    this.cls.set('ip', req.ip);
    res.setHeader(CORRELATION_ID_HEADER, this.cls.getId());
    next();
  }
}
