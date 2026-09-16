import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BatchStockLengthsQueryDto } from './cutting-batch-candidate.dto';

/**
 * Chiều dài cây đi qua QUERY STRING (2 endpoint GET dựng bảng ở màn "Tối ưu cắt sắt").
 *
 * Tách ra test riêng vì đây là chỗ DUY NHẤT mà kiểu dữ liệu bị đổi giữa đường: Express (qs) parse
 * `?stockLengthsByMaterial[200]=5850` ra `{ "200": "5850" }` - CHUỖI. Test gọi thẳng service không
 * bao giờ chạm vào chuyện này, nên không có test ở đây thì lỗi "chọn 5850 mà BE trả 400" chỉ lộ ra
 * lúc bấm thật trên FE.
 */
describe('BatchStockLengthsQueryDto', () => {
  const parse = async (payload: Record<string, unknown>) => {
    const dto = plainToInstance(BatchStockLengthsQueryDto, payload);
    return { dto, errors: (await validate(dto)).map((e) => e.property) };
  };

  it('ép chuỗi từ query string về số - đúng cái qs trả ra', async () => {
    const { dto, errors } = await parse({ stockLengthsByMaterial: { '200': '5850' } });
    expect(errors).toEqual([]);
    expect(dto.stockLengthsByMaterial).toEqual({ '200': 5850 });
  });

  it('nhận dạng chuỗi gọn "<id>:<mm>" - hợp đồng chính cho query string', async () => {
    const { dto, errors } = await parse({ stockLengthsByMaterial: '7:5850,6:6000' });
    expect(errors).toEqual([]);
    expect(dto.stockLengthsByMaterial).toEqual({ '6': 6000, '7': 5850 });
  });

  it('TỪ CHỐI mảng kèm hướng dẫn - không đoán bừa materialId', async () => {
    // Bẫy bắt được khi live-test 2026-09-16: `?stockLengthsByMaterial[7]=5850` bị qs hiểu là chỉ
    // số mảng (id <= arrayLimit 20), rồi class-transformer NÉN mảng thưa nên materialId bị xoá
    // sạch - tới tay code chỉ còn `[5850]`. Mọi cách "khôi phục" đều là đoán một id sai, mà đoán
    // sai ở đây nghĩa là áp chiều dài cây cho NHẦM loại sắt rồi cắt thật. Phải từ chối thẳng.
    const dto = plainToInstance(BatchStockLengthsQueryDto, { stockLengthsByMaterial: [5850] });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('stockLengthsByMaterial');
    expect(Object.values(errors[0].constraints ?? {}).join(' ')).toContain('<materialId>:<mm>');
  });

  it('nhận nhiều quy cách cùng lúc', async () => {
    const { dto, errors } = await parse({
      stockLengthsByMaterial: { '200': '5850', '300': '6000' },
    });
    expect(errors).toEqual([]);
    expect(dto.stockLengthsByMaterial).toEqual({ '200': 5850, '300': 6000 });
  });

  it('không gửi gì thì hợp lệ - bảng tính theo cây chuẩn của công ty như trước', async () => {
    const { dto, errors } = await parse({});
    expect(errors).toEqual([]);
    expect(dto.stockLengthsByMaterial).toBeUndefined();
  });

  it('chuỗi KHÔNG ép được thì giữ nguyên để validator bật lỗi, không âm thầm bỏ qua', async () => {
    // Âm thầm bỏ qua là đúng cho solver nhưng SAI cho người dùng: KHSX chọn xong, hệ thống lặng lẽ
    // cắt cây khác mà không báo gì.
    const { errors } = await parse({ stockLengthsByMaterial: { '200': 'sáu mét' } });
    expect(errors).toContain('stockLengthsByMaterial');
  });

  it('vẫn chặn sai đơn vị dù đến từ query string', async () => {
    expect((await parse({ stockLengthsByMaterial: { '200': '6' } })).errors).toContain(
      'stockLengthsByMaterial',
    );
  });

  it('vẫn chặn khoá không phải id vật tư', async () => {
    expect(
      (await parse({ stockLengthsByMaterial: { 'SAT-VUONG-20X20': '5850' } })).errors,
    ).toContain('stockLengthsByMaterial');
  });
});
