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
      const statusCode = exception.getStatus();
      return {
        statusCode,
        message: Array.isArray(message)
          ? message.map((m) => translateFrameworkMessage(m, statusCode))
          : translateFrameworkMessage(message, statusCode),
        error: exception.name,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrismaError(exception);
    }

    // Lỗi của body-parser (JSON sai cú pháp, dữ liệu quá lớn) không phải HttpException nhưng mang sẵn mã 4xx.
    const bodyParserStatus = clientErrorStatusOf(exception);
    if (bodyParserStatus) {
      return {
        statusCode: bodyParserStatus,
        message:
          bodyParserStatus === Number(HttpStatus.PAYLOAD_TOO_LARGE)
            ? PAYLOAD_TOO_LARGE_MESSAGE
            : 'Dữ liệu gửi lên sai định dạng',
        error: 'BadRequestException',
      };
    }

    return {
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: INTERNAL_ERROR_MESSAGE,
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
          message: `Giá trị đã tồn tại, không được trùng: ${uniqueTargetOf(exception.meta)}`,
          error: 'ConflictException',
        };
      case 'P2025':
        return {
          statusCode: HttpStatus.NOT_FOUND,
          message: 'Không tìm thấy dữ liệu (có thể đã bị xoá). Tải lại trang rồi thử lại.',
          error: 'NotFoundException',
        };
      case 'P2003':
        return {
          statusCode: HttpStatus.BAD_REQUEST,
          message:
            'Không lưu được: dữ liệu liên kết không tồn tại, hoặc bản ghi đang được dùng ở chỗ khác',
          error: 'BadRequestException',
        };
      default:
        return {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: DATABASE_ERROR_MESSAGE,
          error: 'InternalServerError',
        };
    }
  }
}

export const INTERNAL_ERROR_MESSAGE =
  'Hệ thống đang lỗi. Đợi một lát rồi thử lại; vẫn lỗi thì báo quản trị hệ thống.';
export const DATABASE_ERROR_MESSAGE =
  'Lỗi cơ sở dữ liệu. Đợi một lát rồi thử lại; vẫn lỗi thì báo quản trị hệ thống.';
const PAYLOAD_TOO_LARGE_MESSAGE = 'Dữ liệu hoặc file gửi lên quá lớn';

/** Có chữ tiếng Việt có dấu => câu nghiệp vụ đã viết sẵn, không đụng. */
const VI_CHAR = /[À-ỹ]/;

/** Câu mặc định tiếng Anh Nest/Throttler/Multer tự sinh khi không truyền message (khớp cả câu). */
const FRAMEWORK_MESSAGES: Record<string, string> = {
  Unauthorized: 'Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập. Đăng nhập lại rồi thử lại.',
  'Forbidden resource': 'Tài khoản không có quyền làm việc này',
  Forbidden: 'Tài khoản không có quyền làm việc này',
  'ThrottlerException: Too Many Requests': 'Thao tác quá nhanh. Đợi khoảng 1 phút rồi thử lại.',
  'Too Many Requests': 'Thao tác quá nhanh. Đợi khoảng 1 phút rồi thử lại.',
  'Bad Request': 'Yêu cầu không hợp lệ',
  'Not Found': 'Không tìm thấy dữ liệu',
  Conflict: 'Dữ liệu bị xung đột, tải lại trang rồi thử lại',
  'Payload Too Large': PAYLOAD_TOO_LARGE_MESSAGE,
  'request entity too large': PAYLOAD_TOO_LARGE_MESSAGE,
  'File too large': 'File quá lớn',
  'Too many files': 'Gửi quá nhiều file một lần',
  'Unexpected field': 'File gửi lên không đúng ô chọn file',
  'Unprocessable Entity': 'Dữ liệu không xử lý được',
  'Internal Server Error': INTERNAL_ERROR_MESSAGE,
  'Internal server error': INTERNAL_ERROR_MESSAGE,
  'Service Unavailable': 'Hệ thống tạm thời không phục vụ được. Đợi một lát rồi thử lại.',
};

/**
 * Đổi câu mặc định tiếng Anh của framework sang tiếng Việt; câu nghiệp vụ (đã tiếng Việt, hoặc câu tiếng Anh viết
 * riêng trong service) trả nguyên văn. Dùng chung cho mọi HttpException đi qua filter.
 */
export function translateFrameworkMessage(message: string, statusCode: number): string {
  if (typeof message !== 'string' || VI_CHAR.test(message)) return message;
  const known = FRAMEWORK_MESSAGES[message];
  if (known) return known;
  // Router không có route: "Cannot GET /api/v1/abc".
  if (statusCode === 404 && /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) /.test(message)) {
    return 'Không tìm thấy chức năng này trên máy chủ (đường dẫn không tồn tại)';
  }
  // ParseIntPipe/ParseUUIDPipe...: "Validation failed (numeric string is expected)".
  if (statusCode === 400 && /^Validation failed \(.+ is expected\)$/.test(message)) {
    return 'Giá trị gửi lên không đúng kiểu (vd phải là số)';
  }
  // JSON sai cú pháp: "Unexpected token } in JSON at position 10" / "Expected ',' ... in JSON ...".
  if (statusCode === 400 && /\bJSON\b/.test(message)) return 'Dữ liệu gửi lên sai định dạng';
  return message;
}

/** Mã 4xx của lỗi body-parser / http-errors (có `status` + `type`), không thì undefined. */
function clientErrorStatusOf(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, type } = exception as { status?: unknown; type?: unknown };
  if (typeof status !== 'number' || typeof type !== 'string') return undefined;
  return status >= 400 && status < 500 ? status : undefined;
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
  return 'không rõ trường';
}
