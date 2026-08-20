-- Int -> Decimal cho cutLengthMm và các field hao hụt/mẩu nguyên phái sinh từ nó (xem comment
-- schema.prisma tại từng field). Solver cố ý tránh float nhị phân (SCALING_FACTOR=10, số nguyên
-- đã nhân 10), nên Decimal(...,1) khớp đúng độ phân giải 1 chữ số thập phân đó. USING ::numeric
-- là cast an toàn, không mất dữ liệu (mọi giá trị Int hiện có trở thành Decimal với phần thập
-- phân = .0).

ALTER TABLE "segment_spec"
  ALTER COLUMN "cutLengthMm" TYPE DECIMAL(7,1) USING "cutLengthMm"::numeric;

ALTER TABLE "cutting_proposals"
  ALTER COLUMN "totalWasteMm" TYPE DECIMAL(8,1) USING "totalWasteMm"::numeric;

ALTER TABLE "cutting_proposal_lines"
  ALTER COLUMN "totalWasteMm" TYPE DECIMAL(7,1) USING "totalWasteMm"::numeric,
  ALTER COLUMN "mauNguyenMm" TYPE DECIMAL(7,1) USING "mauNguyenMm"::numeric,
  ALTER COLUMN "mauNguyenMm" SET DEFAULT 0;

ALTER TABLE "cutting_proposal_patterns"
  ALTER COLUMN "wastePerBarMm" TYPE DECIMAL(6,1) USING "wastePerBarMm"::numeric,
  ALTER COLUMN "mauNguyenMm" TYPE DECIMAL(7,1) USING "mauNguyenMm"::numeric,
  ALTER COLUMN "mauNguyenMm" SET DEFAULT 0;
