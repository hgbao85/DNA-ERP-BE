import { spawnSync } from 'node:child_process';

/**
 * Gộp 2 lệnh dọn dev DB "triệt để" thành 1 lệnh duy nhất, chạy ĐÚNG THỨ TỰ (xem doc comment
 * prisma/reset-warehouse-v2.ts và prisma/delete-sku.ts cho lý do thứ tự này bắt buộc):
 *   1. reset-warehouse-v2.ts    - xoá sạch dữ liệu GIAO DỊCH (ProductionOrder/Invoice/
 *      WarehouseTransfer/MaterialInspectionRequest/CuttingProposal/StockLedger...), giữ nguyên
 *      vật tư/user/kho/SKU-BOM.
 *   2. delete-sku.ts --all --with-product - dọn tiếp MỌI SKU/Product không còn dữ liệu thật bám
 *      vào (vẫn tự kiểm an toàn cho từng SKU - xem 4 lớp kiểm trong delete-sku.ts, --all KHÔNG
 *      bỏ qua lớp kiểm nào).
 *
 * KHÔNG đổi logic của 2 file gốc - chỉ gọi lại đúng 2 lệnh đó bằng 1 tiến trình con mỗi bước, để
 * mỗi file giữ nguyên hành vi/đã test độc lập của nó. Dừng NGAY nếu bước 1 lỗi (không chạy bước 2
 * trên 1 lần reset nửa vời, dang dở).
 *
 * CHẠY:       npm run reset-and-delete-sku
 * XEM TRƯỚC:  npm run reset-and-delete-sku -- --dry-run   (không xoá gì ở CẢ 2 bước)
 */

const dryRun = process.argv.includes('--dry-run');

function run(label: string, args: string[], env: NodeJS.ProcessEnv): void {
  console.log(`\n=== ${label} ===`);
  // shell:true bắt buộc trên Windows để spawnSync tìm ra "npx.cmd" (không phải file thực thi
  // trực tiếp, cần qua cmd.exe mới resolve được) - không có cờ này, spawnSync lỗi ENOENT âm thầm
  // (result.status=null, không in gì ra) trước khi cả tiến trình con kịp chạy.
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const result = spawnSync(npxCmd, args, {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(
      `\n[DỪNG] "${label}" thất bại (exit code ${result.status ?? result.signal}) - không chạy bước tiếp theo.`,
    );
    process.exit(result.status ?? 1);
  }
}

const resetEnv = { ...process.env };
if (dryRun) {
  delete resetEnv.CONFIRM_RESET; // không thừa hưởng CONFIRM_RESET=YES nếu shell hiện tại đã set sẵn
} else {
  resetEnv.CONFIRM_RESET = 'YES';
}
run(
  'Bước 1/2: reset-warehouse-v2 (xoá dữ liệu giao dịch, giữ nguyên SKU/BOM)',
  ['ts-node', '-r', 'tsconfig-paths/register', 'prisma/reset-warehouse-v2.ts'],
  resetEnv,
);

const deleteSkuArgs = [
  'ts-node',
  '-r',
  'tsconfig-paths/register',
  'prisma/delete-sku.ts',
  '--all',
  '--with-product',
];
if (dryRun) deleteSkuArgs.push('--dry-run');
run(
  'Bước 2/2: delete-sku --all --with-product (dọn SKU/Product còn sót)',
  deleteSkuArgs,
  process.env,
);

console.log('\nHoàn tất.');
