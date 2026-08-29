#!/usr/bin/env bash
# Khôi phục DB (Prisma Postgres) từ 1 file backup tạo bởi scripts/backup-db.sh - gọi qua
# `pnpm db:restore -- <đường-dẫn-file>`.
#
# Đính chính 2026-08-29 (kế hoạch "chiều dài cây sắt", Bước 0) - xem backup-db.sh: file này cũng
# chưa từng được tạo trong repo dù đã khai trong package.json từ trước. ĐÃ TỰ CHẠY THẬT để xác
# nhận cơ chế restore hoạt động (khôi phục vào 1 Postgres tạm riêng, KHÔNG đụng DB thật - bảng,
# dữ liệu, trigger fn_sync_stock_quant/trg_sync_stock_quant đều đúng).
#
# ⚠️ NGUY HIỂM - ĐỌC KỸ TRƯỚC KHI DÙNG:
# Lệnh này XOÁ SẠCH toàn bộ dữ liệu hiện có trong DB đích (--clean) rồi ghi đè bằng đúng nội dung
# tại thời điểm backup - MỌI giao dịch phát sinh SAU thời điểm backup (đơn hàng/nhận hàng/xuất
# kho... thật) sẽ MẤT VĨNH VIỄN, không có cách lấy lại.
#
# CHỈ dùng lệnh này TRƯỚC khi mở lại hệ thống cho người dùng thật sau 1 đợt migration/bảo trì (còn
# trong buổi bảo trì, chưa ai thao tác gì mới). Sau khi hệ thống đã hoạt động lại, PHÁT HIỆN LỖI
# THÌ CHỈ FORWARD-FIX (vá tiếp bằng migration/hotfix mới) - TUYỆT ĐỐI KHÔNG chạy lệnh này, vì hậu
# quả (mất nhiều giờ dữ liệu thật) thường nặng hơn chính lỗi đang muốn sửa.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Đọc ĐÚNG 1 dòng cần thiết từ .env thay vì `source` cả file - xem comment cùng đoạn ở
# backup-db.sh (CORS_ORIGIN không có ngoặc làm `source` crash, đã tự gặp thật).
if [ -z "${DIRECT_DATABASE_URL:-}" ] && [ -f .env ]; then
  DIRECT_DATABASE_URL="$(grep -E '^DIRECT_DATABASE_URL=' .env | tail -n1 | cut -d'=' -f2- | sed -e "s/^['\"]//" -e "s/['\"]\$//")"
  export DIRECT_DATABASE_URL
fi

: "${DIRECT_DATABASE_URL:?DIRECT_DATABASE_URL chưa được set - kiểm tra file .env}"

# `pnpm db:restore -- <file>` truyền cả "--" lẫn <file> làm 2 tham số riêng cho script (pnpm/npm
# tự thêm "--" khi forward args qua "run <script> -- ...") - đã tự chạy thật và bắt được lỗi này
# (script tưởng nhầm "--" là tên file). Bỏ qua "--" đứng đầu nếu có.
if [ "${1:-}" = "--" ]; then
  shift
fi

FILE="${1:-}"
if [ -z "${FILE}" ] || [ ! -f "${FILE}" ]; then
  echo "Dùng: pnpm db:restore -- <đường-dẫn-file-backup>" >&2
  echo "Ví dụ: pnpm db:restore -- backups/dna-erp-20260829_120000.dump" >&2
  exit 1
fi

# Cùng lý do version với backup-db.sh - xem comment ở đó.
PG_RESTORE_IMAGE="${PG_RESTORE_IMAGE:-postgres:17}"

echo "⚠️  Sắp XOÁ SẠCH dữ liệu hiện tại trong DB đích và khôi phục từ:"
echo "    ${FILE}"
echo ""
echo "Chỉ làm việc này TRƯỚC khi mở lại hệ thống cho người dùng thật sau bảo trì."
echo "Gõ đúng chữ XOA (viết hoa, không dấu) rồi Enter để xác nhận, hoặc Ctrl+C để huỷ:"
read -r CONFIRM
if [ "${CONFIRM}" != "XOA" ]; then
  echo "Huỷ - không có gì bị xoá."
  exit 1
fi

echo "Đang khôi phục từ ${FILE} ..."
# Tắt `set -e` riêng cho đoạn gọi pg_restore - đã tự chạy thật và bắt được: pg_restore --clean
# --if-exists THƯỜNG trả exit code khác 0 dù khôi phục dữ liệu vẫn thành công, vì nó tự đếm cả
# những lỗi VÔ HẠI đã "ignored" (vd DROP EXTENSION/CREATE EXTENSION cho extension đặc thù của
# Prisma Postgres không có trên 1 server Postgres thường - trên chính server thật thì extension
# này luôn có sẵn nên không phát sinh). Nếu để `set -e` giết script ngay tại đây, người vận hành
# đang cần khôi phục khẩn cấp sẽ tưởng nhầm là thất bại hoàn toàn dù dữ liệu đã về đúng, dễ hoảng
# và thao tác thêm sai lầm. Không giấu lỗi - chỉ không để 1 exit code mơ hồ cắt ngang thông báo.
set +e
if command -v pg_restore >/dev/null 2>&1; then
  echo "Dùng pg_restore có sẵn trong PATH..."
  pg_restore --clean --if-exists --no-owner --no-privileges --dbname="${DIRECT_DATABASE_URL}" "${FILE}"
  RESTORE_EXIT=$?
elif command -v docker >/dev/null 2>&1; then
  echo "Không thấy pg_restore trong PATH - chạy qua Docker (${PG_RESTORE_IMAGE}, đã tự xác nhận hoạt động 2026-08-29)..."
  ABS_FILE_DIR="$(cd "$(dirname "${FILE}")" && pwd)"
  FILE_NAME="$(basename "${FILE}")"
  # MSYS_NO_PATHCONV=1: xem giải thích ở backup-db.sh (chặn Git Bash trên Windows tự sửa đường
  # dẫn container trước khi truyền cho docker).
  MSYS_NO_PATHCONV=1 docker run --rm -v "${ABS_FILE_DIR}:/restore-in" "${PG_RESTORE_IMAGE}" \
    pg_restore --clean --if-exists --no-owner --no-privileges \
    --dbname="${DIRECT_DATABASE_URL}" "/restore-in/${FILE_NAME}"
  RESTORE_EXIT=$?
else
  echo "Lỗi: không tìm thấy 'pg_restore' trong PATH, và không có Docker để chạy fallback." >&2
  exit 1
fi
set -e

if [ "${RESTORE_EXIT}" -eq 0 ]; then
  echo "Khôi phục xong (pg_restore không báo lỗi nào)."
else
  echo ""
  echo "pg_restore kết thúc với mã lỗi ${RESTORE_EXIT} - đọc kỹ log \"pg_restore: error\" ở TRÊN:"
  echo "  - Nếu dòng cuối là kiểu \"warning: errors ignored on restore: N\" và mọi lỗi phía trên"
  echo "    đều thuộc dạng \"extension ... does not exist\"/\"already exists\" (đặc thù server khác"
  echo "    Prisma Postgres thật, hoặc restore lần 2 lên DB đã có sẵn extension) - dữ liệu vẫn có"
  echo "    thể đã về đúng, tự kiểm tra lại vài bảng quan trọng (vd SELECT count(*) FROM users)."
  echo "  - Nếu có lỗi KHÁC loại trên (vd \"permission denied\", \"connection\", \"syntax\") - PHẢI coi"
  echo "    là thất bại thật, không được coi là đã khôi phục xong."
  exit "${RESTORE_EXIT}"
fi
