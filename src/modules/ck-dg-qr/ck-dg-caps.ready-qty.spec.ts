/* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest matcher (expect.objectContaining) trong toHaveBeenCalledWith */
import { loadReadyQty } from './ck-dg-caps.util';

/**
 * Lỗi 5 (nghiệp vụ báo 28/11/2026): quét QR chuyền kiểm báo vượt (0) với khung đã đan lấy từ SKU huỷ - "hiện có" chỉ cộng nhập đan.
 * Màn thủ kho (recordTransferCheck) cộng cả khung đã nhận từ SKU huỷ -> đường QR phải cùng số.
 */
describe('loadReadyQty', () => {
  const db = (weaving: number | null, fromCancelled: number | null) => ({
    weavingReceipt: { aggregate: jest.fn().mockResolvedValue({ _sum: { qty: weaving } }) },
    cancelledGoodsTransfer: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { qty: fromCancelled } }),
    },
    warehouseTransferPieceItem: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: 4 } }),
    },
  });

  it('mảnh đan: nhập đan về + khung đã nhận từ SKU huỷ (đúng SKU nhận, đúng mảnh, chỉ dòng đã nhận)', async () => {
    const d = db(null, 6);
    await expect(loadReadyQty(d as never, 70n, 9n, true, 109n)).resolves.toBe(6);
    expect(d.cancelledGoodsTransfer.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ targetItemId: 109n, pieceId: 9n, kind: 'WOVEN' }),
      }),
    );
    await expect(loadReadyQty(db(5, 3) as never, 70n, 9n, true, 109n)).resolves.toBe(8);
  });

  it('mảnh không đan: vẫn theo phiếu chuyển kho, không đọc khung SKU huỷ', async () => {
    const d = db(5, 3);
    await expect(loadReadyQty(d as never, 70n, 9n, false, 109n)).resolves.toBe(4);
    expect(d.cancelledGoodsTransfer.aggregate).not.toHaveBeenCalled();
  });
});
