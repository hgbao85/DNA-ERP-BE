import {
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

/**
 * Chiều dài cây sắt chọn cho từng quy cách: `{ "<materialId>": <mm> }`.
 *
 * Khoá là `Material.id` dạng chuỗi (BigInt không qua JSON được), giá trị là chiều dài cây tính
 * bằng mm. Thiếu khoá nào thì loại sắt đó dùng `SystemConfig.solverStockLengths` như trước.
 */
export type StockLengthsByMaterial = Record<string, number>;

/** Cây sắt ngắn hơn/dài hơn khoảng này là gõ sai đơn vị (nhập 6 hoặc 600 thay vì 6000), không
 *  phải nhu cầu thật - chặn ngay ở DTO thay vì để solver nhận rồi ra phương án vô nghĩa. */
export const MIN_STOCK_LENGTH_MM = 500;
export const MAX_STOCK_LENGTH_MM = 20_000;

/**
 * Kiểm `{ "<materialId>": <mm> }`: khoá phải là số nguyên dương (id vật tư), giá trị phải là số
 * trong khoảng hợp lý.
 *
 * Vì sao kiểm ở đây chứ không dựa vào solver: solver cố ý BỎ QUA lặng lẽ entry sai định dạng rồi
 * rơi về chiều dài chung (xem `_parse_stock_lengths_by_material` trong `api/views.py` của
 * cat_sat_iea - "khớp nhầm lặng lẽ tệ hơn bỏ qua"). Đúng cho solver, nhưng SAI cho người dùng:
 * KHSX chọn 5m85 rồi hệ thống âm thầm cắt 6m mà không báo gì. Nên ở BE phải bật lỗi ngay lúc gửi.
 *
 * CỐ Ý KHÔNG kiểm giá trị có nằm trong `SystemConfig.solverStockLengths` hay không - danh sách đó
 * hiện chỉ có [6000], chặn theo nó thì tính năng "linh hoạt chiều dài" vô dụng. Hệ quả nghiệp vụ
 * (mua được cỡ đó không) thuộc trách nhiệm KHSX, xem cảnh báo ở
 * `ProductionInvoice.solverStockLengthsByMaterial`.
 */
/**
 * Chuẩn hoá giá trị đến từ QUERY STRING về `{ "<materialId>": <number> }`.
 *
 * Nhận 3 dạng vì `qs` (bộ parse query của Express) trả ra 3 kiểu khác nhau cho cùng một ý:
 *
 * 1. **Chuỗi gọn** - `?stockLengthsByMaterial=7:5850,6:6000`. Đây là dạng DUY NHẤT chạy đúng
 *    trong mọi trường hợp, FE PHẢI dùng dạng này.
 * 2. **Object** - `?stockLengthsByMaterial[25]=5850`, CHỈ đúng khi id > 20 (xem bẫy bên dưới).
 *    Vẫn nhận vì là dữ liệu hợp lệ, nhưng KHÔNG được coi là hợp đồng.
 *
 * **BẪY, live-test 2026-09-16 mới lộ**: cú pháp ngoặc `[<id>]` với id <= 20 KHÔNG cứu được.
 * `qs` thấy khoá thuần số <= arrayLimit (mặc định 20) nên hiểu là CHỈ SỐ MẢNG và dựng mảng thưa;
 * rồi class-transformer NÉN mảng thưa lại trước khi gọi @Transform, nên thứ tới tay hàm này là
 * `[5850]` - **materialId đã bị xoá sạch, không có cách nào khôi phục**. Đo thật: id 7 ra khoá
 * "0", id 25 lại chạy bình thường - tức tính năng sống chết theo id vật tư to hay nhỏ.
 * Vì vậy mảng bị TỪ CHỐI thẳng (validator bật lỗi kèm hướng dẫn) thay vì đoán mò một id sai.
 *
 * Chỉ dùng cho @Query, KHÔNG dùng cho @Body: body là JSON nên số đã là số và object đã là object,
 * nhận thêm 3 dạng ở đó chỉ làm hợp đồng API mờ đi mà không giải quyết vấn đề gì có thật.
 *
 * Giá trị không ép được giữ NGUYÊN VĂN để validator bật lỗi - không âm thầm bỏ qua.
 */
export function coerceStockLengthsFromQuery(value: unknown): unknown {
  if (typeof value === 'string') {
    const out: Record<string, unknown> = {};
    for (const pair of value.split(',')) {
      if (pair.trim() === '') continue;
      const [k, v] = pair.split(':');
      if (v === undefined) return value; // sai cú pháp -> trả nguyên văn cho validator báo lỗi
      out[k.trim()] = toNumberOrKeep(v.trim());
    }
    return Object.keys(out).length > 0 ? out : value;
  }
  // Mảng: KHÔNG cố cứu. Chỉ số đã bị class-transformer nén mất nên mọi cách khôi phục đều là
  // đoán một materialId sai - trả nguyên văn để validator báo lỗi kèm hướng dẫn.
  if (Array.isArray(value)) return value;
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toNumberOrKeep(v)]),
  );
}

/** Ép về số nếu ép được, còn không thì GIỮ NGUYÊN để validator bật lỗi. */
function toNumberOrKeep(v: unknown): unknown {
  if (typeof v !== 'string' || v.trim() === '') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : v;
}
export function IsStockLengthsByMaterial(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStockLengthsByMaterial',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown): boolean {
          if (value === undefined || value === null) return true;
          if (typeof value !== 'object' || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length === 0) return false; // gửi {} là vô nghĩa - bỏ trống hẳn thay vì gửi rỗng
          return entries.every(
            ([key, mm]) =>
              /^[1-9]\d*$/.test(key) &&
              typeof mm === 'number' &&
              Number.isFinite(mm) &&
              mm >= MIN_STOCK_LENGTH_MM &&
              mm <= MAX_STOCK_LENGTH_MM,
          );
        },
        defaultMessage(args: ValidationArguments): string {
          const base =
            `${args.property} phải có dạng { "<materialId>": <mm> } - khoá là id vật tư (số ` +
            `nguyên dương), giá trị là chiều dài cây từ ${MIN_STOCK_LENGTH_MM} đến ` +
            `${MAX_STOCK_LENGTH_MM}mm (vd { "5": 5850 })`;
          // Ca hay gặp nhất khi tích hợp FE: gửi qua query bằng cú pháp ngoặc với id nhỏ -
          // materialId bị bộ parse query xoá mất, không phải lỗi giá trị. Nói thẳng cách sửa,
          // nếu không người tích hợp sẽ mất hàng giờ tưởng mình gửi sai số.
          return Array.isArray(args.value)
            ? `${base}. Qua query string PHẢI gửi dạng chuỗi ` +
                `"?${args.property}=<materialId>:<mm>,<materialId>:<mm>" - cú pháp ngoặc ` +
                `"[<id>]" với id <= 20 bị bộ parse query hiểu thành chỉ số mảng và làm mất id vật tư`
            : base;
        },
      },
    });
  };
}
