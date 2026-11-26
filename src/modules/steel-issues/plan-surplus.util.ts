import { PrismaServiceType, PrismaTx } from '../../prisma/prisma.service';
import { normalizeSegmentSteps } from '../../common/utils/segment-code.util';
import { PlanSurplusRow } from './phoi-need.util';

/**
 * Đoạn DƯ theo phương án cắt đã duyệt (anh Nhân câu 9-13, 24/11/2026): cây mua cuối được cắt khúc thừa thành đoạn dư, đoạn dư làm
 * đủ công đoạn như đoạn của lệnh rồi qua KCS, đạt thì vào phần dư chung kho Phôi. Trước đây tổ cắt / công đoạn phụ bị chặn ở số
 * cần (đoạn dư "để riêng dưới xưởng, không báo").
 *
 * Dư của 1 phương án theo cỡ đoạn = Σ (số cây kiểu cắt × số đoạn/cây) − Σ số cần định mức của MỌI SKU phương án phủ (kể cả SKU đã
 * huỷ: phần của nó đi đường Q3 riêng, không cộng sang SKU khác để khỏi cho cắt 2 lần). Gán hết cho SKU CÒN CHẠY có id nhỏ nhất
 * dùng cỡ đó (chỉ để có chỗ ghi; tồn đoạn tính theo cả PI nên SKU nào nhận không đổi số vào kho).
 *
 * Câu 14a (cùng ngày): phương án đã lấy đoạn dư trong kho (nhật ký giữ đoạn SURPLUS_IN refType CUTTING_PROPOSAL, refId = phương
 * án, trừ phần đã nhả) -> dòng `fromStockSteps` GIẢM số cần cắt + công đoạn của SKU (chia cho các SKU còn chạy có đúng cỡ + bộ
 * công đoạn đó theo số cần từng SKU - mục 3.3 review IT 26/11), và dư theo phương án tính trên số cần đã trừ.
 *
 * `orderIds`: các SKU đang xét (thường mọi lệnh của 1 PI). Trả các dòng của SKU trong `orderIds`.
 */
export async function loadPlanSurplus(
  db: PrismaTx | PrismaServiceType,
  orderIds: readonly bigint[],
): Promise<PlanSurplusRow[]> {
  if (orderIds.length === 0) return [];
  const mine = await db.cuttingPlanCoverage.findMany({
    where: { productionOrderId: { in: [...orderIds] }, cuttingProposal: { status: 'APPROVED' } },
    select: { cuttingProposalId: true },
  });
  const proposalIds = [...new Set(mine.map((c) => c.cuttingProposalId))];
  if (proposalIds.length === 0) return [];
  const [coverage, segments, stockLogs] = await Promise.all([
    db.cuttingPlanCoverage.findMany({
      where: { cuttingProposalId: { in: proposalIds } },
      select: {
        cuttingProposalId: true,
        productionOrder: {
          select: { id: true, bomRevisionId: true, quantity: true, status: true },
        },
      },
    }),
    db.cuttingProposalPatternSegment.findMany({
      where: { pattern: { line: { cuttingProposalId: { in: proposalIds } } } },
      select: {
        segmentSpecId: true,
        countPerBar: true,
        pattern: { select: { barCount: true, line: { select: { cuttingProposalId: true } } } },
      },
    }),
    db.segmentReservationLog.findMany({
      where: {
        refType: 'CUTTING_PROPOSAL',
        refId: { in: proposalIds.map((id) => id.toString()) },
        kind: { in: ['SURPLUS_IN', 'RELEASE'] },
      },
      select: {
        refId: true,
        kind: true,
        qty: true,
        reservation: { select: { segmentSpecId: true, segmentSteps: true } },
      },
    }),
  ]);
  const revIds = [...new Set(coverage.map((c) => c.productionOrder.bomRevisionId))];
  // Cỡ đoạn được đoạn dư trong kho phủ HẾT không còn trong kiểu cắt nào - vẫn phải nạp định mức của nó để gán phần lấy từ kho
  // (thử sống 25/11: lệnh gộp lấy đủ 8 đoạn 420 từ kho mà tổ Phôi vẫn thấy cần 8).
  const specIds = [
    ...new Set([
      ...segments.map((s) => s.segmentSpecId.toString()),
      ...stockLogs.map((l) => l.reservation.segmentSpecId.toString()),
    ]),
  ].map((v) => BigInt(v));
  if (revIds.length === 0 || specIds.length === 0) return [];
  const [bomPieces, pieceBoms] = await Promise.all([
    db.bomPiece.findMany({
      where: { bomRevisionId: { in: revIds } },
      select: { bomRevisionId: true, pieceId: true, qtyPerUnit: true },
    }),
    db.pieceBom.findMany({
      where: { bomRevisionId: { in: revIds }, segmentSpecId: { in: specIds } },
      select: {
        bomRevisionId: true,
        pieceId: true,
        segmentSpecId: true,
        qtyPerPiece: true,
        processSteps: true,
      },
    }),
  ]);
  const qpu = new Map(bomPieces.map((b) => [`${b.bomRevisionId}:${b.pieceId}`, b.qtyPerUnit]));
  // Số cần định mức theo (bản định mức, cỡ) cho 1 bộ.
  const perUnit = new Map<string, number>();
  // Số cần 1 bộ theo (bản định mức, cỡ, bộ công đoạn) - để chia phần lấy từ kho cho các SKU dùng đúng bộ công đoạn đó.
  const perUnitSteps = new Map<string, number>();
  for (const pb of pieceBoms) {
    const k = `${pb.bomRevisionId}:${pb.segmentSpecId}|${normalizeSegmentSteps(pb.processSteps)}`;
    perUnitSteps.set(
      k,
      (perUnitSteps.get(k) ?? 0) +
        pb.qtyPerPiece * (qpu.get(`${pb.bomRevisionId}:${pb.pieceId}`) ?? 0),
    );
  }
  for (const pb of pieceBoms) {
    const k = `${pb.bomRevisionId}:${pb.segmentSpecId}`;
    perUnit.set(
      k,
      (perUnit.get(k) ?? 0) + pb.qtyPerPiece * (qpu.get(`${pb.bomRevisionId}:${pb.pieceId}`) ?? 0),
    );
  }

  const produced = new Map<string, number>(); // `${proposal}:${spec}`
  for (const s of segments) {
    const k = `${s.pattern.line.cuttingProposalId}:${s.segmentSpecId}`;
    produced.set(k, (produced.get(k) ?? 0) + s.countPerBar * s.pattern.barCount);
  }
  // Phần lấy từ kho còn giữ theo (phương án, cỡ, bộ công đoạn).
  const stock = new Map<string, number>();
  for (const l of stockLogs) {
    const k = `${l.refId}:${l.reservation.segmentSpecId}|${l.reservation.segmentSteps}`;
    stock.set(k, (stock.get(k) ?? 0) + (l.kind === 'SURPLUS_IN' ? 1 : -1) * l.qty.toNumber());
  }
  const wanted = new Set(orderIds.map((id) => id.toString()));
  const out: PlanSurplusRow[] = [];
  const fromStockBySpec = new Map<string, number>(); // `${proposal}:${spec}`
  for (const [k, raw] of stock) {
    const qty = Math.round(raw);
    if (qty <= 0) continue;
    const [pid, rest] = k.split(':');
    const [spec, steps] = rest.split('|');
    fromStockBySpec.set(`${pid}:${spec}`, (fromStockBySpec.get(`${pid}:${spec}`) ?? 0) + qty);
    // Review IT 26/11 mục 3.3: chia cho các SKU còn chạy dùng đúng (cỡ, bộ công đoạn), theo id tăng dần, mỗi SKU tới số cần của nó;
    // phần vượt (không nên có) dồn cho SKU cuối. Trước đây dồn hết cho SKU id nhỏ nhất, số cần kẹp ≥ 0 nên phần vượt mất.
    const owners = coverage
      .filter(
        (c) =>
          c.cuttingProposalId.toString() === pid &&
          c.productionOrder.status !== 'CANCELLED' &&
          (perUnitSteps.get(`${c.productionOrder.bomRevisionId}:${spec}|${steps}`) ?? 0) > 0,
      )
      .map((c) => ({
        id: c.productionOrder.id,
        need:
          (perUnitSteps.get(`${c.productionOrder.bomRevisionId}:${spec}|${steps}`) ?? 0) *
          c.productionOrder.quantity,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    let left = qty;
    owners.forEach((o, i) => {
      const take = i === owners.length - 1 ? left : Math.min(left, Math.floor(o.need));
      left -= take;
      if (take <= 0 || !wanted.has(o.id.toString())) return;
      out.push({
        productionOrderId: o.id,
        segmentSpecId: BigInt(spec),
        qty: take,
        fromStockSteps: steps,
      });
    });
  }
  for (const [k, made] of produced) {
    const [pid, spec] = k.split(':');
    const covered = coverage.filter((c) => c.cuttingProposalId.toString() === pid);
    let need = -(fromStockBySpec.get(k) ?? 0);
    let owner: bigint | null = null;
    for (const c of covered) {
      const u = perUnit.get(`${c.productionOrder.bomRevisionId}:${spec}`) ?? 0;
      if (u <= 0) continue;
      need += u * c.productionOrder.quantity;
      if (c.productionOrder.status === 'CANCELLED') continue;
      if (owner === null || c.productionOrder.id < owner) owner = c.productionOrder.id;
    }
    const surplus = Math.round(made - need);
    if (surplus <= 0 || owner === null || !wanted.has(owner.toString())) continue;
    out.push({ productionOrderId: owner, segmentSpecId: BigInt(spec), qty: surplus });
  }
  return out;
}
