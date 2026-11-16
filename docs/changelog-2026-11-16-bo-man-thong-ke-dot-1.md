# 16/11/2026 - Bỏ màn thống kê tổ Phôi / Hàn / Sơn, đợt 1: đóng đường báo cũ ở BE, QR khu nhận sắt theo xưởng

Đi kèm FE: changelog cùng tên ở repo FE.

## Vì sao

- **Quyết định:** bỏ màn thống kê của tổ Phôi / Hàn / Sơn. Đó là các tài khoản PHOI_STAFF / HAN_STAFF / SON_STAFF nhập số trên máy tính. Từ nay:
  - mọi số sản lượng do công nhân báo bằng quét mã QR tại máy;
  - QLSX kiểm, hủy lần báo sai, rồi gửi KCS ở "Sản lượng xưởng".
  - Quyết định này đúng hướng đã chốt từ đầu dự án QR: "công nhân là người quét, không phải thống kê".
- **Rủi ro khi hai đường báo chạy song song:**
  - Nút "Gửi KCS" đợt cắt ở màn cũ lấy đợt đang cắt đầu tiên của SKU. Đợt đó có thể do công nhân báo qua QR, nên bị gửi đi mà QLSX chưa kiểm.
  - "Gửi KCS" công đoạn phụ ở màn cũ không gắn người, nên gom luôn các lần báo QR vào.
- **Vì sao chưa gỡ hẳn được:** một số việc hiện chỉ tài khoản thống kê Phôi làm được:
  - báo Vật tư TP;
  - báo chân nhôm;
  - xác nhận nhận Sắt La / thanh nhôm;
  - gán SKU cho đợt cũ.

  Vì vậy chia làm 3 đợt. Đợt 1 đóng các đường báo đã có QR thay thế.

## Thay đổi

- **Câu thông báo dùng chung:** các câu báo lỗi dồn vào `src/common/constants/legacy-floor-report.constant.ts`.
- **`steel-issues.controller.ts`:** 6 route luôn trả 403 kèm câu tiếng Việt và không gọi service.
  - Gồm: nhận sắt cây (`POST steel-issues/:id/receive`), lưu đợt cắt (`POST steel-issues/:id/cut-batches`), gửi KCS đợt cắt (`POST cut-bundles/:id/finish`), hoàn tác (`POST cut-bundles/:id/undo-last-batch`), báo công đoạn phụ (`POST production-invoices/:id/step-batches`), gửi công đoạn phụ (`POST production-invoices/:id/step-bundles`).
  - Giữ nguyên: gán / sửa SKU cho đợt (`assign-order`, `reassign-order`) và mọi route xem.
  - Service không đổi, vì đường QR và màn QLSX gọi thẳng service.
- **`production-batches.controller.ts`:** 3 route tạo / lưu / gửi KCS lô mảnh trả 403 khi người gọi thuộc tổ Hàn hoặc Sơn. Tổ Phôi vẫn dùng 3 route này cho tab Vật tư TP. Các route công đoạn mảnh (`piece-step-*`) không đổi.
- **QR "Khu nhận sắt" (`floor-scan`):**
  - Số cây nhận phải từ 1 trở lên (trước đây cho nhận 0). Câu lỗi: "Số cây nhận phải từ 1 trở lên. Không nhận được cây nào thì báo thủ kho."
  - Chỉ liệt kê lô sắt có PI thuộc xưởng của máy đang quét. Máy chưa gắn xưởng thì tính theo xưởng mặc định.
  - Nhận lô của xưởng khác thì trả 409: "Lô sắt này của xưởng khác. Lô của xưởng nào thì nhận bằng mã "Khu nhận sắt" của xưởng đó; nhầm thì báo thủ kho."
- **Số đỏ "Xác nhận nhận sắt"** của tài khoản thống kê Phôi (`work-queue.service.ts`, khoá `phoiSteelReceiving`):
  - Nay đếm Sắt La + thanh nhôm đang chờ nhận, là việc còn làm ở màn đó.
  - Không đếm sắt cây nữa.
- **Thông báo** (`notification-types.ts`):
  - "Sắt đã xuất" gửi tài khoản thống kê Phôi đổi thành tin để biết (INFO). Tiêu đề mới: "<PI>: sắt đã xuất - công nhân nhận bằng mã QR "Khu nhận sắt" của xưởng".
  - Tin "KCS chấm lỗi" đổi chữ thành: "Công nhân báo bù bằng quét mã QR, QLSX kiểm rồi gửi KCS; Vật tư TP thì báo bù ở Lệnh sản xuất."
- Không đổi quyền, không seed, không migration.

## Kiểm tra

- jest: 8 bộ, 176 test đạt.
  - Mới: `steel-issues.controller.spec.ts`, `production-batches.controller.spec.ts`, `floor/dto/floor-scan.dto.spec.ts`.
  - Đã có, thêm ca: `floor-scan.service.spec.ts`, `work-queue.service.spec.ts`. Chạy kèm cả thư mục `notifications`.
  - Các test kiểm:
    - route đóng không gọi service; route giữ lại vẫn gọi;
    - Phôi đi tiếp, Hàn / Sơn bị chặn;
    - 0 cây bị chặn;
    - lọc theo xưởng, kể cả khi PI chưa có xưởng hoặc lô sắt không tồn tại;
    - nhận lô của xưởng khác bị chặn;
    - số đỏ không còn đếm sắt cây.
- tsc chỉ còn 2 lỗi cũ ở `prisma/seed-*`. `nest build` đạt. eslint 0 lỗi (1 cảnh báo có sẵn). prettier sạch. Các file đều LF.
- **QA review độc lập (chỉ đọc code):** kết luận "Đạt có điều kiện".
  - Phần chặn, đường QR / QLSX và phần Phôi giữ lại đều đúng.
  - Đã sửa trong đợt này:
    - (Cao) xưởng thiếu mã "Khu nhận sắt" thì không ai nhận được sắt → FE "Máy & tem QR" có cảnh báo;
    - số đỏ đếm nhầm sắt cây;
    - thông báo chỉ tới thao tác đã đóng;
    - Hướng dẫn hiện ảnh màn cũ;
    - chữ "nhập số" trên màn Hàn / Sơn chỉ xem;
    - câu chữ lệch giữa BE / FE / Hướng dẫn.
  - Để sau: xem mục "Còn lại".
- **Thử thật trên bản sao DB local** (BE thử cổng 3003, FE 3100, QA nghiệm thu; bản sao đã xoá). Kết luận "Đạt có điều kiện", không có lỗi mức cao.
  - Gọi API thật bằng token tài khoản thống kê:
    - 6 route Phôi đã đóng đều trả 403 kèm câu tiếng Việt.
    - Hàn / Sơn gọi các route tạo / lưu / gửi KCS lô mảnh đều bị 403.
    - Phôi gọi route lưu lô mảnh không ra câu Hàn / Sơn.
    - Route gán SKU vẫn mở (trả 409 vì đợt đã có SKU, không bị 403).
  - QR "Khu nhận sắt":
    - Mã Phú An không thấy lô của PI Phước An; mã Phước An thấy đúng lô đó.
    - Nhận 0 cây trả 400; nhận lô của xưởng khác trả 409, lô vẫn ở trạng thái chờ nhận.
    - Nhận đủ 5/5 cây thì tin "sắt đã xuất" cũ tự đóng.
  - Số đỏ của tài khoản thống kê Phôi = 3 (1 Sắt La + 2 thanh nhôm, không tính sắt cây), giảm dần mỗi lần nhận.
  - Lưu ý nhỏ: gọi route Hàn / Sơn đã đóng với body sai dạng thì gặp 400 (lỗi kiểm dữ liệu) trước câu 403, vì kiểm dữ liệu chạy trước hàm. Không ghi được gì nên không nguy hiểm.

## Lưu ý deploy

- **Ngày deploy là ngày cắt.** Từ lúc deploy, ở màn cũ: tài khoản thống kê Phôi không còn báo cắt, công đoạn phụ hay nhận sắt cây; Hàn / Sơn không còn báo số mảnh. Phải báo xưởng trước.
- **Chuẩn bị trước khi deploy:**
  - Mỗi xưởng có máy "Khu nhận sắt" đang bật, gắn đúng xưởng.
  - Mọi công đoạn phụ có máy QR.
  - QLSX xếp PI vào hàng đợi kịp, vì QR chỉ báo được PI đang trong hàng đợi / bảng chia máy.
- **Dọn dữ liệu trước:** đợt cắt "đang cắt" do tài khoản thống kê mở thì QLSX gửi KCS hoặc hủy ở "Sản lượng xưởng". Lô sắt cây đang chờ nhận vẫn nhận được bằng QR.
- Tin "sắt đã xuất - vào xác nhận nhận" cũ còn mở trong DB vẫn là loại cần xử lý. Tin đó vẫn tự đóng khi công nhân nhận sắt bằng QR.
- File e2e `full-flow.spec.ts` ở FE (chưa đưa vào git) còn đi đường cũ, nên sẽ đỏ. `e2e/floor/fixtures.ts` lấy mã nhận sắt đầu tiên tìm thấy, nên có thể chọn sai xưởng.

## Còn lại

- **Đợt 2:**
  - QR nhận Sắt La / thanh nhôm.
  - Vật tư tiêu hao của Hàn / Sơn: nhận qua QR, hoặc bỏ bước nhận.
  - Chặn loại mảnh Tự tính có khai công đoạn ở điểm báo mảnh.
  - Chuyển thông báo của tổ sang QLSX.
  - Admin gán SKU được cho đợt cũ.
- **Đợt 3:**
  - QR báo chân nhôm (có migration).
  - Sau đó gỡ hẳn vai thống kê, bỏ việc tự gắn vai khi Admin đặt tổ, khoá các tài khoản thống kê.
- **Từ QA, chưa sửa:**
  - **Đổi xưởng khi PI đã vào hàng đợi Phôi:** hàng đợi không dời theo, nên có thể kẹt nhận sắt / báo cắt. Lỗi gốc từ đợt C1; trước đây còn màn cũ làm đường vòng. Cần chốt nghiệp vụ trước.
  - **PI có SKU ở 2 xưởng:** xưởng lấy theo dòng PI có id nhỏ nhất.
  - **Đợt Vật tư TP đang mở có thể gồm số báo qua QR,** mà tài khoản thống kê Phôi tự "Gửi KCS" được.
  - **Test gọi API thật:** token thống kê gọi 9 route đóng phải nhận 403.
