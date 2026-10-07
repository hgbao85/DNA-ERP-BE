import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { RealtimeEntity, RealtimeEntityAction } from './realtime.contract';
import { RealtimeService } from './realtime.service';

export const REALTIME_ENTITY_KEY = 'realtime:entity';

/**
 * Gắn trên controller: mọi request GHI (POST/PATCH/PUT/DELETE) THÀNH CÔNG sẽ phát entity.changed.
 * Handler đã resolve nghĩa là service đã commit, nên event luôn đi SAU commit; request lỗi không phát.
 */
export const RealtimeEntityOn = (entity: RealtimeEntity) =>
  SetMetadata(REALTIME_ENTITY_KEY, entity);

type MutationRequest = Request & { user?: { id: string } };

function actionFor(req: MutationRequest): RealtimeEntityAction {
  const path = req.path.toLowerCase();
  if (req.method === 'DELETE') return 'DELETED';
  if (path.includes('/approve')) return 'APPROVED';
  if (path.includes('/reject')) return 'REJECTED';
  if (req.method === 'POST' && !req.params?.id) return 'CREATED';
  return 'UPDATED';
}

@Injectable()
export class RealtimeMutationInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly realtime: RealtimeService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const entity = this.reflector.get<RealtimeEntity | undefined>(
      REALTIME_ENTITY_KEY,
      context.getClass(),
    );
    const req = context.switchToHttp().getRequest<MutationRequest>();
    if (!entity || req.method === 'GET') return next.handle();

    return next.handle().pipe(
      tap((result) => {
        const id = req.params?.id ?? (result as { id?: unknown } | null)?.id;
        if (id === undefined || id === null) return;
        this.realtime.publishEntityChanged({
          entity,
          entityId: String(id),
          action: actionFor(req),
          actorId: req.user?.id ?? null,
        });
      }),
    );
  }
}
