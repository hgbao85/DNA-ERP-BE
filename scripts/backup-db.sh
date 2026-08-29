#!/usr/bin/env bash
# Backup toàn bộ DB (Prisma Postgres) bằng pg_dump - dùng qua `pnpm db:backup`.
#
# Đính chính 2026-08-29 (kế hoạch "chiều dài cây sắt", Bước 0): file này TỪNG được khai trong
# package.json ("db:backup": "bash scripts/backup-db.sh") nhưng chưa từng được tạo trong repo -
# lệnh gọi thất bại thẳng ("No such file or directory") mà không ai phát hiện tới khi cần dùng
# thật. Đây là bản viết thật đầu tiên, ĐÃ TỰ CHẠY THẬT để xác nhận (không chỉ đọc code):
#   1. pg_dump qua Docker (postgres:17, khớp server thật 17.2) tạo file .dump thành công.
#   2. pg_restore file đó vào 1 Postgres tạm (container riêng, KHÔNG đụng DB thật) - bảng, dữ
#      liệu (users/stock_ledger/stock_quant...), và trigger fn_sync_stock_quant/
#      trg_sync_stock_quant đều khôi phục đúng.
#
# Dùng DIRECT_DATABASE_URL (không phải DATABASE_URL) - .env phân biệt 2 biến này vì DATABASE_URL
# trỏ qua pooler kiểu PgBouncer (pooled.db.prisma.io) không đảm bảo hỗ trợ đầy đủ phiên làm việc
# mà pg_dump cần (transaction pooling có thể cắt ngang phiên dump dài); DIRECT_DATABASE_URL trỏ
# thẳng (db.prisma.io) an toàn cho tác vụ này.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Đọc ĐÚNG 1 dòng cần thiết từ .env thay vì `source` cả file - `.env` ở đây không phải bash hợp lệ
# 100% (vd CORS_ORIGIN=http://localhost:3000, https://erpdna.vercel.app không có ngoặc, có dấu
# phẩy+khoảng trắng - `source` sẽ khiến bash hiểu nhầm phần sau là 1 lệnh riêng và crash với lỗi
# "No such file or directory" khó hiểu, đã tự gặp lúc viết script này). Không ghi đè nếu biến đã
# có sẵn trong môi trường gọi (CI có thể tự export riêng, không qua .env).
if [ -z "${DIRECT_DATABASE_URL:-}" ] && [ -f .env ]; then
  DIRECT_DATABASE_URL="$(grep -E '^DIRECT_DATABASE_URL=' .env | tail -n1 | cut -d'=' -f2- | sed -e "s/^['\"]//" -e "s/['\"]\$//")"
  export DIRECT_DATABASE_URL
fi

: "${DIRECT_DATABASE_URL:?DIRECT_DATABASE_URL chưa được set - kiểm tra file .env (cần cả DATABASE_URL lẫn DIRECT_DATABASE_URL, xem .env.example)}"

mkdir -p backups
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT="backups/dna-erp-${TIMESTAMP}.dump"

# Version PHẢI khớp (hoặc mới hơn) server thật, không thì pg_dump báo "aborting because of server
# version mismatch" (đã tự gặp: server 17.2, thử image postgres:16 trước tiên thì lỗi ngay). Server
# đang là 17.2 tính tới 2026-08-29 - đổi tag này nếu Prisma nâng cấp Postgres phía họ.
PG_DUMP_IMAGE="${PG_DUMP_IMAGE:-postgres:17}"

run_pg_dump() {
  local out_path_in_container="/backups/$(basename "${OUT}")"
  if command -v pg_dump >/dev/null 2>&1; then
    echo "Dùng pg_dump có sẵn trong PATH..."
    pg_dump "${DIRECT_DATABASE_URL}" --format=custom --no-owner --no-privileges --file="${OUT}"
  elif command -v docker >/dev/null 2>&1; then
    echo "Không thấy pg_dump trong PATH - chạy qua Docker (${PG_DUMP_IMAGE}, đã tự xác nhận hoạt động 2026-08-29)..."
    # MSYS_NO_PATHCONV=1: chặn Git Bash trên Windows tự "sửa" đường dẫn kiểu /backups/... thành
    # đường dẫn Windows trước khi truyền cho docker - không có dòng này, mount volume sẽ sai trên
    # Windows (vô hại/bị bỏ qua trên Linux/macOS).
    MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd)/backups:/backups" "${PG_DUMP_IMAGE}" \
      pg_dump "${DIRECT_DATABASE_URL}" --format=custom --no-owner --no-privileges \
      --file="${out_path_in_container}"
  else
    echo "Lỗi: không tìm thấy 'pg_dump' trong PATH, và không có Docker để chạy fallback." >&2
    echo "Cài PostgreSQL client tools (winget install PostgreSQL.PostgreSQL / choco install postgresql)" >&2
    echo "hoặc cài/bật Docker Desktop rồi chạy lại." >&2
    exit 1
  fi
}

echo "Đang backup DB (DIRECT_DATABASE_URL) vào ${OUT} ..."
run_pg_dump

SIZE="$(du -h "${OUT}" 2>/dev/null | cut -f1)"
echo "Backup xong: ${OUT} (${SIZE:-?})"
echo "Khôi phục bằng: pnpm db:restore -- ${OUT}"
