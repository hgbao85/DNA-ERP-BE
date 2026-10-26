# Changelog 2026-09-24 — Vỡ UI dropdown "Chọn kho" ở màn QLSX duyệt Lệnh sản xuất

## 1. Bối cảnh

Trong lúc live-test luồng duyệt PI (KHSX → QLSX → Sếp) để kiểm hàng đợi solve, người dùng báo: *"hãy
kiểm tra tới màn QLSX khi duyệt Lệnh sản xuất lúc chọn kho tôi thấy bị vỡ UI"*.

## 2. Tái hiện + gốc rễ

Tái hiện bằng UI thật: đăng nhập `qlsx`/`demo1234` → "Xử lý lệnh sản xuất" → mở 1 PI **CHỈ 1 SKU**
(PI-2026-013) → bấm "Chọn kho sản xuất" → gõ vào ô "Chọn kho thành phẩm cho SKU này..." để lọc gợi ý.
Dropdown gợi ý ("Kho thành phẩm (demo)") gần như biến mất - chỉ còn 1 sliver vài px ở đáy ô nhập, kèm
1 thanh cuộn dọc lạ tràn ra ngoài khung SKU.

**Không tái hiện được** ở ô "Áp dụng nhanh cho tất cả SKU" (chỉ xuất hiện khi PI có ≥2 SKU) - ô đó
nằm NGOÀI khung bị lỗi nên không dính.

Dùng `javascript_tool` đo trực tiếp `getBoundingClientRect()` + `getComputedStyle()` của dropdown và
tổ tiên của nó, xác nhận gốc rễ:

- `SearchableSelect` ([SearchableSelect.tsx](../../DNA-ERP/src/components/SearchableSelect.tsx), dùng
  chung ở 6 màn: `MaterialPicker.tsx`, `ChuyenKhoTuDoPage.tsx`, `LenhSXPage.tsx`,
  `SKUReviewPage.tsx`, `OrderManagementPage.tsx`, `PurchaseHistoryPage.tsx`) render dropdown gợi ý
  bằng `position: absolute; top: 100%` lồng NGAY TRONG wrapper `position: relative` của chính nó -
  cách định vị dropdown "cổ điển", không dùng portal.
- Modal "Chọn kho thành phẩm" (`LenhSXPage.tsx` dòng ~1077) bọc danh sách SKU trong 1 khung
  `maxHeight:320, overflowY:'auto'`. CSS `overflow: auto/hidden/scroll` CẮT MẤT mọi phần tử con tràn
  ra ngoài khung, KỂ CẢ phần tử `position: absolute` - và khung này tự co theo chiều cao NỘI DUNG
  BÌNH THƯỜNG (bỏ qua phần tử absolute khi tính kích thước), nên với PI chỉ 1-2 SKU, khung thấp hơn cả
  chiều cao dropdown → dropdown bị cắt gần hết. PI nhiều SKU hơn đôi khi đủ cao để dropdown "lọt" vừa,
  che giấu bug - nhưng bản chất vẫn sai, chỉ là hiếm khi lộ ra bằng mắt.

## 3. Đã sửa

`SearchableSelect.tsx`: đổi dropdown gợi ý sang render qua **React Portal** (`createPortal` vào
`document.body`), định vị bằng `position: fixed` + toạ độ đo trực tiếp từ `input.getBoundingClientRect()`
(không cần cộng/trừ scroll offset vì `fixed` đã theo toạ độ viewport). Đo lại vị trí:
- Mỗi lần dropdown mở (`open` chuyển `true`).
- Khi cuộn/resize TRONG LÚC dropdown đang mở (`window.addEventListener('scroll', ..., true)` với
  `capture:true` để bắt được cả scroll của khung `overflowY:auto` lồng sâu bên trong, vì scroll không
  bubble lên `window` theo cách thường - phải nghe ở capture phase) - để dropdown không "đứng yên" khi
  modal chứa nó tự cuộn.

Portal thoát khỏi MỌI tổ tiên có `overflow`, nên không còn bị cắt dù lồng sâu tới đâu - sửa 1 lần ở
component dùng chung, tự động khớp cho cả 6 nơi đang dùng `SearchableSelect`, không cần sửa riêng từng
màn.

## 4. Kiểm tra

- `npx tsc --noEmit` (DNA-ERP) sạch.
- **Live-test lại đúng ca vừa vỡ**: cùng PI-2026-013 (1 SKU), gõ "kho" vào ô "Chọn kho thành phẩm cho
  SKU này..." - dropdown "Kho thành phẩm (demo)" hiện đầy đủ, không còn bị cắt, không còn thanh cuộn
  lạ. Chọn được, ô điền đúng giá trị, nút "Gửi sếp duyệt" chuyển active (trước đó bị khoá vì chưa chọn
  được kho do dropdown không bấm được).

## 5. Còn treo

Chưa live-test lại 5/6 nơi khác đang dùng `SearchableSelect` (`MaterialPicker.tsx`,
`ChuyenKhoTuDoPage.tsx`, `SKUReviewPage.tsx`, `OrderManagementPage.tsx`, `PurchaseHistoryPage.tsx`) -
fix mang tính tổng quát (sửa đúng cách định vị, không phải patch riêng cho 1 màn) nên về lý thuyết áp
dụng đúng cho mọi nơi, nhưng chưa xác nhận bằng mắt cho từng màn còn lại.
