# Changelog 12/11/2026 - Tối ưu cắt sắt: các API đọc dùng chung một lần nạp dữ liệu nền

## Yêu cầu
Đo trên production bằng header Server-Timing (changelog cùng ngày): DB không chậm (truy vấn đơn ~4 ms) nhưng khi nhiều API chạy
cùng lúc thì mỗi request tốn 200–450 ms phía máy chủ do máy chủ thiếu CPU. Mở màn "Tối ưu cắt sắt" gọi gần như cùng lúc 4 hàm
đọc - `getBatchCandidates` (2 lần: thường + kiểm bù nền), `getBatchSuggestions` (số đỏ ở menu), `getBatchFixOptions` (1–2 lần),
`previewBatch` - và hàm nào cũng tự nạp lại cùng bộ dữ liệu nền `loadBatchContext` (~6 truy vấn: SKU chờ gom, định mức, vật tư,
cấu hình).

## Sửa
- `src/modules/cutting-proposals/cutting-proposals.service.ts`:
  - `loadBatchContext` đổi tên `loadBatchContextFresh` (luôn đọc tươi, thân giữ nguyên); thêm `loadBatchContextCached()` cho đúng
    4 hàm đọc trên: gọi đồng thời chờ chung 1 lần đọc, xong giữ tối đa 3 giây (`BATCH_CONTEXT_CACHE_TTL_MS`); lỗi không nhớ.
  - `invalidateBatchContext()` xoá bản nhớ (kể cả lần đọc đang chạy dở) khi phát realtime (lượt giải xong / thất bại) và ở mọi
    đường ghi của service: `requestForOrder`, `requestForInvoice`, `requestForBatch`, `discardBatchSolve`, `attachToInvoice`,
    `releaseForInvoice`, `approve`.
  - Các đường ghi / kiểm tra trước khi ghi không dùng bản nhớ. Đã rà 4 hàm đọc và các hàm phụ: không chỗ nào sửa tại chỗ dữ liệu
    dùng chung (sort / Map mới đều trên bản sao).
  - Thay đổi từ module khác (duyệt SKU/định mức, tạo lệnh SX, cấu hình hệ thống) không có sự kiện phía server để xoá bản nhớ ->
    trễ tối đa 3 giây. Danh sách SKU chờ gom chỉ phụ thuộc trạng thái duyệt và việc SKU đã vào lệnh hay chưa, không phụ thuộc lượt
    tính, nên bấm "Tính" không làm danh sách sai.
- `cutting-proposals.service.spec.ts`: 5 test mới (gọi đồng thời chỉ đọc 1 lần, quá 3 s đọc lại, phát realtime thì đọc lại, lần
  đọc dở bị xoá không được dùng lại, lỗi không bị nhớ).

## Kiểm tra
- `tsc` không lỗi trong `src` (2 lỗi seed có sẵn từ 19/10); `eslint` sạch; jest `cutting-proposals.service.spec.ts` +
  `cutting-batch-suggestions.service.spec.ts`: 2 suite / 197 test pass; `nest build` sạch.
- Đo ở local (Server-Timing) khi mở màn: chỉ lần gọi đầu đọc DB (6 truy vấn); `cutting-batch-candidates`, `fix-options`,
  `preview` sau đó 0 truy vấn (trước: mỗi API 6 truy vấn).
