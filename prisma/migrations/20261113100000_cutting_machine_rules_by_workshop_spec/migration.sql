-- Quy tac chia sat cho may cat (tong hop 07/11/2026):
--  - Phuoc An: toan bo cat may tu dong -> may cat bat buoc theo xuong (khoa = workshops.code).
--  - So cay/bo cho phep cua MC Tu dong theo tung quy cach (V10, H10-20, FI19...). Quy cach ngoai bang: chan tinh voi MC Tu dong
--    (Sep chot 13/11 cau 3: bao KHSX hoi so cay/bo, co so roi moi tinh).

-- AlterTable
ALTER TABLE "system_config"
  ADD COLUMN "solverMachineByWorkshop" JSONB NOT NULL DEFAULT '{"PHUOC_AN":"tu_dong"}',
  ADD COLUMN "solverBundleFactorsBySpec" JSONB NOT NULL DEFAULT '{"V10":[60,64,68,72,76,80,84,88,100],"V12":[36,39,42,44,45,48,56,60,64],"V15":[21,24,30,33,36,39,42],"V16":[14,16,18,20,24,27,30],"V18":[14,16,18,20,24,27,30],"V20":[14,16,18,20,24,27,30],"V50":[2,3,4],"H10-20":[24,28,32,36,40,50],"H13-26":[15,18,21,24,32],"H15-35":[12,15,18],"H25-50":[6,8],"FI10":[52,56,60,64,68],"FI19":[14,16,18,20,22],"FI21":[14,16,18,20]}';

