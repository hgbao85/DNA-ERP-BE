# Changelog – Phần A, Đợt 4: màn "Vật tư cần về" (YC6) – 05/11/2026

Nhánh `dot-4-vat-tu-can-ve` ở 2 worktree: BE `D:\DNA-ERP-BE-dot4` (cắt từ `main` `e95b28c` = `origin/main`), FE `D:\DNA-ERP-dot4`
(cắt từ `demo` `ebd83f5` = `origin/demo`). **Commit trên nhánh + gộp `--no-ff` vào `main` / `demo` 05/11, sau Đợt 5d phần 1 của người B (chưa push).** Plan: `docs/ke-hoach-phan-a-12-yeu-cau-2026-11-04.md` mục 4, 4b, **4c**
(4c thắng 4b chỗ nào khác); bản yêu cầu v8 YC6 6.1–6.4 + YC11 11.1. Câu trả lời của Sếp: file
`TRA_LOI_DOT_4_VAT_TU_CAN_VE_IT_05-11-2026.docx` (trả lời `docs/cau-hoi-sep-dot-4-vat-tu-can-ve-2026-11-05-v2.docx`).

## Mục lục
- 1. Sếp chốt 4 câu → thiết kế
- 2. Đã làm (BE, FE)
- 3. Quyết định thiết kế / lệch plan có lý do
- 4. Kiểm tra
- 5. Chưa làm / còn treo
- 6. Đụng phần có sẵn của file dùng chung
- 7. Danh sách file để commit
- 8. Môi trường thử
- 9. Đánh giá UX/UI sau khi xem trình duyệt (Opus, 05/11)
- 10. Sửa U1–U6 theo đánh giá UX (05/11)

---

## 1. Sếp chốt 4 câu → thiết kế

| Câu | Sếp chọn | Hệ thống làm |
|---|---|---|
| 1 "Hôm nay" là những ngày nào | A + C | Lọc Hôm nay = mọi dòng có **về từ ≤ hôm nay ≤ hạn chót** (về từ = hạn chót − N, N = cấu hình, mặc định 4). Ngày hạn chót: nhãn đỏ đặc **"HẠN CHÓT HÔM NAY"**. Tới hạn chót chưa về đủ → đỏ + cảnh báo mới cho **KHSX + Sếp** (Sếp = vai trò BOSS - Giám đốc, người dùng xác nhận), ngoài tin sáng của người mua + thủ kho. |
| 2 Lệnh gộp 2 SKU chung 1 dòng mua | A | 1 dòng; cột Lệnh liệt kê từng SKU kèm hạn riêng; hạn chót dòng = hạn SKU sớm nhất. |
| 3 Mua dư | B + ý kiến | Số theo dõi = **SỐ CHỐT MUA** (`effectiveOrderQty(buyQty, orderQty)`): cần 100, chốt 120, về 100 → còn thiếu 20, đỏ khi quá hạn, tính badge. Bỏ ngoại lệ "chờ mua dư" của plan 4b. |
| 4 KHSX xem ở đâu | A | Mục "Vật tư cần về" ở menu Kế hoạch SX, cùng danh sách, chỉ xem, không badge. |

## 2. Đã làm

### 2.1 BE
- **Cấu hình** `SystemConfig.materialEarliestArrivalDays Int @default(4)` - migration chỉ-thêm
  `20261105120000_add_material_earliest_arrival_days`. Admin sửa 0–30 (PUT /system-config); trả ở GET /system-config và
  GET /system-config/planning-params.
- **Hạn vật tư dự phòng (V4-3, Đợt 3 hẹn)** trong `purchaseDeadlineOf` (`frame-deadline.util.ts`): VT khung & đan = hạn mua đã lưu →
  (Bắt đầu Phôi − 1) → hạn Khung → hạn PI; VT còn lại = hạn mua đã lưu → (Bắt đầu đóng gói − 7) → hạn Đóng gói → hạn PI.
  `frameDeadlineOf` (xếp cắt / luật gộp) không đổi.
- **Hàm chung gán dòng mua ↔ dòng SKU** `src/common/utils/purchase-line-sku.util.ts` (dây/nệm riêng của SKU: dòng của dây SKU khác
  chọn không tính sang SKU này). Bảng mốc chuyển sang gọi hàm này - hành vi không đổi, spec Bảng mốc xanh nguyên.
- **Module mới `materials-due`** (`GET /materials-due?view=overdue|today|date|all&date=&scope=mine|all`, quyền
  PURCHASE_PROPOSAL:VIEW sẵn có - không cần seed quyền):
  - Dòng = 1 dòng đề xuất mua trạng thái NEW / QUOTING / SUBMITTED / PURCHASING của PI có ≥ 1 dòng SKU đang chạy (cùng điều kiện Bảng
    mốc: đã duyệt, lệnh chưa Kết thúc, PI chưa huỷ, đơn bán còn), còn thiếu = số chốt mua − đã nhận > 0. Không còn SKU đang chạy nào
    dùng dòng → ẩn.
  - Trạng thái OVERDUE / DEADLINE_TODAY / IN_WINDOW / UPCOMING / NO_DEADLINE; lọc Quá hạn = OVERDUE, Hôm nay = DEADLINE_TODAY +
    IN_WINDOW, Theo ngày D = về từ ≤ D ≤ hạn chót, Tất cả. Xếp: trạng thái → hạn chót → về từ → tên vật tư.
  - NCC: đơn đặt hàng chưa huỷ (tên NCC + số đơn seq/năm), không có thì báo giá đã chọn; người mua = `Material.buyer`; kho nhận =
    kho ghi đè ?? kho vật tư.
  - Phạm vi: người mua mặc định "Vật tư của tôi" (chọn được Tất cả); KHSX / QLSX / Sếp / Admin tất cả; thủ kho có phạm vi kho → chỉ
    kho mình. Người vừa mua vừa thủ kho tính theo người mua.
  - Truy vấn cố định (không N+1): 1 dòng mua + 3 dòng SKU + 1 mã lệnh + 1 cấu hình (+ 1 kho khi có kho ghi đè); nhớ tạm 60 s cho badge,
    API màn luôn tính mới.
- **Badge** `materialsDueNow` trong `GET /me/work-queue` cho PURCHASER / WAREHOUSE_STAFF = quá hạn + hạn chót hôm nay + trong hạn về.
- **Tin sáng `MORNING_MATERIALS_DIGEST`** đổi nguồn sang màn mới (bỏ phần dựng từ Bảng mốc): "Vật tư cần về: X quá hạn, Y hạn chót hôm
  nay, Z trong hạn về", câu theo **mã lệnh (LSX)** "MY-9402 (HẠN CHÓT HÔM NAY): Sơn bột còn thiếu 20 Kg", link mở màn mới lọc Hôm nay.
  Người nhận + dedupe + đóng tin hôm trước giữ như cũ. Lỗi nguồn vật tư thì lần kiểm 10 phút sau thử lại, không chặn tin tiến độ.
- **Cảnh báo mới `MATERIALS_DEADLINE_ALERT`** (ALERT, CRITICAL → Sếp tự được thêm; người nhận KHSX): từ 07:00, 1 tin/ngày khi toàn hệ thống
  có dòng quá hạn / hạn chót hôm nay; tiêu đề "Vật tư tới hạn chót chưa về đủ: 1 hạn chót hôm nay, 1 quá hạn", tối đa 5 câu theo lệnh kèm
  người mua; tự đóng trong ngày khi hàng về hết; tin hôm trước đóng khi gửi tin mới; không gửi lại trong ngày. Chạy ngoài bước Bảng mốc.

### 2.2 FE
- Màn mới `src/modules/pages/MaterialsDue/VatTuCanVePage.tsx` (+ hàm thuần `vatTuCanVe.ts` + test): nút lọc Quá hạn / Hôm nay (mặc định)
  / Theo ngày (chọn ngày) / Tất cả có số đếm, lọc nằm trên URL (`view`, `date`) để thông báo mở đúng lọc; người mua có "Vật tư của tôi /
  Tất cả"; thủ kho thấy "Kho: …". Bảng 10 cột (Trạng thái · Được về từ – Hạn chót · Vật tư + nhóm · Cần / Chốt mua · Đã nhận · Còn thiếu
  · Lệnh (từng SKU + hạn) · NCC + số đơn / "Chưa đặt NCC" · Người mua · Kho nhận); màn hẹp thành thẻ. Màu: hạn chót hôm nay đỏ đặc, quá
  hạn đỏ nhạt, trong hạn về vàng "Còn N ngày", chưa tới xám "Về từ dd/mm", chưa có hạn mờ. Chỉ xem với mọi vai trò.
- Mục "Vật tư cần về" ở menu Mua hàng (badge), Kho (badge, mọi phạm vi kho), Kế hoạch SX (không badge - Sếp cũng dùng app này).
- Ô cấu hình "Vật tư được về sớm nhất trước hạn chót (ngày)" ở Cấu hình hệ thống (khối Năng lực); dòng "về từ" ở Lệnh SX / form Sửa thời
  hạn đọc số này thay số 4 viết cứng.
- Bài Hướng dẫn "Màn Vật tư cần về" ở Mua hàng, Kho, Kế hoạch SX.

## 3. Quyết định thiết kế / lệch plan có lý do
- **Bảng mốc giữ cách chấm "đủ" theo số CẦN mua** (trả lời "sản xuất có bị chặn không"); màn mới theo **số chốt mua** (Sếp câu 3). Mua
  dư chưa về đủ: Bảng mốc có thể "đủ" trong khi màn mới còn thiếu phần dư - ghi trong Hướng dẫn / file test.
- Cảnh báo KHSX + Sếp gửi **07:00 sáng ngày hạn chót** (cùng giờ tin sáng) - "tới hạn chót mà chưa về đủ" hiểu là đầu ngày hạn chót, để
  còn kịp đôn. Không gửi lại trong ngày dù có dòng mới quá hạn sau đó (đã có test).
- Tin sáng nay nhắc cả dòng **trong hạn về** (chưa tới hạn chót) - đúng Sếp câu 1 A "nhắc liên tục tới khi về đủ"; trước chỉ báo
  hạn hôm nay / đã trễ.
- Mã lệnh trong câu tin = LSX của SKU có hạn sớm nhất của dòng (nối " + " khi nhiều SKU cùng hạn) - không dùng mã PI (theo quy ước mới ẩn
  mã PI của người B).
- Dòng chưa có hạn: chỉ hiện ở Tất cả, không tính badge / tin.
- Bỏ `MaterialsDigestNotificationParams.dueToday/late` → `overdue/deadlineToday/inWindow` (tin cũ đã lưu sẵn tiêu đề, không ảnh hưởng).

## 4. Kiểm tra
- **BE** (Opus chạy lại trong worktree): `npx nest build` OK; `tsc --noEmit` chỉ còn 2 lỗi seed cũ (`seed-ghe-j55-full-bom.ts:152`,
  `seed-real-products.ts:150`); eslint các file đổi 0 lỗi (15 cảnh báo `any` có sẵn); `jest --runInBand` toàn bộ **124 suite / 2582 test
  xanh** (1 skip có sẵn). Thợ: 60 test mới cho materials-due (gồm 500 dòng mua / 120 SKU / 40 PI kiểm số truy vấn cố định), 9 util hạn,
  7 util gán dòng, thêm test daily-jobs / work-queue / system-config.
- **FE** (Opus chạy lại): `tsc --noEmit` sạch; `vitest run` **34 file / 341 test xanh**; eslint file đổi 0 lỗi (6 cảnh báo có sẵn ở 3
  file app).
- **API thật** BE 3037 trên `dna_erp_dot4` + dữ liệu `pa4-seed.sql` (hôm nay 05/11, N = 4), đăng nhập tài khoản demo:
  - `khsx` Tất cả: 1 quá hạn (Sắt hộp MY-9401, hạn 03/11, đã đặt NCC đơn 1/2026), 1 hạn chót hôm nay (Sơn bột MY-9402: cần 100 · chốt
    120 · về 100 · thiếu 20, NCC theo báo giá), 4 trong hạn về (Sắt vuông lệnh gộp 1 dòng: MY-9403 hạn 07/11 + MY-9404 hạn 09/11; Dây nâu
    chỉ MY-9403; Dây xám bông chỉ MY-9404; Nệm xám MY-9402), 1 chưa tới (Thùng carton, về từ 07/11), 1 chưa có hạn (Đinh MY-9406). Dòng
    đã về đủ và dòng của lệnh đã Kết thúc không hiện.
  - Phạm vi + badge: muapsh 3 dòng mình (Tất cả = 8), badge 3 · muavttp 2 · muatp 1 · khopsh kho phoi-son-han 3 · khotp kho thanh-pham 1 ·
    boss tất cả, không badge. Theo ngày 10/11 → 1 dòng, 03/11 → 4 dòng; thiếu `date` / view sai → 400; planning-params N = 4.
  - **Việc hằng ngày thật** (BE chạy `DAILY_JOBS` bật): cảnh báo CRITICAL "Vật tư tới hạn chót chưa về đủ: 1 hạn chót hôm nay, 1 quá hạn"
    tới **khsx + boss**; 6 tin sáng: muapsh / muavttp / muatp mỗi người đúng vật tư mình, khopsh / khotp / khovttp đúng kho mình, người mua
    không nhận trùng tin của kho; link `vat-tu-can-ve` lọc Hôm nay (cảnh báo: Tất cả).
  - **Nhận hàng thật** (đúng API màn Nhập kho, `khopsh`): Sơn bột MY-9402 nhận 10 Kg → còn thiếu 10, vẫn "HẠN CHÓT HÔM NAY"; nhận thêm
    10 Kg → dòng biến mất, badge muapsh 3 → 2. Sau đó chạy lại `pa4-seed.sql` (script xoá cả phiếu nhận + giữ chỗ của PA4 để chạy lại
    được; tồn kho đã cộng thì giữ).
- **Trình duyệt** (FE 3137 + BE 3037, sau khi Claude desktop bị tắt ngang và bật lại 2 máy chủ):
  - `muapsh` Mua hàng: màn hẹp ra thẻ (Sơn bột thẻ đỏ "HẠN CHÓT HÔM NAY", "Cần 100 · chốt mua 120 Kg", còn thiếu 20 Kg; Sắt vuông vàng "Còn
    2 ngày" với 2 lệnh 2 hạn); màn rộng ra bảng 10 cột, Tất cả + phạm vi Tất cả = 8 dòng đúng thứ tự, 2 dòng đỏ đầu bảng; nút lọc 1 / 2 / 3
    (của tôi) và 1 / 5 / 8 (tất cả); Theo ngày 10/11 rỗng với câu "Không có vật tư nào trong khoảng được về của ngày 10/11/2026".
  - `khopsh` Kho: chỉ kho mình, không có nút phạm vi. **Opus sửa:** nhãn phạm vi kho hiện mã "Kho: phoi-son-han" → hiện tên kho "Kho Phôi
    Sơn Hàn" (lấy từ dòng cùng kho; không có dòng thì vẫn hiện mã).
  - `khsx` Kế hoạch SX: 8 dòng, mục cuối menu, không số, không nút sửa; chuông: cảnh báo đỏ "Vật tư tới hạn chót chưa về đủ: 1 hạn chót hôm
    nay, 1 quá hạn" đứng đầu. Chuyển sang "Tổng hợp lệnh SX" khi URL còn `view=all` vẫn mở bình thường (tab Theo lệnh).
  - **Phát hiện lỗi có sẵn (không do Đợt 4):** số nhắc việc trên menu **không bao giờ hiện, ở mọi phân hệ** - trình duyệt không gọi
    `/me/work-queue` lần nào. `src/hooks/useWorkQueue.ts` (commit `a0c7705` "DEC-85" ngày 07/10): `poll` bọc `useCallback(..., [])` nhưng đọc
    `token` → giữ `token = null` của lần vẽ đầu (token khôi phục bất đồng bộ / đăng nhập sau) nên luôn `return` sớm. Sửa 1 dòng (thêm `token`
    vào deps). File dùng chung + ảnh hưởng production → người dùng duyệt sửa trong nhánh Đợt 4 (mục 10).

## 5. Chưa làm / còn treo
- Chia số mua theo từng SKU của lệnh gộp (5d của người B): màn đang ghi số chung + hạn từng SKU.
- "Đóng phần thiếu" (7.13 của B): khi B có trạng thái đóng, dòng tự ra khỏi danh sách.
- Truy vấn dòng mua đọc mọi dòng còn mở rồi mới lọc theo SKU đang chạy - dòng NEW bỏ quên của lệnh cũ đã Kết thúc vẫn bị đọc (đã đo ổn với
  500 dòng; nếu production nhiều dòng tồn thì lọc thêm theo PI ở truy vấn).
- Sau khi gộp: báo người B `purchaseDeadlineOf` có thêm dự phòng (chỉ đổi lệnh chưa lưu hạn mua riêng) và tin sáng vật tư đổi nội dung.
- Thông báo cũ khác của lệnh SX vẫn ghi mã PI (follow-up đã ghi ở changelog Phần A mục 13).

## 6. Đụng phần có sẵn của file dùng chung
- `work-queue.service.ts` / `.controller.ts` / `.module.ts` (dùng chung với B): thêm tham số constructor `MaterialsDueService`, trường
  `id?` ở tham số `getWorkQueue`, 1 khối `// Phần A – Đợt 4`; controller truyền `@CurrentUser('id')`.
- `notification-types.ts`: **thay** `MaterialsDigestNotificationParams` + định nghĩa `MORNING_MATERIALS_DIGEST` (link sang màn mới), thêm
  `MATERIALS_DEADLINE_ALERT`; sửa 1 câu chú thích (Sếp nhận DELIVERY_AT_RISK và MATERIALS_DEADLINE_ALERT).
- `frame-deadline.util.ts` `purchaseDeadlineOf` (dùng ở "Theo dõi mua hàng" của B + Bảng mốc): thêm dự phòng mục 2.1.
- `milestone-board.service.ts`: thay luật own/siblings nội bộ bằng hàm chung (hành vi không đổi).
- `daily-jobs.service.ts`: `materialsDigests` đổi đầu vào từ Bảng mốc sang dòng màn mới; thêm `syncMaterialsDeadlineAlert`.
- `schema.prisma`: 4 dòng cuối khối SystemConfig.
- FE `src/hooks/useWorkQueue.ts` (dùng chung, của người B từ 07/10): deps `poll` `[]` → `[token]` (mục 10, U1) - sửa cho MỌI phân hệ.
- FE sidebar dùng chung: `PurchasingApp.tsx`, `InboundWarehouseApp.tsx` (thêm 1 mục + thêm id vào 3 danh sách tab theo họ kho),
  `ProductionPlanApp.tsx`; `LenhSXPage.tsx` 4 chỗ "hạn − 4" → N cấu hình; `phuAnTimeline.ts` `materialArrivalFrom` thêm tham số tuỳ chọn
  (mặc định 4, test cũ không đổi).

## 7. Danh sách file để commit
**BE** (nhánh `dot-4-vat-tu-can-ve`): `prisma/schema.prisma`, `prisma/migrations/20261105120000_add_material_earliest_arrival_days/
migration.sql`, `src/common/utils/frame-deadline.util.ts`, `frame-deadline.util.spec.ts`, `purchase-line-sku.util.ts` + `.spec.ts`,
`src/modules/materials-due/**` (module, service, controller, types, dto, 2 spec), `src/modules/daily-jobs/daily-jobs.{module,service,
service.spec}.ts`, `src/modules/milestone-board/milestone-board.service.ts`, `src/modules/notifications/notification-types.ts`,
`src/modules/system-config/{system-config.service,system-config.service.spec}.ts` + `dto/{planning-params,system-config-response,
update-system-config,update-system-config.spec}.ts`, `src/modules/work-queue/work-queue.{controller,module,service,service.spec}.ts`,
`docs/changelog-2026-11-05-phan-a-dot-4.md`.

**FE** (nhánh `dot-4-vat-tu-can-ve`): `src/modules/pages/MaterialsDue/{VatTuCanVePage.tsx,vatTuCanVe.ts,vatTuCanVe.test.ts}`,
`src/services/materials-due-api.ts`, `src/services/system-config-api.ts`, `src/hooks/useWorkQueue.ts`, `src/types/{admin,containerLoad}.ts`,
`src/hooks/usePlanningParams.ts`, `src/utils/phuAnTimeline.ts`, `src/modules/pages/Admin/SystemConfigPage.tsx`,
`src/modules/pages/{Purchasing/PurchasingApp,InboundWarehouse/InboundWarehouseApp,ProductionPlan/ProductionPlanApp,
ProductionPlan/LenhSXPage}.tsx`, `src/modules/pages/Guide/content/{purchasing,warehouse,productionPlan}.ts`.
**Không commit:** `next-env.d.ts` (next dev tự sửa), `tsconfig.tsbuildinfo`.

## 8. Môi trường thử
- DB `dna_erp_dot4` = bản sao `dna_erp_full` + migration của đợt + `.claude/tools/huong-dan-test-phan-a/pa4-seed.sql` (5 lệnh PA4-PI-A..E =
  MY-9401..9406; ngày tính theo NGÀY CHẠY nên chạy lại script vào sáng ngày test; đổi người mua của 10 vật tư dùng ở đây sang 3 tài khoản
  demo muapsh / muavttp / muatp - chỉ trong DB này). Không commit script (repo public).
- `.claude/launch.json`: `be-3037-dot4` (việc hằng ngày tắt), `be-3037-dot4-daily` (bật), `fe-3137-dot4`.

## 9. Đánh giá UX/UI sau khi xem trình duyệt (Opus, 05/11)

Người dùng: "review xong đưa tôi bản đánh giá của bạn về UX và UI của đợt 4". Xem trên FE 3137 với `muapsh`, `khopsh`, `khsx`, màn rộng
1440 và màn hẹp ~770 px. **Kết luận:** đúng 4 quyết định của Sếp, dòng đỏ / "HẠN CHÓT HÔM NAY" rõ, lệnh gộp dễ đọc; **nên sửa 4 điểm trước
khi đưa Sếp test** (U1–U4), còn lại để sau.

| Mã | Mức | Vấn đề | Đề xuất |
|---|---|---|---|
| U1 | Cao | Số nhắc việc trên menu không hiện (lỗi có sẵn `useWorkQueue.ts`, mục 4) - mất nửa ý "nhắc việc" của Đợt 4. | Sửa 1 dòng (chờ người dùng). |
| U2 | Vừa-cao | Mở màn mặc định lọc **Hôm nay** - dòng **quá hạn không nằm trong đó**; dải đỏ chỉ đếm dòng đang hiện ("1 dòng quá hạn hoặc đến hạn chót hôm nay") nên người mua dễ bỏ sót hàng đã trễ (chỉ còn số nhỏ trên nút "Quá hạn"). | Ở Hôm nay, khi có quá hạn: dải đỏ "Có N dòng đã quá hạn – bấm để xem" (đếm theo `counts`, bấm chuyển sang Quá hạn). |
| U3 | Vừa | 2 nút **"Tất cả"** đứng sát nhau (lọc + phạm vi người mua) - dễ bấm nhầm. | Đổi phạm vi thành "Của tôi / Mọi người mua" (hoặc có chữ "Phạm vi:"). |
| U4 | Vừa | Cột Lệnh hẹp: "MY-9403 (PA3-J55) · hạn 07/11" xuống 3 dòng, mã SKU bị cắt đôi. | Mã lệnh + hạn 1 dòng, mã SKU dòng nhỏ riêng; nới cột Lệnh, thu cột Người mua. |
| U5 | Thấp | Dòng đã đặt mua mà chưa ghi NCC hiện "—" (dòng chưa đặt thì "Chưa đặt NCC") - "—" không nói gì. | Ghi "Chưa ghi NCC". |
| U6 | Thấp | Nhãn vàng "Còn 2 ngày" không rõ còn 2 ngày tới gì. | "Còn 2 ngày tới hạn chót" (hoặc chú thích khi rê chuột). |
| U7 | Thấp | Phạm vi "Vật tư của tôi / Tất cả" không nhớ trên địa chỉ - tải lại là về "của tôi". | Đưa lên URL như `view`. |
| U8 | Để sau | Chưa có ô tìm (vật tư / lệnh / NCC) - dữ liệu thật vài chục-trăm dòng sẽ cần. Chưa có lối tắt từ dòng sang Nhập kho / Đơn đặt hàng (màn chỉ xem theo thiết kế). | Ô tìm như Tổng hợp lệnh SX; nút "Nhập kho" cho thủ kho. |
| U9 | Để sau | Sếp bấm cảnh báo đỏ sẽ mở màn trong app Kế hoạch SX (Sếp vẫn dùng app này để duyệt lệnh) - BossApp chưa có mục riêng. | Hỏi Sếp nếu cần. |

Đã sửa ngay: nhãn phạm vi kho hiện tên kho (mục 4). Chưa xem: giao diện tối (app đổi theo nút giao diện của app, không theo hệ điều hành -
màn chỉ dùng biến màu chung), điện thoại thật, dữ liệu production nhiều dòng.

## 10. Sửa U1–U6 theo đánh giá UX (05/11)

Người dùng xem canvas đánh giá (màn hiện tại / đề xuất) rồi chọn "Sửa cả U1–U6". Opus tự sửa (≤ 4 file FE + chữ hướng dẫn):
- **U1** `src/hooks/useWorkQueue.ts`: `useCallback(poll, [token])` (trước `[]`) - số nhắc việc hiện lại ở **mọi phân hệ**, không riêng Đợt 4.
- **U2** `VatTuCanVePage.tsx` + hàm thuần `overdueHint(view, counts)`: ở lọc Hôm nay mà có dòng quá hạn (đếm theo `counts`) → dải đỏ
  "N dòng đã quá hạn chưa về đủ — không nằm trong “Hôm nay”" + nút **Xem quá hạn** (chuyển lọc); lọc khác giữ dòng chữ đỏ cũ.
- **U3** ô **Phạm vi**: "Của tôi | Mọi người mua", tách khỏi nhóm lọc bằng vạch, nút chọn tô tím nhạt (`--bg-ede7f6` / `--fg-4527a0`, đủ
  tương phản cả giao diện tối) - không còn 2 nút "Tất cả" sát nhau.
- **U4** cột Lệnh: dòng 1 "MY-9403 · hạn 07/11" (không xuống dòng), dòng 2 mã SKU nhỏ; cột Lệnh tối thiểu 150 px, cột Người mua 150 px chữ 12.
- **U5** dòng đã đặt mua chưa ghi NCC: "Chưa ghi NCC" (trước "—"). **U6** nhãn vàng "Còn N ngày tới hạn".
- Chữ Hướng dẫn trong app (Mua hàng, Kho, KHSX) và file Word (R4.6, R4.7, R4.9, TC4.1–4.4, 4.6, 4.7) đổi theo nhãn mới.
- Kiểm tra: FE `tsc` sạch; eslint file đổi 0 lỗi (1 cảnh báo có sẵn ở `useWorkQueue.ts`); `vitest` **34 file / 342 test xanh** (thêm test
  `overdueHint`, sửa test nhãn U5/U6). Trình duyệt (FE 3137 + BE 3037): `khopsh` menu "Nhập kho 3", "Vật tư cần về 3"; dải đỏ quá hạn → bấm
  "Xem quá hạn" sang lọc Quá hạn (Sắt hộp MY-9401); `muapsh` menu "Theo dõi mua hàng 6", "Vật tư cần về 3" ngay sau khi đăng nhập (trước
  luôn trống); ô Phạm vi tách riêng; cột Lệnh, "Chưa ghi NCC", "Còn 2 ngày tới hạn" đúng; màn 375 px dải đỏ + thẻ xuống dòng gọn; console
  không có lỗi mới.
- Còn U7 (nhớ phạm vi trên địa chỉ), U8 (ô tìm, lối tắt Nhập kho), U9 (mục riêng ở màn Giám đốc) - để sau.
