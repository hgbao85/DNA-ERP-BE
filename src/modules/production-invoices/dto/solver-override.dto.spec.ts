import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SolverOverrideDto } from './solver-override.dto';

/**
 * Thông số cắt đặc cách KHSX đề nghị - Sếp chấp thuận bằng chính nút Duyệt lệnh sản xuất, nên lý
 * do là thứ DUY NHẤT Sếp đọc để quyết định chi thêm tiền sắt. Khoá luật ở tầng DTO (ValidationPipe
 * dựng với whitelist+transform, xem main.ts) thay vì dựng cả HTTP stack - đúng tiền lệ
 * create-material.dto.spec.ts.
 */
describe('SolverOverrideDto', () => {
  const errorsOn = async (payload: Record<string, unknown>) =>
    (await validate(plainToInstance(SolverOverrideDto, payload))).map((e) => e.property);

  it('không xin gì thì hợp lệ - phần lớn đợt cắt không cần đặc cách', async () => {
    expect(await errorsOn({})).toEqual([]);
  });

  it('có ngưỡng đặc cách thì BẮT BUỘC kèm lý do', async () => {
    expect(await errorsOn({ solverMaxWastePctOverride: 3 })).toContain('solverOverrideReason');
  });

  it('lý do chỉ gồm khoảng trắng KHÔNG được tính là có lý do', async () => {
    // Bắt được khi dò bug qua API thật (2026-09-14): "   " dài 3 ký tự nên lọt @MinLength(1),
    // PI lưu xuống DB với lý do rỗng trơn và Sếp duyệt một đề nghị không có căn cứ nào. FE có tự
    // trim nhưng đường API gọi thẳng thì không đi qua FE.
    expect(await errorsOn({ solverMaxWastePctOverride: 3, solverOverrideReason: '   ' })).toContain(
      'solverOverrideReason',
    );
  });

  it('nhận đề nghị hợp lệ và cắt khoảng trắng thừa quanh lý do', async () => {
    const dto = plainToInstance(SolverOverrideDto, {
      solverMaxWastePctOverride: 2,
      solverAllowCustomLength: false,
      solverOverrideReason: '  PO-4 giao gấp  ',
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto.solverOverrideReason).toBe('PO-4 giao gấp');
  });

  it('từ chối ngưỡng ngoài khoảng (0, 100]', async () => {
    expect(await errorsOn({ solverMaxWastePctOverride: 0, solverOverrideReason: 'x' })).toContain(
      'solverMaxWastePctOverride',
    );
    expect(await errorsOn({ solverMaxWastePctOverride: 150, solverOverrideReason: 'x' })).toContain(
      'solverMaxWastePctOverride',
    );
  });

  it('cờ cấm đặt cây ngoài chuẩn đứng ĐỘC LẬP - không kéo theo yêu cầu lý do', async () => {
    expect(await errorsOn({ solverAllowCustomLength: false })).toEqual([]);
  });

  describe('solverStockLengthsByMaterial - chiều dài cây theo từng quy cách (2026-09-16)', () => {
    const KEY = 'solverStockLengthsByMaterial';

    it('nhận map hợp lệ { materialId: mm }', async () => {
      expect(await errorsOn({ [KEY]: { '5': 5850, '6': 6000 } })).toEqual([]);
    });

    it('bỏ trống vẫn hợp lệ - đợt không chọn gì thì cắt cây chuẩn như trước', async () => {
      expect(await errorsOn({})).toEqual([]);
    });

    it('từ chối khoá không phải id vật tư - solver sẽ BỎ QUA lặng lẽ nên phải chặn ở đây', async () => {
      // Đây là lý do chính phải kiểm ở BE: _parse_stock_lengths_by_material bên solver cố ý bỏ
      // qua entry sai rồi rơi về chiều dài chung, tức KHSX chọn 5m85 mà hệ thống âm thầm cắt 6m.
      expect(await errorsOn({ [KEY]: { 'SAT-VUONG-50X50': 5850 } })).toContain(KEY);
      expect(await errorsOn({ [KEY]: { '0': 5850 } })).toContain(KEY);
      expect(await errorsOn({ [KEY]: { '-1': 5850 } })).toContain(KEY);
    });

    it('từ chối chiều dài sai đơn vị (gõ 6 hoặc 600 thay vì 6000)', async () => {
      expect(await errorsOn({ [KEY]: { '5': 6 } })).toContain(KEY);
      expect(await errorsOn({ [KEY]: { '5': 400 } })).toContain(KEY);
      expect(await errorsOn({ [KEY]: { '5': 25_000 } })).toContain(KEY);
    });

    it('từ chối giá trị không phải số', async () => {
      expect(await errorsOn({ [KEY]: { '5': '5850' } })).toContain(KEY);
      expect(await errorsOn({ [KEY]: { '5': null } })).toContain(KEY);
    });

    it('từ chối mảng và object rỗng - gửi {} là vô nghĩa, bỏ trống hẳn thay vì gửi rỗng', async () => {
      expect(await errorsOn({ [KEY]: [5850, 6000] })).toContain(KEY);
      expect(await errorsOn({ [KEY]: {} })).toContain(KEY);
    });

    it('đứng ĐỘC LẬP với ngưỡng đặc cách - chọn cây riêng không phải là xin đặc cách', async () => {
      // 2 trục tách bạch giống solverAllowCustomLength: chọn cắt trên cây 5m85 là quyết định kỹ
      // thuật của KHSX, không phải lời xin Sếp nới ngưỡng hao hụt nên KHÔNG đòi lý do.
      expect(await errorsOn({ [KEY]: { '5': 5850 } })).toEqual([]);
    });
  });
});
