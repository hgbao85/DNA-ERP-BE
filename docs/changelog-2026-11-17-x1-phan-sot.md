# X1 phần còn sót — danh sách lỗi còn tồn 16/11 (17/11/2026)

Nguồn: FE `docs/audit-2026-11-16-loi-con-ton-doc-code.html`, mục X1, phần "Còn sót". Không có migration, không sửa FE.

## Đối chiếu từng ý với code hiện tại

| Ý trong danh sách | Hiện trạng |
|---|---|
| `recordCutBatch` đọc bó đang mở ngoài transaction, không khoá, cộng vào bó không kiểm trạng thái | **Đã sửa từ `2470ac9` (IT)**: chọn đợt đang mở TRONG transaction, `lockBusinessKey` + `FOR UPDATE`, chỉ lấy đợt `CUTTING` → không cộng được vào đợt đã gửi KCS / đã đạt. |
| `finishCutBundle` update không có điều kiện trạng thái | **Đã sửa từ `2470ac9`**: `updateMany WHERE status = CUTTING` + kiểm count, lời gọi thua nhận 409. |
| `reviewCutBundle` đọc số đoạn ngoài transaction | **Không còn là lỗi thật**, đã thêm chốt phòng thủ (dưới). |

Vì sao `reviewCutBundle` không còn là lỗi thật:
- Mọi chỗ ghi vào số đoạn của đợt cắt đều đòi đợt đang `CUTTING` và khoá dòng đợt `FOR UPDATE`. Ba chỗ đó là `recordCutBatch`, QLSX hủy báo cắt (`reverseCut`) và hoàn tác (`undoLastCutBatch`).
- Không có đường nào đưa đợt từ `AWAITING_QC` quay về `CUTTING`.
- Vậy khi KCS duyệt, đợt đã "chờ KCS" và số đoạn đã đứng yên.

## Sửa

`qc-reviews.service.ts` `reviewCutBundle`:
- Số đã cắt dùng cho chặn "chấm lỗi vượt số đã cắt" nay đọc **trong transaction, sau** bước `updateMany` có điều kiện `AWAITING_QC`. Bước này giữ khoá dòng đợt tới hết transaction.
- Chấm vượt thì transaction huỷ cả bước đổi trạng thái.
- Mục đích: chốt chặn không phụ thuộc vào luật ở module khác, phòng khi sau này có luồng sửa số đoạn của đợt đã gửi KCS.

## Test

- +1 unit: số đã cắt đọc sau bước giữ dòng đợt. Ca "chấm vượt" kiểm thêm là không ghi kết quả KCS.
- Unit toàn bộ: chỉ còn 2 lỗi cũ của bộ giải tối ưu cắt (3823 qua).
- Integration 35/35, gồm 12 test tranh chấp đợt cắt của IT.
- **Chưa thử sống**: bản sao DB dev không còn phiếu xuất sắt / đợt cắt nào để duyệt.
