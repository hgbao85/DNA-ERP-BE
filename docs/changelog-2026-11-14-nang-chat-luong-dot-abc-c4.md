# 14/11/2026 - Nâng chất lượng code đợt chia máy cắt (A/B/C) + C4

Mục tiêu: đưa code của đợt chia máy cắt (A/B/C, C4) lên mức tối thiểu 8,5/10 ở các mặt test, code sạch, kiến trúc, hiệu năng, UI, UX. Không đổi nghiệp vụ, trừ 2 thay đổi hành vi ghi ở mục "Hành vi thay đổi". FE đi kèm: changelog cùng tên ở repo FE.

## Thay đổi

1. **Tách `CutAllocationService`** (`src/modules/floor/`): file service từ 2.080 xuống 894 dòng, giữ nguyên mọi method public.
   - File mới, mỗi file một trách nhiệm:
     - `cut-allocation-types.ts`: kiểu trả về;
     - `cut-allocation-snapshot.ts`: nạp dữ liệu, `CutSnapshotCache`;
     - `cut-allocation-board.ts`: dựng bảng chia, hàm thuần;
     - `cut-allocation-units.ts`;
     - `cut-allocation-machine-rule.ts`;
     - `cut-allocation-guard.ts`;
     - `cut-allocation-log.ts`;
     - `cut-allocation-steel-gaps.ts`;
     - `cut-auto-pull-plan.ts`.
   - Không hàm nào dài quá 80 dòng; dài nhất còn 70 (trước: `autoPull` 206, `loadSnapshot` 199). `planAllocation` trong util từ 115 xuống 45 dòng.
2. **Một luật máy duy nhất:** `isMachineAllowedForClass` dùng cho cả kiểm khi sửa tay và trường mới gửi FE, nên FE và BE không lệch nhau.
3. **Bảng chia thêm 2 trường:**
   - `rows[].allowedMachineIds`: các máy BE nhận dòng đó;
   - `waiting[].heldElsewhereBars`: số cây đang giữ ở kho xưởng khác (lệnh vừa đổi xưởng, chờ chuyển kho).
4. **Nhắc nền** (`floor-alerts.service.ts`):
   - Thao tác ở `/floor` chỉ kích tối đa 1 lượt mỗi 30 giây (`MIN_EVALUATE_GAP_MS`), có lượt bù, không bỏ mất yêu cầu.
   - Yêu cầu gấp (`urgent`) chạy sau 3 giây gom.
   - Mỗi lượt, mỗi xưởng chỉ dựng bảng chia 1 lần (dùng chung cho tiến độ máy và thiếu sắt); bỏ cache sau khi máy rảnh kéo lệnh.
   - Log thời gian từng bước; lượt nào trên 2 giây thì log warn.
5. **Tin thủ kho đóng nhanh:** `IssueSlipsService.confirm` xác nhận phiếu có dòng sắt thì gọi lượt kiểm gấp. Nếu lời gọi này lỗi thì chỉ ghi log, phiếu vẫn được xác nhận.
6. **Đo năng suất (C4):** `getStats` và `computeCutMachineStats` tách thành hàm nhỏ, dài nhất 48 dòng (trước: 126 và 185). Kết quả không đổi.
7. **Comment và chữ hiển thị:**
   - Comment chỉ nói "vì sao", bỏ ngày tháng / tên người / lịch sử nghiệp vụ.
   - Gói lại 254 dòng comment dài ở 36 file khác (chỉ comment, code giữ nguyên, đã so cây cú pháp).
   - Bỏ "(Sếp chốt …)" khỏi chữ hiển thị: tin `CUT_ORDER_PULLED`, tin `CUT_PULL_STEEL_TO_ISSUE`, 3 câu báo lỗi sửa bảng chia.
   - Comment trong `prisma/schema.prisma` và migration `20261114093000_cut_allocation_log` bỏ tên người. Sửa file migration làm đổi checksum: DB local đã cập nhật `_prisma_migrations.checksum`; production chưa chạy migration này nên không ảnh hưởng.
8. **Test tích hợp** (Postgres test thật, `test/integration/`):
   - Mới `cut-allocation.integration.spec.ts` + fixture, gồm 4 test:
     - máy rảnh kéo lệnh (nối dòng, nhật ký, mã kho);
     - sắt ở kho xưởng khác thì không kéo;
     - khoảng thiếu sắt hết khi xuất đủ;
     - C4 tính cây quy đổi và cây/giờ có trừ nghỉ trưa.
   - Sửa `reservation-own-pi.integration.spec.ts`: thiếu `WorkshopScopeService` từ khi QLSX gắn xưởng, nên trước đó cả bộ hỏng trên main.

## Hành vi thay đổi

- Máy rảnh kéo lệnh và các nhắc máy cắt phản ứng chậm nhất khoảng 30 giây sau thao tác ở xưởng (trước: khoảng 3 giây, nhưng mỗi thao tác đều dựng lại bảng chia).
- Tin "Xuất sắt … xuống Phôi ngay" đóng khoảng 4 giây sau khi thủ kho xác nhận phiếu (trước: chậm nhất 10 phút).

## Kiểm tra

- **Jest:**
  - floor + issue-slips + notifications: 21 bộ, 562 test đạt;
  - các module của đợt: 79 bộ, 1.777 test đạt.
- **Test tích hợp:** `npm run test:integration` cho 5/5 bộ, 20 test đạt. Bật DB test bằng `docker compose -f docker-compose.test.yml up -d`.
- tsc sạch (ngoài 2 lỗi cũ ở `prisma/seed-*`), eslint sạch, `nest build` đạt.
- **Thử thật trên bản sao DB local (đã xoá), đúng hết.** Kịch bản: lệnh đổi xưởng nằm ở "Chờ sắt", chuyển kho, máy kéo lệnh, đúng thủ kho xưởng mới nhận tin, xuất 4 rồi 1 cây.
  - `allowedMachineIds` khoá máy tự động với dòng có đoạn dập.
  - `heldElsewhereBars` = 5 trước khi chuyển kho.
  - Tin thủ kho đóng sau 3,9 giây, không cần thao tác ở xưởng.
  - 6 lượt quét nền trong khoảng 3 phút, mỗi lượt 158–383 ms.

## Còn lại

- Thời gian lượt quét mới đo trên dữ liệu local; cần xem log warn sau khi deploy.
- Rủi ro CK1 / CK2 (giữ chỗ không theo kho) vẫn như ghi ở changelog C3.
