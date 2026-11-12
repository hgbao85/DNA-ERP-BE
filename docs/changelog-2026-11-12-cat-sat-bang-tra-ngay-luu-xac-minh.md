# Changelog 12/11/2026 - Tối ưu cắt sắt: bảng SKU trả về ngay, kiểm bù không quá giờ, lưu kết quả xác minh vào DB

## Yêu cầu
Đo với 28 SKU chờ gom (12 sản phẩm thật, 106 ô loại sắt) trên BE chạy giới hạn 0,1 CPU / 512 MB (giống gói free của Render):
- Mở màn: `cutting-batch-candidates` mất 20,4 s vì giải xác minh các ô ≤ 5 cỡ đoạn TRƯỚC khi trả bảng, mà chỉ xác minh được 1/106
  ô; mở lại vẫn 23,8 s.
- Lượt kiểm bù nền (`deepVerify`) mất 151 s, vượt timeout 150 s của FE nên FE bỏ kết quả (chỉ 39/106 ô): ngân sách 120 s chỉ
  chặn nhận bài mới, bài đang chạy vẫn được chờ tới 75 s.
- Kết quả xác minh chỉ nhớ trong RAM 30 phút, mất khi BE khởi động lại / ngủ.

## Sửa (`src/modules/cutting-proposals/cutting-proposals.service.ts`)
- Lượt thường của `getBatchCandidates` KHÔNG gọi bộ giải: chỉ điền ô đã có kết quả nhớ (RAM rồi DB, tới 12 cỡ đoạn), còn lại giữ
  ước tính. Mọi việc giải dồn sang lượt kiểm bù (FE đã có sẵn ô xám "đang kiểm" rồi tự cập nhật - không sửa FE).
- Lượt kiểm bù: giải ô ước tính CHƯA vượt ngưỡng trước (đã vượt thì chắc chắn vượt), trong mỗi nhóm bài ít cỡ đoạn trước. Timeout
  mỗi lần gọi = min(75 s, phần còn lại của ngân sách 120 s), còn dưới 3 s thì dừng; `time_limit_seconds` gửi bộ giải theo đó.
  `getBatchFixOptions` (ngân sách 60 s) cắt timeout tương tự cho cả 3 kiểu gọi bộ giải.
- Lưu kết quả xác minh vào bảng mới `cutting_exact_checks` (model `CuttingExactCheck`): khoá = sha256(phiên bản
  `EXACT_CHECK_CACHE_VERSION` + khoá bài toán gồm mọi tham số gửi bộ giải), giữ 7 ngày, dọn bản ghi quá hạn tối đa 6 giờ/lần khi
  ghi. Tra DB một truy vấn cho cả lượt rồi nạp lên RAM; ghi chạy nền, lỗi đọc/ghi DB chỉ log. Dùng chung cho
  `getBatchCandidates` và `getBatchFixOptions`.
- Chỉ lưu DB kết quả giải trọn: bài bị hết giờ ở chiều dài nào đó (`timeout_count > 0`, hoặc vô nghiệm mà `timed_out`) vẫn hiện
  cho lượt đó nhưng không lưu, để không giữ số chưa tối ưu tới 7 ngày.
- Migration `prisma/migrations/20261112090000_cutting_exact_check_cache` - chỉ `CREATE TABLE` + index `createdAt`, không đụng bảng
  khác. Deploy sẽ tự chạy (entrypoint `prisma migrate deploy`).

## Kiểm tra
- `tsc` không lỗi trong `src` (2 lỗi seed có sẵn từ 19/10); `eslint` sạch; jest `cutting-proposals.service.spec.ts` +
  `cutting-batch-suggestions.service.spec.ts`: 206 test pass (thêm test: lượt thường không gọi bộ giải, đọc/ghi DB, thứ tự ưu
  tiên, cắt timeout theo ngân sách, kết quả hết giờ không lưu DB); `nest build` sạch; migration áp vào DB local, `prisma migrate
  status` khớp.
- Đo lại cùng 28 SKU / 106 ô:

| Phép đo | Trước (giả lập gói free) | Sau (giả lập gói free) | Sau (máy mạnh) |
|---|---|---|---|
| Mở màn lần đầu, chưa có gì nhớ | 20,4 s, 1/106 ô xác minh | 6,0 s (máy chủ vừa khởi động), không gọi bộ giải | 0,18 s |
| Lượt kiểm bù 1 | 151 s (quá timeout FE), 39 ô | 119 s, 73 ô | 120 s, 81 ô |
| Lượt kiểm bù 2 | - | 121 s, 77 ô | 85 s, 105 ô |
| Khối "Đợt đang chọn" (1 SKU) | 17,9 s | 3,6 s | 0,4 s |
| Mở lại màn | 23,8 s | 0,9 s | 0,07 s |
| Mở màn sau khi BE khởi động lại (DB đã có kết quả) | 20,4 s, 1 ô | 5,7 s lần đầu / 1,7 s lần 2, 105/106 ô ngay | - |

  RAM cao nhất khi đo trên giả lập: 287 MB / 512 MB.
- Trên máy chủ yếu, các bài khó (≈ 30 s mỗi bài) có thể hết giờ mỗi lượt nên vài ô vẫn xám sau nhiều lượt (77/106 sau 2 lượt).
