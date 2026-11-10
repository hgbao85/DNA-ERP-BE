import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { ClsService } from 'nestjs-cls';
import {
  AllExceptionsFilter,
  INTERNAL_ERROR_MESSAGE,
  translateFrameworkMessage,
  uniqueTargetOf,
} from './all-exceptions.filter';

describe('uniqueTargetOf (P2002)', () => {
  it('engine cũ: meta.target', () => {
    expect(uniqueTargetOf({ target: ['code'] })).toBe('code');
  });

  it('driver adapter: tên cột ở driverAdapterError.cause.constraint.fields (trước đây ra "undefined", test thật 32.27)', () => {
    expect(
      uniqueTargetOf({
        modelName: 'DataHealthFinding',
        driverAdapterError: {
          cause: {
            kind: 'UniqueConstraintViolation',
            constraint: { fields: ['"checkCode"', '"entityKey"'] },
          },
        },
      }),
    ).toBe('checkCode, entityKey');
  });

  it('không có thông tin -> chữ chung, không "undefined"', () => {
    expect(uniqueTargetOf(undefined)).toBe('không rõ trường');
  });
});

describe('translateFrameworkMessage (câu mặc định của framework -> tiếng Việt)', () => {
  it('câu mặc định Nest/Throttler', () => {
    expect(translateFrameworkMessage('Unauthorized', 401)).toMatch(/Đăng nhập lại/);
    expect(translateFrameworkMessage('Forbidden resource', 403)).toBe(
      'Tài khoản không có quyền làm việc này',
    );
    expect(translateFrameworkMessage('ThrottlerException: Too Many Requests', 429)).toMatch(
      /Đợi khoảng 1 phút/,
    );
    expect(translateFrameworkMessage('Cannot GET /api/v1/khong-co', 404)).toMatch(
      /đường dẫn không tồn tại/,
    );
    expect(
      translateFrameworkMessage('Validation failed (numeric string is expected)', 400),
    ).toMatch(/không đúng kiểu/);
  });

  it('câu nghiệp vụ tiếng Việt giữ nguyên', () => {
    expect(translateFrameworkMessage('Kho nguồn và kho đích không được trùng nhau', 400)).toBe(
      'Kho nguồn và kho đích không được trùng nhau',
    );
  });
});

describe('AllExceptionsFilter (body trả về)', () => {
  const run = (exception: unknown): { code: number; message: string | string[] } => {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/api/v1/x', method: 'POST' }),
      }),
    };
    const cls = { isActive: () => false } as unknown as ClsService;
    const filter = new AllExceptionsFilter(cls);
    (filter as unknown as { logger: { error: jest.Mock } }).logger = { error: jest.fn() };
    filter.catch(exception, host as never);
    const [[code]] = status.mock.calls as unknown as [[number]];
    const [[body]] = json.mock.calls as [[{ message: string | string[] }]];
    return { code, message: body.message };
  };

  it('exception không truyền câu -> câu tiếng Việt', () => {
    expect(run(new UnauthorizedException()).message).toMatch(/Đăng nhập lại/);
    expect(run(new ForbiddenException()).message).toBe('Tài khoản không có quyền làm việc này');
    expect(run(new NotFoundException()).message).toBe('Không tìm thấy dữ liệu');
    expect(run(new ThrottlerException()).code).toBe(429);
    expect(run(new ThrottlerException()).message).toMatch(/Đợi khoảng 1 phút/);
  });

  it('câu nghiệp vụ và mảng câu validate giữ nguyên', () => {
    expect(run(new BadRequestException('Số lượng phải lớn hơn 0')).message).toBe(
      'Số lượng phải lớn hơn 0',
    );
    expect(run(new BadRequestException(['"code" phải là chữ'])).message).toEqual([
      '"code" phải là chữ',
    ]);
  });

  it('lỗi lạ -> 500 tiếng Việt, không lộ "Internal server error"', () => {
    const r = run(new Error('boom'));
    expect(r.code).toBe(500);
    expect(r.message).toBe(INTERNAL_ERROR_MESSAGE);
  });

  it('body-parser: JSON sai cú pháp (400) / quá lớn (413)', () => {
    const parseErr = Object.assign(new SyntaxError('Unexpected token'), {
      status: 400,
      type: 'entity.parse.failed',
    });
    expect(run(parseErr)).toEqual({ code: 400, message: 'Dữ liệu gửi lên sai định dạng' });
    const bigErr = Object.assign(new Error('request entity too large'), {
      status: 413,
      type: 'entity.too.large',
    });
    expect(run(bigErr)).toEqual({ code: 413, message: 'Dữ liệu hoặc file gửi lên quá lớn' });
  });
});
