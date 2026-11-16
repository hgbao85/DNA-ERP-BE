# 16/11/2026 - `FLOOR_ALERTS=off` tắt hẳn nhắc nền xưởng

Sửa sau buổi review các commit ngày 14/11 (điểm 5). Đi kèm FE: changelog cùng ngày ở repo FE (gán xưởng cho mọi loại máy).

## Thay đổi

- `FloorAlertsService.requestEvaluate()` (`src/modules/floor/floor-alerts.service.ts`) bỏ qua mọi yêu cầu khi `FLOOR_ALERTS=off`. Biến được đọc mỗi lần gọi.
  - Trước: công tắc chỉ tắt lượt quét định kỳ 10 phút (`onModuleInit`). Các việc sau vẫn kích một lượt quét:
    - thao tác ghi ở `/floor` (`FloorRealtimeInterceptor`);
    - thủ kho xác nhận phiếu có dòng sắt (lượt gấp).
  - Vì vậy dù đã tắt công tắc, hệ thống vẫn tự đóng lệnh Phôi, máy rảnh vẫn kéo lệnh, vẫn gửi thông báo.
  - Sau: tắt công tắc thì không còn lượt quét nào. Bật thì như cũ.
- Cách chạy này có từ 15/10 (khi thêm interceptor). Từ đợt C2–C3, mỗi lượt quét ghi dữ liệu (đóng lệnh Phôi, kéo lệnh), nên công tắc phải tắt hẳn được.

## Kiểm tra

- `floor-alerts.service.spec.ts`: thêm test `FLOOR_ALERTS=off` cho cả yêu cầu thường lẫn yêu cầu gấp; 53/53 test đạt.
- tsc chỉ còn 2 lỗi cũ ở `prisma/seed-*`; eslint, prettier sạch.

## Lưu ý

- `CUT_AUTO_PULL=off` vẫn chỉ tắt việc máy rảnh kéo lệnh.
- Muốn tắt toàn bộ nhắc nền, kể cả tự đóng lệnh Phôi, thì đặt `FLOOR_ALERTS=off`.
