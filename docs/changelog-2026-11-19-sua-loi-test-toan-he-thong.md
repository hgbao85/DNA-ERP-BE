# 19/11/2026 - Sửa 10 lỗi không cần chốt nghiệp vụ từ đợt test toàn hệ thống (BE)

Nguồn: đợt test toàn hệ thống 19/11 (API từng vai + trình duyệt). Chia việc với đồng nghiệp: phần tạo vật tư kèm tồn đầu, điểm đan,
chuyển kho do đồng nghiệp làm; đợt này là phần còn lại không cần chốt nghiệp vụ. Không đổi FE, không migration.

## Thay đổi

### Kho / danh mục
- Xoá kho không còn treo (T1-1). Trước đây `$transaction([...])` dạng mảng bị extension xoá mềm viết lại `user.deleteMany` thành lời gọi
  ngoài batch nên batch không bao giờ chạy. Nay dùng `$transaction(async tx)`: kiểm trước kho còn được tham chiếu (vật tư, dòng tồn, bút toán
  sổ kho, giữ chỗ, phiếu chuyển, đoạn, văn phòng phẩm, phiếu xuất - đủ 14 khoá ngoại tới kho) -> 409 "Kho còn 3 vật tư, 5 bút toán sổ kho -
  không xoá được"; xoá được thì giữ hành vi cũ (tài khoản chưa xoá gắn đúng kho bị xoá mềm theo). Xoá mềm tài khoản dùng
  `tx.user.updateMany` trong cùng transaction (KHÔNG `deleteMany`: extension xoá mềm chạy lệnh đó ngoài transaction), nên kho xoá lỗi thì
  tài khoản cũng lùi.
- Xoá nhóm vật tư còn vật tư -> 409 "Nhóm còn N vật tư - chuyển vật tư sang nhóm khác trước khi xoá" (T1-2); trước đây 204 và vật tư mất nhóm.
- Tạo / sửa vật tư với loại chi tiết / nhóm con của sắt sai -> 400 tiếng Việt thay vì 500 (T1-7, chỉ sửa DTO).
- Mã (id) vượt khoảng bigint -> 400 "Mã (id) không hợp lệ" thay vì 500 (T3-10). Sổ kho lọc theo ngày thuần (YYYY-MM-DD) tính theo ngày giờ VN:
  từ 00:00 tới 23:59:59 giờ VN (trước đây 00:00 UTC nên "đến ngày" loại cả ngày đó).

### Cấu hình / thông báo / đợt cắt
- PUT /system-config (T1-3): hao hụt tối đa 0,01-100%; lưỡi cắt laze 0-10 mm; email kiểm định dạng; số điện thoại công ty 8-40 ký tự gồm
  chữ số, khoảng trắng, + . - ( ) / , (ghi được 2 số). Ô để trống vẫn được. Câu lỗi tiếng Việt.
- Thông báo: `read-all` và danh sách với loại thông báo lạ -> 400 thay vì 500 (T1-5).
- GET /cut-bundles với trạng thái lạ -> 400 thay vì 500 (T1-6).

### Định mức / KCS
- Tách quyền ghi định mức (T4-1, ĐỔI QUYỀN): 3 route ghi định mức mảnh (gửi, lưu nháp, xoá nháp) chỉ NV định mức mảnh (`SPEC_STEEL_STAFF`)
  + Admin; 3 route ghi định mức chi tiết chỉ NV định mức chi tiết (`SPEC_ACCESSORY_PACKAGING_STAFF`) + Admin. Trước đây cả hai NV ghi được
  định mức của nhau vì cùng có `SKU:UPDATE`. Route duyệt định mức không đổi. FE không đổi (mỗi màn chỉ gọi route của vai mình).
- Câu lỗi sai / kỹ thuật (T4-9): KCS chấm thiếu danh sách cỡ đoạn -> "Thiếu danh sách cỡ đoạn..." (trước "có giá trị bị trùng"); định mức
  có 2 mảnh trùng tên -> "Hai mảnh trùng tên: ..." (trước câu khoá trùng kỹ thuật); lý do lỗi KCS không tồn tại -> "Lý do lỗi không tồn tại
  hoặc đã xoá" (6 hàm chấm); tách dòng chỉ có 1 cây -> "Dòng chỉ có 1 cây - không tách được".

### Câu lỗi kiểm tra đầu vào (toàn hệ thống, T3-15)
- Mỗi trường chỉ báo MỘT câu (trước: thiếu 1 trường ra 3-4 câu chồng nhau). Thứ tự chọn: câu tự đặt trong DTO (chọn theo mức ưu tiên ràng
  buộc) > "Thiếu <nhãn>" khi trường undefined / null (chuỗi rỗng / mảng rỗng chỉ tính là thiếu nếu trường bắt buộc nhập) > ràng buộc ưu
  tiên cao nhất (kiểu dữ liệu -> định dạng -> khoảng / độ dài).
- Gọi trường bằng nhãn tiếng Việt (bảng `validation-field-labels.ts`, phủ cả 277 tên thuộc tính có kiểm tra trong DTO), không còn in tên
  thuộc tính tiếng Anh; dòng con: "Dòng 1: thiếu số lượng đã nhận" (cả với câu tự đặt).
- Mỗi lỗi 400 kiểm tra đầu vào ghi log mức warn kèm đường dẫn trường thật (vd `items.0.receivedQty [isNumber]`, không ghi giá trị người
  dùng gửi) để dò khi FE / BE lệch nhau.

## Kiểm
- Mỗi lỗi có test tái hiện chạy đỏ trước rồi mới sửa (đơn vị). Test HTTP mới `test/loi-test-toan-he-thong-1911.e2e-spec.ts`: 36 ca đầu
  trên code cũ 21 đỏ / 15 xanh; sau sửa + bổ sung theo QA 39/39 (dọn cả nhật ký kiểm toán của dữ liệu thử); cả bộ e2e 98/98 (chạy được trên
  DB mới tinh như CI). Jest đơn vị 4681 đạt; nest build đạt; eslint / prettier sạch; LF.
- QA review độc lập: Đạt có điều kiện (2 Vừa: xoá mềm tài khoản thoát transaction khi xoá kho; câu lỗi "một trường dữ liệu" vì thiếu nhãn
  - và 6 Thấp) - đã sửa hết trong đợt này. Tách quyền định mức: không đường vòng, không chặn nhầm ai (bản sao 17/11).

## Deploy
- Chỉ BE. Không migration, không seed, không cần đăng nhập lại.
- Trước deploy: SELECT chỉ đọc production - (a) cấu hình hiện có lưỡi cắt laze > 10 mm hoặc hao hụt tối đa ngoài 0,01-100 không (nếu có,
  lưu lại màn Cấu hình sẽ bị 400); (b) tài khoản đang nhập định mức thật có đúng vai (định mức mảnh = `SPEC_STEEL_STAFF`, định mức chi tiết
  = `SPEC_ACCESSORY_PACKAGING_STAFF`).
- Báo người dùng: NV định mức mảnh / chi tiết chỉ nhập được phần của mình; câu lỗi khi nhập thiếu / sai giờ ngắn hơn, mỗi ô một câu.
