-- Cho phép 1 SKU có NHIỀU dòng cùng 1 vật tư khi khác quy cách (nệm đôi 870x450x50 + nệm đơn 450x450x50 cùng màu).
--
-- Ràng buộc cũ "mỗi (bản định mức, vật tư) 1 dòng" chặn việc này. Thay bằng "mỗi (bản định mức, vật tư, quy cách) 1
-- dòng"; quy cách NULL được coi như chuỗi rỗng (COALESCE) để 2 dòng cùng vật tư đều không có quy cách vẫn bị chặn
-- trùng như trước (Postgres coi các NULL là khác nhau nên unique thường không đủ).
--
-- Chỉ nới ràng buộc, không đổi dữ liệu: mọi dòng hiện có đã thoả ràng buộc cũ nên cũng thoả ràng buộc mới.
-- Index theo biểu thức không khai báo được trong schema.prisma - cùng idiom các index có điều kiện khác của repo.

-- DropIndex
DROP INDEX "bom_accessory_items_bomRevisionId_materialId_key";

-- CreateIndex
CREATE UNIQUE INDEX "bom_accessory_items_bomRevisionId_materialId_spec_key"
  ON "bom_accessory_items" ("bomRevisionId", "materialId", COALESCE("spec", ''));
