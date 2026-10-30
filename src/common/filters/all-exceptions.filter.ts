import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { Request, Response } from 'express';
import { ClsService } from 'nestjs-cls';

interface ErrorBody {
  success: false;
  statusCode: number;
  message: string | string[];
  error: string;
  correlationId?: string;
  timestamp: string;
  path: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly cls: ClsService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const { statusCode, message, error } = this.resolveError(exception);

    const body: ErrorBody = {
      success: false,
      statusCode,
      message,
      error,
      correlationId: this.cls.isActive() ? this.cls.getId() : undefined,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${statusCode}: ${JSON.stringify(message)}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    response.status(statusCode).json(body);
  }

  private resolveError(exception: unknown): {
    statusCode: number;
    message: string | string[];
    error: string;
  } {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : (((response as Record<string, unknown>).message as string | string[]) ??
            exception.message);
      return {
        statusCode: exception.getStatus(),
        message,
        error: exception.name,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrismaError(exception);
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'InternalServerError',
    };
  }

  private mapPrismaError(exception: Prisma.PrismaClientKnownRequestError): {
    statusCode: number;
    message: string;
    error: string;
  } {
    switch (exception.code) {
      case 'P2002':
        return {
          statusCode: HttpStatus.CONFLICT,
          message: `Duplicate value for: ${uniqueTargetOf(exception.meta)}`,
          error: 'ConflictException',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Record not found',
          error: 'NotFoundException',
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'Invalid reference to a related record',
          error: 'BadRequestException',
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Database error',
          error: 'InternalServerError',
        };
    }
  }
}

/**
 * Trường bị trùng của lỗi P2002. Engine cũ ghi `meta.target`; qua driver adapter (adapter-pg) `target` trống, tên cột nằm ở
 * `meta.driverAdapterError.cause.constraint.fields` (vd `"checkCode", "entityKey"`) - trước đây ra "Duplicate value for:
 * undefined" (test thật 32.27).
 */
export function uniqueTargetOf(meta: Record<string, unknown> | undefined): string {
  const target = meta?.target;
  if (Array.isArray(target) && target.length > 0) return target.join(', ');
  if (typeof target === 'string' && target) return target;
  const cause = (
    meta?.driverAdapterError as
      { cause?: { constraint?: { fields?: unknown[]; index?: string } } } | undefined
  )?.cause;
  const fields = cause?.constraint?.fields;
  if (Array.isArray(fields) && fields.length > 0)
    return fields
      .map((f) => (typeof f === 'string' ? f.replace(/"/g, '') : JSON.stringify(f)))
      .join(', ');
  if (typeof cause?.constraint?.index === 'string') return cause.constraint.index;
  return 'unknown field';
}
