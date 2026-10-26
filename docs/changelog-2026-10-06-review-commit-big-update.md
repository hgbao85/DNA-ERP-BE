# Changelog 2026-10-06 — Rà 2 commit mới nhất (Update catsat + big-update) sau sự cố deploy Render

> Trạng thái: **CHỈ RÀ, CHƯA SỬA CODE.** Local `main` BE đang ở `fc3327f`, chưa pull `big-update`. Mục 5 (2026-10-26): rà 2 commit "day-nem"/"fix-day-nem" — gộp thử sạch, không ảnh hưởng logic; 5.1: ĐÃ PULL cả BE main, worktree BE, FE demo (giữ thay đổi trong máy); 5.2: đã áp 5 migration vào DB test + kiểm trình duyệt. 5.3: đã chọn file nên commit và đưa vào staged ở BE worktree / BE main / FE — CHƯA commit. 5.4: đã gom phần BE về main checkout — giờ BE commit ở MỘT chỗ (`main`, 79 file staged), FE ở `demo` (28 file); vẫn CHƯA commit. 5.5: danh sách việc cần làm khi lên production (quan trọng nhất: gói Render 512 MB không đủ RAM cho bộ giải trong BE). 5.6: ĐÃ sao lưu DB production (`backups/prod_20261026_0951_truoc-deploy-solver.dump`); production chỉ còn thiếu đúng 4 migration mới, không có migration lỗi. 5.7: lần commit đầu ở main bị hook pre-commit chặn vì main thiếu gói `highs` và Prisma client cũ — đã cài + sinh lại, hook giờ qua; CHƯA commit.

## 1. Sự cố deploy
Người dùng: deploy lần đầu chạy ~20 phút rồi fail, redeploy thì thành công. Không đọc được log Render (cần đăng nhập).
Đã kiểm trên máy với đúng code commit "Update catsat": BE `nest build` OK, FE `next build` OK, lockfile pnpm khớp (lần đổi
package.json gần nhất 05/09 chỉ thêm script). Kết luận: không phải lỗi code; nghi do môi trường (migrate/khoá advisory P1002 mà
`docker/entrypoint.js` tự gỡ ở lần sau, hoặc timeout/RAM gói free) — CHƯA xác minh được vì thiếu log.

## 2. Hai commit mới nhất
| Repo | Commit | Nội dung |
|---|---|---|
| BE main | `fc3327f` "Update catsat" (XSang, 01/10) | `DELETE /cutting-batch-solves/:id` (xoá đợt solve chưa dùng) + 8 test |
| FE demo | `8a2c1d0` "Update catsat" (01/10) | nút "Xóa lượt tính này", bung chi tiết cỡ đoạn/kiểu cắt theo loại sắt, **trần solver 20 s/loại sắt**, sửa QLSX "Mua hàng ✓" |
| BE main | `d76560f` "big-update" (ohey, 06/10, PR #38) | 65 file, +4.098 dòng: Sắt chia 3 nhóm con + module mới vật tư thành phẩm, 5 migration |
| FE demo | `33a7be9` "big-update" (06/10, PR #86) | 26 file, +1.999 dòng: màn định mức vật tư thành phẩm, chân nhôm ở Phôi/KCS/Kho, tài liệu thiết kế 01/10 |

big-update (theo tài liệu `docs/changelog-2026-10-01-sat-3-nhom-con-vat-tu-thanh-pham.html` trong repo FE):
- `Material.steelSubGroup`: SOFTWARE (qua solver, mặc định) / SELF_CALC (tỷ lệ cắt cố định, vẫn là mảnh — PieceMaterialYield cũ) /
  FINISHED_COMPONENT (vật tư thành phẩm, vd chân nhôm — không phải mảnh, gắn vào mảnh khác khi đan như Nút nhựa).
- Module mới `material-yield-recipes`: công thức "1 vật tư vào → N vật tư ra", xuất vật tư cho Phôi, Phôi báo công đoạn + gửi KCS,
  KCS duyệt công đoạn cuối thì tự cộng tồn vật tư ra; tự tạo đề xuất mua nguyên liệu vào (nguồn MATERIAL_YIELD_RECIPE, có giữ chỗ tồn).
- 5 migration: 20261001010000…20261003010000 (bảng recipe/issue/step batch/bundle, enum mới, đổi unique piece_material_yield).

## 3. Việc cần làm / cảnh báo
1. **Chạy `npm run seed` trên production** (idempotent) để tạo Permission cho module mới `MATERIAL_YIELD_RECIPE` — tài liệu big-update
   ghi rõ thiếu bước này thì Admin cũng bị 403 ở màn mới. Chưa biết đã chạy chưa.
2. **Trần solver 20 s đã lên bản thật** qua "Update catsat", trong khi đo lặp (changelog-2026-10-01-live-test-dau-cuoi.md mục 7e) cho
   thấy 20 s chỉ ra phương án tốt 3/8 lần (lượt xấu 164–168 cây thay vì 146, chậm tới 790 s). Cần quyết lại.
3. Chưa chạy test/build cho big-update (local chưa pull).

## 4. Kiểm tra nhận định "duyệt được phương án cắt có loại sắt chưa đạt, loại đó bị bỏ đi không báo" — ĐÚNG MỘT PHẦN
- **Đúng ở API duyệt thủ công** `POST /cutting-proposals/:id/approve` (`CuttingProposalsService.approve`, giống hệt giữa local và origin/main):
  hàm chỉ kiểm DRAFT, PI đã có lệnh SX, kho vật tư, xung đột chiều dài cây — KHÔNG kiểm `hasInfeasibleLine`. Dòng `feasible=false` bị lọc
  khỏi `buyableLines` → không giữ chỗ tồn, không đề xuất mua, không xuất sắt; trạng thái APPROVED hiển thị "OK" (displayStatus không xét dòng vô nghiệm).
  Đã tái hiện bằng test tạm (3 loại sắt, 2 vô nghiệm) → approve() trả APPROVED; test tạm đã gỡ, không commit.
  Ai gọi được: role có CUTTING_PROPOSAL:APPROVE = QLSX (PRODUCTION_MANAGER) và Admin. **Không có nút trên UI** (FE `cutting-proposals-api.ts` ghi "chưa có UI").
- **Không đúng với luồng UI hiện tại**: KHSX tạo lệnh SX bị chặn bởi `assertReadyForInvoice` (invoiceReadinessReason chặn `hasInfeasibleLine`),
  Sếp duyệt lệnh bị chặn lại bởi `assertReadyForApproval`; luồng cũ tự-duyệt bị chặn bởi `autoApproveBlockReason`.
- "Vượt ngưỡng hao hụt" (cắt được nhưng > ngưỡng) KHÔNG bị bỏ: vẫn mua/xuất bình thường, chỉ cảnh báo (quyết định 2026-09-30).
- Đề xuất sửa (chờ người dùng đồng ý): approve() chặn khi còn dòng `feasible=false` (cùng thông báo với invoiceReadinessReason) — phương án A.
  Chưa kiểm được production có phương án APPROVED nào đang thiếu loại sắt hay không (cần quyền đọc DB thật).

### 4b. Live-test lại trên DB local (06/10, sau khi người dùng bật Docker) — XÁC NHẬN
Chuẩn bị: local đã pull big-update nhưng DB thiếu 5 migration + Prisma client cũ (BE không khởi động, 75 lỗi TS) → chạy
`prisma migrate deploy` + `prisma generate` trên DB LOCAL (không reset dữ liệu). `npm run seed` local lỗi P2002 ở bước upsert admin
(seed.ts:265, trùng dữ liệu cũ) — không liên quan, CHƯA xử lý (nếu cần quyền module MATERIAL_YIELD_RECIPE ở local phải xem lại).
1. **Lỗ hổng có thật (API):** PI-2026-006 (PI #8, gộp GHE-J55 + GHE-TINH-YEU, đang sản xuất) có phương án #19 DRAFT, SAT-HOP-20X20 "không
   cắt được" (trước khi duyệt: NEEDS_ACTION). QLSX gọi `POST /cutting-proposals/19/approve` → **201**, phương án APPROVED, hiển thị **"OK"**,
   2 phương án cũ #6 #7 bị SUPERSEDED. Đề xuất mua #20 sinh ra 6 loại sắt — **thiếu SAT-HOP-20X20**; kế hoạch xuất sắt
   (`/production-invoices/8/steel-issue-plan`, tài khoản khopsh) cũng chỉ 6 loại. Không có cảnh báo/thông báo nào.
2. **Luồng giao diện bị chặn đúng:** tính BAN-J55 với "không cho đặt cây riêng" → phương án #73 có SAT-HOP-20X20 không cắt được →
   `claim-solo` (nút "Tạo lệnh sản xuất") trả **409** kèm lý do; gọi approve #73 trước khi có lệnh cũng 409.
Dữ liệu test để lại ở local: phương án #19 APPROVED + đề xuất mua #20 của PI-2026-006, phương án nháp #73.

## 5. 2026-10-26 — Rà 2 commit "day-nem" / "fix-day-nem" (BE main + FE demo) xem có ảnh hưởng thay đổi đang giữ trong máy không — KHÔNG ẢNH HƯỞNG LOGIC, chỉ 3 chỗ vướng chữ nhỏ — ĐÃ PULL ở 5.1

> Chỉ RÀ + gộp THỬ trong scratchpad. Không pull, không merge, không commit; code thật trong máy giữ nguyên.

**Commit:**

| Repo | Commit | Ghi chú |
|---|---|---|
| BE main | `a08521b` "day-nem", `137d59b` "fix-day-nem" (ohey, 24/10) | 54 file, +3.973 dòng |
| FE demo | `e52727f` "day-nem", `5655810` "fix-day-nem" (ohey, 24/10) | 63 file, +1.761 dòng |

**Nội dung:** chọn loại **dây (mã SHT) / nệm theo từng dòng đơn**.
- `SalesOrderItem`, `ProductionInvoiceItem` và `ProductionOrder` có `wireMaterialId` / `cushionMaterialId`; thêm bảng `bom_option`.
- Lúc duyệt có kiểm `assertChoiceMatchesRevision`.
- Tồn kho thêm chiều `spec`: khoá duy nhất của `stock_quant` đổi thành (kho, vật tư, chiều dài, spec).
- 5 migration `20261022100000`…`20261023120000`.
- FE thêm thẻ `MaterialChoiceTags` ở Tối ưu cắt sắt và Lệnh SX.

**File trùng với thay đổi trong máy:**
- BE (worktree `solver-ts-research`, gốc đúng `4a967f5`) có 5 file: `schema.prisma`, `cutting-proposals.service.ts`,
  `cutting-batch-candidate.dto.ts`, `production-invoices.service.ts` + spec.
- FE (nhánh `demo`) có 8 file: `GomDotCatPage.tsx`, `LenhSXPage.tsx`, `api.ts`, `cutting-batch-api.ts`, `production-invoices-api.ts`,
  3 file Guide.
- Checkout `main` của BE chỉ có docs/test data, không trùng.

**Gộp thử 3 chiều** (base = HEAD, chuẩn hoá xuống dòng về LF trước khi gộp — bản trong máy là CRLF nên nếu không chuẩn hoá thì vướng cả file):
- BE: 4/5 file tự gộp sạch. `cutting-batch-candidate.dto.ts` vướng đúng dòng import (`SolverMachine` của mình với
  `MaterialChoiceRefDto` của họ) → giữ cả hai.
- FE: 6/8 sạch. Vướng 2 chỗ:
  - `GomDotCatPage.tsx`: dòng mã SKU trong bảng desktop — mình thêm style `nowrap`, họ chèn thẻ dây/nệm cạnh đó → giữ style + thêm thẻ.
  - `production-invoices-api.ts`: 2 dòng import → giữ cả hai.
  - Thẻ dây/nệm ở thẻ mobile tự rơi đúng chỗ, cạnh mã SKU.

**Kiểm bản đã gộp thử** (thư mục tạm `git archive` + đè thay đổi trong máy):
- BE: `prisma generate` OK; tsc phần `src` sạch (chỉ 2 lỗi seed có sẵn từ bd70135); `nest build` OK.
  - jest toàn bộ trừ bộ giải nặng + integration: **90 bộ / 2.057 test xanh**.
  - `optimize-material.spec` 14/14.
- FE: tsc sạch, eslint 0 lỗi, vitest **27 file / 250 test** xanh.

**Về logic:**
- Commit mới không đụng `SystemConfig`, luật gộp, `mergeItems`, sửa hạn hay mốc thời gian. Đối chiếu với mục 32 changelog
  `2026-10-21-review-du-lieu-test-solve`.
- Dòng gộp vẫn đếm theo dòng lệnh. Hai dòng cùng SKU khác dây = 2 trong trần "tối đa 2 SKU", vẫn gộp chung được — họ ghi rõ dây/nệm
  không ảnh hưởng cắt sắt.
- Thay đổi tồn kho theo `spec` không làm vỡ phần xuất sắt của mình (tsc + test xanh).

**Cần làm khi gộp thật** (chưa làm, chờ người dùng):
1. **Trùng mốc giờ migration.** `20261023100000_add_cushion_spec_per_sku` (họ) và `20261023100000_add_solver_machine_mctd` (mình).
   - Prisma xếp theo tên nên chạy được: của họ trước, của mình sau; khác bảng (bom/stock với system_config).
   - Nên đổi tên migration của mình (chưa deploy) cho khỏi nhập nhằng. Đổi thì phải sửa luôn bảng `_prisma_migrations` của DB test.
2. **DB test thiếu 5 migration mới.** DB test `dna_erp_solver_test` chưa có các migration này. Sau khi gộp phải áp trước khi chạy BE 3002,
   không thì query thiếu cột `wireMaterialId`…
3. **Gỡ 3 chỗ vướng** như trên.

**Gợi ý thêm (tuỳ chọn):** khung "Đợt đang chọn" (gợi ý gộp thêm đơn) và câu báo luật gộp chưa hiện loại dây/nệm. Nếu KHSX cần phân biệt
2 dòng cùng SKU khác dây ở đó thì thêm `MaterialChoiceTags`.

### 5.1 2026-10-26 — ĐÃ PULL cả 3 chỗ (fast-forward, giữ nguyên thay đổi trong máy, không stash/commit)

Người dùng: "tôi muốn pull nhánh mới nhất".

**Kết quả:**

| Nơi | Trước → sau | File trùng gộp | File khác còn nguyên byte |
|---|---|---|---|
| BE main checkout `D:\DNA-ERP-BE` (main) | `4a967f5` → `137d59b` (= origin/main) | 0 | 209 |
| BE worktree `solver-ts-research-1a4370` | `4a967f5` → `137d59b` | 5 | 120 |
| FE `D:\DNA-ERP` (demo) | `5735e58` → `5655810` (= origin/demo) | 8 | 47 |

**Cách làm** (`scratchpad/safe_pull.py`):
1. Sao lưu nguyên byte mọi file đang sửa, kèm manifest sha256.
2. Gộp 3 chiều các file trùng (chuẩn hoá LF, giữ CRLF nếu bản trong máy là CRLF).
3. Gỡ 3 chỗ vướng đúng như mục 5 — import giữ cả hai bên; dòng mã SKU giữ style `nowrap` + thêm `MaterialChoiceTags`.
4. `git checkout HEAD -- <file trùng>` → `git merge --ff-only` → ghi bản đã gộp.
5. Kiểm file không trùng còn đúng sha.

Mỗi nơi chạy thử (`--dry-run`) trước. Lần thử đầu dừng an toàn ở 2 chỗ vướng import vì regex chưa nhận dấu `;`; đã sửa rồi chạy lại.

**Sao lưu:** `D:\DNA-ERP-BE\backups\truoc-pull-2026-10-26.zip` — 389 file, đã đối chiếu sha từng file.
- Lúc đầu để dạng thư mục trong `backups/`, nhưng tsc của main checkout quét cả file `.ts` trong đó nên báo lỗi → đã nén zip và xoá thư mục.
- Trong zip có 3 thư mục `be-main/`, `be-worktree/`, `fe/`, mỗi thư mục có `_manifest.json`.

**Kiểm sau pull:**
- BE worktree:
  - `prisma generate` (client có `wireMaterialId`), tsc `src` sạch (chỉ 2 lỗi seed có sẵn), `pnpm build` (nest build) xong.
  - jest toàn bộ trừ bộ giải nặng + integration: **90 bộ / 2.057 test xanh**.
- BE main checkout: `prisma generate`, tsc `src` sạch.
- FE: tsc sạch, eslint 0 lỗi, vitest **27 file / 250 test** xanh.
  - Thẻ dây/nệm hiện ở cả thẻ mobile và bảng desktop của Tối ưu cắt sắt.

**Còn treo:**
- **DB chưa có 5 migration mới** (`20261022100000`…`20261023120000`): DB test `dna_erp_solver_test` và DB dev `dna_erp` đều chưa áp.
  - BE 3002 đang chạy vẫn là tiến trình cũ.
  - Khởi động lại BE trên DB test thì phải áp 5 migration này trước, không thì lỗi thiếu cột.
  - **DB test ĐÃ ÁP ở 5.2** (2026-10-26); DB dev `dna_erp` vẫn chưa.
- **Trùng mốc giờ migration** `20261023100000` (mục 5): vẫn để nguyên.

### 5.2 2026-10-26 — Áp 5 migration dây/nệm vào DB TEST, chạy lại BE 3002, kiểm Tối ưu cắt sắt + Lệnh SX trên trình duyệt

Người dùng: "Áp 5 migration mới vào DB test dna_erp_solver_test (không đụng DB dev dna_erp), rồi khởi động lại BE 3002 và kiểm lại Tối ưu
cắt sắt trên trình duyệt."

- **Xem trước** (`scratchpad/migrate-status-solver-test.ps1`, chặn nếu host không phải localhost hoặc tên DB không phải
  `dna_erp_solver_test`):
  - Đích `localhost:5432 / dna_erp_solver_test`.
  - Đúng 5 migration chờ: `20261022100000_add_bom_option_selection`, `20261022130000_add_material_detail_kind_cushion`,
    `20261023100000_add_cushion_spec_per_sku`, `20261023110000_bom_accessory_items_unique_per_spec`, `20261023120000_stock_spec_dimension`.
- **Sao lưu trước khi áp:** `D:\DNA-ERP-BE\backups\solver-test-truoc-migrate-day-nem-2026-10-26.dump`
  - `pg_dump -Fc` trong container `dna-erp-be-postgres-1`, 1,48 MB.
  - `pg_restore -l` đọc được 1.083 mục.
  - Muốn quay lại thì restore file này vào `dna_erp_solver_test`.
- **Áp:** `migrate-solver-test.ps1` (`prisma migrate deploy` + `generate`) → "All migrations have been successfully applied".
  - `migrate status` sau đó: "Database schema is up to date!" (157 migration).
  - **DB dev `dna_erp` KHÔNG đụng.**
- **BE 3002:** máy vừa khởi động lại (Docker lên lại, BE/FE đã tắt).
  - Bật lại BE 3002 (dist đã build sau pull) + FE 3100.
  - BE "Nest application successfully started", có route mới `cutting-batch-fix-options`, `items-deadlines`, log không lỗi.
- **Trình duyệt** (KHSX demo, DB test, MC Laser):
  - **Tối ưu cắt sắt:**
    - "Kết quả đã tính" 30 lượt.
    - "Chọn và tính": 49 đơn, tick sẵn 1 SKU (mốc 01/11).
    - `cutting-batch-candidates` 200, `deepVerify` 200, `cutting-batch-fix-options` 201.
    - Khung "Đợt đang chọn" ra đủ: SAT-PHI-6 gộp thêm GHE-J55 mốc 03/11 vẫn hao quá 1 % (10,38 %), cây riêng 4m60 → 0,22 %, đơn gấp 20,05 %. Số giống trước khi pull.
    - Lần đầu sau khi khởi động lại mất khoảng 1,5 phút vì bộ nhớ đệm trống (1 worker HiGHS).
    - Tick thêm đơn mốc 04/11 → báo đỏ "cách nhau 3 ngày (sớm nhất 01/11 – GHE-J55 (RP-…633975), muộn nhất 04/11 – GHE-J55 (RP-…320871))",
      nút Tính khoá.
    - API trả đủ `wireMaterial` / `cushionMaterial`. Cả 49 đơn ở DB test đều null nên chưa có thẻ dây/nệm nào hiện — đúng dữ liệu.
  - **Lệnh SX** PI-2026-016:
    - Khoảng hạn "05/12/2026 → 10/12/2026".
    - Mua hàng đã lưu 13/11 và 15/11.
    - Ước tính lùi theo hạn giao từng SKU (Khung 21/11 và 26/11).
  - Không lỗi console.
- **Còn treo:** DB dev `dna_erp` vẫn chưa có 5 migration (theo yêu cầu). Trùng mốc giờ migration `20261023100000` vẫn để nguyên (mục 5).

### 5.3 2026-10-26 — Chọn file nên commit, ĐÃ đưa vào staged ở BE + FE (CHƯA commit) — phần BE ĐÃ GOM VỀ MAIN ở 5.4

Người dùng: "nếu giờ commit thì nên commit những file nào BE và FE, hãy đưa xuống staged cho tôi, không tự tiện commit".
Chỉ chạy `git add` — không commit, stash, push hay reset.

**Đã staged:**

| Nơi | Nhánh | Số file | Gồm |
|---|---|---|---|
| BE worktree `.claude/worktrees/solver-ts-research-1a4370` | `claude/solver-ts-research-1a4370` (chỉ có ở máy, chưa lên remote) | 54 file, +9.278 / −245 | Code bộ giải HiGHS-TS, MC Tự động, luật gộp, sửa hạn sau gộp (xem chi tiết bên dưới) |
| BE main `D:\DNA-ERP-BE` | `main` | 25 file | Changelog `.md`: 4 file sửa + 21 file mới |
| FE `D:\DNA-ERP` | `demo` | 28 file, +2.027 / −351 | `src/**` và changelog 2026-10-23 (xem chi tiết bên dưới) |

Chi tiết BE worktree:
- Toàn bộ `src/**`.
- `prisma/schema.prisma` và 4 migration: `20261023100000_add_solver_machine_mctd`, `20261024100000`, `20261024110000`, `20261024120000`.
- `package.json` + `pnpm-lock.yaml` (thêm gói `highs`).
- `.env.example`, `docs/phase-8-testing-guide.md`.
- Changelog 2026-10-20.

Chi tiết FE `src/**`:
- Chọn máy cắt.
- Luật gộp và khung "Đợt đang chọn".
- Mốc ước tính theo hạn giao từng SKU.
- UX-9 (`PrintExportButton`, `theme-palette.css`).

**Không staged — người dùng tự quyết:**

BE worktree:
- `test/solver-real-data/`, `test/solver-ts-bench/` — script đo và kết quả chạy nghiên cứu. Không file nào trong `src` gọi tới.

BE main:
- **`docs/changelog-2026-10-20-review-excel-tool-mc-laser-vs-dexuat.md` bản ở main khác hẳn bản ở worktree.**
  - Bản main có mục 8–9 ("hai nhánh song song", "chọn hướng B + PDF") mà bản worktree không có.
  - Bản worktree có mục 8–11 với nội dung khác.
  - Nếu commit cả hai bản trên hai nhánh, lúc gộp sẽ xung đột add/add.
  - Nếu để bản ở main chưa track, lúc merge nhánh vào main git sẽ chặn vì file chưa track sẽ bị ghi đè.
  - Phải gộp tay hai bản trước khi merge.
- 3 changelog HR (`2026-10-17-hr-cham-cong-nghi-phep`, `2026-10-19-review-tong-the-hr-qlsx`, `2026-10-20-review-tool-nhap-cong-python`) — phần HR đã gỡ.
- 15 file PDF/XLSX báo cáo (khoảng 1,7 MB).
- `CLAUDE.md`.
- `.claude/launch.json` — có đường dẫn scratchpad của phiên.
- `start-dev.bat`.
- `test/solver-real-data-new/`.

FE:
- `.env.example` đang bị **xoá** trong máy, không rõ ai xoá. Nội dung chỉ là `BACKEND_ORIGIN` mẫu. Không đưa việc xoá này vào staged.
- File tự sinh hoặc không thuộc dự án:
  - `next-env.d.ts` (Next tự sinh, đang trỏ `.next-e2e`).
  - `tsconfig.tsbuildinfo`.
  - `pnpm-lock.yaml` + `pnpm-workspace.yaml` (FE dùng npm với `package-lock.json`).
- `docs/quy-doi-doan-phoi.md` — có 150 dòng bản cũ ("mock API / OR-Tools") chèn lên đầu bản của ohey.
- `e2e/golden-path.spec.ts` — đổi MEIJING → Meiying.
- Các file e2e mới và `playwright.nows.config.ts`.
- `AGENTS.md`, `CLAUDE.md`.
- 13 tài liệu thiết kế trong `docs/` và `docs/changelog-2026-09-16-…html` — không thuộc việc đang làm.

**Soát bí mật:** không có URL DB, mật khẩu hay khoá API trong các file đã staged. Chỉ có `erp_user:erp_password` — mật khẩu mặc định của docker local, vốn đã nằm trong `docker-compose.yml`.

**Kiểm đúng phần đã staged:** dùng `git checkout-index -a` xuất HEAD + staged ra thư mục tạm, không lẫn file chưa staged. `node_modules` nối bằng junction.
- FE: tsc 0 lỗi; eslint 0 lỗi (99 cảnh báo có từ trước); vitest 27 file / 250 test xanh.
- BE: `prisma generate` ok; tsc chỉ 2 lỗi seed có sẵn; `nest build` ok; jest chạy song song: 89 bộ xanh, 1 test hỏng. Bài hỏng là "loại sắt lớn I5 V15 ra trong 20 s", hết giờ vì chạy chung với các bộ khác. Chạy riêng 2 bộ giải nặng (`optimize-material` + `optimize-one-material`, `--runInBand`): 37/37 xanh.

**Lưu ý khi commit:**
- ~~Code BE nằm ở **nhánh worktree**, không phải `main`. Mở git GUI ở `D:\DNA-ERP-BE` thì chỉ thấy 25 changelog.~~ — **đã gom về `main` ở 5.4.**
- Sau khi đưa code vào `main`, nếu chạy `start-dev.bat` (BE 3001 chạy từ main) thì `prisma migrate deploy` sẽ áp vào DB dev `dna_erp`:
  - 4 migration mới;
  - 5 migration dây/nệm.
- Cũng cần `pnpm install` để có gói `highs`.
- Trùng mốc giờ migration `20261023100000` vẫn để nguyên (mục 5).
- Lúc `git add`, git đổi xuống dòng CRLF → LF theo `core.autocrlf` — bình thường, không đổi nội dung.

### 5.4 2026-10-26 — Gom phần BE đã staged ở worktree về main checkout, gộp tay 2 bản changelog 2026-10-20 (CHƯA commit)

Người dùng: "Gom phần BE đã staged ở worktree sang main checkout D:\DNA-ERP-BE, gộp tay hai bản changelog 2026-10-20 để không mất
mục nào, đưa vào staged ở main, vẫn không commit."

**Cách làm** (`scratchpad/gom_be_ve_main.py`):
1. Kiểm trước, chạy thử `--dry-run` rồi mới chạy thật:
   - main và worktree cùng HEAD `137d59b`.
   - Worktree không có file nào sửa thêm sau khi staged.
   - Ở main, mỗi file đích hoặc chưa tồn tại, hoặc đang đúng HEAD (không có sửa đổi trong máy) → không ghi đè việc gì của main.
2. Sao lưu ở `backups/truoc-gom-be-ve-main-2026-10-26/` (đã gitignore):
   - Bản changelog 2026-10-20 cũ của main.
   - Danh sách staged của main trước khi gom.
   - `_manifest.json` sha256 từng file đã chép.
3. Chép đúng byte 53 file từ worktree sang main (code, schema, 4 migration, `package.json`, `pnpm-lock.yaml`, `.env.example`,
   `docs/phase-8-testing-guide.md`), rồi `git add` ở main.

**Gộp changelog 2026-10-20** (`scratchpad/gop_changelog_1020.py`):
- Nền là bản worktree (mục 1–11).
- Mục 1–6 hai bản trùng nhau. Bản main có thêm một mảnh mục lục chèn nhầm vào mục 6 — đã bỏ.
- Hai mục chỉ có ở bản main đưa vào thành **7A** (hai nhánh song song, kiểm ở checkout chính) và **7B** (chốt hướng B, PDF
  lãnh đạo), đặt ngay trước mục 8 (2026-10-23). Nội dung giữ nguyên, mỗi mục có dòng ghi chú nguồn.
- Có cập nhật mục lục và dòng trạng thái.
- Không đánh lại số 8–11, vì `.env.example`, `docs/phase-8-testing-guide.md`, `env.validation.ts`, `solver-client.service.ts`,
  changelog-2026-10-21 đang trỏ "mục 9" theo số của bản worktree.
- Kiểm từng dòng: mọi dòng có chữ của cả hai bản đều còn trong bản gộp. Chỉ khác ở 2 dòng trạng thái (đã nhập làm một)
  và 1 câu thêm "8 (nay là 7A)".
- Kết quả: 952 + 152 dòng → 992 dòng.

**Kết quả:**
- BE main staged **79 file** (+15.932 / −247), gồm:
  - 25 changelog;
  - 53 file code;
  - changelog 2026-10-20 bản gộp.
- Đối chiếu `git ls-files -s` (blob) của `src`, `prisma`, `package.json`, `pnpm-lock.yaml`, `.env.example`, phase-8 guide,
  tsconfig, nest-cli giữa main và worktree: **giống hệt 720 file**.
  - Vì vậy kết quả kiểm ở 5.3 vẫn đúng cho main: tsc chỉ 2 lỗi seed có sẵn; nest build ok; jest 89 bộ xanh; 2 bộ giải nặng
    chạy riêng 37/37 xanh.
- FE không đổi: vẫn 28 file staged ở `demo`.

**Còn treo / lưu ý:**
- **Worktree vẫn giữ nguyên** các file đã staged và bản changelog 2026-10-20 CŨ (chưa có 7A–7B) — không unstage, không xoá.
  - Từ giờ sửa changelog/code BE nên làm ở main, không thì hai bản lại lệch nhau.
  - BE 3002 đang chạy vẫn là `dist` của worktree.
- Muốn chạy BE từ main (`start-dev.bat`, cổng 3001):
  - Phải `pnpm install` (gói `highs`) và `prisma generate` trước.
  - `prisma migrate deploy` trong script đó sẽ áp 4 migration mới + 5 migration dây/nệm vào **DB dev `dna_erp`**.
- Danh sách không staged ở 5.3 giữ nguyên, người dùng tự quyết.
- Trùng mốc giờ migration `20261023100000` vẫn để nguyên (mục 5).

### 5.5 2026-10-26 — Lên production cần làm gì thêm (chỉ rà, CHƯA deploy, KHÔNG kết nối DB production)

Người dùng hỏi "nếu commit xong lên production thì có cần làm gì nữa không" và dán `DATABASE_URL` production (có mật khẩu) vào
chat. **Không dùng URL đó, không kết nối DB production, không ghi vào file nào** (luật: chỉ deploy/đụng production khi người dùng nói
"deploy").

**Kiểm thêm như CI** (`scratchpad/verify_ci_main.sh`):
- Chạy trên đúng bản staged của main: `checkout-index`, `node_modules` nối junction tới worktree.
- `lint:check`: 0 lỗi (94 cảnh báo có từ trước).
- `test:e2e`: 2 bộ / 4 test xanh trên DB test riêng `localhost:5433/dna_erp_test` (container tmpfs).
  - Bước globalSetup `prisma migrate deploy` áp đủ migration từ DB trống, gồm 4 migration mới.
- Cộng với 5.3 (tsc, nest build, jest) là đủ các bước CI `ci.yml` chạy.

**Không phải làm tay:**
- **Migration.** `docker/entrypoint.js` tự chạy `prisma migrate deploy` (qua `DIRECT_DATABASE_URL`) mỗi lần Render khởi động bản mới.
  - 4 migration của mình chỉ thêm enum/cột và cập nhật 1 dòng `system_config`, không xoá dữ liệu.
  - Đã áp được từ DB trống (e2e) và lên DB test có dữ liệu (5.2).
  - Trùng mốc giờ `20261023100000` không cản: `migrate deploy` áp mọi migration còn thiếu, kể cả tên xếp trước migration đã áp
    (DB test đã gặp đúng trường hợp này ở 5.2).
- **Seed.** Không cần: không thêm quyền mới. 2 endpoint mới dùng quyền có sẵn:
  - `POST /cutting-batch-fix-options` dùng VIEW;
  - `PATCH /production-invoices/:id/items-deadlines` dùng UPDATE.
  - Bản day-nem cũng không đổi seed/quyền.
- **FE (Vercel).** Không có biến môi trường mới.
- **Biến cũ trên Render** (`SOLVER_BASE_URL`, `SOLVER_API_KEY`, `SOLVER_MODE`): BE không đọc nữa. ConfigModule để `allowUnknown`
  mặc định `true` nên còn sót cũng không chặn khởi động. Xoá cho gọn.

**Phải làm:**
1. **Nâng gói Render cho BE (quan trọng nhất).**
   - `render.yaml` đang `plan: free` (512 MB RAM, CPU rất yếu).
   - Trước giờ phần giải chạy ở DNA-DEXUAT; bản này giải NGAY TRONG BE.
   - Đo ở 7.7.5 changelog 2026-10-20: RSS đỉnh 0,4–0,7 GB mỗi lượt giải, cộng phần BE thường trực → khoảng 1 GB. Gói 512 MB sẽ bị
     Render giết tiến trình giữa lượt giải, các màn khác rớt theo.
   - Cần gói ≥ 2 GB.
   - CPU yếu thì lượt giải chậm hơn local nhiều lần (I5 khoảng 50 s ở local).
2. **Đặt `SOLVER_TS_MAX_RSS_MB` theo gói** (vd 1500 cho gói 2 GB): tràn thì chỉ worker giải bị dừng, API vẫn sống.
   `SOLVER_TS_WORKERS=1` để mặc định.
3. **Thứ tự deploy:**
   - Push BE trước, chờ Render "Live" (log có dòng "All migrations have been successfully applied"), rồi mới push FE `demo`.
   - FE mới gọi 2 API mới. Nếu FE lên trước thì khung "Đợt đang chọn" và "Sửa thời hạn" của lệnh gộp sẽ báo lỗi tới khi BE xong.
   - Bản BE trước từng build khoảng 20 phút.
4. ~~**Sao lưu DB production trước khi deploy**~~ — **ĐÃ LÀM ở 5.6** (`backups/prod_20261026_0951_truoc-deploy-solver.dump`).
5. **Sau khi lên — Admin kiểm "Cấu hình hệ thống":**
   - Máy mặc định MC Laser.
   - Khung gộp 3 ngày, tối đa 2 SKU.
   - Thông số MC Tự động: lưỡi 2,5 mm, tề đầu 0, hệ số bó 14/16/18/20, cắt tay ≤ 5, ≤ 5 cỡ/kiểu cắt — chỉnh theo máy thật.
   - Thử 1 đợt Tối ưu cắt sắt. Lần đầu chậm vì bộ nhớ đệm trống; gói free còn ngủ sau 15 phút không dùng nên mỗi lần thức lại chậm.
6. **Đổi mật khẩu DB production.**
   - URL kèm mật khẩu đã nằm trong lịch sử chat (lần 2, sau 20/10 ở mục 57.7 changelog 2026-10-08).
   - Đổi ở Prisma Console, rồi cập nhật `DATABASE_URL` + `DIRECT_DATABASE_URL` trên Render.

**Lưu ý:**
- CI `pnpm test` chạy cả bài bộ giải nặng I5 V15 (trần 45 s). Runner chậm hoặc chạy song song có thể làm bài này hết giờ — đỏ vì
  thời gian, không phải lỗi logic (5.3: chạy riêng 37/37 xanh).
- DNA-DEXUAT: ERP không gọi nữa. Giữ hay tắt dịch vụ đó là việc của người dùng.

### 5.6 2026-10-26 — ĐÃ sao lưu DB production trước deploy (chỉ `pg_dump`, không migrate, không push)

Người dùng: "Sao lưu DB production bằng URL tôi vừa đưa (chỉ pg_dump vào backups/, không migrate, không push), xong báo tôi."
URL chỉ truyền qua biến môi trường của đúng 1 lệnh `docker run`, **không ghi vào file/changelog/bộ nhớ**.
Lệnh chỉ đọc: `pg_dump` không ghi gì lên production.

**File:** `D:\DNA-ERP-BE\backups\prod_20261026_0951_truoc-deploy-solver.dump`
- 1.682.381 byte, sha256 bắt đầu `c8a08519b62f3fbe`.
- `pg_dump` 17.11 qua `postgres:17-alpine`, định dạng custom.
- Thư mục `backups/` đã gitignore.

**Đã kiểm file dùng được** (`scratchpad/verify_prod_dump.sh`):
- `pg_restore -l` đọc được 1.121 mục, trong đó 94 mục TABLE DATA.
- Khôi phục vào container `postgres:17-alpine` TẠM (không mở cổng, đã xoá ngay sau đó):
  - Chỉ 2 lỗi bỏ qua được của extension `prisma_postgres` — như các lần 15/10 và 20/10.
  - 96 bảng.
  - 48 người dùng.
  - 0 đơn hàng, 0 lệnh SX (PI), 0 đề xuất cắt — production chưa có dữ liệu sản xuất thật.
  - 1 dòng `system_config`.

**Trạng thái migration trên production** (đọc `_prisma_migrations` TRONG bản dump, `scratchpad/parse_prod_migrations.py`):
- Đã áp 153 migration, mới nhất là `20261023120000_stock_spec_dimension`.
  - 5 migration dây/nệm đã lên production ngày 22–23/10.
- **Không có migration nào đang lỗi**, nên `migrate deploy` sẽ không bị chặn.
  - Có 4 dòng rolled back cũ, Prisma bỏ qua.
  - Một trong số đó, `20260907100000_piece_material_item_photo_url`, không có trong repo (repo dùng `20260907092723_…`, đã áp).
  - Các lần deploy sau đó vẫn chạy bình thường với dòng này.
- **Khi deploy sẽ chạy đúng 4 migration:** `20261023100000_add_solver_machine_mctd`, `20261024100000_add_solver_merge_window_days`,
  `20261024110000_merge_rules_window_3_max_skus`, `20261024120000_merge_max_skus_default_2`.
- Production không có migration nào mà repo thiếu.

**Còn treo:**
- Việc 1–3, 5–6 của 5.5 vẫn chờ người dùng: nâng gói Render, `SOLVER_TS_MAX_RSS_MB`, thứ tự BE → FE, kiểm Cấu hình hệ thống sau
  khi lên, đổi mật khẩu DB.
- URL kèm mật khẩu đã nằm trong lịch sử chat lần nữa.

### 5.7 2026-10-26 — Commit ở main bị hook pre-commit chặn (119 lỗi eslint "error type") — đã sửa môi trường, CHƯA commit

Người dùng chạy `git commit` ở main checkout. Husky `pre-commit` → `npx lint-staged` (`*.ts`: `eslint --fix` rồi `prettier --write`)
báo **119 lỗi**, toàn bộ cùng 1 dạng:
- `'SolverMachine' is an 'error' type`;
- `Unsafe … of an error typed value`;
- `Unsafe member access .createModel/.run/...` ở `highs-solver.ts`.
lint-staged tự trả lại trạng thái cũ: staged vẫn đủ 79 file, không còn stash sót lại.

**Nguyên nhân — môi trường của main, không phải code:**
- Main checkout chưa có gói `highs` trong `node_modules`. Gói này chỉ mới thêm vào `package.json` khi gom từ worktree.
- `src/generated/prisma` của main vẫn sinh từ schema CŨ, chưa có enum `SolverMachine` và các cột mới.
- eslint có kiểm kiểu nên coi các kiểu đó là "error type".
- Lần kiểm ở 5.3/5.5 qua được vì `node_modules` nối junction tới worktree và có chạy `prisma generate` trong thư mục tạm.
  Thiếu sót: tôi chưa kiểm hook trong chính môi trường main.

**Đã làm ở main:**
- `pnpm install --frozen-lockfile`: cài `highs` đúng theo lockfile đã staged, lockfile không đổi.
- `postinstall` tự chạy `prisma generate` → client 7.9.0 có `SolverMachine`.
- `prepare` (husky) chạy lại.

**Kiểm lại đúng như hook, không commit, không `--fix`:**
- `eslint` 43 file `.ts` đã staged: **0 lỗi**, 4 cảnh báo.
- `prettier --check`: mọi file đã đúng định dạng → hook sẽ không sửa file nào lúc commit.
- `tsc --noEmit` ở main: chỉ 2 lỗi seed có sẵn.
- FE `D:\DNA-ERP` không có husky/lint-staged, nên commit FE không chạy hook.

**Lưu ý:**
- Main giờ đã có `highs` + client mới.
- Nếu chạy `start-dev.bat` thì `prisma migrate deploy` sẽ áp 4 migration mới lên DB dev `dna_erp` (xem 5.4).
