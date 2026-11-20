# 20/11/2026 - Sửa 15 lỗi nhóm 4 (không cần chốt nghiệp vụ) theo chuẩn ERP (BE)

Nguồn: đợt test toàn hệ thống 19/11, nhóm "không cần chốt". Mỗi lỗi được thiết kế theo cách ERP / chuẩn web làm (SAP, Odoo, Dynamics,
IETF, OWASP) rồi mới sửa. Đi kèm FE: `changelog-2026-11-20-sua-loi-nhom-4-chuan-erp.md` ở repo FE. Có 1 migration.

## Quy ước mới dùng chung
- Chống bấm trùng (`common/utils/idempotency.util.ts`, theo IETF draft Idempotency-Key): cùng khoá + cùng nội dung -> trả lại kết quả cũ,
  không chạy lại việc phụ (thông báo, realtime, cộng tồn); cùng khoá + khác nội dung / người / loại thao tác -> 422
  `IdempotencyKeyReusedException`; đang xử lý trùng lúc -> 409 `IdempotencyKeyInUseException` (chỉ trường hợp này được bấm lại cùng khoá).
  Khoá ghi cùng transaction với thao tác; try-lock khoá chống trùng là câu đầu transaction, trước các khoá nghiệp vụ.
- Tệp đính kèm (`common/validators/system-upload-url.validator.ts`, theo OWASP): chỉ nhận đường dẫn tệp do chính hệ thống tải lên
  (`https://res.cloudinary.com/<cloud>/(image|raw)/upload/[v…/]dna-erp/…`), parse và so từng phần; thiếu cloud name thì từ chối.
- Kiểu tham số (`common/validators/strict-type.decorators.ts`): boolean ở query đọc giá trị gốc (`abc` -> 400, `false` không còn thành
  true); khoảng ngày `to >= from`. Không tắt ép kiểu ngầm toàn cục.

## Thay đổi theo lỗi
- T3-5: `POST /segment-stock/recompute` (tính lại tồn đoạn theo lệnh, cả xem thử) chỉ Admin - trước đây mọi tài khoản văn phòng gọi được.
- T1-8, T4-10: ảnh bằng chứng KCS (chấm, sửa ảnh), ảnh lỗi Chuyền kiểm, ảnh phiếu xuất đã ký chỉ nhận tệp đã tải lên hệ thống (trước nhận cả
  `javascript:` / trang ngoài). Các trường đính kèm khác (booking, mua hàng, đơn bán, SKU, chuyển kho, vật tư) để đợt sau.
- T2-5: `activeOnly`, `deepVerify`, `includeCancelled`, `mine` giá trị lạ -> 400; nhà cung cấp `isActive`, đơn bán `note / depositConfirmed
  / isActive` sai kiểu -> 400; thống kê nhận vượt `to < from` -> 400.
- T3-9: nhập kho / từ chối nhận gửi lại cùng khoá khác nội dung hoặc khác người -> 422 (trước 409 / 400 câu khó hiểu); gửi trùng đồng thời
  chỉ ra 1 phiếu; sửa tồn cùng khoá khác số -> 422.
- T4-4: báo sản lượng (QR) gửi lại cùng khoá nhưng khác nội dung / tổ / máy -> 422 thay vì trả đợt cũ như thành công.
- T1-9: phát thông báo chung nhận `Idempotency-Key` (tuỳ chọn): bấm lại không tạo bản thứ 2. Tạo thông báo + người nhận chung 1
  transaction. Migration `20261120100000_notification_idempotency_key` (cột nullable + unique index, không đổi dữ liệu cũ).
- XOA-SKU (phần A): xoá SKU còn lệnh kiểm tra vật tư -> 409 nêu lý do; vướng khoá ngoại lúc xoá -> 409 "vừa được dùng ở chứng từ khác".
  (Chặn xoá SKU đã có lệnh sản xuất / phiếu chuyển kho: chờ chốt.)
- T4-7: gửi định mức mảnh rỗng -> 400 "Cần ít nhất 1 mảnh" (trước xoá sạch mảnh, có thể sinh bản nháp mồ côi).
- T2-2: xoá khách còn đơn / booking -> 409 nêu số; xoá đơn có lượt tính phương án cắt đang mở -> 409 nêu lý do; xoá đơn dọn dòng ghim của
  lượt đã bị thay (SUPERSEDED) để không vướng khoá ngoại.
- T2-6: xem trước phương án cắt với SKU không tồn tại -> 404 (như route anh em).
- T3-12: văn phòng phẩm - tên / đơn vị rỗng -> 400; nhập phải số dương, xuất phải số âm; dòng tồn đầu ghi người tạo trong cùng transaction;
  mã đã dùng cho vật tư đã xoá -> 409 câu rõ (không dùng lại mã, theo chuẩn ERP).
- T4-5: KCS chấm có phần không đạt mà thiếu nguyên nhân -> 400 (6 đường chấm). Thiếu (short) không phải lỗi, không bắt buộc.
- T4-8: tên lý do lỗi tối đa 100 ký tự.

## Kiểm
- Mỗi lỗi có test đơn vị đỏ trước. Test HTTP mới `test/loi-muc4-2011.e2e-spec.ts`: 65 ca đầu chạy trên code cũ 51 đỏ / 14 xanh; sau
  review độc lập thêm 4 ca (URL ảnh có `?` / `#` ở cuối...), nay 69/69.
- 2 ca đua mới ở `p1-chan-vuot-race` (gửi trùng cùng khoá lúc khoá Cắt / Uốn đang bị giữ): tắt try-lock chống trùng thì 2 đỏ, bật lại xanh.
- Cả bộ e2e 167/167 (DB mới tinh như CI + DB test chung); integration 182/182 (gồm test đua P1); jest đơn vị 4877. Chạy lại sau khi gộp
  main mới nhất: e2e 167/167, integration 182/182, jest 4887 (2 ca đo thời gian của bộ giải cắt sắt chậm khi máy tải nặng, chạy riêng
  16/16); nest build; eslint / prettier sạch; LF.
- Chạy thử trên bản sao (BE bản build mới + FE): Admin phát thông báo chung, lần 1 mất phản hồi sau khi BE đã ghi -> bấm lại gửi cùng khoá,
  chỉ có 1 thông báo.
- Test QA đã khoá đổi kỳ vọng theo kế hoạch (Lead duyệt): 409 -> 422 khi khoá chống trùng bị dùng lại (nhập kho, báo sản lượng); thêm
  nguyên nhân lỗi vào các lần chấm KCS có phần không đạt.

## Deploy
- BE (kèm migration) trước, FE NGAY sau trong cùng đợt (màn QR / thông báo dùng mã lỗi mới).
- Trước deploy, SELECT chỉ đọc production: `max(length(label))` lý do lỗi (> 100 thì rút gọn trước); `CLOUDINARY_CLOUD_NAME` có trên
  Render (chỉ kiểm có / không) - thiếu thì mọi thao tác có ảnh bằng chứng sẽ 400.
- Báo người dùng: KCS chấm có lỗi phải chọn nguyên nhân (giao diện vốn đã bắt buộc); không xoá được khách còn đơn / SKU còn lệnh kiểm tra.
- Báo đồng nghiệp: mã lỗi mới ở nhận hàng / sửa tồn / phiếu XK / văn phòng phẩm; khi họ push chuyển kho / vật tư thì áp cùng quy ước
  chống trùng và bộ kiểm URL.
