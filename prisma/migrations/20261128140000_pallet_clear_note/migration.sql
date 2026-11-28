-- Đợt 2 lượt 2 (28/11/2026, câu 7a): thủ kho Sơn gỡ pallet đã sơn phải ghi lý do - lưu ở lượt xếp (clearedReason = 'REMOVED_PAINTED').
ALTER TABLE "pallet_loads" ADD COLUMN "clearNote" TEXT;

-- Thêm lý do gỡ mới vào ràng buộc cũ (ISSUED / UNLOADED); REMOVED_PAINTED bắt buộc có lý do >= 3 ký tự.
ALTER TABLE "pallet_loads" DROP CONSTRAINT "pallet_loads_cleared_chk";
ALTER TABLE "pallet_loads" ADD CONSTRAINT "pallet_loads_cleared_chk" CHECK (
  "clearedAt" IS NULL
  OR (
    "clearedById" IS NOT NULL
    AND (
      "clearedReason" IN ('ISSUED', 'UNLOADED')
      OR ("clearedReason" = 'REMOVED_PAINTED' AND length(btrim(COALESCE("clearNote", ''))) >= 3)
    )
  )
);
