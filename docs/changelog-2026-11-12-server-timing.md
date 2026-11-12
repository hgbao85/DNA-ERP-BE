# Changelog 12/11/2026 - Header Server-Timing cho mọi API

## Yêu cầu
Production mở màn "Tối ưu cắt sắt" chậm (4,3 s, 13 lượt gọi). Đo từ trình duyệt: gọi lần lượt mỗi API ~100 ms, gọi cùng lúc
thì tổng thời gian tăng gần theo số lượt gọi (12 lượt `auth/me` cùng lúc: 1,4–2,4 s), kể cả khi màn không có SKU nào chờ gom
(bộ giải không chạy). Cần số đo phía máy chủ để biết thời gian nằm ở DB, bộ giải hay xử lý/CPU, thay vì đoán.

## Sửa
- Mọi response có header chuẩn `Server-Timing`, xem được trong DevTools (Network → Timing) và đọc được bằng JS
  (`PerformanceResourceTiming.serverTiming`):
  `Server-Timing: total;dur=182.4, db;dur=95.1;desc="7 queries"` (+ `solver;dur=…;desc="N calls"` khi request gọi bộ giải).
  - `total`: từ lúc request vào app tới lúc ghi header response.
  - `db`: tổng thời gian các truy vấn Prisma của request (cộng dồn cả truy vấn chạy song song nên có thể lớn hơn `total`).
  - `solver`: tổng thời gian chờ hàng đợi + chạy bộ giải (cũng cộng dồn khi gọi song song).
- `Timing-Allow-Origin`: đặt bằng Origin của request khi Origin nằm trong `CORS_ORIGIN` (hoặc `*` khi CORS là `*`), để FE
  khác origin đọc được số đo. Không mở rộng CORS.
- Bật/tắt bằng `SERVER_TIMING_ENABLED` (mặc định bật).
- File: `src/common/middleware/server-timing.middleware.ts` (mới, mount ngay sau `ClsMiddleware`, bọc `res.writeHead`);
  `src/prisma/extensions/query-timing.extension.ts` (mới, lớp `$extends` trong cùng, ngoài request thì bỏ qua);
  `src/common/interfaces/cls-store.interface.ts` (`timing`); `src/prisma/prisma.service.ts`; `src/app.module.ts`;
  `src/modules/cutting-proposals/solver-client.service.ts` (đo quanh `propose`); `src/config/configuration.ts`,
  `src/config/env.validation.ts`, `.env.example`.

## Kiểm tra
- `tsc` không lỗi trong `src` (2 lỗi có sẵn từ 19/10 ở `prisma/seed-ghe-j55-full-bom.ts`, `prisma/seed-real-products.ts`, không
  đụng); `eslint` sạch; jest 3 suite / 17 test (2 spec mới + `solver-client.service.spec.ts`); `nest build` sạch.
- Chạy thật trên DB local qua client có lớp đo: giao dịch gộp `$transaction([...])` và giao dịch tương tác đều chạy đúng, đếm đủ
  4 truy vấn.
- Mở màn Tối ưu cắt sắt ở local (FE dev → BE dev): đọc được `serverTiming` của mọi request, vd `cutting-batch-candidates`
  total 387 ms, db 112 ms / 6 truy vấn, solver 993 ms cộng dồn (xác minh chip song song sau khi BE vừa khởi động lại).

## Lưu ý khi deploy
- Production phải có `CORS_ORIGIN` chứa đúng origin của FE thì JS mới đọc được số đo (DevTools vẫn hiện header dù thiếu).
- Số đo lộ thời gian DB/số truy vấn cho client; muốn tắt thì đặt `SERVER_TIMING_ENABLED=false`.
