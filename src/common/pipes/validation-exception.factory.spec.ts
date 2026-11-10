import { plainToInstance, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
  validate,
} from 'class-validator';
import {
  flattenValidationErrors,
  validationExceptionFactory,
} from './validation-exception.factory';

enum Color {
  RED = 'RED',
  BLUE = 'BLUE',
}

class LineDto {
  @IsInt()
  @Min(1)
  quantity!: number;
}

class SampleDto {
  @IsString()
  @MaxLength(5)
  code!: string;

  @IsEnum(Color)
  color!: Color;

  @Matches(/^[a-z]+$/, { message: 'Mã chỉ gồm chữ thường' })
  slug!: string;

  @IsString({ each: true })
  tags!: string[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LineDto)
  lines!: LineDto[];
}

async function messagesOf(plain: Record<string, unknown>): Promise<string[]> {
  const errors = await validate(plainToInstance(SampleDto, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return flattenValidationErrors(errors);
}

const VALID = { code: 'AB', color: 'RED', slug: 'abc', tags: ['x'], lines: [{ quantity: 1 }] };

describe('validationExceptionFactory (câu lỗi validate tiếng Việt)', () => {
  it('dữ liệu đúng -> không có lỗi', async () => {
    expect(await messagesOf(VALID)).toEqual([]);
  });

  it('câu mặc định tiếng Anh -> tiếng Việt, giữ tham số ràng buộc', async () => {
    const msgs = await messagesOf({ ...VALID, code: 'ABCDEFG', color: 'GREEN' });
    expect(msgs).toContain('"code" chỉ được tối đa 5 ký tự');
    expect(msgs).toContain('"color" phải là một trong các giá trị: RED, BLUE');
  });

  it('câu tự đặt bằng tiếng Việt giữ nguyên', async () => {
    expect(await messagesOf({ ...VALID, slug: 'ABC' })).toEqual(['Mã chỉ gồm chữ thường']);
  });

  it('lỗi lồng nhau: chỉ rõ dòng (đếm từ 1) và trường', async () => {
    const msgs = await messagesOf({ ...VALID, lines: [{ quantity: 1 }, { quantity: 0 }] });
    expect(msgs).toEqual(['"lines › dòng 2 › quantity" không được nhỏ hơn 1']);
  });

  it('{ each: true } và mảng rỗng', async () => {
    const msgs = await messagesOf({ ...VALID, tags: [1], lines: [] });
    expect(msgs).toContain('Mỗi giá trị trong "tags" phải là chữ');
    expect(msgs).toContain('"lines" phải có ít nhất 1 dòng');
  });

  it('trường lạ (forbidNonWhitelisted) -> báo không được gửi', async () => {
    expect(await messagesOf({ ...VALID, hack: 1 })).toEqual([
      'Không được gửi "hack" (trường này không dùng ở đây)',
    ]);
  });

  it('không còn chữ tiếng Anh mặc định nào lọt ra', async () => {
    const msgs = await messagesOf({ code: 1, color: 1, slug: 1, tags: 'x', lines: 'x', hack: 1 });
    expect(msgs.length).toBeGreaterThan(0);
    for (const m of msgs) expect(m).not.toMatch(/\b(must|should|property|each value)\b/);
  });

  it('trả 400 với message là mảng (giữ đúng dạng Nest mặc định)', async () => {
    const errors = await validate(plainToInstance(SampleDto, { ...VALID, code: 1 }));
    const ex = validationExceptionFactory(errors);
    expect(ex.getStatus()).toBe(400);
    expect((ex.getResponse() as { message: string[] }).message).toContain('"code" phải là chữ');
  });
});
