import { Transform } from 'class-transformer';
import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * 20/11/2026 (T2-5): `enableImplicitConversion` của ValidationPipe đổi chuỗi thành boolean TRƯỚC `@Transform`
 * (`Boolean('false')` = true, `Boolean('abc')` = true) nên `@Transform(({ value }) => value === 'true')` không phân
 * biệt được. Các decorator ở đây đọc giá trị GỐC `obj[key]` để sai kiểu còn lại nguyên cho `@IsBoolean` báo 400.
 */

/**
 * Boolean ở QUERY STRING: `'true'`/`true` -> true, `'false'`/`false` -> false; `allowNumeric` nhận thêm `'1'`/`'0'`.
 * Giá trị khác giữ nguyên (không đoán) để `@IsBoolean` báo lỗi.
 */
export function ToStrictBoolean(options: { allowNumeric?: boolean } = {}): PropertyDecorator {
  return Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => {
    const raw = obj[key];
    if (raw === true || raw === 'true') return true;
    if (raw === false || raw === 'false') return false;
    if (options.allowNumeric) {
      if (raw === '1') return true;
      if (raw === '0') return false;
    }
    return raw;
  });
}

/** Giá trị gốc ở BODY JSON (boolean / chuỗi): không cho ép kiểu ngầm, sai kiểu thì validator báo 400. */
export function KeepRawValue(): PropertyDecorator {
  return Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) => obj[key]);
}

/**
 * Trường ngày này phải >= trường ngày `otherField` (so 10 ký tự đầu `YYYY-MM-DD`). Thiếu một đầu thì bỏ qua
 * (các validator khác lo). Đặt trên `to`: `@IsOnOrAfterField('from')`.
 */
export function IsOnOrAfterField(
  otherField: string,
  options?: ValidationOptions,
): PropertyDecorator {
  return (object, propertyName) => {
    registerDecorator({
      name: 'isOnOrAfterField',
      target: object.constructor,
      propertyName: propertyName as string,
      constraints: [otherField],
      options: {
        message: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc',
        ...options,
      },
      validator: {
        validate: (value: unknown, args: ValidationArguments) => {
          const other = (args.object as Record<string, unknown>)[args.constraints[0] as string];
          if (typeof value !== 'string' || typeof other !== 'string') return true;
          if (value.length < 10 || other.length < 10) return true;
          return value.slice(0, 10) >= other.slice(0, 10);
        },
      },
    });
  };
}
