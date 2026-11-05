/**
 * Phần A – Đợt 3 (YC10 10.2, 10.4, 10.10–10.15; kế hoạch phần A mục 3 + V4-12, V4-16): HỢP ĐỒNG kiểu dữ liệu của module năng lực.
 * Năng lực chỉ để CẢNH BÁO, không khoá. FE mirror ở `src/services/production-capacity-api.ts` - đổi ở đây thì đổi cả ở đó.
 * Ngày luôn là 'YYYY-MM-DD' theo giờ VN. Số cont làm tròn 3 chữ số thập phân khi trả ra.
 */

/** Công đoạn tính năng lực (v8 10.4). "Khung cơ khí" = Phôi + Hàn + Sơn nên không có dòng riêng. */
export type CapacityStage = 'PHOI' | 'HAN' | 'SON' | 'NHAP_DAN' | 'CHUYEN_KIEM' | 'DONG_GOI';

export const CAPACITY_STAGES: { stage: CapacityStage; label: string }[] = [
  { stage: 'PHOI', label: 'Phôi' },
  { stage: 'HAN', label: 'Hàn' },
  { stage: 'SON', label: 'Sơn' },
  { stage: 'NHAP_DAN', label: 'Nhập đan' },
  { stage: 'CHUYEN_KIEM', label: 'Chuyền kiểm' },
  { stage: 'DONG_GOI', label: 'Đóng gói' },
];

/**
 * Nhóm năng lực: Phôi/Hàn theo xưởng cơ khí của dòng; Sơn theo xưởng SƠN (Phước An -> Phú An, `Workshop.paintWorkshopId`);
 * Nhập đan / Chuyền kiểm / Đóng gói theo kho đóng gói (`ProductionInvoiceItem.warehouseCode`) - v8 10.12, 10.13.
 */
export type CapacityGroupKind = 'WORKSHOP' | 'WAREHOUSE';

export type CapacityMode = 'CONT_PER_DAY' | 'DAYS_PER_CONT';

/**
 * Nhập đan / Chuyền kiểm chỉ có 1 ngày mốc: coi lệnh làm trong X = ⌈cont ÷ năng lực⌉ ngày KẾT THÚC đúng ngày mốc (mặc định đang
 * chờ anh Nhân xác nhận - câu 2.2). Đổi thành false = dồn cả lệnh vào đúng 1 ngày mốc.
 */
export const SINGLE_DATE_STAGE_SPREAD_X_DAYS = true;

/**
 * Cảnh báo "chưa đủ 1 cont/ngày" chỉ xét dòng ĐÃ CÓ ngày bắt đầu Phôi (PHOI_START) - tránh "bão" cảnh báo lệnh cũ (V4-13).
 * Chấm ngày D lúc tin sáng 7h ngày D+1 (câu 2.3 - đang chờ anh Nhân xác nhận; đổi giờ ở daily-jobs DIGEST_HOUR_VN).
 */
export const DAILY_OUTPUT_REQUIRES_PHOI_START = true;

/** 1 lệnh (dòng SKU) đóng góp vào 1 ô ngày. */
export interface CapacityOrderLoad {
  itemId: string;
  piId: string;
  /** Mã lệnh hiển thị (số LSX, chưa có thì mã PI). */
  displayCode: string;
  skuCode: string;
  /** Cont của lệnh trong ĐÚNG ngày này = cont của dòng ÷ số ngày của khoảng. */
  cont: number;
  /** Khoảng ngày của công đoạn (đã lưu, hoặc đang thử ở /check). */
  from: string;
  to: string;
}

export interface CapacityDayCell {
  day: string;
  /** Tổng cont mọi lệnh trong ngày. */
  cont: number;
  orders: CapacityOrderLoad[];
  /** CONT_PER_DAY: cont > năng lực; DAYS_PER_CONT: từ 2 lệnh trở lên cùng chiếm ngày. */
  over: boolean;
}

/** 1 dòng bảng = 1 nhóm (xưởng/kho) × 1 công đoạn, đủ mọi ngày trong [from, to] (ngày không có việc: cont 0, orders []). */
export interface CapacityRow {
  groupKind: CapacityGroupKind;
  /** Mã xưởng (Workshop.code) hoặc mã kho đóng gói (warehouseCode). */
  groupCode: string;
  groupName: string;
  stage: CapacityStage;
  stageLabel: string;
  mode: CapacityMode;
  /** Trần cont/ngày (CONT_PER_DAY); null với DAYS_PER_CONT (kiểm chồng lệnh). */
  capacity: number | null;
  days: CapacityDayCell[];
}

export interface CapacityWarning {
  groupKind: CapacityGroupKind;
  groupCode: string;
  groupName: string;
  stage: CapacityStage;
  stageLabel: string;
  day: string;
  cont: number;
  capacity: number | null;
  itemIds: string[];
  /** vd "Phôi · Xưởng Phú An 12/11: 1,8 cont > 1,3 (MY-313, GP-176)" / "Phôi · Xưởng Phước An 12/11: 2 lệnh cùng chiếm ngày (…)". */
  message: string;
}

export interface CapacityMissingLoadCont {
  itemId: string;
  displayCode: string;
  skuCode: string;
}

/** GET /production-capacity?from&to */
export interface CapacityBoard {
  from: string;
  to: string;
  capacityContPerDay: number;
  daysPerContPhuocAn: number;
  rows: CapacityRow[];
  warnings: CapacityWarning[];
  /** Dòng đã có xưởng nhưng SKU chưa có load cont - không cộng được vào năng lực. */
  missingLoadCont: CapacityMissingLoadCont[];
}

/** POST /production-capacity/check - thử mốc đang sửa (chưa lưu) / xưởng-kho QLSX đang chọn. */
export interface CapacityCheckItemInput {
  itemId: string;
  /** Xưởng đang chọn (hộp QLSX); bỏ trống = xưởng đã lưu của dòng; dòng chưa có xưởng thì không xét Phôi/Hàn/Sơn (v8 10.10). */
  workshopId?: string | null;
  /** Kho đóng gói đang chọn; bỏ trống = kho đã lưu; chưa có kho thì không xét Nhập đan/Chuyền kiểm/Đóng gói. */
  warehouseCode?: string | null;
  /** Mốc đang sửa - ngày 'YYYY-MM-DD'; thiếu khoá nào thì dùng ngày đã lưu của dòng. */
  stages?: Partial<
    Record<
      | 'PHOI_START'
      | 'FRAME_PHOI'
      | 'FRAME_HAN'
      | 'FRAME_SON'
      | 'WEAVING'
      | 'TRANSFER_CHECK'
      | 'PACKAGING_START'
      | 'PACKAGING',
      string
    >
  >;
}

export interface CapacityCheckResult {
  /** Chỉ các cảnh báo CÓ dính tới dòng đang thử (đã cộng với mọi lệnh khác đang chạy). */
  warnings: CapacityWarning[];
  missingLoadCont: CapacityMissingLoadCont[];
}

/** Cảnh báo sản lượng 1 ngày (tin sáng, v8 10.4, 10.15) - service `DailyOutputService.alertsForDay(day)`. */
export interface DailyOutputAlert {
  groupKind: CapacityGroupKind;
  groupCode: string;
  groupName: string;
  stage: CapacityStage;
  stageLabel: string;
  /** Ngày được chấm (hôm qua so với lúc gửi tin sáng). */
  day: string;
  mode: CapacityMode;
  /** Cont đã làm (ngày D; Phước An: luỹ kế tới hết khối 4 ngày). */
  doneCont: number;
  /** Ngưỡng: min(1 cont, phần còn lại của công đoạn đầu ngày) - Phước An: số khối × 1 cont (chặn trần tổng). */
  thresholdCont: number;
  /** Phôi: ước tính theo tỷ lệ đoạn cắt (chưa đồng bộ theo mảnh). */
  estimated: boolean;
  itemIds: string[];
  displayCodes: string[];
  /** vd "Phôi · Xưởng Phú An 03/11: làm 0,6/1 cont (ước tính theo đoạn cắt) - MY-313". */
  message: string;
}
