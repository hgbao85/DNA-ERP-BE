-- Cây đặt riêng luôn tròn 5 cm: bước dò chiều dài mặc định 50 mm, dòng đang lưu số không phải bội 50 lên bội 50 gần nhất phía trên.
ALTER TABLE "system_config" ALTER COLUMN "solverLengthStepMm" SET DEFAULT 50;
UPDATE "system_config" SET "solverLengthStepMm" = GREATEST(50, CEIL("solverLengthStepMm" / 50.0)::int * 50) WHERE "solverLengthStepMm" % 50 <> 0 OR "solverLengthStepMm" < 50;
