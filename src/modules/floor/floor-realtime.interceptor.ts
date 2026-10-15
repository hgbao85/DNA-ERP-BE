import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { RealtimeService } from '../../realtime/realtime.service';
import { FloorAlertsService } from './floor-alerts.service';

/**
 * Mọi request GHI thành công của /floor/* (báo, nhận sắt, gửi KCS, đảo, hàng đợi, máy, công nhân) phát
 * entity.changed FLOOR_REPORT -> màn "Sản lượng xưởng" của QLSX tự tải lại. Không dùng
 * RealtimeMutationInterceptor có sẵn vì nó bỏ qua request không có id (vd advance, send-kcs của nhóm công đoạn).
 * Payload không chứa dữ liệu (chỉ topic), nên công nhân cùng nhận cũng không lộ gì.
 */
@Injectable()
export class FloorRealtimeInterceptor implements NestInterceptor {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly alerts: FloorAlertsService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request & { user?: { id: string } }>();
    if (req.method === 'GET') return next.handle();
    return next.handle().pipe(
      tap(() => {
        this.realtime.publishEntityChanged({
          entity: 'FLOOR_REPORT',
          entityId: req.path,
          action: 'UPDATED',
          actorId: req.user?.id ?? null,
        });
        // Sau mỗi thao tác ghi: kiểm tra "tổ đã báo đủ số" / "đợt chờ quá lâu" (gom lại, chạy nền, không chặn request).
        this.alerts.requestEvaluate();
      }),
    );
  }
}
