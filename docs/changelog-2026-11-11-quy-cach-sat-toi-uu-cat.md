# Changelog 11/11/2026 - Trả quy cách sắt cho màn Tối ưu cắt sắt

## Lý do
Màn Tối ưu cắt sắt (FE) cần hiện quy cách sắt bên cạnh tên: nhiều loại sắt trùng tên, chỉ khác quy cách (vd SAT-001 và SAT-025
đều "Sắt phi 6zem", Ø21 / Ø19). API trước đây chỉ trả `materialCode` + `materialName`.

## Sửa
- Thêm field `materialSpec: string | null` (lấy từ `materials.spec`, cắt khoảng trắng, rỗng → `null`):
  - `CuttingProposalLineResponseDto` (`dto/cutting-proposal-response.dto.ts`), gán trong `toDetailResponseDto` - dùng cho
    GET `cutting-batch-solves` ("Kết quả đã tính") và chi tiết phương án cắt;
  - `CandidateMaterialDto` (`dto/cutting-batch-candidate.dto.ts`), gán lúc dựng danh sách SKU chờ tính; câu truy vấn vật tư
    ở đó thêm `spec: true`.
- Không đổi DB, không đổi cách tính.

## Test
- `cutting-proposals.service.spec.ts`: 2 test mới cho `materialSpec` ở dòng phương án (`' Ø19 '` → `'Ø19'`; `'   '`, `''`,
  `null` → `null`). Phần candidate chưa có test riêng (dựng ngữ cảnh nặng), được tsc bảo vệ và đã thử tay trên trình duyệt.
- `tsc` chỉ còn 2 lỗi cũ ở `prisma/seed-*.ts`; `eslint` sạch; `jest src/modules/cutting-proposals` 308/308.
