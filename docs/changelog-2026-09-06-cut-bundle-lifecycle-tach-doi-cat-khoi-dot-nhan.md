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
