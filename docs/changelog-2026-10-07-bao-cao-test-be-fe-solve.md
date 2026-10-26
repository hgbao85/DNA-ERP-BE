# Báo cáo kiểm thử BE + FE + Solve — 07/10/2026

> **Chỉ ghi nhận lỗi, KHÔNG sửa code** (theo yêu cầu người dùng). Môi trường: local (BE :3001, FE :3000, solver docker :18080, DB local).
> Phiên bản: BE `main` @ `d73948a` (đã gồm big-update + fixbug-v2), FE `demo` @ `c35ce6d`. Đã áp 6 migration mới lên DB local.

## 1. Tóm tắt

| Phần | Kết quả |
|---|---|
| BE unit test (jest toàn bộ) | **1398/1398 đạt**, 54 suite; `tsc` sạch; `eslint` các module chính sạch |
| FE | `tsc` sạch; vitest **61/61**; `next build` OK; **ESLint 2 lỗi** (xem L-11) |
| API khâu Solve (bộ test tự viết, 76 ca) | **72/76 đạt** + 1 ca script sai (chạy lại đạt) — tìm được **2 lỗi thật + 1 điểm cần xác nhận** |
| Luồng đầu–cuối qua API: tính → tạo lệnh → QLSX → Sếp duyệt → đề xuất mua → kế hoạch xuất sắt | **13/13 đạt** (số cây mua khớp từng loại sắt của phương án, solver không chạy lại) |
| E2E giao diện (Playwright) | `solve-truoc-tao-lenh` **đạt**; `full-flow` và `golden-path` **trượt** vì bài test lỗi thời (L-9) |
| Quét giao diện 16 vai trò (mọi menu) | Chạy được hết; **2 lời gọi API lỗi** (L-4, L-5) |
| Module mới big-update (công thức vật tư thành phẩm), 20 ca API | 19 đạt, 1 lỗi thật (L-3) + 1 điểm nhỏ (L-8) |
| Solver sập giữa chừng | Xử lý đúng (FAILED có lý do, xoá được, tính lại được) |

## 2. Danh sách lỗi / vấn đề (xếp theo mức độ)

### Cao
**L-1. Tham số boolean bị ép kiểu sai — `"false"` được hiểu là `true`** (BE)
- Gốc: `ValidationPipe` toàn cục bật `enableImplicitConversion: true` (`src/main.ts:32`) → chuỗi bất kỳ không rỗng thành `true`.
- Tái hiện: `POST /cutting-batch-solve` với `solverAllowCustomLength: "false"` → lưu `{"solverAllowCustomLength": true}`; `"yes"`, `"0"` cũng thành `true`; chỉ `0` (số) mới thành `false`. `@IsBoolean()` không bắt được vì đã bị ép trước.
- Ảnh hưởng: FE gửi JSON boolean thật nên **chưa thấy lỗi trên UI**, nhưng mọi client gọi API bằng chuỗi (bot Zalo/Cowork, script, Postman) sẽ **bật cây đặt riêng ngoài ý muốn**. Ảnh hưởng toàn bộ DTO có boolean, không chỉ solve.

**L-2. Trần solver 20 s/loại sắt đang chạy ở bản thật cho kết quả không ổn định** (FE `GomDotCatPage.tsx` `SOLVER_MAX_SECONDS_PER_MATERIAL = 20`, commit "Update catsat")
- Đo lặp Ghế J55 (xem `changelog-2026-10-01-live-test-dau-cuoi.md` mục 7e): ở 20 s chỉ **3/8 lượt** ra phương án tốt (146 cây); các lượt còn lại 164–168 cây và chậm 166–790 s. Nguyên nhân: giải cây 6 m hết giờ → solver chuyển sang quét hàng chục chiều dài cây riêng (đặt riêng, nhiều cây hơn, lâu hơn).
- Chưa quyết lại mức trần. Máy Render yếu hơn nên khả năng gặp nhánh xấu cao hơn.

### Trung bình
**L-3. Giá trị `steelSubGroup` không hợp lệ gây lỗi 500** (BE `POST /materials`)
- Gửi `steelSubGroup: "ABC"` → **500 Internal server error** (đúng ra 400 có thông báo). DTO `create-material.dto.ts` thiếu kiểm tra enum hoặc lỗi bị Prisma ném ra.

**L-4. Admin → "Thông báo" luôn lỗi 400** (FE ↔ BE)
- FE `NotificationsPage.tsx:115` gọi `getSentAnnouncements(1, 200)` → `GET /notifications/sent?page=1&limit=200`; BE giới hạn `limit ≤ 100` (`pagination-query.dto.ts`). Màn không tải được danh sách.
- Sửa: FE gọi `limit=100` (hoặc BE nâng trần).

**L-5. QLSX → "Tổng hợp kho" bị 403 khi tải danh mục nhóm vật tư** (BE phân quyền / FE)
- `GET /material-groups?limit=100` trả 403 với tài khoản `qlsx` (thiếu `MATERIAL_GROUP:VIEW` cho vai QLSX), nhưng `MfgWarehousesPage.tsx:117` luôn gọi. Gọi 2 lần/lần mở; có thể làm bộ lọc theo nhóm bị trống.

**L-6. Chọn riêng chiều dài cây cho một quy cách bị solver bỏ qua mà không báo** (solver/FE)
- Chọn `solverStockLengthsByMaterial: {"3": 5850}` (SAT-HOP-20X20) → kết quả `4340 mm, đặt riêng (scan)`, không phải 5850. Khi cho phép cây riêng, solver tự quét và thay cây đã chọn nếu cây đó không đạt ngưỡng. Thẻ kết quả chỉ ghi "đặt riêng", không nói "cây bạn chọn không đạt nên bị thay".
- Cần xác nhận đây có phải thiết kế mong muốn không.

**L-7. Bài e2e cũ không dùng được nữa** — xem L-9.

### Thấp
**L-8. Công thức vật tư thành phẩm cho phép lưu công đoạn trùng** — `processSteps: ["CAT","CAT"]` được lưu nguyên (nên khử trùng hoặc 400).

**L-9. E2E `full-flow.spec.ts` và `golden-path.spec.ts` trượt do giao diện/dữ liệu đổi**
- `full-flow`: form tạo vật tư Admin có thêm ô "nhóm con" của Sắt nên các `selectOption` theo thứ tự (`form.nth(1)`) bị lệch (big-update). `golden-path`: đã hỏng từ 17/09 (khách "MEIJING"/SKU "test" không còn, ô "Mã đơn hàng" mới). Chỉ `solve-truoc-tao-lenh` còn chạy tốt.

**L-10. Nhóm vật tư "Sắt tự tính" (`SAT_TU_TINH`, id 7) vẫn còn trong DB local** dù commit `revert-satTuTinh` đã rút tính năng; big-update dùng `steelSubGroup` thay thế. Nên kiểm tra DB production có còn nhóm này không (dễ chọn nhầm khi tạo vật tư).

**L-11. FE ESLint 2 lỗi** — `SpecSteelPage.tsx:850` ký tự `"` chưa escape trong JSX (`react/no-unescaped-entities`), từ 08/09. Không chặn build.

**L-12. `GET /production-invoices/:id/material-yield-recipe-demand` với PI không tồn tại trả 200 `[]`** (nên 404).

**L-13. Thông báo lỗi lộ địa chỉ nội bộ của solver** — khi solver sập, `errorMessage` hiển thị `External service unavailable: http://localhost:18080/api/v1/de_xuat/propose/` cho người dùng (nên thông báo chung, ghi URL vào log).

### Cần xác nhận nghiệp vụ (không chắc là lỗi)
- **C-1.** Sales không thể sửa số lượng của dòng đơn hàng ngay sau khi tạo (`PATCH sales-orders/:id/items/:itemId` → 409 "đã ghim vào lệnh sản xuất (PI item …)", dù PI chưa tạo): gõ nhầm số lượng thì phải xoá đơn làm lại? Nếu đúng ý thì bỏ qua.
- **C-2.** Tài khoản demo `sales`, `khsx` còn mang thêm vai `WAREHOUSE_STAFF` trong DB local → hiển thị quyền rộng hơn thật (sales xem được công thức vật tư). Chỉ ảnh hưởng dữ liệu demo.

## 3. Lỗi đã được sửa ở upstream trong lúc kiểm thử (xác minh lại)
- **Duyệt tay phương án có loại sắt "không cắt được"** (`approve()` không kiểm tra, loại sắt bị bỏ khỏi đề xuất mua/kế hoạch xuất sắt mà vẫn hiện "OK"): tái hiện được ở bản `fc3327f` (PI-2026-006, phương án #19). Commit `e6f3247 fixbug-v2` đã thêm chặn `hasInfeasibleLine` → `POST …/approve` trả **409** kèm lý do; đã xác nhận bằng ca H2/H3.

## 4. Những gì đã kiểm tra và ĐẠT

**Xác thực/phân quyền solve:** không token 401; sales/qlsx gọi tính 403; xoá đợt solve chỉ KHSX; kho không xem được danh sách.
**Validation (15 ca):** body rỗng, ids rỗng/trùng/sai kiểu/không tồn tại/chữ, override % 0 và 101, thiếu lý do hoặc lý do toàn khoảng trắng, timeLimit 0/3601/1,5, stockLengths khoá chữ/âm → đều 400/404 đúng.
**Kết quả giải (9 ca):** tổng cây = tổng từng loại; tổng `barCount` các kiểu cắt = số cây; mỗi cỡ đoạn cắt ra ≥ cần; `produced` khớp cộng từ kiểu cắt; không kiểu cắt nào vượt chiều dài cây.
**Tham số (14 ca):** cấm cây riêng (loại sắt cần cây riêng báo "cần xử lý", không giả vờ OK); chế độ chấp nhận hao hụt cao hơn (lưu tuỳ chọn, gắn cờ vượt mức); số lượng 1 và 3000; gộp 2 SKU ra ít cây hơn tách riêng (61 vs 29+32).
**Chồng lượt:** tính lại cùng SKU khi đang tính 409; xoá lượt đang tính 409; lượt chậm vẫn xong bình thường.
**Xoá đợt solve (8 ca):** 204 / 409 xoá lần 2 / 404 / 403 theo vai; biến khỏi danh sách; tính lại sau khi xoá được; lượt đã gắn PI không xoá được.
**Cổng tạo lệnh:** claim-solo phương án vô nghiệm 409 (kèm lý do); claim-solo sai SKU 409; thiếu id 400; claim lần 2 409; tính lại SKU đã thuộc PI 409; duyệt phương án trước khi Sếp duyệt PI 409.
**Chuỗi duyệt đầu–cuối:** phương án chuyển APPROVED không giải lại; đề xuất mua đúng số cây từng loại; kế hoạch xuất sắt đủ mọi loại sắt.
**Solver sập:** `FAILED/NEEDS_ACTION` kèm lý do, xoá được (204), tính lại được (201).
**Công thức vật tư thành phẩm (BE, 18 ca):** vật tư ra = vào 400; `piecesPerBar` 0/âm/lẻ 400; công đoạn sai 400; vật tư ra không thuộc nhóm thành phẩm 400; vật tư vào không tồn tại 404; trùng vật tư ra 409; sửa/xoá/quyền 403 đúng; `steelSubGroup` trên nhóm không phải Sắt 400.
**Quét 16 vai trò (khsx, qlsx, boss, sales, admin, dms, dmbbdg, phoi, han, son, kcs, khopsh, khovttp, khotp, muapsh, muatp, muavttp):** mọi menu mở được, không lỗi JS; chỉ 2 lời gọi API lỗi (L-4, L-5).

## 5. Lưu ý vận hành phát hiện khi test
- **Chạy `next build` trong thư mục FE khi dev server đang chạy làm hỏng `.next` → mọi trang 404.** Cách sửa: xoá `.next` rồi khởi động lại dev (đã gặp, đã tự xử lý). Playwright `webServer` cũng không tái dùng được BE vì `/api/health` trả 404 → phải chạy với config không `webServer`.
- Tính năng big-update cần **`npm run seed` trên production** để tạo Permission module `MATERIAL_YIELD_RECIPE` (nếu chưa).
- `npm run seed` ở local lỗi P2002 (trùng khoá ở bước upsert admin, `seed.ts:265`) — dữ liệu local cũ, chưa xử lý.
- Lần deploy Render hôm trước chạy 20 phút rồi fail, redeploy thì thành công: code build được trên máy (BE `nest build`, FE `next build`), chưa xác minh được nguyên nhân (cần log Render).
- Test để lại nhiều dữ liệu rác trong DB local: ~60 đơn Sales `T-*`/`SPD-*`/`SPU-*`/`SPL*`, các đợt solve và 1 PI (từ test luồng duyệt). Đã có chức năng xoá đợt solve; chưa dọn đơn.

## 6. File công cụ test (trong scratchpad phiên, chưa đưa vào repo)
`solve_suite.js` (76 ca), `flow_suite.js` (luồng duyệt), `recipes2.js` (công thức), `probe16.js` (ép kiểu boolean), `down.js` (solver sập).
Có thể đưa vào repo thành bộ test tích hợp nếu cần.

---

# PHẦN BỔ SUNG — Live-test E2E đầu–cuối bằng giao diện thật + kiểm thông báo (07/10/2026)

> Vẫn **chỉ ghi nhận, không sửa**. Dữ liệu test: vật tư `SAT-010/011/012/013`, `VTK-010` ("… E2E 07"), SKU `E2E07-GHE` (id 17), đơn `E2E07-PO-01` (30 bộ), PI-2026-029, lệnh xưởng #31, đề xuất mua #23.

## 8. Kết quả luồng đầu–cuối: **ĐẠT, mục đơn = HOAN_THANH, giao 30/30**

| # | Vai | Việc (giao diện thật, trừ ghi chú) | Kết quả |
|---|---|---|---|
| 1 | admin | Tạo 5 vật tư (2 sắt, chân nhôm = *Vật tư thành phẩm*, thanh nhôm, sơn) | OK; form có ô nhóm con của Sắt |
| 2 | admin | Công thức chân nhôm: 1 thanh nhôm → 12 chân, công đoạn Cắt | OK |
| 3 | khsx | Tạo SKU `E2E07-GHE` | OK → dms + dmbbdg nhận thông báo "cần nhập định mức" |
| 4 | dms | Định mức mảnh: "Khung tựa E07" (3 dòng sắt 700×4, 520×6, 300×8) + "Chân E07" (chân nhôm ×4) → Gửi | OK → khsx nhận "định mức mảnh đã nộp" |
| 5 | khsx | Duyệt mảnh (Duyệt → Xác nhận duyệt → Xác nhận hoàn tất) | OK |
| 6 | dmbbdg | Định mức chi tiết: sơn 2 kg → Gửi; khsx duyệt + gửi Sếp | OK |
| 7 | boss | Bấm thông báo → "Duyệt SKU" → Duyệt | OK, SKU APPROVED |
| 8 | sales | Tạo PO 30 bộ (API) | OK |
| 9 | khsx | Tối ưu cắt sắt: chọn 1 SKU → Tính | 61 cây (45 × 4m04 + 16 × 4m53), hao 0,60%; cỡ đoạn cần = 120/180/240 đúng định mức |
| 10 | khsx → qlsx → boss | Tạo lệnh → Gửi QLSX → chọn kho → Gửi Sếp → Sếp duyệt (màn hiện đúng "61 cây · 0,60%") | OK, PI-2026-029 PRODUCING, solver không chạy lại |
| 11 | muapsh, muavttp | Mỗi người chỉ thấy vật tư của mình; "Sếp đã duyệt" + đính file | OK → đề xuất #23 PURCHASING |
| 12 | khopsh, khovttp | Nhận hàng | Số mua đúng: sắt 45 + 16, sơn 60 kg, thanh nhôm 10 (=30×4÷12) → PURCHASED |
| 13 | qlsx | Bắt đầu | OK |
| 14 | khopsh → phoi | Xuất sắt 45/16 cây → Phôi xác nhận nhận (bấm thông báo) | OK |
| 15 | phoi → kcs | Cắt (thử hoàn tác; số 123/181/240) → Gửi KCS → KCS duyệt (07B báo 3 lỗi, bắt buộc chọn nguyên nhân) | OK, QC_FAILED tới phoi + qlsx |
| 16 | khopsh → phoi → kcs | **Nhánh mới big-update**: xuất 10 thanh nhôm → Phôi nhận → báo Cắt 120 chân → KCS duyệt | OK, tồn kho VTTP +120 chân nhôm đúng công thức |
| 17 | han/son → kcs | Hàn, Sơn báo 30 × 2 mảnh → KCS duyệt | OK |
| 18 | khopsh → khovttp | Chuyển 2 mảnh sang kho VTTP, nhận nội bộ | OK |
| 19 | khotp | Chuyền kiểm 30/mảnh → Đóng gói 30 thùng | OK → sales nhận "đã đóng gói xong" |
| 20 | sales | Giao hàng (API): 31 → 409, 0 → 400, 20 + 10 → 201 | OK, đã giao 30/30 |
| 21 | qlsx | Kết thúc | lệnh xưởng FINISHED; mục đơn **HOAN_THANH** |

## 9. Lỗi / vấn đề mới tìm được ở luồng này

**E-1 (trung bình–cao) Nhánh chân nhôm có thể rơi vào ngõ cụt không ai xuất được nguyên liệu, và không có cảnh báo từ trước.**
Màn "Xuất vật tư TP → Không gắn mảnh (chân nhôm)" chỉ nằm trong "Phân phối nội bộ" của kho PSH (kho VTTP không có menu này). Nếu vật tư nguyên liệu (thanh nhôm) khai báo ở **kho VTTP**, kho PSH bị chặn khi xuất: *"Caller bị giới hạn ở kho 'phoi-son-han', không được xuất vật tư từ kho 'vat-tu-tp'"* (thông báo lỗi lẫn tiếng Anh); kho VTTP không thể xuất. Form Admin tạo công thức không cảnh báo kho của vật tư vào. Cách thoát duy nhất ở local: đổi kho vật tư sang PSH + bù tồn (chuyển kho tự do tới PSH bị cấm: "chỉ nhận vật tư qua mua hàng").
**E-2 (thấp)** Form công thức: ô "Vật tư vào" liệt kê MỌI vật tư (cả sơn, cả chính vật tư thành phẩm); nên lọc.
**E-3 (thấp)** Mảnh chỉ có vật tư thành phẩm ("Chân E07") vẫn mặc định đi qua **Hàn và Sơn** (cờ mặc định bật) → Hàn/Sơn buộc báo cả mảnh đó; không có cảnh báo khi định mức.
**E-4 (cần xác nhận)** Phôi lưu được đợt cắt 200 đoạn khi nhu cầu chỉ 120 (không cảnh báo; có nút Hoàn tác); Hàn PI-2026-004 hiện tiến độ 172%. Đóng gói cho nhập 31 vào ô khi tổng 30 (chặn hay không lúc xác nhận chưa test). Có thể là chủ đích (vật tư cắt dư), cần xác nhận.
**E-5 (thấp)** Màn Gửi QLSX hiện mốc "Mua hàng ước tính 30/09/26" — đã nằm trong quá khứ so với hôm nay.
**E-6 (thấp)** Danh sách đợt solve vẫn giữ các thẻ "Solver lỗi" cũ cho tới khi KHSX tự xoá (đã có nút xoá).

## 10. Kiểm thông báo (notification) — theo từng chặng

**ĐÚNG (đã xác minh trên UI + DB):**
- SKU mới → `SKU_NEEDS_MANH_QUOTA` (dms) + `SKU_NEEDS_DETAIL_QUOTA` (dmbbdg), link `production/setup`.
- Nộp định mức → `SKU_*_QUOTA_SUBMITTED` (khsx, link `duyet-sku`); thông báo "cần nhập" của dms/dmbbdg tự chuyển **"Đã xử lý"** sau khi nộp.
- Gửi Sếp → `SKU_SENT_TO_BOSS` (boss, link `boss/cho-duyet`; **bấm đi đúng màn, số trên chuông giảm 14→13, mục thành "Đã xử lý" khi Sếp duyệt**); Sếp duyệt → `SKU_APPROVED` (khsx, dms, dmbbdg).
- Tính xong → `CUTTING_SOLVE_DONE` (khsx, link `gom-cat`); gửi QLSX → `PI_SENT_TO_QLSX` (bấm → "Xử lý lệnh sản xuất"); QLSX → Sếp → `PI_SENT_TO_BOSS` (tự "Đã xử lý" sau duyệt); Sếp duyệt → `PI_APPROVED_BY_BOSS` (khsx, qlsx).
- `PURCHASE_PROPOSAL_CREATED` tới 3 vai mua (bấm → "Lệnh mua vật tư"; tự "Đã xử lý" khi họ làm); `PURCHASE_PROPOSAL_APPROVED`, `_ITEM_RECEIVED`, `_PURCHASED` (qlsx, các vai xưởng).
- `STEEL_ISSUE_TO_PHOI` (bấm → "Xác nhận nhận sắt"); `CUT_BUNDLE_TO_KCS` (kcs); `BATCH_TO_KCS` (Hàn/Sơn → kcs); `QC_PASSED`/`QC_FAILED` ("KCS chấm lỗi 3" tới phoi + qlsx).
- `WAREHOUSE_TRANSFER_CREATED` tới kho nhận (khovttp) + muavttp; `PI_ITEM_PACKAGING_COMPLETE` tới sales.
- Màn "Thông báo của tôi" (`?notif=all`) mở đúng, có nhãn "Cần xử lý/Kết quả", "Đã xử lý", giờ theo múi giờ địa phương; số huy hiệu khớp API `unread-count`.

**LỖI / THIẾU:**
- **N-1 (cao) Nhánh chân nhôm KHÔNG gửi thông báo nào:** xuất nhôm cho Phôi (`MATERIAL_YIELD_ISSUE_TO_PHOI` có định nghĩa nhưng module `material-yield-recipes` không gọi `notifications.emit`) và gửi KCS (bundle chân nhôm `AWAITING_QC`) đều im lặng → Phôi/KCS chỉ biết nếu tự vào màn.
- **N-2 (trung bình) Số "Cần xử lý" trên chuông đếm cả mục ĐÃ xử lý:** boss hiện 14 "cần xử lý" nhưng chỉ 3 mục thật sự còn chờ (11 mục đã resolved vẫn chưa đọc); dms 10 vs 1; khsx còn 2 dù đã xử lý hết. `unread-count` đếm theo `readAt` bỏ qua `resolvedAt` → huy hiệu/tab "Cần xử lý (n)" phóng đại.
- **N-3 (thấp–trung bình) Nhiễu/trùng:** QLSX nhận **2** thông báo y hệt "đề xuất mua đã có Sếp duyệt" (mỗi người mua duyệt một lần); mỗi dòng nhận hàng tạo 1 thông báo "PI-2026-029: hàng về kho" gửi ~7 vai (4 lần × ~7 = 16 dòng), không nêu vật tư/số lượng.
- **N-4 (thấp)** `muatp` (mua kho thành phẩm) nhận "4 vật tư cần mua" dù đề xuất không có vật tư kho TP.
- **N-5 (thấp)** Nhiều thông báo thiếu liên kết: `PI_APPROVED_BY_BOSS`, `QC_PASSED/QC_FAILED` có `link` rỗng, và `QC_*` không có `entityType/entityId` (không thể tự đánh dấu "đã xử lý"); nội dung "KCS duyệt đạt" không nêu mảnh/vật tư.
- **N-6 (thấp)** `SKU_APPROVED` gửi cho dms/dmbbdg kèm link `production_plan/planforms` (module KHSX) — menu của hai vai này chỉ có module `production`; chưa bấm thử trên UI (nghi link không đến được).
- **N-7 (thấp, có thể chủ đích)** Không có thông báo cho dms/dmbbdg khi KHSX **duyệt** định mức (chỉ có khi từ chối) và không có thông báo khi QLSX "Kết thúc".
- Thông báo "solver lỗi" in địa chỉ nội bộ (L-13 mục 2).

## 11. Dọn dữ liệu test + các mục test nốt (07/10/2026, vẫn không sửa code)

**Dọn (DB local, chỉ dữ liệu do tôi tạo):** xoá 30 đợt solve chưa dùng; xoá 32/46 đơn Sales test (`T-`, `SPD-`, `SPU-`, `SPL*`, `DN-`, `P16-`). 14 đơn KHÔNG xoá được: 9 đơn đã gom vào lệnh sản xuất (đúng luật), **5 đơn báo 400 "Invalid reference to a related record"** (xem L-14). Dữ liệu chuỗi hoàn chỉnh (E2E07-PO-01, PI-2026-029, 5 vật tư "E2E 07", đơn đã giao) giữ nguyên vì đã giao/đã có lịch sử kho.

**L-14 (trung bình) Xoá đơn Sales vẫn báo lỗi mơ hồ khi đơn từng có đợt solve đã bị "thay thế":** `requestForBatch` đánh SUPERSEDED các đợt cũ nhưng GIỮ dòng ghim `CuttingProposalItem`; FK Restrict chặn xoá đơn → 400 "Invalid reference…" (không nói lý do, người dùng không có cách gỡ ngoài DB). Bản "Xoá lượt tính này" chỉ gỡ ghim cho đợt đang hiển thị.

**Test nốt:**
- Đóng gói vượt số còn lại (PI 6 item 5: còn 10, gửi 11) → **400** "vượt quá số còn có thể đóng"; 0 / âm / số lẻ → 400; item đã Kết thúc → 409. **ĐẠT** (E-4 phần đóng gói: BE chặn; chỉ ô nhập UI không chặn trước).
- Chuyền kiểm: 0 / âm → 400; PI đã kết thúc → 409. ĐẠT.
- **N-6 xác nhận:** dms bấm thông báo "SKU đã được duyệt: E2E07-GHE" → URL đổi sang `?m=production_plan&p=planforms` nhưng màn **vẫn ở "Định mức mảnh"**, không có thông báo lỗi/quyền → liên kết chết, người dùng không biết vì sao.
- Chưa test: dmbbdg bấm cùng thông báo (cùng cơ chế), thông báo "Kết thúc" (không có loại này).

## 12. E2E lần nữa trên server local (sau patch solver ×3/×6 + 2 commit mới DEC-85) — KẾT QUẢ: 1/3 spec PASS, 2 spec FAIL do script/dữ liệu test, không phải lỗi sản phẩm

**Môi trường:** "server" = local (BE :3001, FE :3000, solver local bản patch). BE không build vì sau lần pull DEC-85 (module realtime/socket.io) thiếu thư viện → `pnpm install` (BE + FE). ĐÍNH CHÍNH (2026-10-08): ban đầu ghi "pnpm-lock.yaml của FE lệch package.json" là SAI mức độ — pnpm-lock.yaml của FE KHÔNG được git theo dõi (chỉ có trên máy), còn package-lock.json (được theo dõi) đã có socket.io-client; deploy dùng npm nên không bị ảnh hưởng. Trên máy này chỉ cần pnpm install --no-frozen-lockfile. Migrations: không có cái nào pending.

**Kết quả Playwright (`playwright.nows.config.ts`):**
- `solve-truoc-tao-lenh.spec.ts` — **PASS** (tính trước → tạo lệnh → duyệt).
- `full-flow.spec.ts` — FAIL lần 1 ở bước tạo vật tư Sắt: form có thêm ô **"Nhóm con Sắt" bắt buộc** (big-update) → chỉ số ô chọn trong spec lệch. Đã sửa spec (thêm chọn "Phần mềm (cắt qua phần mềm)", dời chỉ số kho/NV mua hàng) → qua bước này, FAIL tiếp ở bước Sales tạo đơn.
- `golden-path.spec.ts` — FAIL lần 1: tìm khách "MEIJING" nhưng DB local chỉ có "Meiying Furniture" → đã đổi từ khoá thành "Meiying" → FAIL tiếp ở cùng bước tạo đơn.
- **Nguyên nhân chung bước tạo đơn:** chọn khách Meiying thì form PO tự điền sẵn 3 dòng SKU (E2E-FULL-65361579/-20005005/-19933280 — SKU còn sót từ các lần E2E trước), nên `getByPlaceholder('Tìm hoặc chọn SKU đã duyệt *')` khớp 3 phần tử (strict mode violation). Là xung đột giữa dữ liệu test local còn sót và giả định "form trống" của spec. Chưa xử lý.

**Đã sửa (CHƯA commit, repo DNA-ERP):** `e2e/full-flow.spec.ts`, `e2e/golden-path.spec.ts`.
**CHƯA làm:** chạy hết 2 spec (cần dọn SKU/đơn test local hoặc sửa spec chịu được dòng SKU điền sẵn); chưa xác định đây là tính năng (gợi ý SKU theo khách) hay hành vi nên xem lại UX.

### 12b. Dọn dữ liệu test local rồi chạy lại Playwright — full-flow đi tới bước tính phương án cắt rồi dừng vì kỳ vọng của spec gắn với solver GIẢ

**Dọn local:** 30 đợt solve chưa dùng (xoá hết), 30/91 đơn test (61 đơn đã được KHSX gộp vào lệnh → 409 không xoá được), các SKU `E2E-FULL-*` (xoá lặp lại giữa các lần chạy).

**Các chỗ spec lệch giao diện/dữ liệu, đã sửa trong `D:\DNA-ERP/e2e` (CHƯA commit):**
1. Form vật tư Sắt có ô "Nhóm con Sắt" bắt buộc → chọn "Phần mềm", dời chỉ số ô.
2. Khách "MEIJING" không có ở local → dùng "Meiying".
3. Chọn khách trong form PO tự điền các SKU đã gán cho khách (tính năng `skusForCustomer`) — 2 spec chạy song song cùng tạo SKU gán cho Meiying nên lẫn nhau → chạy `--workers=1` + xoá SKU sót trước khi chạy.
4. "Hạn giao" nay là DatePicker tự vẽ (button, không còn `input[title]`) → bấm nút rồi "Hôm nay".
5. Ô "Mã đơn hàng" bắt buộc → spec điền `E2E-PO-<ts>`.

**Kết quả cuối:** `full-flow` đi qua tạo vật tư, định mức, SKU, đơn hàng, rồi FAIL ở khẳng định `totalBarsAll <= 53` (nhận 75). Nguyên nhân KHÔNG phải lỗi sản phẩm hay patch solver (lượt tính 0,02 s, không hết giờ): baseline Playwright dùng **solver giả** `e2e/solver-stub.js` (cổng 18080, xác định), còn cấu hình tạm `playwright.nows.config.ts` tắt webServer nên BE gọi solver THẬT. Solver thật: 6000 mm hao 1,33 % > ngưỡng 1 % → loại, quét ra cây 4040 mm hao 0,7 % → 75 cây (so 50 cây nếu chấp nhận 6000). Là hành vi theo ngưỡng hao hụt; đáng cân nhắc về mặt nghiệp vụ (cây riêng 4040 mm, mua nhiều hơn 25 cây để hao ≤1 %) nhưng không phải lỗi mới.
**CHƯA làm:** chạy lại với solver giả (cần chạy stub + trỏ `SOLVER_BASE_URL` của BE vào :18080) để hết chuỗi full-flow; `golden-path` chạy riêng chưa thử lại.

## 13. Kiểm tra bug BE nhanh bằng đọc code + test tự động (08/10/2026, KHÔNG sửa code)

**Đã làm:** chạy `tsc --noEmit`, `eslint src`, `jest` toàn bộ; đối chiếu lại các lỗi L-1…L-13 ở trên với code `main` @ `b82edce`; đọc module realtime mới (DEC-85: `realtime.gateway.ts`, `realtime-mutation.interceptor.ts`, `realtime.service.ts`, `realtime-io.adapter.ts`). Không dùng công cụ quét ngoài (đã cân nhắc `@alibaba-group/open-code-review` nhưng người dùng bỏ qua; không gửi mã nguồn ra dịch vụ ngoài).

**Kết quả kiểm tra:**
- `jest`: **1436/1437 đạt** (1 skipped), 58/59 suite (1 suite skipped). `eslint src`: **0 lỗi**, 83 cảnh báo (toàn `no-explicit-any`/`no-unsafe-argument` trong file `.spec`). `tsc`: chỉ 2 lỗi ở `prisma/seed-real-products.ts:150` và `prisma/seed-ghe-j55-full-bom.ts:152` (`factoryCode` không còn unique) — đã biết từ `changelog-2026-09-30-solve-truoc-tao-pi.md`, nằm ngoài `src/`, chạy 2 script seed này sẽ lỗi.
- Module realtime: xác thực JWT ở handshake, room theo quyền VIEW do server tự join, ngắt khi token hết hạn, phát event sau commit — không thấy lỗi.

**Còn tồn tại (xác nhận lại bằng đọc code):**
- **L-1 còn nguyên:** `src/main.ts:35` vẫn `enableImplicitConversion: true`.
- **L-3 còn nguyên:** `create-material.dto.ts:57-58` chỉ có `@IsOptional()` trên `steelSubGroup`, thiếu `@IsEnum(SteelSubGroup)`; `MaterialsService.resolveSteelSubGroup` (`materials.service.ts:184-201`) không kiểm giá trị hợp lệ → giá trị lạ đi thẳng vào Prisma, ra 500.
- **L-13 còn nguyên:** `external-api.service.ts:104,137` đưa URL nội bộ vào `ServiceUnavailableException`.

**Điểm nhỏ mới (độ tin cậy thấp, chưa tái hiện):**
- Quyền trong socket được chụp từ JWT lúc kết nối nên thu hồi quyền chỉ có hiệu lực khi token hết hạn (≤ thời hạn access token), giống REST nếu guard cũng tin JWT; cần xác nhận nếu muốn thu hồi tức thì.
- `actionFor` trong interceptor gán `APPROVED`/`REJECTED` theo việc đường dẫn có chứa `/approve`, `/reject`; route khác có chữ này (vd cấu hình auto-approve) sẽ bị gán nhầm action. Không tìm thấy route như vậy trong controller hiện tại.

**CHƯA làm:** chưa sửa gì; chưa đọc hết ~35k dòng service (chỉ đối chiếu danh sách lỗi cũ + module realtime); chưa live-test trên DB.

## 13. Live test từ tạo SKU tới giao hàng bằng GIAO DIỆN THẬT (08/10/2026) — **ĐẠT: đơn HOAN_THANH, PO FINISHED, giao 50/50**

**Cách làm:** SKU → Sếp duyệt → PO → tính cắt → lệnh SX → Sếp duyệt chạy bằng Playwright (`e2e/full-flow.spec.ts`, nay PASS 1,1 phút); từ Mua hàng trở đi thao tác trong trình duyệt tích hợp, đăng nhập từng vai, MỞ CHUÔNG và bấm thông báo để vào màn (kiểm `focus`). PO-155 / PI-2026-038 / SKU E2E-FULL-43351487; sắt 75 × 4040 mm (solver thật, ngưỡng hao 1% → cây riêng), sơn 100 kg, 50 bộ.

| # | Vai | Việc trên UI | Kết quả |
|---|---|---|---|
| 1 | muapsh | Bấm thông báo "2 vật tư cần mua" → dòng PI-2026-038 nháy → mở → "Sếp đã duyệt" + đính file → Xác nhận | OK (file lên Cloudinary thật), đề xuất #29 → PURCHASING |
| 2 | khopsh | Nhập kho → mở PI → nhận 75 cây sắt, 100 kg sơn | OK → PURCHASED |
| 3 | qlsx | Tổng hợp lệnh SX → PI → "Bắt đầu" | OK (nút dùng `confirm()` gốc, xem U-1) → ACTIVE |
| 4 | khopsh | Phân phối nội bộ → Xuất sắt 75 × 4040 | OK |
| 5 | phoi | Bấm thông báo → dòng `STEEL_ISSUE:33` nháy → "Xác nhận đã nhận" | OK |
| 6 | phoi | Lệnh SX Phôi → nhập 200×700 + 300×520 → Lưu đợt → Gửi KCS | OK |
| 7 | kcs | Bấm thông báo → dòng PI `CUT_BUNDLE:34` nháy → Tiến hành duyệt (đạt 500) | OK → QC_PASSED |
| 8 | khopsh | Xuất vật tư sơn 100 kg | **LỖI B-1** |
| 9 | han, son | Lệnh SX → nhập 50 → Lưu đợt → Gửi KCS | OK (không bị chặn dù sơn chưa xuất) |
| 10 | kcs | Bấm 2 thông báo → KCS Sơn `PRODUCTION_BATCH:83`, KCS Hàn `PRODUCTION_BATCH:82` nháy → duyệt đạt 50 | OK (thông báo của lô đã duyệt tự biến khỏi "Cần xử lý") |
| 11 | khopsh | Xuất theo đơn hàng → PI → chuyển 50 mảnh sang kho VTTP | OK → phiếu CK-2026-033 |
| 12 | khovttp | Chuông (chỉ khovttp nhận, muavttp KHÔNG — sửa mục 30.3 hoạt động) → bấm → thẻ `WAREHOUSE_TRANSFER:36` nháy trên sub-tab Nhập nội bộ → Xác nhận nhận | OK |
| 13 | khotp | Chuyền kiểm 50/50 → Đóng gói 50 thùng | OK → sales nhận "đã đóng gói xong" |
| 14 | khotp | Xuất theo đơn hàng → xuất giao 50 (xác nhận giao ở màn kho, không phải màn Sales) | OK, đã giao 50/50 |
| 15 | qlsx | PI → "Kết thúc" | OK → mục đơn **HOAN_THANH**, lệnh xưởng FINISHED |

**B-1 (cao — LỖI THẬT, chưa sửa) Kho không xuất được vật tư tiêu hao (sơn) cho CHÍNH PI vừa mua về:** màn "Xuất vật tư sơn" báo "Tồn kho khả dụng (0) không đủ xuất 100 cho vật tư 86" dù tồn vật lý 100 kg. Nguyên nhân: nhận hàng mua gọi `StockReservationsService.creditPool()` cho MỌI vật tư; vật tư mới tồn 0 → pool rỗng → tạo dòng giữ chỗ `refType=PRODUCTION_INVOICE` (100 kg, ACTIVE); `MaterialIssuesService` (và `packaging-issues`, `weaving-issues`, `material-yield-issues`) tính khả dụng nhưng chỉ miễn trừ 2 refType `CONSUMABLE_MATERIAL_PURCHASE`/`PIECE_MATERIAL_YIELD_PURCHASE` → giữ chỗ của chính PI bị trừ vào → available = 0. Xuất sơn là bước nghiệp vụ nhưng UI Hàn/Sơn không chặn báo sản lượng nên luồng vẫn đi tiếp, tồn sơn thực tế KHÔNG được trừ. Cần quyết: miễn trừ `PRODUCTION_INVOICE` đúng PI đó, hoặc không tạo giữ chỗ fallback cho vật tư tiêu hao.

**Khác (chưa sửa):** U-1 các nút Bắt đầu/Kết thúc (QLSX) và xác nhận xuất hàng dùng `window.confirm()` gốc — bị chặn trong trình duyệt nhúng (bấm không có gì xảy ra, không báo lỗi), nên phải ghi đè `confirm` mới chạy được; U-2 thanh "Dữ liệu vừa được cập nhật bởi người khác" hiện cả khi CHÍNH người dùng vừa thao tác (xuất sắt, báo sản lượng Hàn/Sơn); U-3 trên bố cục hẹp, bấm thông báo khi ngăn menu bên đang mở thì menu không tự đóng (che mất dòng nháy); U-4 xác nhận giao hàng nằm ở màn Kho (khotp "Xuất theo đơn hàng"), màn Sales chỉ xem số "Đã xuất hàng".
**Thông báo — khoảng trống phát hiện (chưa sửa, xem changelog notification mục 30.7):** `PURCHASE_PROPOSAL_*` gửi QLSX tới `production/lenh-sx` nhưng màn đó chỉ liệt kê PI chờ QLSX duyệt → không có dòng để nháy; `PI_ITEM_PACKAGING_COMPLETE` (Sales) trỏ `PRODUCTION_INVOICE_ITEM:<id PI item>` nhưng danh sách đơn hàng khoá theo đơn bán → không nháy.
