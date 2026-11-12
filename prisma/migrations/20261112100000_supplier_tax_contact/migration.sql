-- 12/11/2026 (anh Nhân): danh sách NCC lưu thêm mã số thuế và người liên hệ (địa chỉ đã có cột sẵn).
ALTER TABLE "suppliers" ADD COLUMN "taxCode" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "contactName" TEXT;
