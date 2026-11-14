import type {
  CutAllocationChangeReason,
  CutAllocationLogAction,
} from '../../generated/prisma/client';
import type { SegmentStep } from '../cutting-proposals/proposal-segment-info.util';
import type { CutClass, CutMachineStatus, CutMachineType } from './cut-allocation.util';

// Kiểu trả về của CutAllocationService: hợp đồng với FE, tách riêng để service không phình.

export interface CutAllocationSegment {
  cutLengthMm: number;
  countPerBar: number;
  steps: SegmentStep[];
  pieceNames: string[];
}

export interface CutAllocationRow {
  id: string;
  workstationId: string;
  seq: number;
  isManual: boolean;
  productionInvoiceId: string;
  piCode: string;
  priority: { phoiStart: string | null; bookingDue: string | null; deadline: string | null };
  cuttingProposalId: string;
  patternId: string;
  patternIndex: number;
  patternBarCount: number;
  materialId: string;
  materialCode: string;
  materialLabel: string;
  barLengthMm: number | null;
  lineMachine: CutMachineType | null;
  machineClass: CutClass;
  barCount: number;
  segments: CutAllocationSegment[];
  punchedSegments: Array<{ cutLengthMm: number; countPerBar: number }> | null;
  bundles: Record<string, number> | null;
  /** Kiểu cắt theo bó: không tự tách sang máy khác, đổi máy chỉ khi máy hư. */
  isBundle: boolean;
  wastePerBarMm: number | null;
  lineSurplus: Array<{ cutLengthMm: number; surplus: number }>;
  hasBend: boolean;
  /** Ước số cây đã cắt của dòng, từ số đoạn đã báo ở chính máy này. */
  barsDoneEst: number;
  /** Máy của xưởng mà BE chấp nhận khi đổi máy / thêm dòng (cùng hàm kiểm tra với validate). */
  allowedMachineIds: string[];
}

/** Nhật ký sửa tay bảng chia máy (GET /floor/cut-allocation/log). */
export interface CutAllocationLogEntry {
  id: string;
  createdAt: Date;
  action: CutAllocationLogAction;
  reason: CutAllocationChangeReason | null;
  note: string | null;
  isBundle: boolean;
  barCount: number;
  previousBarCount: number | null;
  productionInvoiceId: string;
  piCode: string;
  materialLabel: string | null;
  fromMachine: { id: string; name: string } | null;
  toMachine: { id: string; name: string } | null;
  createdByName: string | null;
}

export interface CutAllocationLogResult {
  entries: CutAllocationLogEntry[];
  /** Lệnh có ít nhất 1 lần đổi máy (MOVE) hoặc tách (SPLIT) trong khoảng, nhiều lần nhất trước. */
  byOrder: Array<{
    productionInvoiceId: string;
    piCode: string;
    moves: number;
    splits: number;
    machineBrokenMoves: number;
  }>;
}

export interface CutAllocationBoard {
  workshop: { id: string; code: string; name: string; laserAllowed: boolean };
  machines: Array<{
    id: string;
    code: string;
    name: string;
    cutMachineType: CutMachineType;
    totalBars: number;
    rowCount: number;
    plannedSegments: number;
    reportedSegments: number;
    /**
     * Ước cây đã cắt / còn lại + trạng thái: EMPTY không có dòng, IDLE cắt hết, LOW còn ≤ 20 cây,
     * BUSY.
     */
    barsDoneEst: number;
    barsLeftEst: number;
    status: CutMachineStatus;
  }>;
  rows: CutAllocationRow[];
  unallocated: Array<{
    productionInvoiceId: string;
    piCode: string;
    materialId: string;
    materialLabel: string;
    bars: number;
  }>;
  waiting: Array<{
    productionInvoiceId: string;
    piCode: string;
    materialId: string;
    materialLabel: string;
    requiredBars: number;
    availableBars: number;
    shortBars: number;
    /** Cây đang giữ chỗ ở kho xưởng khác: không tính vào availableBars, phải chuyển kho trước. */
    heldElsewhereBars: number;
  }>;
  staleCount: number;
  warnings: string[];
}

/** Việc của 1 máy cắt ở màn quét. */
export interface CutMachineWork {
  rows: CutAllocationRow[];
  barsDoneEst: number;
  barsLeftEst: number;
  status: CutMachineStatus;
}

/** Tiến độ ước của 1 máy cắt, dùng cho nhắc "máy sắp hết việc / máy rảnh". */
export interface CutMachineProgressInfo {
  workstationId: string;
  name: string;
  workshopId: string;
  workshopName: string;
  totalBars: number;
  barsLeft: number;
  status: CutMachineStatus;
  /** Đổi khi việc của máy đổi (tổng cây + id dòng lớn nhất) -> nhắc mới cho việc mới. */
  signature: string;
}

/** Loại sắt của 1 lệnh chưa xuất đủ xuống Phôi: thủ kho cần xuất. */
export interface SteelGap {
  materialId: string;
  materialCode: string;
  materialLabel: string;
  requiredBars: number;
  issuedBars: number;
  missingBars: number;
  /**
   * Mã kho có giữ chỗ ACTIVE còn lại > 0 của (lệnh, loại sắt) thuộc xưởng này hoặc không gắn xưởng.
   */
  warehouseCodes: string[];
}

/** Kết quả 1 lần máy rảnh tự kéo lệnh kế tiếp. */
export interface CutAutoPullResult {
  workshopId: string;
  workshopName: string;
  /** Máy rảnh đã nhận việc. */
  machines: Array<{ id: string; name: string }>;
  orders: Array<{
    productionInvoiceId: string;
    piCode: string;
    /** Id nhỏ nhất của các dòng chia vừa tạo cho lệnh, làm khoá chống nhắc trùng. */
    firstAllocationId: string;
    lines: Array<{
      materialId: string;
      materialLabel: string;
      bars: number;
      machines: Array<{ id: string; name: string; bars: number }>;
    }>;
    /** Máy rảnh nhận việc của lệnh này. */
    idleMachineNames: string[];
    steelGaps: SteelGap[];
  }>;
}
