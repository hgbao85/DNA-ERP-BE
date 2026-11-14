# 13/11/2026 - Tối ưu cắt sắt theo góp ý của Sếp (12/11)

Sếp góp ý 5 điểm về tối ưu cắt sắt và đã chốt 4 câu hỏi IT gửi lại. Đợt này làm trọn cả 5 điểm. FE đi kèm: xem changelog cùng tên ở repo FE.

## Thay đổi nghiệp vụ

1. **Hao hụt chỉ tính cùi** (khúc thừa cuối cây). Tề đầu, lưỡi cắt, đoạn dư không tính.
   - Trần mỗi cây: cùi ≤ ngưỡng % × chiều dài cây (1% × 6000 = 60 mm). Trước: tề đầu + cùi ≤ 60 mm.
   - % hao hụt loại sắt = Σ cùi ÷ Σ chiều dài cây mua.
   - Sửa ở bộ giải (`solver-ts/patterns.ts`, `optimize-material.ts`) và phần ước tính nhanh (`best-fill.util.ts`).
   - `EXACT_CHECK_CACHE_VERSION` 1 → 2: kết quả kiểm nhanh đã lưu theo cách tính cũ tự bị bỏ.
   - Phương án đã tính / đã duyệt giữ nguyên số cũ, không tự tính lại.
2. **MC Tự động: tề đầu mặc định 10 mm** (trước 0).
3. **Khung gộp mốc cần sắt = 5 ngày** tính cả 2 đầu, tức 2 mốc cách nhau tối đa 4 ngày (ngày 10 gộp được ngày 14). Trước: 3.
4. **Dò chiều dài đặt riêng**: dải 4000..6500 (trước 5000..6000). Dò từ cây chuẩn ra 2 phía (6000 → 5950 → 6050 → 5900 → 6100 …), lấy chiều
   dài đầu tiên đạt ngưỡng, tức gần cây chuẩn nhất. Trước: dò từ ngắn lên.
5. **Chiều dài đang có trong kho**: lượt tính chính thức thử thêm, cùng cây chuẩn, các chiều dài đang có tồn ở kho Phôi của 2 xưởng; chọn
   chiều dài ít hao hụt nhất, bằng nhau thì ưu tiên cây chuẩn. Không chiều dài nào đạt mới dò (mục 4).
   - Chỉ lấy chiều dài: bội 50 mm, trong dải dò, khác cây chuẩn, còn ít nhất 1 cây chưa bị giữ chỗ.
   - Loại sắt KHSX đã tự gõ chiều dài: chỉ dùng chiều dài đó như cũ.
   - Dòng chọn chiều dài tồn lưu `lengthSource = "stock"`.
   - Đọc tồn lỗi thì ghi log và tính như không có chiều dài tồn.
6. **Luật xưởng "tối đa N cỡ đoạn/cây"** (Phước An = 2), cấu hình ở `SystemConfig.solverMaxSizesPerBarByWorkshop` (khoá = mã xưởng).
   - Thứ tự theo quy tắc chia sắt 07/11 ("tính sơ đồ theo cây 6.000; cố gắng tối đa 2 cỡ; không đạt dưới 1% thì được nhiều hơn, phải ghi chú"):
     giai đoạn 1 chỉ dùng chiều dài cố định (cây chuẩn + chiều dài tồn), thử N cỡ rồi nới N+1… tới giới hạn của máy; giai đoạn 2 chỉ khi
     giai đoạn 1 không mức nào đạt mới dò cây đặt riêng, lại theo thang N, N+1…
   - Phải nới thì ghi lý do vào `CuttingProposalLine.sizesRelaxNote`.
7. **Xưởng đi theo lượt tính**:
   - `POST /cutting-batch-solve` nhận `workshopId` (lưu trong `solverOptions`). Thiếu vẫn tính như cũ.
   - Tạo lệnh (`merge`, `claim-solo`): các dòng lệnh mang sẵn xưởng của phương án.
   - KHSX gửi QLSX với xưởng khác xưởng đã tính: 400. Gửi đúng xưởng dòng lệnh đang giữ thì không chặn.
   - Đổi xưởng (`PATCH :id/workshop`, hoặc đổi lúc gửi Sếp duyệt): bật cờ "cần kiểm lại phương án cắt" khi lệnh có phương án đã tính xong
     (DRAFT hoặc APPROVED). Trước: chỉ khi có phương án APPROVED.
   - Sếp duyệt lệnh đang có cờ: 409, tới khi KHSX bấm "Đã kiểm". Từ chối không bị chặn.
8. **Máy cắt bắt buộc theo xưởng** (quy tắc chia sắt 07/11: Phước An cắt toàn bộ bằng máy tự động): `SystemConfig.solverMachineByWorkshop`
   (khoá = mã xưởng, mặc định `{"PHUOC_AN":"tu_dong"}`). Xưởng có khoá thì mọi lượt tính chính thức của xưởng đó dùng máy này, đè lựa
   chọn của KHSX. Kiểm nhanh / ước tính (không có xưởng) không đổi.
9. **Số cây/bó của MC Tự động theo quy cách** (quy tắc chia sắt 07/11 mục 4): `SystemConfig.solverBundleFactorsBySpec`, khoá là mã quy cách
   `V<cạnh>` / `H<a>-<b>` / `FI<đường kính>`, mặc định là bảng 14 quy cách trong file quy tắc.
   - Mã quy cách suy từ tên + quy cách vật tư (`steel-spec-key.util.ts`): "Sắt hộp 8zem" + "13x26" → `H13-26`.
   - Quy cách có trong bảng: dùng đúng các số cây/bó đó. Phần lẻ không đủ bó được cắt lẻ, tới (bó nhỏ nhất − 1) cây.
   - Quy cách ngoài bảng: **chặn tính** với MC Tự động (Sếp chốt 13/11, câu 3). `cutting-batch-solve` trả 400 liệt kê quy cách, vd
     "Quy cách V15 (Sắt vuông 6zem · 15) chưa có trong bảng số cây/bó của MC Tự động. Hỏi Sếp số cây/bó rồi nhờ Admin thêm vào Cấu hình
     hệ thống › Máy cắt, sau đó tính lại." Lượt tính tự động lúc Sếp duyệt / Tính lại của lệnh không chặn sớm (đang chạy nền) mà ra lượt
     tính lỗi với đúng câu đó.
   - Bảng rỗng `{}`: dùng `solverBundleFactors` chung như trước.
10. **Giữ nguyên**: lưỡi MC Tự động 2,5 mm (Sếp chốt 13/11, câu 1). Fi4, Fi6 vốn không vào bộ giải (nhóm tự tính).
11. **Luật máy laze: nhát cắt cuối phải ra 1 đoạn dài hơn 10 cm, tính cả cùi** (Sếp chốt 13/11, câu 11). Kiểu cắt laze (cắt từng cây) chỉ
    hợp lệ khi đoạn dài nhất trên cây + cùi > `SystemConfig.solverLaserMinTailMm` (mặc định 100, 0 = tắt): đoạn đó để cuối, công nhân cắt
    tay. Áp ở mọi lượt gọi bộ giải (tính chính thức, kiểm nhanh, gợi ý xử lý); không áp cho cắt theo bó (MC Tự động). Loại sắt chỉ có đoạn
    rất ngắn (≤ 40 mm) với ngưỡng 1% có thể không còn kiểu đạt: báo không cắt được với lý do rõ.

## Hợp đồng bộ giải (`solver-ts/types.ts`)

- Request thêm `scan_center_length`, `max_sizes_per_bar_start`, `bundle_factors_by_material` (mảng = hệ số riêng, `null` = cắt từng cây),
  `fallback_trim_start`, `fallback_blade_width` (BE không gửi `null` nữa sau câu 3, bộ giải vẫn giữ khả năng này), `laser_min_tail_mm`.
- Response dòng khả thi thêm `sizes_per_bar_start`, `sizes_per_bar_limit` (chỉ khi request có luật xưởng còn hiệu lực).
- `stock_lengths_by_material` gửi mảng chiều dài (chuẩn + tồn) cho loại sắt KHSX không gõ.

## Cấu hình và DB

Migration `20261113080000_cutting_boss_feedback_12_11`:
- `system_config`: đổi mặc định và **cập nhật cả dòng cấu hình đang dùng**: tề đầu MC Tự động 10, khung gộp 5, dải dò 4000..6500.
- `system_config.solverMaxSizesPerBarByWorkshop` (JSONB, mặc định `{"PHUOC_AN":2}`).
- `cutting_proposal_lines.sizesRelaxNote` (TEXT, null).

Migration `20261113100000_cutting_machine_rules_by_workshop_spec`:
- `system_config.solverMachineByWorkshop` (JSONB, mặc định `{"PHUOC_AN":"tu_dong"}`).
- `system_config.solverBundleFactorsBySpec` (JSONB, mặc định bảng 14 quy cách).

`GET/PUT /system-config` và `GET cutting-defaults` trả / nhận `solverMaxSizesPerBarByWorkshop` (khoá phải là mã xưởng đang có, giá trị 1..10),
`solverMachineByWorkshop` (khoá là mã xưởng, giá trị `laser` | `tu_dong`), `solverBundleFactorsBySpec` (khoá đúng dạng mã quy cách, mỗi
quy cách 1..12 số nguyên từ 2 đến 500) và `solverLaserMinTailMm` (0..1000).

Migration `20261113140000_laser_min_tail`: `system_config.solverLaserMinTailMm` (INTEGER, mặc định 100).

`EXACT_CHECK_CACHE_VERSION` = 3 (luật laze làm đổi kết quả kiểm nhanh).
Service kiểm thêm chiều dài dò ngắn nhất ≤ dài nhất.

## Deploy

Chạy `prisma migrate deploy` như thường lệ. Không cần seed. Nên deploy BE trước FE (FE cũ không gửi xưởng vẫn tính được).

## Kiểm tra

- jest các module liên quan (gồm cả đợt A chia máy): 82 bộ, 1950 test pass.
- Thử thật ở local: tạm bỏ V15 khỏi bảng bó -> tính cho Phước An bị chặn đúng câu (đã trả bảng như cũ); SKU có đoạn 20–65 mm tính bằng MC
  Laser ra 21 kiểu cắt, không kiểu nào vi phạm luật đoạn cuối.
- tsc: chỉ còn 2 lỗi cũ ở `prisma/seed-*.ts`. eslint các file đã sửa: 0 lỗi.
- Ví dụ của Sếp chạy trên bộ giải thật (đoạn 427 × 1180, 425 × 295, 422 × 590; cây 6000; MC Tự động; lưỡi 2,5; tề đầu 10):
  148 cây, 8 bó, tổng cùi 146 mm = 0,016%. Trước khi sửa cùng phương án báo 1626 mm = 0,18%.
- Thử trên BE local: tính cho từng xưởng, tạo lệnh mang xưởng, gửi QLSX sai xưởng bị chặn, chuyển xưởng trước duyệt bật cờ.

## Chưa làm / lưu ý

- Chip ước tính và khối "Đợt đang chọn" chưa áp luật số cỡ theo xưởng và chưa thử chiều dài tồn kho; chỉ lượt Tính chính thức áp.
- Lúc duyệt, tồn chỉ được trừ ở kho Phôi của xưởng làm lệnh; chiều dài tồn ở xưởng kia không tự chuyển.
- Ví dụ dữ liệu local, cùng một SKU tính cho Phước An: các loại sắt chính dùng cây chuẩn 6000 với MC Tự động, số cây/bó theo quy cách,
  3 dòng có ghi chú "nới lên 3 cỡ"; loại sắt cần 27 cây thuộc quy cách có bó nhỏ nhất 60 được cắt lẻ.
- Mỗi mức số cỡ là một lần giải, nên lượt tính cho xưởng có luật có thể lâu hơn.
- Phần lẻ "tới (bó nhỏ nhất − 1) cây" là cách hiểu câu "phần lẻ cắt lẻ" trong quy tắc; quy tắc không nêu con số trần.
- Phần chia máy lúc cắt thật của quy tắc chia sắt (giao máy theo lỗ khoan/dập, số máy cho một lệnh) nằm ở bảng "Chia máy cắt" của QLSX
  (đợt B1, `changelog-2026-11-13-chia-may-dot-b1.md`), không ở sơ đồ tính mua sắt. Laze chừa đoạn cuối: mục 11 ở trên.
