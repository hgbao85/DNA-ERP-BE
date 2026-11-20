import { Logger } from '@nestjs/common';
import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsDefined,
  IsNumber,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  validate,
} from 'class-validator';
import {
  flattenValidationErrors,
  validationExceptionFactory,
} from './validation-exception.factory';
import { IsSystemUploadUrl } from '../validators/system-upload-url.validator';
import { FIELD_LABELS } from './validation-field-labels';

enum Color {
  RED = 'RED',
  BLUE = 'BLUE',
}

class LineDto {
  @IsInt()
  @Min(1)
  qty!: number;
}

class SampleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  reason!: string;

  @IsInt()
  @Min(1)
  @Max(100)
  limit!: number;

  @IsEnum(Color)
  status!: Color;

  @Matches(/^[a-z]+$/, { message: 'Mã chỉ gồm chữ thường' })
  note!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  signedSlipUrls!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  items!: LineDto[];

  // Tên không có trong bảng nhãn
  @IsOptional()
  @IsInt()
  zzzNoLabel?: number;
}

async function messagesOf(plain: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(SampleDto, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return flattenValidationErrors(errors);
}

const VALID = {
  reason: 'ab',
  limit: 10,
  status: 'RED',
  note: 'abc',
  signedSlipUrls: ['x'],
  items: [{ qty: 1 }],
};

describe('validationExceptionFactory (câu lỗi validate tiếng Việt)', () => {
  it('dữ liệu đúng -> không có lỗi', async () => {
    expect(await messagesOf(VALID)).toEqual([]);
  });

  it('câu mặc định tiếng Anh -> tiếng Việt, nhãn tiếng Việt, giữ tham số ràng buộc', async () => {
    const msgs = await messagesOf({ ...VALID, reason: 'ABCDEFG', status: 'GREEN' });
    expect(msgs).toContain('Lý do chỉ được tối đa 5 ký tự');
    expect(msgs).toContain('Trạng thái phải là một trong các giá trị: RED, BLUE');
  });

  it('câu tự đặt bằng tiếng Việt giữ nguyên', async () => {
    expect(await messagesOf({ ...VALID, note: 'ABC' })).toEqual(['Mã chỉ gồm chữ thường']);
  });

  it('thiếu trường (không gửi / null / rỗng) -> đúng MỘT câu "Thiếu ..."', async () => {
    expect(await messagesOf({ ...VALID, reason: undefined })).toEqual(['Thiếu lý do']);
    expect(await messagesOf({ ...VALID, reason: null })).toEqual(['Thiếu lý do']);
    expect(await messagesOf({ ...VALID, reason: '' })).toEqual(['Thiếu lý do']);
    expect(await messagesOf({ ...VALID, limit: undefined })).toEqual(['Thiếu số dòng mỗi trang']);
    expect(await messagesOf({ ...VALID, signedSlipUrls: [] })).toEqual(['Thiếu ảnh phiếu đã ký']);
  });

  it('sai nhiều ràng buộc: chỉ báo một câu, kiểu dữ liệu trước khoảng', async () => {
    // limit = "x" -> NaN/không phải số: vi phạm isInt + min + max, chỉ còn câu kiểu
    expect(await messagesOf({ ...VALID, limit: 'x' })).toEqual([
      'Số dòng mỗi trang phải là số nguyên',
    ]);
    // limit = 0 -> chỉ vi phạm min
    expect(await messagesOf({ ...VALID, limit: 0 })).toEqual([
      'Số dòng mỗi trang không được nhỏ hơn 1',
    ]);
    expect(await messagesOf({ ...VALID, reason: 123456 })).toEqual(['Lý do phải là chữ']);
  });

  it('nhiều trường lỗi: mỗi trường một câu', async () => {
    const msgs = await messagesOf({ ...VALID, reason: undefined, limit: 0, status: 'GREEN' });
    expect(msgs).toHaveLength(3);
  });

  it('lỗi lồng nhau: "Dòng N: <nhãn>" (đếm từ 1)', async () => {
    const msgs = await messagesOf({ ...VALID, items: [{ qty: 1 }, { qty: 0 }] });
    expect(msgs).toEqual(['Dòng 2: số lượng không được nhỏ hơn 1']);
    expect(await messagesOf({ ...VALID, items: [{}] })).toEqual(['Dòng 1: thiếu số lượng']);
  });

  it('{ each: true } và mảng rỗng', async () => {
    const msgs = await messagesOf({ ...VALID, signedSlipUrls: [1], items: [] });
    expect(msgs).toContain('Mỗi giá trị trong ảnh phiếu đã ký phải là chữ');
    expect(msgs).toContain('Thiếu danh sách dòng');
  });

  it('tên không có trong bảng nhãn -> nói chung, không lộ tên tiếng Anh', async () => {
    const msgs = await messagesOf({ ...VALID, zzzNoLabel: 'x' });
    expect(msgs).toEqual(['Một trường dữ liệu phải là số nguyên']);
    expect(msgs.join('')).not.toContain('zzzNoLabel');
  });

  it('trường lạ (forbidNonWhitelisted) -> báo không được gửi, không lộ tên tiếng Anh', async () => {
    const msgs = await messagesOf({ ...VALID, hack: 1 });
    expect(msgs).toEqual(['Không được gửi một trường dữ liệu (trường này không dùng ở đây)']);
  });

  it('không còn chữ tiếng Anh mặc định / tên thuộc tính nào lọt ra', async () => {
    const msgs = await messagesOf({
      reason: 1,
      limit: 'x',
      status: 1,
      note: 1,
      signedSlipUrls: 'x',
      items: 'x',
      hack: 1,
    });
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) {
      expect(m).not.toMatch(/\b(must|should|property|each value)\b/);
      expect(m).not.toMatch(/"|signedSlipUrls|reason|limit|items/);
    }
  });

  it('bảng nhãn: mọi nhãn bắt đầu bằng chữ thường, không chứa tên tiếng Anh trong ngoặc', () => {
    for (const [k, v] of Object.entries(FIELD_LABELS)) {
      expect(v.charAt(0)).toBe(v.charAt(0).toLowerCase()); // chữ đầu viết thường (cho phép từ viết tắt như PIN, SKU)
      expect(v).not.toMatch(/["]/);
      expect(v.length).toBeGreaterThan(0);
      expect(k).toMatch(/^[a-zA-Z0-9]+$/);
    }
  });

  it('trả 400 với message là mảng (giữ đúng dạng Nest mặc định)', async () => {
    const errors = await validate(plainToInstance(SampleDto, { ...VALID, reason: 1 }));
    const ex = validationExceptionFactory(errors);
    expect(ex.getStatus()).toBe(400);
    expect((ex.getResponse() as { message: string[] }).message).toContain('Lý do phải là chữ');
  });
});

// --- Đợt sửa 19/11 (QA): thiếu = undefined/null; rỗng chỉ thiếu khi bắt buộc nhập; câu tự đặt theo rank; log ---
class ReceivedLine {
  @IsNumber({ maxDecimalPlaces: 4 }, { message: 'Số lượng tối đa 4 chữ số thập phân' })
  @Min(0)
  receivedQty!: number;
}

class MixedDto {
  // Không bắt buộc nhập: chuỗi rỗng là giá trị sai độ dài / định dạng, không phải "thiếu"
  @IsString()
  @MaxLength(3)
  @Matches(/^[a-z]+$/)
  note!: string;

  // Bắt buộc nhập: chuỗi rỗng = thiếu
  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsArray()
  @ArrayMinSize(2)
  tags!: string[];

  @IsArray()
  signedSlipUrls!: string[];

  // Nhiều câu tự đặt: chọn theo rank (isInt trước min), không theo thứ tự khai báo
  @Min(1, { message: 'Phần trăm không được nhỏ hơn 1' })
  @IsInt({ message: 'Phần trăm phải là số nguyên' })
  @IsDefined()
  pieceId!: number;

  @ValidateNested({ each: true })
  @Type(() => ReceivedLine)
  @IsDefined()
  items!: ReceivedLine[];
}

async function mixedMessages(plain: Record<string, unknown>): Promise<string[]> {
  return flattenValidationErrors(await validate(plainToInstance(MixedDto, plain)));
}

const MIXED_OK = {
  note: 'ab',
  reason: 'x',
  tags: ['a', 'b'],
  signedSlipUrls: [],
  pieceId: 1,
  items: [{ receivedQty: 1 }],
};

describe('validationExceptionFactory - đợt sửa 19/11', () => {
  it('chuỗi rỗng / mảng rỗng chỉ là "thiếu" khi trường bắt buộc nhập', async () => {
    expect(await mixedMessages({ ...MIXED_OK })).toEqual([]);
    expect(await mixedMessages({ ...MIXED_OK, note: '' })).toEqual(['Ghi chú sai định dạng']);
    expect(await mixedMessages({ ...MIXED_OK, reason: '' })).toEqual(['Thiếu lý do']);
    expect(await mixedMessages({ ...MIXED_OK, tags: [] })).toEqual(['Thiếu một trường dữ liệu']);
    expect(await mixedMessages({ ...MIXED_OK, tags: ['a'] })).toEqual([
      'Một trường dữ liệu phải có ít nhất 2 dòng',
    ]);
    // mảng rỗng hợp lệ khi không có ràng buộc bắt buộc nhập
    expect(await mixedMessages({ ...MIXED_OK, signedSlipUrls: [] })).toEqual([]);
  });

  it('câu tự đặt nhiều: chọn theo rank (isInt trước min), không theo thứ tự khai báo', async () => {
    expect(await mixedMessages({ ...MIXED_OK, pieceId: 0.5 })).toEqual([
      'Phần trăm phải là số nguyên',
    ]);
  });

  it('thiếu trường bắt buộc: "Thiếu ..." thắng câu tự đặt về khoảng / số lẻ; có tiền tố dòng', async () => {
    expect(await mixedMessages({ ...MIXED_OK, items: [{}] })).toEqual([
      'Dòng 1: thiếu số lượng đã nhận',
    ]);
    expect(
      await mixedMessages({ ...MIXED_OK, items: [{ receivedQty: 1 }, { receivedQty: null }] }),
    ).toEqual(['Dòng 2: thiếu số lượng đã nhận']);
  });

  it('câu tự đặt ở dòng lồng nhau có tiền tố "Dòng N: "', async () => {
    expect(
      await mixedMessages({ ...MIXED_OK, items: [{ receivedQty: 1 }, { receivedQty: 1.23456 }] }),
    ).toEqual(['Dòng 2: số lượng tối đa 4 chữ số thập phân']);
  });

  it('ghi log warn: đường dẫn thật + tên ràng buộc, không ghi giá trị người dùng gửi', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const errors = await validate(
        plainToInstance(MixedDto, {
          ...MIXED_OK,
          items: [{ receivedQty: 'BI-MAT-123' }],
          reason: 'SECRET-VALUE',
          pieceId: 'SECRET-PIECE',
        }),
      );
      const ex = validationExceptionFactory(errors);
      expect(ex.getStatus()).toBe(400);
      expect(warn).toHaveBeenCalledTimes(1);
      const line = String(warn.mock.calls[0][0]);
      expect(line).toContain('items.0.receivedQty');
      expect(line).toContain('isNumber');
      expect(line).toContain('pieceId');
      expect(line).not.toContain('BI-MAT-123');
      expect(line).not.toContain('SECRET');
    } finally {
      warn.mockRestore();
    }
  });

  it('nhãn: mảnh / chi tiết không bị đảo', () => {
    expect(FIELD_LABELS.pieceId).toBe('mảnh');
    expect(FIELD_LABELS.partId).toBe('chi tiết');
    expect(FIELD_LABELS.qtyPerPiece).toBe('số lượng trên một mảnh');
    expect(FIELD_LABELS.qtyPerPart).toBe('số lượng trên một chi tiết');
  });

  // 20/11/2026 (T1-8 / T4-10): câu tiếng Việt cho bộ kiểm tệp đã tải lên hệ thống.
  it('isSystemUploadUrl: câu tiếng Việt, có "Mỗi giá trị trong" khi each và "Dòng N:" khi lồng', async () => {
    class UrlLine {
      @IsSystemUploadUrl()
      imageUrl!: string;
    }
    class UrlDto {
      @IsSystemUploadUrl({ each: true })
      signedSlipUrls!: string[];

      @ValidateNested({ each: true })
      @Type(() => UrlLine)
      lines!: UrlLine[];
    }
    const dto = plainToInstance(UrlDto, {
      signedSlipUrls: ['javascript:alert(1)'],
      lines: [{ imageUrl: '' }, { imageUrl: 'javascript:alert(1)' }],
    });
    const out = flattenValidationErrors(await validate(dto));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/^Mỗi giá trị trong ảnh phiếu đã ký phải là tệp đã tải lên hệ thống/);
    expect(out[1]).toMatch(/^Dòng 2: ảnh phải là tệp đã tải lên hệ thống/);
  });
});
