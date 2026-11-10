/**
 * Tuỳ chọn transaction cho 3 nguồn đề xuất mua ngoài sắt (vật tư tiêu hao / PieceMaterialYield / MaterialYieldRecipe) chạy sau
 * khi Sếp duyệt lệnh. Mặc định 5 s của Prisma không đủ với DB ở xa (10/11/2026 đo được 5,3 s): quá giờ thì lệnh vẫn duyệt xong
 * nhưng KHÔNG có dòng mua ngoài sắt nào, lỗi chỉ được log ở ProductionInvoicesService.computeNonSteelPurchaseProposals().
 * Cùng mức với bookings (TX_OPTIONS).
 */
export const PURCHASE_TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 };
