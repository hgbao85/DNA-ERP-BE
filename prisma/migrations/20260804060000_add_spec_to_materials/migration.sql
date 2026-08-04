-- Add "Quy cách" (specification) field to materials, exposed by admin's
-- Vật tư form and read by the "Danh sách định mức mảnh" segment table.
ALTER TABLE "materials" ADD COLUMN "spec" TEXT;
