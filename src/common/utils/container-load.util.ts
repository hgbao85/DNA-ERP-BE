/**
 * Phần A – Đợt 1 (YC9, bản yêu cầu v8 mục 9): thể tích thùng và "load cont" (số bộ xếp được trên 1 cont) của 1 SKU.
 *
 *   load cont (công thức) = ⌊ thể tích cont ÷ (thể tích 1 thùng × số thùng / bộ) ⌋
 *   load cont (hiệu lực)  = số KHSX/NV định mức nhập tay (nếu có) ?? load cont công thức
 *
 * Thể tích cont mặc định 68 m³ (cont 40HC) - SystemConfig.containerVolumeM3, Admin sửa được. Bản v8 ghi "68 ÷ thể tích
 * thùng"; với bộ nhiều thùng (vd "I2 góc + 1 bàn") chia thêm cho số thùng/bộ (kế hoạch kỹ thuật 04/11, ghi rõ ở Hướng dẫn).
 *
 * TÍNH BẰNG SỐ NGUYÊN, không dùng số thực: 68 ÷ (85 × 80 × 100 / 10⁶) bằng số thực ra 99,99999999999999 → làm tròn xuống thành
 * 99 thay vì 100 (kế hoạch phần A, vòng 4 V4-1). Đổi hết ra mm / mm³ nguyên rồi mới chia: A = thể tích cont (mm³), B = dài ×
 * rộng × cao (mm, đã ×10 từ cm 1 số lẻ) × số thùng/bộ. Với A, B nguyên và B ≤ 10⁴·10⁴·10⁴·20 thì phép chia số thực A/B chỉ có
 * thể "nhảy" sang số nguyên kế bên khi thương thật CÁCH số nguyên < 1/B - không xảy ra vì thương của 2 số nguyên khác số
 * nguyên ít nhất 1/B; nên Math.floor(A / B) đúng. FE dùng cùng công thức (src/utils/containerLoad.ts) và cùng bộ ví dụ test.
 */

export type ContainerLoadSource = 'MANUAL' | 'FORMULA';

export interface ContainerLoadInput {
  boxLengthCm: number | null;
  boxWidthCm: number | null;
  boxHeightCm: number | null;
  /** Số thùng của 1 bộ (mặc định 1). */
  boxesPerSet: number;
  /** Load cont nhập tay (khách quy định / xếp thực tế khác công thức) - có thì dùng số này. */
  loadContManual: number | null;
}

export interface ContainerLoadResult {
  /** Thể tích 1 thùng (m³), làm tròn 4 chữ số thập phân - chỉ để hiển thị; null khi thiếu kích thước. */
  boxVolumeM3: number | null;
  /** Load cont theo công thức; null khi thiếu kích thước. */
  loadContFormula: number | null;
  /** Load cont hiệu lực = nhập tay ?? công thức; null khi chưa có cả hai. */
  loadCont: number | null;
  source: ContainerLoadSource | null;
}

/** cm có tối đa 1 chữ số thập phân → mm nguyên. */
const cmToMm = (cm: number): number => Math.round(cm * 10);

const isPositive = (n: number | null | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0;

export function computeContainerLoad(
  input: ContainerLoadInput,
  containerVolumeM3: number,
): ContainerLoadResult {
  const { boxLengthCm, boxWidthCm, boxHeightCm, loadContManual } = input;
  const boxesPerSet = isPositive(input.boxesPerSet) ? Math.round(input.boxesPerSet) : 1;

  let boxVolumeM3: number | null = null;
  let loadContFormula: number | null = null;
  if (isPositive(boxLengthCm) && isPositive(boxWidthCm) && isPositive(boxHeightCm)) {
    const boxMm3 = cmToMm(boxLengthCm) * cmToMm(boxWidthCm) * cmToMm(boxHeightCm);
    boxVolumeM3 = Math.round(boxMm3 / 100_000) / 10_000; // mm³ → m³ (÷10⁹), 4 số lẻ
    if (isPositive(containerVolumeM3) && boxMm3 > 0) {
      // m³ (2 số lẻ) → mm³ nguyên: ×100 rồi ×10⁷.
      const containerMm3 = Math.round(containerVolumeM3 * 100) * 10_000_000;
      loadContFormula = Math.floor(containerMm3 / (boxMm3 * boxesPerSet));
    }
  }

  const manual = isPositive(loadContManual) ? Math.round(loadContManual) : null;
  const loadCont = manual ?? loadContFormula;
  const source: ContainerLoadSource | null =
    manual !== null ? 'MANUAL' : loadContFormula !== null ? 'FORMULA' : null;
  return { boxVolumeM3, loadContFormula, loadCont, source };
}

/**
 * Số "cont tương đương" của `qty` bộ (dùng ở đơn hàng, lệnh SX, năng lực Đợt 3, booking Đợt 10a). null khi SKU chưa có
 * load cont hoặc load cont = 0. Không làm tròn - nơi hiển thị tự định dạng.
 */
export function contEquivalent(qty: number, loadCont: number | null | undefined): number | null {
  if (!isPositive(loadCont)) return null;
  return qty / loadCont;
}
