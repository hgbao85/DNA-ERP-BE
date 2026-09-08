# Changelog 2026-09-06 — Tách trạng thái "đợt cắt" (CutBundle) ra khỏi "đợt nhận sắt" (SteelIssue)

> Cập nhật (cùng ngày, mục 5): "Lưu đợt cắt" giờ CỘNG DỒN vào đợt đang mở thay vì luôn tạo đợt mới
> (theo yêu cầu người dùng), và tiện thể phát hiện + sửa 1 lỗ hổng còn sót từ mục 1-4 — lô chỉ có
> DUY NHẤT 1 đợt cắt bị kẹt hoàn toàn sau khi "Báo cắt xong", không mở được đợt tiếp theo.
>
> Cập nhật 2026-09-07 (mục 9): "Bù đủ" giờ hỏi số lượng đã sửa (KCS vẫn duyệt lại độc lập, không
> tin thẳng số Phôi khai) và bấm được ngay tại cột "Lỗi" ở bảng tổng (mục 8) - trước chỉ bấm được
> trong từng đợt cắt riêng và không hỏi số, luôn coi là "báo xong hết".
>
> Cập nhật 2026-09-07 (mục 10, sau khi tự đánh giá UX): gộp "Bù đủ" về ĐÚNG 1 điểm hành động (bỏ
> nút trùng ở từng đợt cắt), thêm "Hoàn tác" cho lần "Lưu đợt cắt" gần nhất, hiện rõ phân bổ khi lỗi
> rải ≥2 đợt, và tiện thể phát hiện + sửa thêm 1 bug thật: chọn sai "issue đích" khi cộng dồn làm
> "Lưu đợt cắt" tưởng cộng dồn nhưng lại đẻ ra đợt cắt mới.
>
> Cập nhật 2026-09-07 (mục 13): "đồng bộ" Bù đủ sang nhánh Vật tư thành phẩm (Hàn/Sơn giữ nguyên) -
> ĐÃ XONG, không còn "đang chờ xác nhận" như ghi trước đó.
>
> Cập nhật 2026-09-07 (mục 14): bỏ ràng buộc THỨ TỰ công đoạn Phôi (Cắt/Uốn/Tán/...) - công đoạn
> nào xong trước gửi KCS trước, không cần chờ công đoạn "trước" nó xong (quyết định Sếp Trương Văn
> Nhân). Vật tư thành phẩm ĐÃ XONG trọn vẹn (BE+FE+live-test); Sắt hoãn sang giai đoạn 2 vì định
> mức (piece_bom) chưa khai processSteps nào trong dữ liệu thật.
>
> Cập nhật 2026-09-07 (mục 15): thêm màn "Ma trận mảnh × công đoạn" cho VTTP (đề xuất UX trước đó) -
> ĐÃ XONG. Set thêm dữ liệu TEST cho 3 dòng `piece_bom` (Sắt) để chuẩn bị cho giai đoạn 2 - code
> Sắt giai đoạn 2 vẫn CHƯA làm, đây chỉ là bước chuẩn bị dữ liệu.
>
> Cập nhật 2026-09-07 (mục 16): **Sắt giai đoạn 2 ĐÃ XONG** (BE+FE+live-test) - công đoạn phụ (Uốn/
> Dập/Tán/...) giờ gửi KCS RIÊNG theo `StepBundle` (mirror `PieceStepBundle` bên VTTP), không còn cờ
> tự khai `CutBundle.completedSteps` và không còn chặn cứng "Báo cắt xong" khi công đoạn phụ chưa
> xong - giải quyết đúng điểm "chưa nhất quán" đã nêu ở mục 15. **ĐỔI SCOPE LẦN 2 ở mục 17** - xem
> bên dưới.
>
> Cập nhật 2026-09-08 (mục 17): **`StepBundle` đổi scope LẦN 2** - từ gắn với 1 `CutBundle` cụ thể
> (mục 16) sang PI + loại sắt (mirror `PieceStepBundle`), vì Phôi làm các công đoạn phụ SONG SONG,
> không cần biết đúng đợt cắt nào ra đoạn đó. Đồng thời **bỏ hẳn cơ chế "Bù đủ → KCS duyệt lại"**
> (report-done/recheck) cho CẢ Cắt lẫn StepBundle (Sắt) và `PieceStepBundle` (VTTP) - "Lỗi" giờ là số
> lịch sử cộng dồn KHÔNG tự giảm, "Bù đủ" chỉ còn là nút pre-fill số lượng rồi gửi 1 đợt MỚI qua đúng
> luồng bình thường. "Các đợt" (lịch sử) lùi hẳn về THUẦN XEM, không còn nút nào. Lúc này CHƯA đụng
> cơ chế "Chốt & gửi KCS" (`ProductionBatch`, Hàn/Sơn/VTTP) - **ĐÃ ĐỒNG BỘ NỐT ở mục 21** bên dưới.
>
> Cập nhật 2026-09-08 (mục 21): **Đồng bộ nốt bước "Chốt & gửi KCS"** (`ProductionBatch`, dùng chung
> Hàn/Sơn/VTTP) theo ĐÚNG pattern mục 17-20 - bỏ hẳn "Sửa được/Phế" (`scrapQty`, `ReplenishRequest` -
> xác nhận tính năng cấp bù này đã hỏng sẵn từ trước, không mất chức năng thật) + report-done/recheck
> (`reportProductionBatchDone`/`recheckProductionBatch`) cho CẢ 3 bộ phận. Gộp luôn mục nav KCS "Vật
> tư TP" VÀO "Phôi" (đồng bộ với bên `tkphoi` đã gộp từ lâu) + sửa cột "Lô"/"SKU nhà máy" sai/rỗng
> thành "PO / PI" có dự phòng `piCode`.

## 1. Đã làm gì

### 1.1. Vấn đề xuất phát

Khi kho xuất sắt cho Phôi theo PO-52, mỗi lần xuất tạo 1 `SteelIssue` riêng (đúng như đã có). Nhưng
trước đây, TOÀN BỘ vòng đời (nhận → cắt → gửi KCS → KCS duyệt) đều gắn cứng vào từng `SteelIssue`
đó — dẫn tới 2 vấn đề khi người dùng xem lại màn "Lệnh sản xuất — Công đoạn Phôi" với PO-52 (2 loại
sắt, nhiều đợt xuất): (1) cùng 1 loại sắt xuất nhiều lần hiện thành nhiều dòng rời rạc, khó theo dõi;
(2) một khi 1 đợt đã "Chốt gửi KCS", `SteelIssue` đó bị khoá — nếu KCS chưa duyệt xong mà Phôi cần
cắt bù thêm (thiếu đoạn, hoặc kho xuất bổ sung), không có đường quay lại "RECEIVED" để nhận/cắt tiếp.

### 1.2. Thiết kế mới — tách 2 khái niệm

- **`SteelIssue`** (đợt kho xuất/Phôi nhận): thu hẹp lại chỉ còn 2 trạng thái có ý nghĩa vận hành
  thật — `ISSUED → RECEIVED`. Không còn tự thân đi tiếp `IN_PROCESS/AWAITING_QC/QC_PASSED`.
- **`CutBundle`** (1 lần Phôi báo cắt = 1 đợt cắt): state machine MỚI, độc lập theo từng đợt —
  `CUTTING → AWAITING_QC → QC_PASSED`. Nhiều `CutBundle` có thể cùng trỏ về 1 `SteelIssue` (Phôi cắt
  nhiều đợt từ cùng 1 lần nhận sắt), và mỗi `CutBundle` đi qua KCS **độc lập** — 1 đợt đang "chờ KCS"
  không còn khoá các đợt khác cùng loại sắt/cùng PO.
- **"Roll-up" 1 chiều**: `SteelIssuesService.syncIssueStatusFromBundles()` tính lại
  `SteelIssue.status`/`completedAt` từ tập `CutBundle` con (còn đợt nào AWAITING_QC → issue hiện
  AWAITING_QC; tất cả đợt đã QC_PASSED → issue QC_PASSED; còn lại → RECEIVED) — CHỈ để 2 màn hình
  chưa đổi giao diện (`XacNhanNhanSatPage.tsx`, `ThongKePagePlan.tsx`) tiếp tục hiện đúng tiến độ,
  không phải nguồn điều khiển nghiệp vụ thật (nguồn thật là `CutBundle.status`).

### 1.3. Đơn giản hoá nhập liệu — bỏ "Số cây đã dùng" + "Mẫu nguyên (mm)"

Theo yêu cầu người dùng, form báo đợt cắt mới (`recordCutBatch`) bỏ hẳn 2 ô nhập:
- **Số cây đã dùng** (`barCount`) — trước dùng để tính cân bằng vật chất (chặn "vượt số cây kho
  giao"), nay không còn tính/không còn chặn — cùng triết lý đã áp cho các module khác trong hệ
  thống: **không cap lúc Phôi báo, KCS mới là bước kiểm soát chất lượng/số lượng thật**.
- **Mẫu nguyên (mm)** (`mauNguyenMm`) — mặc định `0`, không thu thập nữa.

`RecordCutBatchDto` đổi cả 2 field trên thành optional (`?? 0` khi thiếu), FE bỏ hẳn 2 ô nhập khỏi
`NewCutBundleForm`, chỉ còn nhập số lượng theo từng cỡ đoạn.

### 1.4. Màn "Lệnh sản xuất — Công đoạn Phôi" — gộp theo loại sắt

`LenhSanXuatPhoi.tsx` viết lại phần liệt kê: nhiều `SteelIssue` **cùng vật tư** trong cùng PO/PI gộp
thành 1 dòng ("Sắt hộp 25x50 · 2 cây × 6.000mm" thay vì 2 dòng rời), các đợt cắt (`CutBundle`) hiện
như sub-item bên trong, mỗi đợt có nút "Báo cắt xong" riêng. Cột đầu bảng đổi tên "Đang xử lý (đợt)"
/ "Đã phôi (đợt)" (đếm theo `CutBundle`, không còn đếm theo `SteelIssue`).

Màn **"Xác nhận nhận sắt" (`XacNhanNhanSatPage.tsx`) giữ nguyên hoàn toàn** — vẫn liệt kê/xác nhận
theo từng `SteelIssue` như cũ, không đổi giao diện hay hành vi.

### 1.5. Màn KCS Phôi — duyệt theo đợt cắt

`KcsPhoiPage.tsx` viết lại để duyệt theo `CutBundle` thay vì theo `SteelIssue`: mỗi đợt cắt đã báo
xong ("chờ KCS") hiện là 1 dòng riêng, duyệt/từ chối không ảnh hưởng các đợt khác cùng PO.

## 2. Thay đổi kỹ thuật chính

- Migration `20260905020000_cut_bundle_lifecycle` (additive-only): thêm cột
  `cut_bundles.status/completedSteps/completedAt/createdAt`, cột `cutBundleId` (nullable, `ON DELETE
  SET NULL`) vào `step_batches` và `qc_reviews`, kèm backfill từ `SteelIssue` cha để dữ liệu cũ (đợt
  sản xuất đang chạy dở trước thay đổi này) không bị vỡ trạng thái.
- `QcReview` khi duyệt theo `CutBundle` (`reviewCutBundle()`) ghi ĐỒNG THỜI cả `steelIssueId` (giữ
  nguyên CHECK constraint DB cũ `qc_reviews_goods_xor_chk` và các câu query cũ) lẫn `cutBundleId`
  (phạm vi mới) — không phá dữ liệu/API cũ.
- API mới (song song, không thay API cũ): `GET/POST .../cut-bundles`, `POST
  .../cut-bundles/:id/finish`, `.../complete-step`, `.../qc-review`, `.../qc-segments/:id/report-done`,
  `.../qc-recheck`. API cũ theo `SteelIssue` (`finishCutting`, `completeStep`, `reviewSteelIssueQc`,
  `reportSegmentDone`, `recheckQc`) giữ nguyên, không xoá — vẫn hoạt động cho dữ liệu/tích hợp cũ.
- Giới hạn đã biết: `StepBatch.cutBundleId` có cột nhưng service `recordStepBatch`/`getStepProgress`
  CHƯA scope theo bundle (vẫn theo issue) — chấp nhận được vì đã kiểm tra DB dev: 0/44 `piece_bom`
  hiện có `processSteps` nào ngoài CAT (không có material nào thật sự cần bước phụ Uốn/Dập qua
  `CutBundle` lúc này). Cần scope lại nếu sau này có material dùng thêm process step ngoài CAT.

## 3. Kết quả kiểm tra

- `npx tsc --noEmit`: sạch cả BE lẫn FE.
- `npx jest` (BE): **899/899 test pass** (47 test suite) — thêm mới `finishCutBundle`,
  `completeBundleStep`, `syncIssueStatusFromBundles` (steel-issues), `reviewCutBundle`,
  `reportSegmentDoneForBundle`/`recheckForBundle` (qc-reviews); bỏ 3 test cũ khoá cứng hành vi cân
  bằng vật chất/chặn vượt cây (đã bỏ tính năng này, xem mục 1.3).
- `eslint` (FE, 2 file viết lại): sạch, chỉ còn 1 warning `<img>` có từ trước, không liên quan.
- **Live-test qua UI thật** (PO-52 / PI-2026-051, tài khoản `testkhosteel`/`tkphoi`/`tkcs`/`qlsx`):
  1. Kho xuất 3 đợt riêng (1× Sắt vuông 50x50, 2× Sắt hộp 25x50) → cả 3 hiện đúng, độc lập, ở màn
     "Xác nhận nhận sắt" (không đổi giao diện) — Phôi xác nhận nhận cả 3.
  2. Màn "Lệnh sản xuất — Công đoạn Phôi": 2 đợt Sắt hộp 25x50 gộp đúng thành 1 dòng
     "2 cây × 6.000mm". Tạo 2 đợt cắt (`CutBundle`) độc lập từ cùng dòng gộp này, không cần nhập số
     cây/mẫu nguyên — chỉ nhập số lượng theo cỡ đoạn.
  3. Báo cắt xong đợt 2 trước → chuyển "chờ KCS", đợt 1 vẫn "đang cắt" (xác nhận 2 đợt độc lập
     hoàn toàn, không khoá lẫn nhau).
  4. KCS duyệt đạt đợt 2 → xác nhận qua DB: `SteelIssue` cha vẫn `RECEIVED` (đợt 1 chưa xong) — đúng
     roll-up "còn đợt chưa đạt hết thì issue chưa lên QC_PASSED".
  5. Phôi báo cắt xong đợt 1, KCS duyệt đạt → `SteelIssue` cha lên đúng `QC_PASSED` kèm
     `completedAt` = thời điểm đợt cuối cùng đạt.
  6. Màn "Bảng thống kê" (KHSX, `qlsx`) hiện đúng tiến độ PO-52 (17%) dựa trên roll-up — xác nhận
     màn KHÔNG đổi giao diện vẫn đọc đúng dữ liệu mới.

## 4. Chưa làm / lưu ý cho lần sau (TRẠNG THÁI CŨ - xem mục 5 để biết phần đã sửa)

- `StepBatch` scope theo `CutBundle` (mục 2) — chưa cần vì chưa có material thật dùng process step
  ngoài CAT, nhưng phải làm nếu phát sinh.
- Dữ liệu test dùng chung fixture `PO-52`/`PI-2026-051` (đã có sẵn từ trước, dùng chung nhiều lần
  test trong dự án) — không xoá sau khi test vì đây là PO test cố định dùng lại nhiều lần (giống các
  đợt "...-E2E" khác đã có sẵn trong `Xác nhận nhận sắt`), không phải dữ liệu tạo mới cần dọn.
- Đã reset mật khẩu 4 tài khoản test cục bộ (`testkhosteel`, `tkphoi`, `tkcs`, `qlsx`) về `demo1234`
  trên DB dev local để phục vụ live-test (không phải production, chỉ ảnh hưởng máy dev).

## 5. "Lưu đợt cắt" cộng dồn + sửa lỗ hổng "lô 1-đợt-cắt bị kẹt sau khi báo xong" (cùng ngày)

### 5.1. Yêu cầu người dùng

Trước đó (mục 1.4), mỗi lần Phôi bấm nút tạo đợt cắt LUÔN sinh 1 `CutBundle` mới, kể cả khi chỉ
muốn khai bổ sung cho đợt đang cắt dở. Người dùng đề nghị: bấm "lưu" nhiều lần trong lúc đợt còn
đang cắt (chưa "Báo cắt xong") thì phải CỘNG DỒN vào đợt đó, chỉ khi đã "Báo cắt xong" thì lần lưu
tiếp theo mới bắt đầu đợt cắt MỚI.

### 5.2. Đã sửa gì

- `SteelIssuesService.recordCutBatch()`: trước khi ghi, tìm `CutBundle` đang mở (`status=CUTTING`)
  của CHÍNH `SteelIssue` này. Có → `upsert` từng dòng cỡ đoạn vào đợt đó (tăng `qty` nếu cỡ đã có,
  thêm dòng mới nếu chưa — tận dụng đúng `@@unique([cutBundleId, segmentSpecId])` sẵn có). Không có
  (lần đầu, hoặc đợt trước đã "Báo cắt xong") → tạo `CutBundle` mới như cũ. Đổi tên nút FE
  ("Tạo đợt cắt mới" → **"Lưu đợt cắt"**, cột "Nhập đợt mới" → "Nhập đợt này") cho khớp ý nghĩa mới.
- **Phát hiện thêm khi live-test** (không phải yêu cầu ban đầu, tự phát hiện): lô sắt CHỈ CÓ DUY
  NHẤT 1 `SteelIssue` (không như ví dụ PO-52/Sắt hộp 25x50 có 2 issue) — ngay khi đợt cắt duy nhất
  của nó "Báo cắt xong", roll-up (`syncIssueStatusFromBundles`) đẩy `issue.status` lên
  `AWAITING_QC`/`QC_PASSED` để 2 màn cũ hiện đúng tiến độ. Nhưng `recordCutBatch()` cũ lại CHẶN theo
  đúng giá trị ROLL-UP đó (`issue.status !== RECEIVED` → ném lỗi), nên Phôi KHÔNG mở được đợt cắt
  tiếp theo cho tới khi kho xuất thêm 1 lô mới — **đúng vấn đề gốc mà việc tách CutBundle (mục 1-4)
  định giải quyết, chỉ là bỏ sót trường hợp lô có 1 đợt cắt duy nhất**.
  - Sửa: đổi điều kiện chặn thành CHỈ chặn khi `issue.status === ISSUED` (chưa từng xác nhận nhận).
    Mọi giá trị khác (kể cả đã roll-up `AWAITING_QC`/`QC_PASSED`) đều cho khai đợt cắt mới, vì các
    giá trị đó giờ chỉ là hiển thị, không còn là điều khiển thật.
  - FE (`LenhSanXuatPhoi.tsx`): `targetIssue` (issue được chọn để gắn đợt cắt mới/cộng dồn vào) đổi
    từ "issue đầu tiên đang RECEIVED" thành "issue đầu tiên KHÁC ISSUED" - khớp điều kiện BE mới.

### 5.3. Kết quả kiểm tra

- `npx jest` (BE): thêm 2 test cộng dồn (`còn đợt đang CUTTING của lô → CỘNG DỒN...`, `không còn đợt
  nào đang mở → TẠO đợt mới...`), sửa lại test cũ khoá cứng hành vi chặn QC_PASSED (đổi tên +
  hành vi ngược lại - giờ PHẢI cho phép). **901/901 test pass** (47 suite). `npx tsc --noEmit`: sạch
  cả BE lẫn FE. `eslint` (FE): sạch.
- **Live-test qua UI thật** (tiếp tục trên PO-52, tài khoản `tkphoi`):
  1. Lô "Sắt vuông 50x50" (1 issue duy nhất, 0 đợt cắt): lưu 2 đoạn 660mm → tạo đợt 1. Lưu thêm 3
     đoạn 660mm → **cộng dồn đúng thành 5×660mm trong CÙNG đợt 1** (không tạo đợt 2), timestamp gốc
     giữ nguyên.
  2. Lô "Sắt hộp 25x50" (2 issue, 1 issue còn RECEIVED): lưu 3 cỡ đoạn khác nhau 1 lần
     (930/765/200mm) → tạo đúng 1 đợt với 3 dòng segment. Lưu thêm 1 cỡ trùng (930mm) + 1 cỡ mới
     (695mm) → **930mm cộng dồn đúng dòng (1→2), 765mm/200mm giữ nguyên, 695mm thêm dòng mới** -
     vẫn 1 đợt duy nhất.
  3. Bấm "Báo cắt xong" đợt 1 của "Sắt vuông 50x50" → issue roll-up lên `AWAITING_QC`. Xác nhận qua
     DB (`SELECT status FROM steel_issues WHERE id=9` → `AWAITING_QC`). Trước khi sửa mục 5.2, nút
     "Lưu đợt cắt" biến mất hoàn toàn tại đây ("Chưa có lô sắt nào đã nhận"). Sau khi sửa: nút hiện
     lại đúng, lưu 3 đoạn 660mm mới → **tạo đúng đợt cắt 2 độc lập** ("đang cắt"), đợt 1 giữ nguyên
     "chờ KCS" — không còn bị kẹt.

## 6. Chưa làm / lưu ý cho lần sau

- Như mục 4 (`StepBatch` scope theo bundle) — vẫn chưa cần, chưa đổi.
- Đã reset thêm không tài khoản nào mới ở vòng sửa này (dùng lại 4 tài khoản đã reset ở mục 3).

## 7. Vá lỗ hổng phân quyền KCS_STAFF thiếu DEFECT_REASON (phát hiện khi live-test lại, cùng ngày)

Người dùng hỏi lại "nút Bù đủ/ô lỗi còn không" sau mục 5 — khi live-test lại luồng KCS chấm "Không
đạt" để trả lời, phát hiện màn duyệt (KcsPhoiPage) không load được danh sách "Nguyên nhân không đạt"
(dropdown rỗng, cả GET lẫn POST đều 403) nên không hoàn tất duyệt được (bắt buộc chọn nguyên nhân
khi có đoạn không đạt).

**Nguyên nhân**: `role-permissions.constant.ts` chưa từng cấp `DEFECT_REASON` (module "danh mục
Phase 2", ban đầu chỉ định cho ADMIN/BOSS quản lý) cho `KCS_STAFF` — cùng loại lỗ hổng với 2 mục đã
vá trước đó cho role này (`PRODUCTION_BATCH:VIEW`, `STEEL_ISSUE:VIEW`, đều ghi chú "vá lỗ quyền phát
hiện lúc nối FE"), chỉ là chưa ai phát hiện/vá cho `DEFECT_REASON`. Không liên quan gì tới việc tách
CutBundle hôm nay — lỗ hổng đã tồn tại từ trước, tình cờ va phải khi test lại.

**Đã sửa**: thêm `DEFECT_REASON: [VIEW, CREATE]` vào `ROLE_GRANTS[KCS_STAFF]`
(`role-permissions.constant.ts`) — chỉ VIEW+CREATE (không UPDATE/DELETE, sửa/xoá danh mục vẫn là
việc Admin). Chạy `npm run seed` để đồng bộ `role_permissions` trong DB (seed sync theo đúng cơ chế
sẵn có, không cần SQL tay).

**Kết quả kiểm tra**: `npx tsc --noEmit` sạch, `npx jest` **909/909 test pass**. Live-test qua UI
thật: KCS chấm "660mm: 3 đạt / 2 không đạt", chọn nguyên nhân "Cắt lệch kích thước" (tự thêm mới
qua ô "+ Thêm loại lỗi mới…", nay đã dùng được) → duyệt thành công, đợt cắt hiện đúng "Lỗi 2 đoạn"
ở cả màn KCS lẫn màn Phôi. Bấm "Bù đủ" ở màn Phôi → chuyển đúng "chờ KCS duyệt lại"
(`reportSegmentDoneForBundle`). Xác nhận toàn bộ luồng lỗi/bù đủ (đã có từ trước, không phải tính
năng mới hôm nay) vẫn hoạt động đúng sau khi tách CutBundle khỏi SteelIssue.

## 8. Khôi phục cột "Lỗi" ở bảng tham khảo Cần/Đã cắt/Còn lại (phát hiện thêm, cùng ngày)

Trong lúc xác nhận mục 7, người dùng hỏi thêm: sao không để cột "Lỗi" LUÔN hiện giữa "Đã cắt" và
"Còn lại" (thay vì phải mở từng đợt cắt trong `CutBundleCard` mới thấy). Kiểm tra lại bản trước khi
tách CutBundle (`87ed182`, `CutBatchPanel` cũ) thì phát hiện: **đây là tính năng ĐÃ CÓ SẴN từ
trước, bị tôi vô tình làm mất khi viết lại `NewCutBundleForm` ở mục 1.4** - không phải chỉ là góp ý
UX. Bảng cũ vốn có đủ 4 cột `Cần | Đã cắt | Lỗi | Còn lại`, và "Còn lại" được tính đúng là
`required - (done - failed)` (trừ luôn phần đang lỗi chưa bù); bản viết lại hôm nay lỡ bỏ cột "Lỗi"
và đơn giản hoá nhầm thành `required - done` - khiến "Còn lại" báo sai (hiện 0 dù còn đoạn lỗi chưa
bù xong), trong khi field `failed` vẫn được BE trả về đầy đủ (`PhoiProgressSegmentDto.failed`,
không đổi gì ở BE) chỉ là FE không dùng tới.

**Đã sửa** (`LenhSanXuatPhoi.tsx`, hàm `NewCutBundleForm`): thêm lại cột "Lỗi" (đỏ khi >0, "—" khi
0) giữa "Đã cắt" và "Còn lại", luôn hiển thị; sửa lại `remaining = s.required - (s.done - s.failed)`
khớp đúng công thức cũ. Lúc này CHƯA đổi `CutBundleCard` ("Bù đủ" vẫn 1-click báo "xong hết", 2 chỗ
phục vụ 2 mục đích: cột này cho biết TỔNG quan ngay từ đầu, `CutBundleCard` cho biết ĐÚNG đợt nào
cần bù) - **mục 9 (cùng ngày) đổi tiếp cả 2 chỗ này thành có popup nhập số lượng**.

**Kết quả kiểm tra**: `npx tsc --noEmit` sạch, `eslint` sạch. Live-test: bảng tham khảo "Sắt vuông
50x50" hiện đúng `660mm | Cần 8 | Đã cắt 8 | Lỗi 2 | Còn lại 2` (trước khi sửa sẽ hiện sai "Còn lại
0").

## 9. "Bù đủ" hỏi số lượng đã sửa + bấm được ngay tại cột "Lỗi" ở bảng tổng (2026-09-07)

### 9.1. Yêu cầu người dùng

Sau mục 8, người dùng đề xuất: nút "Bù đủ" nên nằm CẠNH cột "Lỗi" ở bảng tổng (không chỉ trong từng
`CutBundleCard`), và bấm vào phải hiện popup cho Phôi nhập rõ số lượng đã sửa (vd lỗi 2 → nhập 2 →
lỗi về 0) thay vì 1 click báo "xong hết" như cũ. Xác nhận thêm: KCS **vẫn phải duyệt lại** độc lập
sau khi Phôi nhập số - không bỏ qua bước kiểm soát chất lượng đó, số Phôi nhập chỉ là THAM KHẢO cho
KCS.

### 9.2. Thiết kế

- **DB** (migration `20260907030000_qc_review_segment_phoi_reported_qty`, additive): thêm cột
  `qc_review_segments.phoiReportedQty` (nullable) - số đoạn Phôi TỰ KHAI đã sửa xong lúc bấm "Bù
  đủ". THUẦN THAM KHẢO, KHÔNG tự cộng vào `resolvedQty` (đúng nguyên tắc "KCS là bước kiểm soát duy
  nhất" - Phôi tự bù ngoài hệ thống nên số này chỉ là lời khai). Reset về `null` cùng lúc với
  `phoiReportedAt` khi KCS duyệt lại còn hỏng (mở lại lượt báo mới); giữ nguyên làm lịch sử khi đạt
  hết.
- **BE** (`qc-reviews.service.ts`): `reportSegmentDone`/`reportSegmentDoneForBundle` nhận thêm
  `dto.qty` (`ReportSegmentDoneDto`, validate `1 <= qty <= outstanding`), lưu vào
  `phoiReportedQty`. `recheckForReview` (dùng chung cho `recheck`/`recheckForBundle`) reset
  `phoiReportedQty` song song `phoiReportedAt`.
- **FE - aggregate "Bù đủ"** (`LenhSanXuatPhoi.tsx`, `NewCutBundleForm`): "Lỗi" ở bảng tổng là TỔNG
  trên cả PI, có thể gộp từ NHIỀU đợt cắt cùng lỗi 1 cỡ đoạn cùng lúc. Popup chỉ hỏi 1 số duy nhất
  (Phôi không cần biết khái niệm "đợt cắt"); `findBuDuRowsForSegment()` gom các đợt `QC_PASSED` còn
  outstanding và CHƯA báo (`phoiReportedAt == null`) cho đúng segmentSpecId, sắp cũ nhất trước;
  `allocateQty()` phân bổ số Phôi nhập xuống từng đợt theo FIFO, gọi
  `reportSegmentDoneForBundle` riêng cho mỗi đợt nhận được phần phân bổ > 0. Đợt nào ĐANG chờ KCS
  duyệt lại (đã báo rồi) bị loại khỏi danh sách nhận phân bổ - không báo lại được (hiện "chờ KCS"
  thay vì nút, nếu không còn đợt nào khác trống).
- **FE - `CutBundleCard`**: đổi 1-click cũ thành cùng popup `BuDuPopup` (dùng chung component với
  bảng tổng), maxQty = outstanding của ĐÚNG đợt đó (không cần phân bổ vì đã biết chính xác 1 đợt).
- **FE - `KcsPhoiPage.tsx` (`RecheckModal`)**: thêm cột "Phôi khai đã sửa" hiện `phoiReportedQty`
  (`—` nếu null - dữ liệu cũ trước migration này). Input "Còn hỏng" giờ GỢI Ý SẴN
  `outstanding - phoiReportedQty` (KCS chỉ cần xác nhận/sửa lại thay vì gõ lại từ đầu) - vẫn hoàn
  toàn độc lập, KCS tự đếm lại chứ không tin thẳng số Phôi khai.

### 9.3. Kết quả kiểm tra

- `npx tsc --noEmit` sạch cả BE lẫn FE. `eslint` (FE) sạch (chỉ còn 1 warning `<img>` cũ, không
  liên quan). `npx jest` (BE): thêm test cho `qty` validation (báo bù MỘT PHẦN outstanding, chặn
  `qty` vượt outstanding) + cập nhật test cũ theo field `phoiReportedQty` mới - **912/912 test
  pass** (47 suite).
- **Live-test qua UI thật** (PO-52, "Sắt vuông 50x50"):
  1. KCS duyệt lại đợt đã có lỗi cũ (từ mục 7, `phoiReportedQty` NULL vì report trước khi có cột
     này) → cột "Phôi khai đã sửa" hiện đúng "—", ô "Còn hỏng" gợi ý sẵn = outstanding (2) như hành
     vi cũ. Nhập "1" (còn hỏng 1) → mở lại lỗi mới để test tiếp.
  2. Bấm "Bù đủ" cạnh cột "Lỗi" ở bảng tổng ("Lỗi 1") → popup "Bù đủ — 660mm, Đang lỗi 1 đoạn",
     input mặc định = 1. Xác nhận → "Lỗi" đổi thành "chờ KCS" (bảng tổng) VÀ "chờ KCS duyệt lại"
     (đúng `CutBundleCard` bên dưới) - đồng bộ 2 nơi.
  3. KCS mở lại "Duyệt lại" → cột "Phôi khai đã sửa" hiện đúng "1" (giá trị vừa Phôi nhập), ô "Còn
     hỏng" gợi ý sẵn = 1 - 1 = 0. Bấm "Xác nhận duyệt lại" ngay (không sửa gì) → đợt chuyển hẳn
     "đạt" - hết lỗi hoàn toàn.

## 10. Tự đánh giá UX + 3 cải tiến theo yêu cầu người dùng + 1 bug thật phát hiện thêm (2026-09-07)

### 10.1. Bối cảnh

Người dùng hỏi "theo bạn UX hiện tại đang như thế nào" - tự rà lại toàn bộ luồng vừa làm (mục 1-9)
và nêu 5 điểm cấn, người dùng chọn làm 3 điểm (1, 2, 5) trước, điểm 3 (2 màn hình gộp khác kiểu -
đụng quyết định "giữ nguyên Xác nhận nhận sắt" đã chốt trước đó) và điểm 4 (test responsive) để sau.

### 10.2. Điểm 1 - gộp "Bù đủ" về ĐÚNG 1 điểm hành động

Trước đó (mục 9) "Bù đủ" bấm được ở CẢ 2 nơi: cột "Lỗi" bảng tổng LẪN trong từng `CutBundleCard` -
2 chỗ cho cùng 1 việc khiến Phôi phân vân bấm chỗ nào. **Đã sửa**: bỏ hẳn nút trong `CutBundleCard`,
dồn về DUY NHẤT cột "Lỗi" ở bảng tổng (`NewCutBundleForm`, đã xử lý đúng cả 1 đợt lẫn nhiều đợt từ
mục 9). `CutBundleCard` giờ chỉ hiện SỐ LIỆU tĩnh (`660mm — lỗi 1`, kèm `· chờ KCS duyệt lại` nếu
đã báo) để chẩn đoán ĐÚNG đợt nào đang vướng, không có nút bấm nữa.

### 10.3. Điểm 2 - "Hoàn tác" lần "Lưu đợt cắt" gần nhất

Trước đó lỡ tay gõ nhầm số rồi bấm Lưu là hết đường sửa, phải đợi KCS soi ra lúc duyệt. **Đã thêm**:
- BE: migration-free (không cần đổi schema) - endpoint mới
  `POST /cut-bundles/:id/undo-last-batch` (`SteelIssuesService.undoLastCutBatch()`) nhận lại CHÍNH
  XÁC `segments` vừa submit ở lần `recordCutBatch` gần nhất, trừ ĐỐI XỨNG lại (không đọc lịch sử để
  suy luận). Trừ hết sạch 1 segment → xoá dòng đó; trừ hết sạch CẢ bundle (lần lưu đầu tiên tạo ra
  nó) → xoá luôn bundle rỗng. Chỉ hoạt động khi đợt còn CUTTING. CHỈ 1 CẤP DUY NHẤT (không phải undo
  stack) - rủi ro race hiếm (người khác lưu thêm giữa lúc bấm Lưu và Hoàn tác) chấp nhận được, cùng
  mức độ rủi ro đã có ở các hàm khác trong module.
- FE: sau khi "Lưu đợt cắt" thành công, hiện banner nhỏ "Đã lưu: +1×930mm, +2×200mm — **Hoàn tác**"
  (kèm nút ẩn thủ công). Banner SỐNG TRONG STATE CỤC BỘ - mất khi lưu lần tiếp theo (bị ghi đè, đúng
  ý "chỉ hoàn tác được lần gần nhất") hoặc rời màn (đúng ý "chỉ dùng ngay sau khi lỡ tay", không phải
  sổ nhật ký chỉnh sửa lâu dài).

### 10.4. Điểm 5 - hiện rõ phân bổ khi lỗi rải ≥2 đợt cắt

`BuDuPopup` giờ nhận thẳng `rows` (danh sách đợt cắt còn lỗi + outstanding + createdAt, đã sắp cũ
nhất trước) thay vì chỉ 1 con số `maxQty`. Khi `rows.length > 1`, hiện thêm dòng nhỏ dưới ô nhập:
"Sẽ phân bổ: đợt 14:20 → 2, đợt 15:00 → 1" (tính LIVE theo số Phôi đang gõ, dùng lại
`allocateQty()`). Trường hợp thường gặp (đúng 1 đợt) không đổi gì - không hiện thêm dòng nào, giữ
gọn như cũ.

### 10.5. Bug thật phát hiện thêm khi test điểm 2 - chọn sai "issue đích" khi cộng dồn

Lúc test "Hoàn tác", phát hiện: "Lưu đợt cắt" đáng lẽ cộng dồn vào đợt đang mở lại TẠO HẲN ĐỢT MỚI.
**Nguyên nhân**: `targetIssue` (issue được chọn để gắn đợt cắt cộng dồn vào, mục 5) chỉ đơn giản lấy
`group.issues.find(i => i.status !== 'ISSUED')` - issue ĐẦU TIÊN "đã nhận" trong mảng, KHÔNG quan
tâm issue đó có đúng là issue đang giữ đợt cắt MỞ hay không. Nhóm vật tư có ≥2 lần kho xuất (2
SteelIssue) mà CẢ 2 đều "đã nhận" thì `.find()` có thể chọn nhầm issue KHÁC issue đang có đợt CUTTING
- `recordCutBatch()` tìm đợt mở THEO ĐÚNG steelIssueId nên không thấy, tạo bundle mới dưới issue sai.

**Đã sửa** ([LenhSanXuatPhoi.tsx:521](../../DNA-ERP/src/modules/pages/Phoi/LenhSanXuatPhoi.tsx)):
`targetIssue` giờ ƯU TIÊN issue nào đang có bundle CUTTING trong `group.bundles`, chỉ khi KHÔNG issue
nào đang mở đợt mới rơi về "issue đầu tiên đã nhận" như cũ để bắt đầu đợt mới.

**Dữ liệu dev bị lệch do bug này** (2 đợt `1×765mm` và `2×930mm+1×765mm+2×200mm+2×695mm` của PO-52
đáng lẽ là 1) đã dọn tay lại đúng bằng SQL (cộng qty rồi xoá đợt thừa) - chỉ ảnh hưởng dữ liệu test
cục bộ, không phải production.

### 10.6. Ngoài phạm vi yêu cầu - gọn hoá "Các đợt cắt" (theo góp ý người dùng ngay trong lúc test)

Trong lúc xem lại UI, người dùng chỉ ra dòng tóm tắt 1 đợt cắt nối `"N×cỡmm"` bằng `" + "` dài dằng
dặc khi đợt có nhiều cỡ (`"2×930mm + 2×765mm + 2×200mm + 2×695mm"`), khó đọc. **Đã sửa**:
`CutBundleCard` giờ mặc định GỌN, chỉ hiện `"4 cỡ đoạn · 8 đoạn"` + mũi tên xổ; bấm vào mới bung ra
bảng `Cỡ đoạn | Số lượng` (cùng style bảng tham khảo phía trên, quen mắt).

Bản đầu vẫn giữ dòng lỗi tách riêng phía dưới bảng (`"930mm — lỗi 1"`) - người dùng chỉ tiếp: cùng 1
cỡ đoạn mà số lượng với lỗi hiện ở 2 chỗ khác nhau, khó đối chiếu. **Đã sửa tiếp**: gộp thẳng vào
bảng - thêm cột "Lỗi" ngay cạnh "Số lượng" (chỉ thêm cột này khi đợt CÓ lỗi, đa số đợt không lỗi
không cần cột thừa), bỏ hẳn dòng tách riêng. Bảng cũng tự bung sẵn (không cần bấm) khi đợt đang có
lỗi, để thấy ngay không phải thao tác thêm.

Vẫn tiêu đề mỗi thẻ là thống kê (`"4 cỡ đoạn · 8 đoạn"`) - người dùng góp ý thêm: không cho biết
ĐANG XEM đợt nào, khó nói chuyện ("đợt 2 bị lỗi gì đó") hơn hẳn đánh số. **Đã sửa**: đổi tiêu đề
chính thành `"Đợt N"`, dời thống kê xuống dòng phụ nhỏ cùng timestamp. Đánh số theo THỨ TỰ TẠO RA
(cũ nhất = Đợt 1), CỐ Ý KHÔNG theo vị trí hiển thị (`bundlesSorted` ưu tiên đợt đang cắt/chờ KCS lên
đầu) - nếu đánh theo vị trí hiển thị, số của 1 đợt sẽ nhảy lung tung mỗi khi đợt KHÁC đổi trạng
thái, không dùng để nói chuyện được.

## 11. Tách "Cắt sắt"/"Vật tư TP" thành 2 tab ở `PiDetail` (2026-09-07)

Người dùng chỉ ra: trang chi tiết 1 PO (`PiDetail`) liệt kê liền nhau trên 1 trang dài — danh sách
Sắt rồi tới "Vật tư thành phẩm" phía dưới, phải cuộn mới thấy hết, trong khi 2 loại việc rất khác
nhau (Sắt theo cỡ đoạn, VTTP theo mảnh phẳng). Đề xuất: 2 nút **"Cắt sắt"**/**"Vật tư TP"**, bấm nút
nào chỉ hiện danh sách tương ứng.

**Đã sửa**: thêm state `tab: 'sat' | 'vttp'`, mặc định mở tab có dữ liệu (ưu tiên Sắt - PI đa số có
cả 2; PI CHỈ có VTTP thì mở thẳng tab đó). Nút dùng lại `subFilterBtn()` có sẵn trong `phoiStyles.ts`
(chưa từng dùng ở file này) - đúng style toggle đã dùng ở nơi khác trong hệ thống, không tạo style
mới. Phần chung ("Đợt cắt này gồm", banner "KCS trả về") giữ NGUYÊN ngoài/trên 2 tab vì áp dụng cho
cả PI, không riêng loại nào. Thêm trạng thái rỗng cho tab VTTP ("Chưa có vật tư thành phẩm nào") -
trước đây phần VTTP chỉ ẩn hẳn khi rỗng (`pi.vatTuTpItems.length > 0 &&`), giờ luôn hiện tab (kèm
số đếm `(0)`) khớp cách tab Sắt đã làm từ trước.

**Kết quả kiểm tra**: `npx tsc --noEmit` sạch, `eslint` sạch, `npx jest` (BE, không đổi gì) vẫn
918/918. Live-test: PO-52 mở đúng tab "Cắt sắt (2)" mặc định, bấm "Vật tư TP (5)" chuyển đúng sang
danh sách 5 mảnh, không còn lẫn với danh sách Sắt.

**Cập nhật cùng ngày**: người dùng đề nghị thêm 1 nút **"Tất cả"** xổ ra gộp cả 2 khối (thay vì bắt
chọn đúng 1 trong 2) - đã thêm, đặt ĐẦU TIÊN trong 3 nút, đếm `materialGroups.length +
vatTuTpItems.length`. Khi ở tab "Tất cả", mỗi khối thêm 1 dòng tiêu đề nhỏ ("Cắt sắt"/"Vật tư TP")
để phân biệt - 2 tab đơn lẻ không cần tiêu đề này (chính nút tab đang bấm đã đủ rõ). CỐ Ý KHÔNG đổi
mặc định sang "Tất cả" (vẫn ưu tiên mở tab có dữ liệu như cũ) - "Tất cả" chỉ là lối tắt khi cần xem
gộp, không phải hành vi mở màn mặc định, giữ đúng lợi ích ban đầu của việc tách tab (đỡ cuộn dài).
Live-test lại: "Tất cả (7)" = đúng tổng 2+5, bấm vào hiện đủ 2 khối có tiêu đề phân biệt.

## 12. Ghép "Tên vật liệu + Quy cách" khi hiển thị (2026-09-07) - vá kiểu dữ liệu sai từ trước

Người dùng hỏi "Sắt hộp 25x50" đang hiển thị có phải mock không - kiểm tra không phải mock (lấy thật
từ `materials.name`), nhưng phát hiện: DB đã có sẵn 2 cột đúng chuẩn (`Material.name` = tên loại,
`Material.spec` = quy cách), nhưng (1) TOÀN BỘ code trong `steel-issues.service.ts` chỉ hiện
`material.name` suông, chưa từng ghép `spec` vào bao giờ, và (2) dữ liệu test hiện có bị nhét sẵn
quy cách thẳng vào cột `name` (`name="Sắt hộp 25x50"`, `spec="25x50"` - trùng lặp 2 lần cùng 1
thông tin ở 2 cột) để "chữa cháy" cho lỗ hổng (1).

**Đã sửa cả 2**:
- **Data** (9 material Sắt trên DB dev, SQL 1 lần): tách lại đúng chuẩn bằng quy tắc cơ học - bỏ
  chuỗi trùng với `spec` ra khỏi `name` (không bịa tên mới) - `"Sắt hộp 25x50"` → `name="Sắt hộp"`
  (giữ nguyên `spec="25x50"`), tương tự cho `Sắt vuông *`, `Sắt Fi Ø21` → `Sắt Fi`,
  `Sắt hộp 25x25 E2E` → `Sắt hộp E2E` (giữ hậu tố đánh dấu dữ liệu E2E).
- **Code** (`steel-issues.service.ts`): thêm `private materialLabel(material)` ghép
  `${name} ${spec}` (bỏ qua nếu `spec` null/rỗng, tránh dư dấu cách với vật tư không phải Sắt), áp
  dụng ở TOÀN BỘ 7 điểm set `materialName` trong file (SteelIssueResponseDto, PhoiProgress +
  bản batch trùng lặp, SteelIssuePlanItemResponseDto - mở rộng thêm `select: {spec: true}` ở đây vì
  trước chỉ select `{id,code,name}`, thiếu `spec`). Phạm vi CỐ Ý giới hạn trong module `steel-issues`
  (đúng phần đang bàn) - không sweep các module khác dùng `Material.name` (kho, mua hàng...) vì
  chưa kiểm tra hết rủi ro hiển thị lặp ở những nơi đó.

**Kết quả kiểm tra**: `npx tsc --noEmit` sạch. `npx jest`: 918/918 - mock test cũ (`material` không
có field `spec`) vẫn qua nguyên vì `materialLabel()` tự rơi về `name` suông khi `spec` là
`undefined`/`null`, không breaking. Live-test qua UI thật: "Sắt hộp 25x50"/"Sắt vuông 50x50" ở PO-52
hiện Y HỆT như trước (đúng - vì tổng `name+spec` sau khi tách vẫn ra cùng chuỗi), nhưng giờ do BE
GHÉP 2 CỘT THẬT lúc trả về, không còn là 1 cột tên gộp cứng như trước; xác nhận qua DB: `name="Sắt
hộp"`, `spec="25x50"` sau khi sửa.

## 13. "Đồng bộ" Bù đủ cho Vật tư thành phẩm (2026-09-07) - ĐÃ XONG (trước ghi "chưa làm - đang chờ xác nhận")

Người dùng hỏi có nên áp dụng luồng "Bù đủ nhập số lượng" (mục 9-10, nhánh Sắt) cho Vật tư thành
phẩm không. Khảo sát ban đầu: màn KCS cho VTTP (`KcsVatTuThanhPhamPage.tsx`) dùng CHUNG hạ tầng với
Hàn/Sơn (`kcsCore.tsx`/`reviewProductionBatch()`), khác hẳn cơ chế CutBundle của Sắt - "sản lượng"
(`ProductionBatch.reportedQty`) bị ghi đè vĩnh viễn = phần đạt NGAY LÚC KCS duyệt (khác Sắt tính
thô, không bao giờ trừ), nên copy nguyên xi kiểu tracking của Sắt sẽ CHỈ LÀ COSMETIC. Người dùng
chốt làm THẬT SỰ (Bù đủ thay thế hẳn bước "tạo lô mới" cho phần rework), CHỈ áp dụng cho VTTP (không
đụng Hàn/Sơn dù dùng chung `kcsCore.tsx`).

**BE**: thêm 3 field vào `QcReview` (migration `20260907050000_qc_review_production_batch_bu_du`) -
`resolvedQty` (KCS đã xác nhận đạt thêm bao nhiêu), `phoiReportedAt`/`phoiReportedQty` (thợ tự khai
đã sửa xong). Cùng ngữ nghĩa `QcReviewSegment` bên Sắt nhưng đặt Ở CẤP REVIEW (không phải segment) vì
nhánh Hàn/Sơn/VTTP không có "cỡ đoạn" để bóc - 1 review = 1 đơn vị outstanding duy nhất
(`outstanding = failedQty - (scrapQty ?? 0) - resolvedQty`). 2 endpoint mới trong
`qc-reviews.service.ts`: `reportProductionBatchDone()` (thợ báo Bù đủ, mfgRole PHOI/HAN/SON - dùng
chung được cả 3 dù FE hiện chỉ bật UI cho VTTP) và `recheckProductionBatch()` (KCS duyệt lại, mfgRole
KCS) - điểm khác biệt THIẾT KẾ QUAN TRỌNG so với Sắt: `recheckProductionBatch()` phải CỘNG THẲNG
phần vừa xác nhận đạt vào `ProductionBatch.reportedQty` (dù batch đã QC_DONE), vì
`passedByPiece`/`awaitingByPiece` (`production-batches.service.ts`) tổng hợp bằng cách SUM
`reportedQty` trực tiếp, không đọc qua lớp `resolvedQty` nào cả - khác Sắt nơi "Còn lại" luôn tính
sống từ `QcReviewSegment`, không cần ghi đè gì. 12 test mới (báo đủ/thiếu, Conflict khi đã
resolved/đã báo, NotFound, floor-gate, recheck full/partial có/không reset `phoiReportedAt`).

**FE**: `production-batches-api.ts` thêm `getQcReviewsForProductionBatches()` (fetch
`/qc-reviews?limit=100` rồi lọc client theo `productionBatchId != null`, cùng idiom
`getQcReviewsForSteelIssues()` bên Sắt - không cần filter param riêng ở BE),
`reportProductionBatchDone()`, `recheckProductionBatchQc()`, `getProductionBatchesForOrder()` (scope
đúng 1 productionOrderId, dùng cho panel Bù đủ bên Phôi). `kcsCore.tsx` thêm prop `enableBuDu` (chỉ
`KcsVatTuThanhPhamPage.tsx` truyền `true` - `KcsHanPage.tsx`/`KcsSonPage.tsx` không đổi hành vi) +
modal `KcsRecheckModal` (gợi ý sẵn "còn hỏng" = outstanding trừ lời khai thợ, KCS chỉnh lại nếu cần)
+ cột "Lỗi"/nút "Duyệt lại" đổi theo `enableBuDu`. `KcsStagePage.tsx` fetch thêm QcReview theo batch,
map lineId→batchId cho CẢ lô QC_DONE (trước chỉ map lô đang chờ). `VatTuTpDetail.tsx` thêm
`BuDuPanel` (ẩn hẳn khi không có lô lỗi) hiện trong tab "Chốt & gửi KCS".

**2 bug tự phát hiện khi live-test, đã sửa ngay trong lúc làm** (không phải để lại "chưa làm"):
1. `KcsStagePage.tsx` chỉ `refetch()` batches sau khi duyệt/duyệt lại, quên `refetchReviews()` - KCS
   duyệt xong không thấy cột "Lỗi" cập nhật ngay (phải tải lại trang mới thấy).
2. `kcsCore.tsx` cột "Lỗi" khi `enableBuDu` bật: nhánh fallback (lúc `outstandingQty` về 0 sau khi
   KCS xác nhận hết) lại rơi về hiện `failedQty` LỊCH SỬ (số lần đầu chấm, không đổi) thay vì "—" -
   sau khi Bù đủ xong nhìn vẫn tưởng còn lỗi. Sửa: khi `enableBuDu`, cột này LUÔN theo
   `outstandingQty`, không đụng `failedQty` nữa.

**Kết quả kiểm tra**: `npx tsc --noEmit` sạch cả BE lẫn FE. `npx jest` BE: 930/930 pass (12 test
mới). Live-test qua UI thật (tài khoản `tkphoi`/`tkcs`, PI-2026-054 · Chân Nhôm): KCS duyệt 10 mảnh
với 4 lỗi (3 sửa được + 1 phế) → outstanding=3 hiện đúng ở cả 2 màn KCS lẫn Phôi → Phôi bấm "Bù đủ"
báo 2 → màn KCS hiện "chờ duyệt lại" → KCS "Duyệt lại" xác nhận đạt thêm 2, còn hỏng 1 →
`reportedQty` từ 6 lên 8 (xác nhận qua "Đã duyệt"/"Đã chốt" tăng đúng, KHÔNG cần đụng logic
`passedQty` tổng hợp) → lặp lại vòng 2 cho 1 mảnh còn lại, KCS xác nhận hết (`remainingFailedQty=0`)
→ `reportedQty` lên 9/10 (1 mảnh phế còn lại đúng là "Còn lại" - phế xử lý qua `ReplenishRequest`
riêng, không phải "sửa lại"), panel Bù đủ bên Phôi tự ẩn, cột "Lỗi" bên KCS về "—" đúng sau khi vá
bug 2 ở trên.

**Chưa làm/lưu ý cho lần sau**: chưa test trên Hàn/Sơn để xác nhận `enableBuDu` KHÔNG bật nhầm (đã
review code kỹ - `enableBuDu` mặc định `undefined`/falsy khi không truyền, không có đường nào khác
bật lên) nhưng chưa live-test trực tiếp 2 màn đó; chưa test trường hợp 1 piece có NHIỀU
`ProductionBatch` outstanding cùng lúc (hiện `BuDuPanel` đã code sẵn hiện danh sách nhiều dòng nhưng
chưa có dữ liệu thật để live-test).

### 10.7. Kết quả kiểm tra

- `npx tsc --noEmit` sạch cả BE lẫn FE. `eslint` (FE) sạch (chỉ còn 1 warning `<img>` cũ). `npx jest`
  (BE): thêm `describe('undoLastCutBatch')` (6 test: trừ còn dư, trừ hết xoá dòng, trừ hết mọi
  segment xoá cả bundle, bỏ qua segmentSpecId không khớp, chặn khi không CUTTING, NotFound) -
  **918/918 test pass** (47 suite).
- **Live-test qua UI thật** (PO-52, "Sắt hộp 25x50" - 2 SteelIssue, đúng kịch bản gây bug ở mục
  10.5):
  1. Xác nhận bug tái hiện ĐÚNG như mô tả (10.5) trước khi sửa: lưu thêm vào đợt đang mở tạo ra đợt
     `1×765mm` RIÊNG thay vì cộng dồn - kiểm tra DB xác nhận 2 bundle gắn 2 `steelIssueId` khác
     nhau của cùng vật tư.
  2. Sau khi sửa targetIssue + dọn dữ liệu: lưu thêm `+2×200mm` vào đúng đợt đang mở duy nhất -
     KHÔNG tạo đợt mới, "Đã cắt" 200mm tăng đúng 10→12.
  3. Bấm "Hoàn tác" ngay sau đó → "Đã cắt" quay đúng lại 10, banner biến mất, đợt cắt trở về y hệt
     trước khi lưu - không để lại rác.
  4. KCS chấm lỗi mới (930mm: 1 không đạt) cho đợt đang "chờ KCS" → xác nhận `CutBundleCard` bên
     Phôi tự bung sẵn bảng, cột "Lỗi" hiện đúng "930mm | 2 | lỗi 1" cùng hàng với "Số lượng", 3 cỡ
     đoạn còn lại hiện "—" - KHÔNG còn nút "Bù đủ" ở đây, nút duy nhất nằm ở cột "Lỗi" bảng tổng
     (đúng điểm 1).
  5. Bấm mũi tên thu gọn 1 đợt không lỗi → về đúng `"4 cỡ đoạn · 8 đoạn"`, bấm lại bung ra bảng đầy
     đủ 4 dòng.

## 14. Bỏ ràng buộc THỨ TỰ công đoạn Phôi - "công đoạn nào xong trước gửi KCS trước" (2026-09-07)

Người dùng hỏi (chat nội bộ với Sếp Trương Văn Nhân) về việc chia Phôi thành các công đoạn nhỏ
(Cắt/Uốn/Tán/Đục lỗ...), mỗi công đoạn tự gửi KCS duyệt riêng thay vì phải xong HẾT mọi công đoạn
mới gửi KCS một lần như hiện tại. Người dùng lo ngại việc bỏ ràng buộc thứ tự (Cắt xong mới được
Tán, Tán xong mới được Uốn...) sẽ "chạy loạn xạ sao kiểm soát" - Sếp chốt: "để cho đơn giản thì
không cần ràng buộc, cứ để thoải mái, xảy ra vấn đề mình sẽ xử lí".

**Phát hiện quan trọng lúc khảo sát** (thay đổi hẳn phạm vi làm):
- `ProductionBatchesService.recordPieceStepBatch()` (nhánh Vật tư thành phẩm) **đã có sẵn** ràng
  buộc "chặn báo bước sau vượt bước liền trước" (`BadRequestException`) - đây chính là điều Sếp
  muốn bỏ, không phải giả thuyết.
- Dữ liệu thật: `piece_bom` (Sắt) có **0/44 dòng** khai `processSteps` - ràng buộc tương tự bên Sắt
  (`SteelIssueStatus.IN_PROCESS`/`resolveRequiredSteps()`) **chưa từng kích hoạt trong thực tế**.
  → Quyết định: làm trọn vẹn cho **Vật tư thành phẩm** trước; **Sắt hoãn sang giai đoạn 2**, chỉ bắt
  đầu sau khi có người khai `processSteps` cho định mức Sắt.

**Thiết kế**: thêm model mới `PieceStepBundle` ("đợt gửi KCS theo công đoạn", mirror `CutBundle`
nhưng phẳng hơn - không có "cỡ đoạn") thay vì nhét thêm `step` vào `ProductionBatch` (sẽ làm
`passedByPiece` đếm trùng 1 mảnh nhiều lần qua các công đoạn). Bundle này **KHÔNG đụng**
`ProductionBatch.reportedQty` - "Chốt & gửi KCS" cuối cùng giữ nguyên là điểm DUY NHẤT sinh sản
lượng thật; bundle thuần là cổng kiểm tra chất lượng trung gian theo công đoạn.

**BE**:
- Migration `20260907060000_piece_step_bundle_qc`: model `PieceStepBundle` +
  `PieceStepBundleStatus` (`AWAITING_QC`/`QC_PASSED`), `PieceStepBatch.pieceStepBundleId` (NULL =
  đã báo nhưng chưa gửi KCS), mở CHECK `qc_reviews_goods_xor_chk` từ 2 lên 3 cột
  (`steelIssueId`/`productionBatchId`/`pieceStepBundleId`).
- `recordPieceStepBatch()`: **xoá hẳn** đoạn code chặn "vượt bước trước" (aggregate + so sánh +
  throw) - không còn `pieceStepBatch.aggregate` nào được gọi ở hàm này nữa.
- `submitPieceStep()` (mới): Phôi gom mọi `PieceStepBatch` chưa gửi (`pieceStepBundleId` NULL) của
  (order, piece, step) thành 1 bundle, khoá `lockBusinessKey` tránh gửi trùng.
- `getBatchPlan()`/`getBatchPlanBatch()`: `PieceStepProgressDto` thêm `submittedQty` (Σ mọi status)
  + `passedQty` (Σ QC_PASSED) - thay cho ràng buộc cứng đã bỏ, FE dùng để tự hiện CẢNH BÁO (không
  chặn) khi bước sau vượt bước trước, đúng tinh thần "xảy ra vấn đề mình xử lý" của Sếp.
- `qc-reviews.service.ts` thêm `reviewPieceStep()`/`reportPieceStepDone()`/`recheckPieceStep()` -
  tái dùng 100% cơ chế "Bù đủ" đã có trên `QcReview` (mục 13), không cộng gì vào đâu khi recheck
  (khác nhánh `productionBatchId` phải cộng `ProductionBatch.reportedQty`) vì bundle không sinh sản
  lượng.
- `findPieceStepBundlesForOrder()` (Phôi xem lại bundle của order mình) + `findAllPieceStepBundles()`
  (KCS, flat, có lọc status).

**Sửa giữa chừng theo phản hồi trực tiếp của người dùng khi đang live-test** (quan trọng, đổi hẳn
thiết kế ban đầu): lúc test màn duyệt, người dùng nhắc lại 1 quyết định cũ tương tự bên Sắt ("lỗi
sửa được không tính là lỗi") và xác nhận áp dụng NGAY cho Vật tư thành phẩm (Hàn/Sơn để tính sau).
`reviewPieceStep()` ban đầu tái dùng nguyên khuôn `reviewProductionBatch()` (tách sửa được/phế qua
`scrapQty` → tạo `ReplenishRequest`, giống Hàn/Sơn) - **đã sửa lại mirror ĐÚNG Sắt**
(`reviewCutBundle()`, CHỈ Đạt/Không đạt, KHÔNG có khái niệm "phế" riêng): xoá nhánh tạo
`ReplenishRequest`, `dto.scrapQty` bị bỏ qua hoàn toàn (không lưu, không validate). FE: thêm
`KcsLine.showFailMode` (override theo TỪNG DÒNG thay vì cả bảng) - dòng "công đoạn" (PieceStepBundle)
set `showFailMode: false` (ẩn 2 ô Sửa được/Phế trong modal, giống Sắt), dòng "Chốt & gửi KCS"
(ProductionBatch) giữ nguyên `showFailMode: true` (chưa đụng Hàn/Sơn).

**FE**:
- `VatTuTpDetail.tsx` (`StepPanel`): thêm khối "Chưa gửi KCS / Chờ KCS duyệt / Đã duyệt" + nút "Gửi
  KCS N mảnh" cho từng tab công đoạn. Thêm `StepBuDuPanel` (mirror `BuDuPanel` cấp "Chốt & gửi KCS"
  nhưng lọc theo đúng (pieceId, step) qua `getPieceStepBundlesForOrder()`+`getQcReviewsForPieceStepBundles()`).
- `kcsCore.tsx`/`KcsStagePage.tsx`: gộp CHUNG 1 bảng/PO cả 2 nguồn (`ProductionBatch` "Chốt & gửi
  KCS" + `PieceStepBundle` theo công đoạn) - cột "Quy cách" phân biệt bằng nhãn `"· {Công đoạn}"`.
  `map: Map<number, LineTarget>` đổi từ string sang `{kind:'batch'|'step', id}` để `onReview`/
  `onRecheck` gọi ĐÚNG API theo từng dòng.

**Kết quả kiểm tra**: `npx tsc --noEmit` sạch cả BE/FE. `npx jest` BE: 952/952 pass (thêm ~20 test
mới: `submitPieceStep`, `findAllPieceStepBundles`, `findPieceStepBundlesForOrder`, `getBatchPlan`
với `submittedQty`/`passedQty`, `reviewPieceStep`/`reportPieceStepDone`/`recheckPieceStep`, xoá 2
test cũ về ràng buộc thứ tự đã gỡ). `npx eslint --fix` sạch cả 2 repo.

Live-test qua UI thật (`tkphoi`/`tkcs`, PI-2026-054 · PAT, `processSteps=[CAT,UON,DAP]`): tab "Cắt"
hiện "Chưa gửi KCS 30" (dữ liệu cũ từ trước khi có bundle) → "Gửi KCS 30 mảnh" → KCS thấy dòng
"PAT · Cắt · lô ..." TÁCH BIỆT rõ với dòng "PAT" (Chốt & gửi KCS) trong CÙNG bảng → duyệt 5 lỗi →
modal CHỈ còn "Đạt/Không đạt" (không còn "Sửa được"/"Đề xuất làm lại") → toast "25 đạt · 5 làm lại"
(không có "cấp lại") → panel Bù đủ bên Phôi hiện đúng theo công đoạn, tách biệt "Chốt & gửi KCS" (10
mảnh không bị đụng) → Bù đủ → KCS "Duyệt lại" xác nhận đạt hết → cột "Lỗi" về "—". Đồng thời test
tab "Uốn" (gửi KCS ĐỘC LẬP dù "Cắt" vẫn còn lỗi treo) - xác nhận KHÔNG bị chặn, đúng ý "không ràng
buộc thứ tự".

**Chưa làm / lưu ý cho lần sau**:
- **Sắt giai đoạn 2**: cần ai đó khai `processSteps` cho định mức (`piece_bom`) trước, sau đó mới gỡ
  `resolveRequiredSteps()`/`SteelIssueStatus.IN_PROCESS` và nâng công đoạn Sắt từ cờ boolean lên có
  số lượng (`StepBatch.cutBundleId` đã có sẵn cột dự phòng).
- **Hàn/Sơn**: `reviewProductionBatch()` vẫn giữ nguyên tách "sửa được/phế" như cũ - "tính sau" theo
  đúng lời người dùng, CHƯA áp dụng thay đổi "sửa được không tính là lỗi" cho nhánh này.
- Chưa test path 1 piece có NHIỀU `PieceStepBundle` outstanding cùng lúc (nhiều công đoạn cùng lỗi) -
  `StepBuDuPanel` đã code sẵn hiện danh sách nhiều dòng nhưng chưa có dữ liệu thật để live-test.

## 15. Màn "Ma trận mảnh × công đoạn" (VTTP) + dữ liệu test cho Sắt giai đoạn 2 (2026-09-07)

Theo yêu cầu người dùng ("làm luôn màn ma trận" + "làm lại định mức test sơ vài công đoạn").

**Ma trận mảnh × công đoạn** - `PieceStepMatrix` (mới, `LenhSanXuatPhoi.tsx`), thêm tab "Ma trận"
trong `PiDetail` (chỉ hiện khi PI có ≥1 mảnh VTTP đã khai `processSteps`, dùng lại data đã có sẵn
từ `getBatchPlan()` - không gọi API mới). Hàng = mảnh, cột = union `processSteps` của mọi mảnh
trong PI (theo đúng thứ tự `PROCESS_STEPS`), ô = `passedQty/requiredQty` (xanh = đủ, cam = đang
làm, xám = chưa có gì), tự hiện icon cảnh báo (không chặn) khi 1 bước đã BÁO (`doneQty`) vượt số
bước LIỀN TRƯỚC đã ĐƯỢC KCS DUYỆT (`passedQty`) - đúng cơ chế "công cụ thay ràng buộc thứ tự đã bỏ"
đã đề xuất trước đó. Bấm 1 dòng điều hướng thẳng vào `VatTuTpDetail` của mảnh đó. Live-test qua UI
thật (PI-2026-054): 2 mảnh hiện đúng ("Chan ban A" chỉ có cột Cắt/Tán vì không khai Uốn/Dập, "PAT"
ngược lại có Cắt/Uốn/Dập không có Tán, đúng từng mảnh khai khác tập công đoạn nhau), bấm dòng PAT
điều hướng đúng vào chi tiết.

**Dữ liệu test cho Sắt giai đoạn 2** - xác nhận lại: `piece_bom` (Sắt) vẫn 0 dòng khai `processSteps`
qua UI thường (`SpecSteelPage.tsx`, vai `SPEC_STEEL`) vì **mọi `BomRevision` hiện có đều đã `ACTIVE`**
(không còn bản nháp `DRAFT` nào để sửa - trang chỉ cho sửa lúc còn nháp, xem comment "sửa nháp,
chưa gửi phê duyệt" trong `SpecSteelPage.tsx`) - thử mở 1 SKU test qua UI xác nhận đúng bị khoá
(không có checkbox công đoạn, chỉ có "Thông báo duyệt"). Thay vì mở lại vòng đời duyệt định mức
(việc lớn, không phải yêu cầu), set trực tiếp `processSteps` cho 3 dòng `piece_bom` thuộc 3 SKU TEST
sẵn có (không đụng SKU thật đang sản xuất):
- `piece_bom.id=43` (TEST-GHE-B · Khung ghế B · Sắt vuông 30x30): `['CAT','UON']`
- `piece_bom.id=44` (TEST-KE-C · Trụ kệ C · Sắt vuông 30x30): `['CAT','UON','DUC_LO']`
- `piece_bom.id=50` (TEST-BAN-A · Chan ban A · Sắt vuông 50x50): `['CAT','TAN']`

**Cập nhật cùng ngày - đã LIVE-TEST được cơ chế CŨ (hard-block) với dữ liệu thật, lần đầu tiên**:
3 dòng test ở trên (TEST-GHE-B/TEST-KE-C/TEST-BAN-A) chưa có đợt cắt sẵn nên chưa test qua UI được
ngay - thay vào đó set thêm `piece_bom.id=3` (**J55 · "chân bàn" · Sắt vuông 50x50 · 660mm**,
`processSteps=['CAT','UON']`) vì PO-52/PI-2026-051 (SKU J55) đã có sẵn 1 `CutBundle` đang `CUTTING`
cho đúng vật tư này (không cần xuất sắt mới). Live-test qua UI thật (`tkphoi`/`tkcs`):
1. Vào đợt cắt "Sắt vuông 50x50" của PO-52 - nút "Xong Uốn" xuất hiện đúng (trước đây KHÔNG THỂ
   xuất hiện vì `resolveRequiredSteps()` luôn trả `[CAT]` khi mọi `piece_bom.processSteps` rỗng).
2. Bấm "Báo cắt xong" TRƯỚC khi đánh dấu Uốn - nút này đã **tự disabled** phía FE
   (`missingSteps.length > 0`, xem `LenhSanXuatPhoi.tsx`), xác nhận network KHÔNG có request nào
   được gửi (kiểm bằng `read_network_requests`) - hành vi CHẶN đúng như thiết kế, và đây là LẦN ĐẦU
   TIÊN cơ chế này chạy với dữ liệu thật (44 dòng piece_bom trước đó đều rỗng, code này chưa từng
   được thực thi ngoài unit test).
3. Bấm "Xong Uốn" → nút "Báo cắt xong" bật lại → bấm → đợt chuyển "chờ KCS" thành công.
4. KCS duyệt đạt (`tkcs`) → đợt "Sắt vuông 50x50 · 3×660mm" chuyển "đạt" đúng.

**Chưa làm / lưu ý cho lần sau**:
- Test trên xác nhận **cơ chế CŨ** (chặn cứng "phải xong hết mọi công đoạn mới gửi KCS") vẫn hoạt
  động đúng với dữ liệu thật - nhưng đây CHÍNH LÀ cơ chế mục 14 đã BỎ cho nhánh VTTP. Sắt hiện
  KHÔNG NHẤT QUÁN với quyết định "không ràng buộc thứ tự" - vẫn còn chặn.
- **Sắt giai đoạn 2 (code bỏ chặn + mirror PieceStepBundle) vẫn CHƯA làm** - test trên chỉ xác nhận
  hành vi HIỆN CÓ chạy đúng với dữ liệu thật, KHÔNG PHẢI đã áp dụng quyết định "không ràng buộc thứ
  tự" cho Sắt. Việc thật còn lại: gỡ `resolveRequiredSteps()`/`SteelIssueStatus.IN_PROCESS`, nâng
  công đoạn Sắt từ cờ boolean (`CutBundle.completedSteps`) lên có số lượng (`StepBatch.cutBundleId`
  đã có sẵn cột dự phòng), mirror `PieceStepBundle` cho nhánh Sắt. Đã có sẵn 4 dòng dữ liệu test
  (piece_bom id=3/43/44/50) để live-test ngay khi làm xong - KHÔNG cần chuẩn bị lại.
- 3 dòng TEST-GHE-B/TEST-KE-C/TEST-BAN-A vẫn chưa có đợt cắt nào gắn vào để test qua UI (PI-2026-054
  của TEST-BAN-A cần có `CuttingProposal` được duyệt trước - chưa làm) - chỉ J55 (`piece_bom.id=3`)
  đã được live-test thật qua UI.

## 16. Sắt giai đoạn 2 — công đoạn phụ (Uốn/Dập/Tán/...) gửi KCS RIÊNG qua `StepBundle` (2026-09-07) — ĐỔI SCOPE LẦN 2 ở mục 17

### 16.1. Vì sao làm

Trong lúc test lại cơ chế CŨ ở mục 15 (nút "Xong Uốn" tự khai, không qua KCS), người dùng góp ý
trực tiếp: *"ví dụ để button xong uốn, xong tán, xong ... vậy thấy kì kì không, mà mỗi cái qua KCS
riêng nên tôi nghỉ nên để riêng ra không, ví dụ Cắt xong thì qua KCS, qua từng công đoạn thì đều
phải qua KCS"*. Hỏi lại có làm ngay không → **"Làm ngay"**. Cùng tinh thần quyết định mục 14 (VTTP)
nhưng áp dụng cho Sắt: mỗi công đoạn (kể cả Cắt) tự đi qua KCS độc lập, không chờ nhau.

### 16.2. Thiết kế — `StepBundle` mirror `CutBundle`/`PieceStepBundle`

Model mới `StepBundle` (`StepBundleStatus`: `AWAITING_QC`/`QC_PASSED`) - "đợt gửi KCS" cho 1 CÔNG
ĐOẠN PHỤ của 1 `CutBundle` cụ thể. Khác `PieceStepBundle` (VTTP dùng số lượng phẳng, không có "cỡ
đoạn"): `StepBundle` bóc theo CỠ ĐOẠN qua `StepBatchSegment` (bảng này đã có sẵn từ 2026-08-27,
trước đó bị đơn giản hoá về boolean-only ở 2026-09-05 vì lúc đó chưa có dữ liệu thật để test - nay
dùng lại được nhờ 4 dòng `piece_bom` test đã set ở mục 15).

- `StepBatch.stepBundleId` (nullable FK) - Phôi gom các `StepBatch` CHƯA gửi (`stepBundleId NULL`)
  của (cutBundleId, step) thành 1 `StepBundle` rồi gửi KCS 1 lần.
- `QcReview.stepBundleId` (nullable, **KHÔNG nằm trong** `qc_reviews_goods_xor_chk`) - CÙNG cách
  `cutBundleId` đã dùng: cột lọc PHỤ, dòng review vẫn ghi `steelIssueId` là leg XOR chính. Nhờ vậy
  tái dùng NGUYÊN VẸN `reportSegmentDoneForRow()`/`recheckForReview()`/
  `findLatestReviewSegmentOrThrow()` (chỉ thêm 1 nhánh scope), không phải viết lại logic Bù đủ/
  Duyệt lại.
- KCS chấm `StepBundle` CHỈ Đạt/Không đạt (`reviewStepBundle()`, mirror `reviewCutBundle()`) -
  KHÔNG có "sửa được/phế" - đúng hành vi GỐC của Sắt, không phải quy tắc mới (khác VTTP ở mục 14 vốn
  phải SỬA lại từ 3-way về 2-way theo góp ý người dùng cùng ngày).

**Bỏ hẳn cơ chế cũ**: `SteelIssuesService.finishCutting()`/`completeStep()` (issue-level,
`IN_PROCESS`/`finish-cutting` không còn đường nào tới được từ 2026-09-05, xác nhận 0 FE caller) và
`completeBundleStep()` (bundle-level, cờ tự khai không qua KCS) - xoá hẳn, không giữ lại tương thích
ngược. `finishCutBundle()` bỏ luôn check chặn `missing.length > 0` (không còn gọi
`resolveRequiredSteps()` để chặn nữa - hàm này vẫn giữ lại làm tham khảo hiển thị). `recordStepBatch()`
viết lại: đổi scope từ `steelIssueId` sang `cutBundleId` (route `POST cut-bundles/:id/step-batches`,
trước là `POST steel-issues/:id/step-batches`) - "đã cắt" đối chiếu giờ lấy từ ĐÚNG `CutBundle.segments`
của đợt đó, không phải gộp PI-wide như code cũ (tránh 1 công đoạn phụ "mượn" số liệu cắt của đợt khác
cùng PI). Route mới `POST cut-bundles/:id/step-bundles` (`submitStepBundle`) gom batch → tạo bundle.

**Migration** `20260907080000_step_bundle_qc` (additive-only, đúng idiom repo): bảng `step_bundles`
+ cột `stepBundleId` trên `step_batches`/`qc_reviews` (FK `ON DELETE SET NULL`) - KHÔNG đụng CHECK
constraint XOR hiện có (đúng như `cutBundleId` không đụng).

### 16.3. Frontend

- **`steel-issues-api.ts`**: xoá `finishCutting`/`completeStep`/`completeBundleStep`; `BeCutBundle`
  thêm `stepBundles: BeStepBundle[]`; `recordStepBatch` đổi route/tham số theo `cutBundleId`; thêm
  `submitStepBundle`/`reviewStepBundleQc`/`reportSegmentDoneForStepBundle`/`recheckQcForStepBundle`;
  `BeQcReview` thêm `stepBundleId`.
- **`LenhSanXuatPhoi.tsx`** (`CutBundleCard`): bỏ hẳn khối "Xong {step}" + việc chặn "Báo cắt xong"
  theo `missingSteps`. Thêm `StepBundleSection` (mới) cho MỖI công đoạn phụ bắt buộc, hiện BẤT KỂ
  `bundle.status` (không còn ràng buộc thứ tự với Cắt) - nhập số lượng theo cỡ đoạn rồi "Gửi KCS"
  **gộp 1 lần bấm** (`recordStepBatch` + `submitStepBundle` gọi nối tiếp), khác Cắt (tách riêng "Lưu
  đợt cắt"/"Báo cắt xong" 2 hành động) vì chưa có nguồn dữ liệu nào đọc được "đã lưu nhưng CHƯA gửi"
  theo đúng đợt cắt (Cắt đọc PhoiProgress PI-wide, StepBundle thì không có tương đương) - nếu sau
  này cần nhập rải nhiều lần trong ca mới tách lại. "Bù đủ" cho lỗi công đoạn phụ bấm NGAY tại
  `StepBundleSection` (không dồn về bảng tổng như lỗi Cắt, vì không có bảng tổng nào gộp theo công
  đoạn phụ).
- **`KcsPhoiPage.tsx`**: `Row` (union `CutRow | StepRow`) gộp CẢ đợt Cắt lẫn đợt công đoạn phụ vào
  1 danh sách chờ kiểm chung theo PO (thêm cột "Công đoạn"). Tổng quát hoá `QcReviewModal`/
  `RecheckModal` (nhận `id`/`segments`/`onReview`/`onRecheck` thay vì bám cứng `bundle`) - dùng
  chung được cho cả `CutBundle` và `StepBundle`, không chép lại nguyên modal.

### 16.4. Kết quả kiểm tra

- Backend: `npx tsc --noEmit` sạch, `npx eslint ... --fix` sạch (chỉ format lại), **959/959 test
  pass** (47 suites) - gồm `describe('recordStepBatch (viết lại theo cutBundleId)')` (7 test),
  `describe('submitStepBundle')` (4 test), `describe('reviewStepBundle')` (5 test),
  `describe('reportSegmentDoneForStepBundle / recheckForStepBundle')` (3 test); xoá hẳn các test cũ
  của `finishCutting`/`completeStep`/`completeBundleStep`.
- Frontend: `npx tsc --noEmit` sạch, `npx eslint ... --fix` sạch (1 warning `no-img-element` có
  từ trước, không liên quan).
- **Live-test qua UI thật** (`tkphoi`/`tkcs`, PO-52 · Sắt vuông 50x50, đợt cắt đã QC_PASSED sẵn từ
  mục 15): vào đợt "Đợt 1" (5×660mm) → panel "Uốn" hiện đúng dù đợt CHA đã QC_PASSED (xác nhận
  không còn ràng buộc thứ tự) → nhập 5, bấm "Gửi KCS" → tạo `StepBundle` mới "chờ KCS" thành công.
  Sang `tkcs`: `KcsPhoiPage` hiện đúng dòng "Sắt vuông 50x50 / Uốn / 5×660mm / chờ kiểm" GỘP CHUNG
  với các dòng "Cắt" khác cùng PO → "Tiến hành duyệt" chấm 2/5 không đạt (modal xác nhận CHỈ có ô
  "Không đạt", KHÔNG có "phế/sửa được" - đúng thiết kế) → xác nhận, dòng chuyển "Lỗi 2 đoạn". Sang
  `tkphoi`: `StepBundleSection` hiện đúng "lỗi 2 (660mm) · chờ KCS duyệt lại" + nút "Bù đủ" → bấm,
  input tự gợi ý sẵn "2" → xác nhận → hiện "chờ KCS duyệt lại". Sang `tkcs`: "Duyệt lại" → modal
  prefill "Còn hỏng: 0" (đúng - Phôi khai đã sửa hết 2/2) → xác nhận → dòng chuyển "✓ đạt". Vòng đời
  đầy đủ gửi KCS → lỗi → Bù đủ → duyệt lại → đạt chạy đúng end-to-end với dữ liệu thật.

### 16.5. Chưa làm / lưu ý cho lần sau

- 3 dòng TEST-GHE-B/TEST-KE-C/TEST-BAN-A (mục 15) vẫn chưa có đợt cắt để live-test StepBundle qua
  UI - chỉ J55 (`piece_bom.id=3`) đã test. Không chặn gì (đã test đủ luồng qua J55), chỉ là chưa phủ
  hết dữ liệu test đã chuẩn bị.
- "Gửi KCS" ở `StepBundleSection` gộp record+submit 1 lần bấm (không tách "lưu nhiều đợt trong ca
  rồi mới gửi" như Cắt) - nếu sau này Phôi cần nhập rải nhiều lần trong ca trước khi gửi, phải thêm
  1 nguồn dữ liệu đọc "đã lưu nhưng chưa gửi" theo đúng (cutBundleId, step) trước (hiện chưa có).

## 17. `StepBundle` đổi scope PI-wide (lần 2) + bỏ hẳn "Bù đủ → KCS duyệt lại" cho Cắt/StepBundle/VTTP (2026-09-08)

### 17.1. Vì sao làm

Sếp Trương Văn Nhân xem UI thật của mục 16 (StepBundle gắn với 1 `CutBundle` cụ thể) rồi phản hồi
qua chat + note tay: các công đoạn Phôi (đủ 7 công đoạn - Cắt/Uốn/Dập/Đục lỗ/Tán/Tóp đầu/Xẻ) phải
làm được **song song, không tuần tự** - số liệu mỗi công đoạn đã tính sẵn theo định mức nên Phôi
"chỉ cần đếm rồi gõ số vào bảng tổng", không cần biết/chọn đúng đợt cắt nào ra đoạn đó. Khi hỏi lại
mâu thuẫn "không tuần tự thì sao biết lỗi thuộc đợt nào", Sếp làm rõ điểm chốt: *"giờ sếp muốn bù đủ
không thể hiện trong từng đợt mà thể hiện trên bảng tổng, số lượng lỗi sẽ được cộng dồn của tất cả
các đợt và khi bù đủ sẽ tạo 1 đợt mới riêng cho số lượng bù"* - tức "Lỗi" ở bảng tổng là số CỘNG DỒN
cả PI (không gắn đợt cụ thể), còn "Bù đủ" không sửa lại lỗi cũ mà tạo hẳn 1 đợt MỚI gửi KCS như bình
thường. Áp dụng cho CẢ Sắt lẫn VTTP (2 nhánh dùng chung 7 công đoạn này khi mảnh có khai
`processSteps`). Xác nhận thêm: "đợt" (CutBundle/StepBundle/PieceStepBundle riêng lẻ) từ nay là
LỊCH SỬ THUẦN - không còn nút thao tác nào, mọi hành động dồn về bảng tổng.

Hệ quả trực tiếp: cơ chế "Bù đủ → KCS duyệt lại" (report-done/recheck) tồn tại chỉ để cột "Lỗi" tự
giảm về 0 theo đúng đợt - nhưng giờ "Lỗi" là số lịch sử không tự giảm (chỉ "Còn lại" mới quan trọng,
tự về đúng khi đợt bù mới qua KCS đạt) nên cơ chế này KHÔNG còn lý do tồn tại - bỏ hẳn, không giữ lại
tương thích ngược.

### 17.2. Phạm vi chốt với người dùng

1. `StepBundle` đổi hẳn từ scope `cutBundleId` (mục 16) sang PI + loại sắt (mirror `PieceStepBundle`)
   - không còn biết/cần biết đúng đợt cắt nào. `CutBundle` (Cắt) giữ NGUYÊN model/lifecycle (mỗi lần
   "Lưu đợt cắt" vẫn là 1 `CutBundle` riêng, KCS vẫn duyệt từng `CutBundle`) - chỉ đổi UI: nút "Báo
   cắt xong"/"Gửi KCS" dời từ từng `CutBundleCard` lên bảng tổng, tự nhắm đúng đợt `CUTTING` đang mở
   (luôn tối đa 1 đợt tại 1 thời điểm).
2. "Các đợt" (lịch sử) lùi hẳn về THUẦN XEM - cả Cắt lẫn Uốn/Dập/... không còn nút bấm nào (kể cả
   "Bù đủ" đang có ở `StepBundleSection` mục 16) - chỉ hiện số liệu để chẩn đoán.
3. Bỏ hẳn report-done/recheck cho: Sắt (`reportSegmentDone`/`reportSegmentDoneForBundle`/
   `reportSegmentDoneForStepBundle` + `recheck`/`recheckForBundle`/`recheckForStepBundle`) và VTTP
   (`reportPieceStepDone`/`recheckPieceStep`). **Giữ nguyên** `reportProductionBatchDone`/
   `recheckProductionBatch` (`ProductionBatch`/chốt cuối, Hàn/Sơn/VTTP dùng chung, ngoài phạm vi).
4. Thay bằng: bảng tổng mỗi công đoạn hiện cột "Lỗi" (cộng dồn lịch sử) + nút "Bù đủ" xuất hiện khi
   `Còn lại > 0 VÀ Lỗi > 0` - bấm chỉ pre-fill số lượng vào ô nhập (client-side, KHÔNG gọi API) - Phôi
   vẫn tự gõ/sửa số rồi bấm "Gửi KCS"/"Lưu đợt" bình thường qua ĐÚNG 1 luồng duy nhất.

### 17.3. Data model

Migration `20260908010000_step_bundle_pi_wide_and_remove_bu_du` (dev DB không có dữ liệu thật ở các
bảng này - đã xác nhận + dọn sạch 1 dòng test `StepBundle`/`StepBatch`/`QcReview` do live-test mục 16
tạo ra trước khi ALTER, không cần backfill):

- `StepBundle`/`StepBatch`: xoá `cutBundleId`/`steelIssueId` + relation, thêm `productionInvoiceId` +
  `materialId` + relation tương ứng (`ProductionInvoice`, `Material`), đổi index theo
  `[productionInvoiceId, materialId, step]`. `StepBatch.stepBundleId` giữ nguyên.
- `QcReviewSegment`: xoá hẳn 3 cột `resolvedQty`/`phoiReportedAt`/`phoiReportedQty` - chỉ còn
  `failedQty` (lịch sử, không sửa sau khi tạo).
- `QcReview`: mở rộng CHECK XOR `qc_reviews_goods_xor_chk` thêm `stepBundleId` làm leg thứ 4 (mirror
  `pieceStepBundleId`) - từ nay `reviewStepBundle()` tạo `QcReview` CHỈ ghi `stepBundleId` (không còn
  kèm `steelIssueId` như mục 16, vì `StepBundle` không còn thuộc đúng 1 `SteelIssue` nào). Cột
  `resolvedQty`/`phoiReportedAt`/`phoiReportedQty` TRÊN BẢNG `QcReview` (khác `QcReviewSegment`) GIỮ
  NGUYÊN - vẫn dùng cho nhánh `productionBatchId` (Hàn/Sơn/VTTP chốt).

### 17.4. Backend

- **Sắt** (`steel-issues.service.ts`): `recordStepBatch`/`submitStepBundle` đổi chữ ký sang
  `(productionInvoiceId, materialId, ...)`; validate `segmentSpecId` thêm điều kiện đúng `materialId`;
  "đã cắt"/"đã Uốn/Dập..." tính PI+material-wide (không còn qua 1 `CutBundle` cụ thể). Thêm
  `findStepBundlesForInvoice`/`findAllStepBundles` (mirror `findPieceStepBundlesForOrder`/
  `findAllPieceStepBundles` bên VTTP). Route đổi `POST/GET production-invoices/:id/step-batches`,
  `POST/GET production-invoices/:id/step-bundles`, thêm `GET step-bundles` (flat, cho KCS).
  `getPhoiProgress`/`getStepProgress`: bỏ `resolvedQty` khỏi tính `failedBySpec` (cộng thẳng
  `failedQty`) - tiện thể sửa luôn 1 bug thật còn sót: `getStepProgress` trước đây KHÔNG lọc theo
  `step` khi tính lỗi (cộng dồn lỗi mọi công đoạn vào 1 số), giờ lọc đúng qua
  `qcReview: { stepBundle: { productionInvoiceId, step } }`.
- **`qc-reviews.service.ts`**: xoá hẳn `reportSegmentDone(ForBundle/ForStepBundle)`,
  `recheck(ForBundle/ForStepBundle)`, `reportPieceStepDone`, `recheckPieceStep` + 3 helper dùng chung
  (`reportSegmentDoneForRow`, `recheckForReview`, `findLatestReviewSegmentOrThrow`) - không còn nơi
  nào gọi, xoá sạch không để lại dead code. `reviewStepBundle()` viết lại theo scope PI-wide (không
  còn qua `cutBundle.steelIssue`). Controller: xoá 8 route report-done/qc-recheck tương ứng (Sắt +
  VTTP piece-step-bundle-level), GIỮ NGUYÊN 2 route `production-batches/:id/qc-report-done`/
  `qc-recheck`. Xoá DTO `ReportSegmentDoneDto`/`QcRecheckDto` (chỉ dùng bởi code vừa xoá).
- **VTTP** (`production-batches.service.ts`): `PieceStepProgressDto` thêm `failedQty` (Σ
  `QcReview.failedQty` theo (productionOrderId, pieceId, step), không trừ gì); `getStepBundleMaps`
  thêm map `failed` (query `qcReview.findMany` mới).

### 17.5. Frontend

- **`LenhSanXuatPhoi.tsx`** (rewrite lớn nhất): `NewCutBundleForm` bỏ hẳn `BuDuPopup`/
  `findBuDuRowsForSegment`/`allocateQty` (gọi API riêng) - "Bù đủ" giờ chỉ `setInputQty` pre-fill;
  thêm nút "Gửi KCS" cạnh "Lưu đợt cắt" (nhắm đúng đợt `CUTTING` đang mở). `CutBundleCard` giảm còn
  THUẦN XEM (bỏ nút "Báo cắt xong"). Component `StepBundleForm` mới (thay `StepBundleSection` mục 16)
  đặt ở cấp `MaterialGroupDetail` - PI-wide, dùng chung `ProgressBuDuTable` (component tách mới, tránh
  chép lại bảng Cần/Đã/Lỗi/Còn lại + logic Bù đủ giữa Cắt và từng công đoạn phụ) + `StepBundleHistoryCard`
  thuần xem bên dưới.
- **`KcsPhoiPage.tsx`**: `StepRow` đổi nguồn từ duyệt `bundle.stepBundles` (mục 16, đã xoá khỏi BE)
  sang gọi thẳng `api.getAllStepBundles()`, group theo `stepBundle.productionInvoiceId`. Xoá hẳn
  `RecheckModal`/`hasAwaitingRecheck`/nút "Duyệt lại" - mọi đợt (Cắt lẫn công đoạn phụ) giờ chỉ còn
  ĐÚNG 1 lượt duyệt qua `QcReviewModal` (không đổi). QC_PASSED có lỗi lịch sử vẫn hiện "đạt (lỗi N
  đoạn)" thuần thông tin, không có hành động nào kèm theo.
- **`VatTuTpDetail.tsx`**: xoá hẳn `StepBuDuPanel`; `StepPanel` thêm cột "Lỗi" + nút "Bù đủ" inline
  (điều kiện `failedQty > 0 && remaining > 0`, pre-fill qty, không gọi API) - cùng idiom với Sắt.
  `BuDuPanel` (báo bù cho `ProductionBatch` đã chốt, Hàn/Sơn/VTTP) **giữ nguyên hoàn toàn** - ngoài
  phạm vi mục này.
- `steel-issues-api.ts`/`production-batches-api.ts`: xoá 8 hàm gọi report-done/recheck đã bỏ ở BE;
  `BeStepBundle` đổi field theo scope mới; `BeCutBundle` bỏ `stepBundles`; `BeQcReviewSegment` bỏ 3
  field đã xoá; `BePieceStepProgress` thêm `failedQty`; thêm `getStepBundlesForInvoice`/
  `getAllStepBundles`.

### 17.6. Kết quả kiểm tra

- Backend: `npx tsc --noEmit` sạch, `npx jest` **47/47 suite · 939/939 test pass** (đã cập nhật
  `steel-issues.service.spec.ts` theo chữ ký `recordStepBatch`/`submitStepBundle` mới, xoá hẳn
  `describe('reportSegmentDone...')`/`describe('recheck...')`/`describe('reportPieceStepDone...')`/
  `describe('recheckPieceStep...')` trong `qc-reviews.service.spec.ts`, thêm mock `qcReview.findMany`
  + field `failedQty` còn thiếu trong `production-batches.service.spec.ts`).
- Frontend: `npx tsc --noEmit` sạch cả repo; `npx eslint` sạch trên mọi file đã sửa (chỉ 1 warning
  `no-img-element` có từ trước, không liên quan).
- **Live-test qua UI thật** (`tkphoi`/`tkcs`, PO-52 · Sắt vuông 50x50, có sẵn "Lỗi 2 đoạn" lịch sử từ
  dữ liệu cũ): bảng tổng Cắt hiện đúng "Lỗi 2 · Còn lại 2" + nút "Bù đủ" → bấm → ô "Nhập đợt này" tự
  điền "2" (client-side, không gọi API) → "Lưu đợt cắt" tạo Đợt 3 mới (CUTTING) → "Còn lại" về 0,
  "Lỗi" giữ nguyên 2 (không tự giảm, đúng thiết kế) → nút "Gửi KCS" xuất hiện cạnh "Lưu đợt cắt" →
  bấm → Đợt 3 chuyển "chờ KCS". Bảng tổng Uốn (PI-wide, KHÔNG cần chọn đợt cắt nào): nhập 8, "Gửi
  KCS" → tạo `StepBundle` mới "chờ KCS" thành công, "Còn lại" về 0. "Các đợt cắt"/"Các đợt đã gửi"
  bên dưới xác nhận THUẦN XEM - không còn nút nào. Sang `tkcs`: `KcsPhoiPage` hiện đúng cả 2 dòng
  "chờ kiểm" (Cắt + Uốn) gộp chung 1 danh sách, không có "Duyệt lại"/RecheckModal ở đâu cả → duyệt cả
  2 qua đúng `QcReviewModal` (Đạt/Không đạt) → cả 2 chuyển "đạt", PO-52 về "đã duyệt hết". Xác nhận
  code `StepPanel` (VTTP) đúng idiom (`failed > 0 && remaining > 0` → pre-fill) qua đọc mã nguồn - dữ
  liệu test VTTP hiện có đều `Còn lại = 0` nên nút "Bù đủ" không có cơ hội hiện trên UI thật (đúng
  hành vi gate, không phải lỗi).

### 17.7. Chưa làm / lưu ý cho lần sau

- ~~Không tìm được dữ liệu test VTTP nào đang có `Còn lại > 0 VÀ Lỗi > 0` cùng lúc để chụp trực tiếp
  nút "Bù đủ" ở `StepPanel` trên UI~~ - **ĐÃ XONG** (xem mục 17.8 bên dưới, cùng ngày).

### 17.8. Bổ sung live-test "Bù đủ" cho VTTP với `Còn lại > 0 VÀ Lỗi > 0` thật (2026-09-08, tiếp)

Theo yêu cầu người dùng ("tạo định mức mới và test luôn"): `piece_bom`/`piece_material_yield` không
sửa được qua UI thường vì mọi `BomRevision` đều đã `ACTIVE` (giống lý do đã ghi ở mục 15) - dùng lại
đúng tiền lệ đó, set trực tiếp qua script `ts-node` một lần (xoá ngay sau khi chạy, không để lại
trong repo): `piece_material_yield.id=12` (SKU TEST-BAN-A · mảnh "Chân Nhôm" · vật tư "Thanh nhôm
2m", đã có sẵn trong PI-2026-054 với "Cần 10 mảnh") - đổi `processSteps` từ `[]` thành `['CAT','UON']`
(trước đó hiện "chưa khai công đoạn").

**Live-test qua UI thật** (`tkphoi`/`tkcs`/`qlsx`, PI-2026-054 · Chân Nhôm):
1. `qlsx` xác nhận qua "Danh sách SKU" → TEST-BAN-A: dòng "Chân Nhôm" đổi từ "—" sang hiện đúng 2 chip
   "Cắt"/"Uốn" ở cột "Công đoạn phôi" ngay sau khi set - không cần deploy lại/restart gì.
2. `tkphoi`: tab "Cắt" hiện đúng Cần 10/Còn lại 10 → nhập 10, "Lưu đợt" → "Gửi KCS 10 mảnh" → "Chờ
   KCS duyệt 10".
3. `tkcs` (màn "Vật tư TP"): dòng "Chân Nhôm · Cắt" mới xuất hiện đúng trong danh sách chờ duyệt →
   "Tiến hành duyệt" → nhập "Số lượng chưa đạt" = 3, chọn nguyên nhân có sẵn → xác nhận → dòng
   chuyển "đã duyệt".
4. `tkphoi`: tab "Cắt" hiện đúng **Lỗi 3 · Còn lại 3** + nút **"Bù đủ"** (trước đây CHƯA từng thấy
   render trên UI thật, chỉ xác nhận qua đọc code) → bấm → ô "Nhập đợt này" tự điền **"3"** (đúng
   `min(failed, remaining) = min(3,3) = 3`, client-side, `read_network_requests` xác nhận KHÔNG có
   request nào bắn ra lúc bấm) → "Lưu đợt" → Đã cắt 13, Còn lại 0, **Lỗi vẫn giữ 3** (không tự giảm,
   đúng thiết kế "Lỗi là số lịch sử cộng dồn") → "Gửi KCS 3 mảnh" → "Chờ KCS duyệt 3".
5. `tkcs`: duyệt đạt đợt bù (0 chưa đạt) → "đã duyệt".
6. `tkphoi`: xác nhận cuối - Cần 10 · Đã cắt 13 · **Lỗi 3** (lịch sử, không đổi) · **Còn lại 0** ·
   Đã duyệt 13. Vòng đời đầy đủ Bù đủ (VTTP) chạy đúng end-to-end với dữ liệu thật, cùng hành vi với
   nhánh Sắt đã test ở mục 17.6.

Không có thay đổi code nào ở bước này - chỉ set dữ liệu test + live-test xác nhận lại code đã viết ở
mục 17 chạy đúng.

## 18. `MaterialGroupDetail` (Sắt): công đoạn chuyển thành TAB, "Các đợt cắt" dời lên sau bảng Cắt (2026-09-08)

### 18.1. Vì sao làm

Trong lúc xem live-test mục 17.8, người dùng chỉ ra 1 điểm UX khó hiểu: khối lịch sử "Các đợt đã gửi
(N)" (của công đoạn phụ, vd Uốn) và "Các đợt cắt (N)" (của Cắt) nằm SÁT NHAU trên màn hình dù thuộc 2
công đoạn khác nhau - vì `MaterialGroupDetail` (`LenhSanXuatPhoi.tsx`) trước đây XỔ DỌC hết mọi bảng
tổng (Cắt → Uốn → Dập → ...) rồi mới tới "Các đợt cắt" ở CUỐI CÙNG (sau tất cả). Người dùng xác nhận
muốn: (1) "Các đợt cắt" dời lên ngay sau bảng Cắt cho nhất quán với Uốn/Dập (mỗi công đoạn - bảng
tổng - lịch sử riêng ngay dưới), và (2) đổi hẳn cách hiển thị công đoạn từ xổ dọc sang **tab bấm
chuyển qua lại ở đầu trang** (mirror `VatTuTpDetail.tsx` đã làm y hệt cho VTTP, dùng chung
`subFilterBtn`).

### 18.2. Đã sửa

`MaterialGroupDetail` (`LenhSanXuatPhoi.tsx`): thêm state `activeStep: 'CAT' | ProcessStep`, dải tab
`{Cắt, ...secondarySteps}` render bằng `subFilterBtn` (CHỈ hiện dải tab khi có ≥1 công đoạn phụ - vật
tư không khai `processSteps` nào ngoài Cắt thì không có gì để chuyển, ẩn hẳn tab cho gọn). Bấm 1 tab
chỉ hiện ĐÚNG bảng tổng + lịch sử của công đoạn đó:
- Tab "Cắt": `NewCutBundleForm` + "Các đợt cắt" (lịch sử `CutBundleCard`) - dời từ vị trí CUỐI TRANG
  (sau mọi tab phụ) lên NGAY DƯỚI bảng tổng Cắt, cùng 1 khối.
- Tab công đoạn phụ: `StepBundleForm` (đã tự có "Các đợt đã gửi" bên trong) - bỏ heading tên công
  đoạn lặp lại trong `StepBundleForm` (vd chữ "Uốn" in đậm phía trên bảng) vì tên đã hiện ở chính nút
  tab đang bấm, giữ 2 chỗ trùng chữ không cần thiết.

### 18.3. Kết quả kiểm tra

- `npx tsc --noEmit` sạch, `npx eslint` sạch (0 lỗi/cảnh báo mới).
- **Live-test qua UI thật** (`tkphoi`, PO-52 · Sắt vuông 50x50 - có sẵn 2 công đoạn Cắt+Uốn từ dữ
  liệu test): dải tab "Cắt"/"Uốn" hiện đúng ở đầu trang; tab "Cắt" hiện bảng tổng Cắt + "Các đợt cắt
  (3)" ngay bên dưới (không còn lẫn với lịch sử Uốn); bấm tab "Uốn" chuyển sạch sang bảng tổng Uốn +
  "Các đợt đã gửi (1)" riêng, không còn sót nội dung Cắt. Test thêm "Sắt hộp 25x50" (material chỉ
  khai mỗi Cắt, không có công đoạn phụ nào) - xác nhận dải tab tự ẩn hoàn toàn khi không có gì để
  chuyển, "Bù đủ" (Lỗi 1 · Còn lại 1) vẫn hoạt động bình thường không bị ảnh hưởng.

## 19. `CutBundleCard`: bỏ badge trạng thái "Lỗi N đoạn"/"đã duyệt" khỏi từng Đợt (2026-09-08)

Người dùng xem trực tiếp lịch sử "Các đợt cắt" (mục 18) rồi góp ý: mỗi thẻ "Đợt N" không cần hiện
badge "Lỗi N đoạn" (đỏ)/"đã duyệt" (xanh) ở góc phải nữa - khối này giờ CHỈ để xem lại số liệu
(`CutBundleCard`, xem doc comment mục 17.2), số Lỗi từng cỡ đoạn đã có sẵn trong bảng chi tiết khi mở
rộng thẻ (cột "Lỗi" mỗi dòng), badge cấp thẻ chỉ lặp lại thông tin không cần thiết.

**Đã sửa** (`CutBundleCard`, `LenhSanXuatPhoi.tsx`): bỏ nhánh hiện badge "Lỗi {outstanding} đoạn"
(đỏ) và "✓ đã duyệt" (xanh) cho đợt `QC_PASSED` - còn lại `null` (không hiện gì ở đó nữa). **Giữ
nguyên** badge "đang cắt"/"chờ KCS" (2 trạng thái CHƯA có kết quả duyệt, khác hẳn "đã xong xem lại" -
vẫn cần thấy ngay để biết đợt nào còn dở dang). Cũng giữ nguyên: viền đỏ + tự bung bảng chi tiết khi
`outstanding > 0`, và cột "Lỗi" trong bảng chi tiết mở rộng - không nằm trong yêu cầu, vẫn hữu ích để
tham khảo số liệu khi cần xem kỹ.

**Kết quả kiểm tra**: `npx tsc --noEmit` sạch, `npx eslint` sạch. Live-test qua UI thật (`tkphoi`,
PO-52 · Sắt hộp 25x50): "Đợt 3"/"Đợt 2"/"Đợt 1" không còn badge nào ở góc phải; "Đợt 3" (có lỗi lịch
sử) vẫn tự bung sẵn + viền đỏ + cột "Lỗi" hiện đúng "lỗi 1" cho đúng dòng.

**Cập nhật cùng ngày (lần 1)**: sửa thêm `StepBundleHistoryCard` (lịch sử "Các đợt đã gửi" của
Uốn/Dập/...) - cùng cách, bỏ nhánh "Lỗi {outstanding} đoạn"/"✓ đã duyệt", chỉ còn giữ "chờ KCS" khi
`status === 'AWAITING_QC'`.

**Cập nhật cùng ngày (lần 2, người dùng góp ý thêm "các công đoạn khác không làm giống Cắt luôn ?" +
"cũng xem được số lượng rồi lỗi các kiểu")**: NÂNG CẤP TIẾP `StepBundleHistoryCard` thành mirror ĐẦY
ĐỦ `CutBundleCard` (không chỉ bỏ badge như lần 1) - thêm đánh số "Đợt N" (tính theo thứ tự tạo, cùng
cách `orderIndexByBundleId` của `CutBundleCard`, tính riêng trong `StepBundleForm` qua
`orderIndexByBundleId` mới dựa trên `submittedAt`), bấm mở/đóng (chevron) bảng chi tiết CỠ ĐOẠN (Cỡ
đoạn / Số lượng / cột Lỗi CHỈ hiện khi `outstanding > 0`), tự bung sẵn + viền đỏ khi đợt có lỗi lịch
sử - y hệt hành vi `CutBundleCard`, không còn khác biệt giữa lịch sử Cắt và lịch sử công đoạn phụ.

**Kết quả kiểm tra** (cả 2 lần cập nhật): `npx tsc --noEmit`/`npx eslint` sạch. Live-test qua UI thật
(`tkphoi`/`tkcs`, PO-52 · Sắt vuông 50x50 · tab Uốn): tạo thêm 1 đợt Uốn mới (1×660mm) → KCS chấm 1
không đạt → quay lại `tkphoi`: "Đợt 2" hiện đúng - tự bung sẵn, viền đỏ, bảng chi tiết "660mm · 1 ·
lỗi 1"; "Đợt 1" (không lỗi) vẫn gọn, không badge, không viền - đúng y hệt trải nghiệm `CutBundleCard`
đã có ở tab Cắt.

## 20. Màn KCS Phôi (`KcsPhoiPage.tsx`): bảng chờ duyệt trong PI cũng chuyển thành TAB theo công đoạn (2026-09-08)

### 20.1. Vì sao làm

Sau khi tabify xong bên `LenhSanXuatPhoi.tsx` (mục 18), người dùng hỏi tiếp "vậy bên màn KCS Phôi
cũng làm ra các tab theo công đoạn thì sao?" - `PiDetail` (bảng liệt kê mọi đợt chờ/đã duyệt của 1
PI) trước đó XỔ CHUNG Cắt lẫn Uốn/Dập/... vào 1 bảng, chỉ phân biệt qua cột "Công đoạn" - cùng vấn đề
UX đã sửa bên Phôi, áp dụng đối xứng cho màn KCS.

### 20.2. Đã sửa

`PiDetail` (`KcsPhoiPage.tsx`): thêm `stepKeyOf(x)` ('CAT' hoặc đúng `ProcessStep` của StepRow) +
state `activeStep`, dải tab render bằng `tabBtn`/`tabPendingBadge` (style cục bộ, cùng hình dạng
`subFilterBtn` bên Phôi nhưng không import chéo module Kcs/Phoi). Mỗi nút tab hiện kèm **badge số đợt
đang "chờ kiểm"** của đúng công đoạn đó (`pendingByStep`) - khác bản bên Phôi (không có badge, vì bên
đó "Bù đủ" mới là hành động chính chứ không phải duyệt). Tab mặc định chọn SẴN công đoạn có nhiều đợt
chờ kiểm NHẤT lúc mount (đỡ KCS phải tự bấm tìm việc cần làm) - đổi tab sau đó do người dùng tự chọn,
không tự nhảy lại khi refetch. Bảng chỉ hiện đúng đợt của tab đang chọn, bỏ hẳn cột "Công đoạn" (đã
ngầm hiểu qua tab, lặp lại không cần thiết).

### 20.3. Kết quả kiểm tra

- `npx tsc --noEmit` sạch, `npx eslint` sạch (1 warning `no-img-element` có từ trước, không liên
  quan).
- **Live-test qua UI thật** (`tkphoi`/`tkcs`, PO-52): mở PI đã "đã duyệt hết" - tab "Cắt"/"Uốn" hiện
  đúng, bấm "Uốn" lọc sạch chỉ còn 2 dòng Uốn (không lẫn dòng Cắt). Tạo thêm 1 đợt Uốn mới (Phôi) →
  `tkcs` mở lại PI - tab TỰ MỞ SẴN "Uốn" (đúng công đoạn có việc), badge cam "1" hiện trên nút tab,
  tab "Cắt" không badge (0 chờ) - duyệt xong badge biến mất đúng.

## 21. Đồng bộ bước "Chốt & gửi KCS" (Hàn/Sơn/VTTP) theo ĐÚNG pattern đã dùng khắp nơi khác + gộp nav KCS Vật tư TP vào Phôi (2026-09-08)

### 21.1. Vì sao làm

Người dùng xem modal duyệt của Vật tư TP (bước "Chốt & gửi KCS" cuối, ProductionBatch) rồi hỏi "sao
lại không giống Phôi luôn" - modal này vẫn giữ 3 lựa chọn (Đạt/Sửa được/Đề xuất làm lại-phế) trong
khi các bước công đoạn (Cắt/Uốn/Tán...) đã đơn giản hoá về Đạt/Không đạt từ 2026-09-07. Sau khi giải
thích đây là bước KHÁC (duyệt cả mảnh sau khi xong hết công đoạn, không phải 1 công đoạn), người
dùng xác nhận muốn đồng bộ luôn - **cho cả 3 bộ phận dùng chung code này (VTTP+Hàn+Sơn)**, không chỉ
riêng VTTP.

Trước khi sửa, khảo sát kỹ (2 agent Explore) để tránh làm gãy tính năng đang chạy thật: xác nhận
`ReplenishRequest` ("cấp bù khi phế") **đã hỏng sẵn từ trước** - request sinh ra từ nhánh Hàn/Sơn/
VTTP (duy nhất nơi tạo request) luôn có `qcReview.steelIssueId = null`, mà `fulfillReplenishRequest()`
CHẶN CỨNG chính xác điều kiện đó ("chỉ hỗ trợ fulfill cho nhánh Phôi") - tức MỌI request từng tạo ra
chỉ có thể `reject`, không bao giờ `fulfill` được. Bỏ scrapQty không mất chức năng thật nào đang hoạt
động, chỉ dọn 1 nhánh chết.

### 21.2. Backend

**Migration** `20260908060000_simplify_production_batch_qc_review` (dev DB chỉ có đúng 1 dòng
`QcReview` test dùng scrapQty/resolvedQty/phoiReportedAt + 2 dòng `ReplenishRequest` test, đều OPEN
không fulfill được - xác nhận là dữ liệu test (piece "Chân Nhôm"/TEST-BAN-A) trước khi ALTER thẳng):
- `qc_reviews`: DROP COLUMN `scrapQty`/`resolvedQty`/`phoiReportedAt`/`phoiReportedQty` - `failedQty`
  giờ là số lịch sử duy nhất còn lại, đúng nghĩa như mọi nhánh khác đã quy về từ trước.
- DROP TABLE `replenish_requests` + DROP TYPE `ReplenishRequestStatus` - không còn nơi nào tạo dòng
  mới (xem 21.1), giữ lại là dead code treo vô ích.

**`qc-reviews.service.ts`**:
- `reviewProductionBatch()`: bỏ validate/param `scrapQty`, bỏ khối tạo `ReplenishRequest` - mirror
  ĐÚNG `reviewPieceStep()` (đã đơn giản hoá từ 2026-09-07, giờ là pattern chuẩn áp dụng ngược lại
  cho cả nhánh này).
- XOÁ HẲN: `reportProductionBatchDone()`, `recheckProductionBatch()`, `findAllReplenishRequests()`,
  `fulfillReplenishRequest()`, `rejectReplenishRequest()`, `findReplenishRequestOrThrow()`,
  `toReplenishResponseDto()`, `findReviewOrThrow()` (chỉ dùng bởi 2 hàm report-done/recheck vừa xoá).
- `review()`/`reviewCutBundle()`/`reviewStepBundle()`: bỏ `scrapQty: 0` hardcode (cột không còn tồn
  tại).

**`qc-reviews.controller.ts`**: xoá route `production-batches/:id/qc-report-done`,
`production-batches/:id/qc-recheck`, `GET/POST replenish-requests*` (3 route). Xoá DTO
`ReportProductionBatchDoneDto`, `RecheckProductionBatchDto`, `FulfillReplenishRequestDto`,
`RejectReplenishRequestDto`, `ListReplenishRequestsQueryDto`, `ReplenishRequestResponseDto`.

**`CreateQcReviewDto`**: bỏ field `scrapQty`. **`QcReviewResponseDto`**: bỏ
`scrapQty`/`resolvedQty`/`phoiReportedAt`/`phoiReportedQty`.

**Dọn dead code liên quan**: `audit-log.extension.ts` bỏ `'ReplenishRequest'` khỏi `AUDITED_MODELS`
(model không còn tồn tại).

**Bonus cùng đợt** (người dùng hỏi "sao lại là Lô mà không phải PI, SKU sao lại trống" khi xem màn
Vật tư TP) - `ProductionBatchResponseDto`/`PieceStepBundleResponseDto` thêm field `piCode`
(`ProductionInvoice.code` qua `productionOrder.productionInvoiceItem.productionInvoice`) - dự phòng
hiển thị "PO/PI" khi `salesOrderCode` null (PI gộp không gắn 1 đơn Sales cụ thể), cùng idiom
`SteelIssue.piCode` bên Sắt.

### 21.3. Frontend

- **`kcsCore.tsx`** (dùng chung Hàn/Sơn/VTTP): `KcsReviewModal` bỏ hẳn khối "Phân loại N không đạt"
  (2 ô Sửa được/Đề xuất làm lại) + prop `showFailMode`. XOÁ HẲN `KcsRecheckModal`. `KcsVatTuReviewBoard`/
  `KcsTwoTierScreen` bỏ prop `showFailMode`/`enableBuDu`/`onRecheck`, bỏ nút "Duyệt lại", cột "Lỗi"
  giờ LUÔN hiện `failedQty` lịch sử (không còn nhánh `enableBuDu` tính outstanding riêng). Toast sau
  duyệt đổi từ "X đạt · Y làm lại · Z cấp lại" → "X đạt · Y không đạt". Cột "SKU nhà máy" (luôn trùng
  giá trị cột "Lô" vì FE tự gán tạm `sku: po`, chưa từng có SKU thật) XOÁ HẲN; đổi nhãn cột "Lô" →
  "PO / PI".
- **`KcsStagePage.tsx`**: đổi tên prop `enableBuDu` → `showPieceSteps` (ý nghĩa còn lại DUY NHẤT:
  có fetch/hiện sub-row `PieceStepBundle` hay không - chỉ VTTP). `reviews` (cho cột "Lỗi") giờ fetch
  KHÔNG điều kiện (trước chỉ fetch khi `enableBuDu`, nay "Lỗi" hiện đồng nhất mọi stage). `po` (cột
  "PO/PI") thêm dự phòng `piCode` khi `salesOrderCode` null.
- **`VatTuTpDetail.tsx`**: XOÁ HẲN `BuDuPanel` (gọi `reportProductionBatchDone` đã xoá) - `ChotPanel`
  giờ tự fetch `reviews`+`batches` để tính "Lỗi" (Σ `failedQty` lịch sử của mọi `ProductionBatch`
  thuộc đúng mảnh), thêm cột "Lỗi" + nút "Bù đủ" (điều kiện `failed > 0 && remaining > 0`, pre-fill
  qty vào ô "Ghi nhận" - client-side, không gọi API) - cùng idiom `StepPanel` đã làm trước đó.
- **`production-batches-api.ts`**: xoá `reportProductionBatchDone`, `recheckProductionBatchQc`; bỏ
  `scrapQty`/`resolvedQty`/`phoiReportedAt`/`phoiReportedQty` khỏi `BeProductionBatchQcReview`; thêm
  `piCode` vào `BeProductionBatch`/`BePieceStepBundle`.
- **`steel-issues-api.ts`**: bỏ field `scrapQty` khỏi `BeQcReview` (cột đã xoá ở BE).

**Gộp nav "Vật tư TP" vào "Phôi"** (người dùng hỏi "sao lại đưa VTTP ra ngoài, sao không đưa vào
trong Phôi luôn" - bên `tkphoi` đã gộp Sắt+VTTP vào 1 màn từ lâu, bên KCS lại tách 2 mục nav riêng,
không nhất quán). Gộp NHANH theo yêu cầu (không viết lại sâu, giữ nguyên 2 luồng dữ liệu độc lập):
- `KcsPhoiPage.tsx`: đổi hàm cũ `KcsPhoiPage` → `KcsSatSection` (không đổi logic bên trong), thêm
  component `KcsPhoiPage` MỚI bọc ngoài với dải tab "Cắt sắt"/"Vật tư TP" ở đầu màn - tab "Vật tư TP"
  render NGUYÊN `KcsVatTuThanhPhamPage` cũ (đã test, không đổi).
- `MfgApp.tsx`: bỏ hẳn mục nav `'kcs-vat-tu-tp'` (khỏi `TabId` union, danh sách tab, dòng render) +
  import `KcsVatTuThanhPhamPage` (giờ chỉ còn được import bởi `KcsPhoiPage.tsx`).

### 21.4. Kết quả kiểm tra

- Backend: `npx tsc --noEmit` sạch, `npx eslint --fix` sạch (2 lỗi format prettier tự sửa), `npx jest`
  **47/47 suite · 916/916 test pass** (giảm từ 939 - xoá ~23 test của
  `reportProductionBatchDone`/`recheckProductionBatch`/`fulfillReplenishRequest`/
  `rejectReplenishRequest` đã xoá method).
- Frontend: `npx tsc --noEmit` sạch cả repo; `npx eslint` sạch mọi file đã sửa (chỉ 1 warning
  `no-img-element` có từ trước).
- **Live-test qua UI thật** (`tkcs`, PI-2026-054 · "Chan ban A"): nav trái CHỈ còn "Phôi/Hàn/Sơn"
  (không còn "Vật tư TP" riêng); vào "Phôi" thấy dải tab "Cắt sắt"/"Vật tư TP" mới; bấm "Vật tư TP" →
  màn KCS Vật tư TP hiện đúng, cột đầu bảng đổi thành **"PO / PI"** hiện đúng **"PI-2026-054"** (dự
  phòng piCode hoạt động, trước đó hiện "—" trắng), cột "SKU nhà máy" biến mất hoàn toàn; bấm vào PI
  → tiêu đề chi tiết hiện gọn "PI-2026-054" (không còn "· PI-2026-054" lặp lại); bấm "Tiến hành
  duyệt" cho "Chan ban A" (20 chờ) → modal CHỈ còn "Số lượng chưa đạt" + Đạt/Không đạt, KHÔNG còn
  khối "Phân loại... Sửa được/Đề xuất làm lại" → xác nhận duyệt 0 lỗi → toast "Đã duyệt Chan ban A:
  20 đạt" (định dạng mới, không còn "làm lại"/"cấp lại") → dòng chuyển "đã duyệt" đúng.

### 21.5. Chưa làm / lưu ý cho lần sau

- Chưa live-test riêng nhánh Hàn/Sơn (`KcsHanPage`/`KcsSonPage`) sau khi sửa `kcsCore.tsx` - cả 2
  dùng chung `KcsTwoTierScreen`/`KcsReviewModal` với VTTP nên về lý thuyết cùng hành vi đã test, chỉ
  chưa bấm qua UI thật với tài khoản `han`/`son` để xác nhận thêm.
- `PieceStepBundleResponseDto.piCode` đã thêm ở BE nhưng chưa có dòng dữ liệu thật nào đi qua nhánh
  PieceStepBundle với PI gộp (salesOrderCode null) để live-test riêng dự phòng piCode cho đúng nhánh
  này (chỉ test được qua nhánh ProductionBatch/"Chan ban A" ở trên).
