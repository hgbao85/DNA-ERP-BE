# Changelog 2026-10-08 — Kế hoạch tem QR cho bó sắt Phôi (chống khai khống số đoạn cắt)

> Trạng thái: **MỤC 57 (2026-10-20): ĐÃ fetch + pull nhánh mới nhất (BE main đã mới nhất; FE demo → 3704086, gộp xung đột Hướng dẫn: giữ 4 bài có ảnh của nhánh mới, bổ sung nội dung mới vào, giữ thêm bài "luồng 6 bước" + bài tab Công nhân) và ĐÃ STAGE phần QR/QLSX ở cả 2 repo (BE 28 file, FE 43 file) — CHƯA commit, người dùng tự commit; file không thuộc phần này để ngoài stage (57.3).** **MỤC 49–56 (2026-10-19→20): đổi "Đảo" → "Hủy", UI/UX QLSX đợt 1 + đợt 2, viết lại chữ màn công nhân, bổ sung Hướng dẫn sử dụng — chi tiết từng mục bên dưới.** **MỤC 48 (2026-10-19): ĐÃ LÀM giai đoạn A — thẻ PI của tổ có thanh 3 ngăn (Đạt/Chờ KCS/Chưa gửi), % theo công đoạn, dòng "Còn thiếu N loại sắt (M chưa nhận sắt) · K đợt chờ"; ngăn "còn thiếu gì" (Còn thiếu / Tất cả / Bất thường, chọn SKU, < 900px toàn màn hình, Esc/focus) qua API mới `GET /floor/queue/:stage/detail/:piId`; hỏi lại khi "Chuyển PI tiếp" lúc còn thiếu (nút an toàn mặc định); BE 457 + FE 207 test, live-test PI-040; chưa commit; C chưa làm.** **MỤC 47 (2026-10-19): ĐÃ LÀM giai đoạn B — % tổ Phôi = Cắt + công đoạn phụ + mảnh Phôi, cùng số ở thẻ PI "Sản lượng xưởng" và "Tổng hợp lệnh SX" (PI-040: 17% cả 2 nơi), bảng Phôi tách cột Chưa gửi/Chờ KCS/Đạt/Lỗi/Còn thiếu, sửa nhãn "Đã báo" Hàn/Sơn, QLSX nhận realtime KCS (+ `QC_REVIEW:VIEW`, production phải seed lại); BE 538 + FE 201 test; chưa commit; A/C chưa làm.** **MỤC 46 (2026-10-19): REVIEW đối chiếu changelog ↔ code (chỉ đọc) — mục 21–39 đã commit (PR #42 QR-QLSX), 40–42 chưa commit; giai đoạn B mục 45 đang dở (BE có `openQty`/`awaitingQcQty` chưa test, `computeProgress` chưa đổi, `floor-progress.util.ts` chết, FE chưa đọc); còn nguyên: nhãn `passedQty` "Đã báo", hết phiên → `/login`, lỗi 500 tiếng Anh; LỖI MỚI: QLSX không nhận realtime KCS (thiếu `QC_REVIEW:VIEW`) nên tab Báo cáo không tự tải lại.** **MỤC 45 (2026-10-16): PLAN màn điều hành QLSX cho Phôi/Hàn/Sơn — B thống nhất số + sửa nhãn sai, A thẻ PI tổ + ngăn "còn thiếu gì" + hỏi lại khi chuyển PI sớm, C Hướng dẫn cắt chỉ xem; ~4,5–6 ngày; chờ chốt 4 câu ở 45.9, chưa sửa code.** **MỤC 44 (2026-10-16): rà UX QLSX ~6/10 (đã đính chính nguyên nhân 30% vs 17%).** **MỤC 43 (2026-10-16): người dùng hỏi màn "Lệnh sản xuất" (PI + chiều dài thanh sắt) của tổ Phôi/Hàn/Sơn có bị xoá không — KHÔNG xoá, vẫn có cho tài khoản thống kê cũ; QLSX chưa có màn này (3 màn đã có chế độ chỉ-xem); QLSX thiếu quyền `QC_REVIEW:VIEW`; chờ người dùng chọn, chưa sửa code.** **MỤC 42 (2026-10-16): PLAYWRIGHT thử điện thoại công nhân (Pixel 7 · iPhone 14 · Android yếu CPU×4/3G, mở bằng http://IP Wi-Fi): 14 bài × 3 máy, lần cuối 41/42 qua (1 trang trắng đơn lẻ không tái hiện), đột biến "gửi lại cùng khoá" bị bắt; phát hiện: phiên hết hạn đưa công nhân sang /login ERP, lỗi 500 hiện tiếng Anh; chưa commit.** **MỤC 41 (2026-10-16): THỬ TẢI phần QR bằng script mới `test/load/floor-load.mjs` (`npm run load:floor`) — 24 công nhân ảo báo cùng lúc trên bản sao DB: số khớp từng người, gửi lại cùng khoá chỉ ghi 1 lần, đảo + gửi KCS lúc đang báo không lỗi/treo, cả xưởng 1 IP không chạm giới hạn; MỘT cảnh báo: 24 người đăng nhập cùng phút từ 1 IP → 8 vào ngay, 16 bị chặn, ~125 giây mới vào hết (giữ nguyên giới hạn 8/phút theo quyết định cũ — chưa đổi); điện thoại thật/pilot chưa làm; chưa commit.** **MỤC 40 (2026-10-15): QA phần QR — BE test đơn vị 1700 → 1828, độ phủ `modules/floor` 66,9% → 89,5%, thêm ma trận quyền 29 route + khoá giới hạn 8 lần/phút, kiểm tra đột biến 30/30 bị bắt, build sạch kiểu Vercel (`npm ci` + `next build`) qua; còn hổng: chưa có test tích hợp DB thật / Playwright cho luồng QR; chưa commit.** **MỤC 39 (2026-10-15): màn "Báo cáo" — ô chọn tháng/năm đổi từ `<select>` sang lịch nổi (`MonthYearPicker`), sửa nút ◀ ▶ (bị bóp còn 6px bởi CSS toàn cục + bị tách khỏi ô ngày); chỉ FE, chưa commit; FE 169 test, thử thật trên trình duyệt.** **MỤC 38 (2026-10-15): SEED PRODUCTION ĐÃ CHẠY (có sao lưu trước + kiểm lại: quyền `FLOOR_REPORT` và vai trò `FLOOR_WORKER` đã có, không gỡ quyền nào, không tạo admin mới); còn đặt `TRUST_PROXY_HOPS`, đo IP, `floorPublicUrl`, IP xưởng, đổi mật khẩu DB.** **MỤC 38 (cùng ngày): CHUẨN BỊ COMMIT/DEPLOY — đã cập nhật `package-lock.json` của FE (thiếu 3 gói `qrcode`, `jsqr`, `@types/qrcode` nên `npm ci` trên Vercel sẽ lỗi); ghi lại việc cần làm ở Render/Vercel và các file không nên commit; CHƯA commit, CHƯA deploy (người dùng: deploy sau khi ổn thỏa ở local).** **MỤC 37 (2026-10-15): GỠ BỎ hẳn icon và nút quét QR trong app công nhân theo yêu cầu người dùng (công nhân chỉ quét tem bằng app camera của điện thoại); xoá `QrScanner.tsx`, `qrToken.*`, đèn pin/rung/bíp; FE 169 test; chưa commit.** **MỤC 36 (2026-10-15): ĐÃ LÀM 3 điểm UI màn báo (ô nhập lên trên nếp gập, xác nhận MỌI lần lưu, "Sản lượng của tôi" theo kỳ/ngày) + màn "Báo cáo sản lượng đạt KCS" cho QLSX (ngày/tháng/năm/khoảng, lọc tổ + từng công nhân, biểu đồ, Excel; mốc = ngày KCS duyệt giờ VN) + công nhân xem số đạt/lỗi của CHÍNH mình (`/floor/my-stats`, id từ token); BE 1692 + FE 174 test, đối chiếu SQL 8/8 khớp, axe 0 vi phạm; sửa lỗi làm tròn "100%" khi còn lỗi; chưa commit; chưa thử phần mới trên điện thoại thật.** **MỤC 35 (2026-10-15): nhận xét UI màn báo (~7.5/10) + đề xuất màn báo cáo — ĐÃ LÀM ở mục 36.** **MỤC 33.6 (2026-10-15): SỬA lỗi nút "Lưu" báo "Có lỗi, thử lại" khi công nhân mở app qua `http://IP` (không HTTPS) — `crypto.randomUUID` chỉ có ở HTTPS/localhost; thay bằng `newUuid()` có phương án dự phòng + test chốt chặn; FE 130 test, đã chạy lại luồng Lưu thật; chưa commit; điện thoại cần tải lại trang. 33.5: máy dev khởi động lại, IP đổi thành 192.168.1.5, đã dựng lại.** **MỤC 34 (2026-10-14): ĐỔI luồng đăng nhập công nhân theo phản hồi bước 0 — bỏ nút "Lần đầu đăng nhập?", nhập tên là BE báo đã có PIN hay chưa (chỉ nhập PIN / đặt PIN + nhập lại), endpoint mới `/auth/pin-status` chống dò tài khoản; BE 1652 + FE 126 test, axe 0 vi phạm; chưa commit; giới hạn đăng nhập 8/phút/IP: ĐÃ QUYẾT giữ nguyên (2026-10-15, mỗi công nhân 1 điện thoại + 1 tài khoản).** **MỤC 33 (2026-10-14): bước 0 — người dùng tự đóng vai công nhân thử ở mạng văn phòng (IPv4 công cộng 171.243.8.52, không IPv6, nghi bị NAT); ĐÃ DỰNG môi trường thử qua Wi-Fi local (cấu hình tạm liệt kê ở 33.1, chờ hoàn nguyên); bỏ việc thử đèn pin/rung/bíp trên máy thật.** **MỤC 32 (2026-10-14): ĐÃ LÀM giai đoạn 1 cải thiện UX màn công nhân (nhận sắt ô trống + hỏi khi lệch, tương phản/cỡ chữ riêng cho /floor, đèn pin/rung/bíp + gợi ý ở bộ quét, lỗi mạng rõ ràng, truy cập; axe 0 vi phạm cả sáng/tối; FE 126 test); chỉ FE, chưa commit; còn bước 0, GĐ2–4.** **MỤC 31 (2026-10-14): KẾ HOẠCH cải thiện UI/UX (tự chấm 7/10 → mục tiêu ≥ 8.5): bước 0 đo bằng thử thật + audit truy cập, GĐ1 làm nhanh, GĐ2 hàng chờ gửi lại + tự huỷ lần báo, GĐ3 QLSX, GĐ4 cắt cửa; CHƯA LÀM, chờ chốt 4 quyết định (31.5).** **MỤC 30 (2026-10-14): ĐÃ SỬA 2 điểm ở 29.4 ("Mở lại PI vừa chuyển" + tab Công nhân gọn ở màn hẹp), test thêm quét camera/nhận sắt giao diện/tổ Sơn và chạy thử IMAGE DOCKER production trên DB sạch (18/18); chưa commit.** **MỤC 29 (2026-10-14): ĐÃ TEST LOCAL TOÀN DIỆN (API ~230 kiểm tra, mô phỏng proxy Render, DB sạch, giao diện 3 vai) — không có lỗi code; còn quét camera thật + Render thật; chưa commit.** **MỤC 28 (2026-10-13, bổ sung 28.6 ngày 2026-10-14): ĐÃ CODE giới hạn mạng công ty cho công nhân (Sếp chốt "công nhân thôi, ai có chức năng quét mã"): danh sách IP ở Cấu hình hệ thống, chặn đăng nhập/đặt PIN/gia hạn phiên/mọi request; đã live-test, chưa commit. Production (Render) BẮT BUỘC đặt TRUST_PROXY_HOPS — đã khai trong `render.yaml`, số lớp phải kiểm bằng thực tế (28.6).** **MỤC 27 (2026-10-13): địa chỉ ERP in lên tem QR là cấu hình ở màn Admin (QLSX chỉ xem); GHI NHẬN yêu cầu mới của Sếp "chỉ đăng nhập được từ mạng công ty" (27.4, chưa làm, cần chốt thiết kế).** **MỤC 26 (2026-10-13): ĐÃ CODE 3 việc còn thiếu của plan — nhắc QLSX (đủ số / đợt chờ quá 4 giờ), công đoạn phụ tách đợt theo công nhân, thẻ chờ gửi KCS hiện "đã báo/cần" + cảnh báo vượt (kể cả sắt vào–đoạn ra); đã live-test, chưa commit. Phần code theo plan v10 coi như đủ; còn thử thật ở xưởng + ẩn màn cũ.** **MỤC 25 (2026-10-13): ĐÃ CODE công nhân tự đặt PIN ở lần đăng nhập đầu (QLSX không biết PIN) + khoá tạm 15 phút sau 5 lần nhập sai; đã live-test, chưa commit.** **MỤC 24 (2026-10-13): ĐÃ CODE màn chung QLSX "Sản lượng xưởng" (kiểm + Gửi KCS + đảo lần báo, hàng đợi PI + "Chuyển PI tiếp", máy + in tem QR, tài khoản công nhân) + review UI/UX với danh sách đề xuất cải thiện (24.4); đã thử trên trình duyệt, chưa commit. Cả 4 phần kế hoạch v10 đã có code; còn thử thật + các cải thiện ở 24.4.** **MỤC 23 (2026-10-13): ĐÃ CODE màn quét trên điện thoại (FE, trang `/floor?ws=<mã máy>`) — đăng nhập PIN, nút quét QR trong app (23.4), báo cắt/công đoạn/mảnh, nhận sắt, bù lỗi, "Sản lượng của tôi"; đã thử trên trình duyệt cỡ điện thoại, chưa commit. Còn màn chung QLSX.** **MỤC 22 (2026-10-13): ĐÃ CODE phần máy chủ (BE) cho QR — điểm làm việc + mã QR, tài khoản công nhân (PIN), hàng đợi PI theo tổ + "Chuyển PI tiếp", API màn quét (báo cắt/công đoạn/mảnh, nhận sắt, "Sản lượng của tôi"), QLSX kiểm + "Gửi KCS" + đảo lần báo có lý do, mỗi công nhân 1 đợt riêng; đã live-test bằng API, chưa commit. giao diện: màn quét đã làm ở mục 23, màn chung QLSX chưa.** **MỤC 21 (2026-10-13): ĐÃ CODE phần nền trước QR — lưu người báo (`floor_reports`), chống lưu trùng (Idempotency-Key), nhận sắt có số cây thực nhận + báo lệch, cảnh báo sắt vào–đoạn ra; đã live-test, chưa commit. Phần QR vẫn chỉ là kế hoạch.** **MỤC 20 (2026-10-12): đánh giá plan v10 ~7/10 (mục 20.2), đề xuất bản tinh gọn B (chờ chốt); mục 20.4–20.5: account công nhân để sau này tính công (nhân sự làm sau), giờ chỉ màn "Sản lượng của tôi" + đợt theo người.** **MỤC 15 (2026-10-12) ĐỔI HƯỚNG theo Sếp — QR dán tại máy, công nhân tự báo, QLSX gửi KCS; thay mục 6–14.** Phần QR: **BE (mục 22), màn quét FE (mục 23), màn chung QLSX (mục 24) đều đã code; chưa thử xưởng thật** (phần nền đã code, mục 21); 6 lỗi giao diện phát hiện khi live-test **ĐÃ SỬA (mục 12, FE)**. Mục 1-5 là bản đầu (tem cho bó ĐOẠN đầu ra). **Mục 6 (cùng ngày) ĐỔI
> đề xuất chính** sang tem cho bó CÂY NGUYÊN theo kiểu cắt, sau khi đọc thêm FE + DNA-DEXUAT — mục 2-4 chỉ còn là
> lịch sử / phương án phụ. **Mục 10 (2026-10-09): đã live-test toàn chuỗi, CHỐT đề xuất "QR theo kiểu cắt trên Hướng dẫn cắt" (thay mục 6–9), còn chờ Sếp chốt 3 việc ở 10.3.** Mục 8–9: lịch sử. Mục 7 đính chính mục 6: xưởng chỉ dùng máy laser, không cắt theo bó.

## 1. Bối cảnh
Công nhân Phôi cắt sắt, tự đếm, cộng tay rồi nhập Excel. Số do chính người làm khai, không ai đối chiếu, lệch thường chỉ lộ ra khi Hàn
thiếu đoạn. Người dùng muốn làm mã QR cho mỗi bó sắt, mỗi bó số cây cấu hình sẵn, quy theo PI đang chạy.

Đã đọc code hiện tại: Phôi báo theo `CutBundle` (đợt cắt, cộng dồn qua `recordCutBatch`) với số đoạn theo cỡ (`CutPatternSegment`),
KCS chấm số lỗi theo cỡ (`reviewCutBundle` / `QcReviewSegment`). Từ 2026-09-05 đã bỏ khai `barCount`/`mauNguyenMm`, nên hệ thống
không còn cân bằng vật chất nào giữa sắt nhận và đoạn báo.

## 2. Đánh giá
Đúng hướng, làm được trên model hiện có. Nhưng QR tự nó không chống khống (quét tem không cần bó thật). Ba quy tắc mới là chốt kiểm soát:
1. Số cây/bó cố định → kiểm đếm = đếm bó, kiểm ngẫu nhiên/cân được.
2. Tem in sẵn từ nhu cầu PI, có hạn, mã ngẫu nhiên unique → không báo vượt, không quét 2 lần, không in tem giả; thêm tem = "tem bù" có duyệt.
3. Người làm không tự chốt: số chỉ tính khi KCS quét nhận bó (2 người xác nhận). Tuỳ chọn: Hàn quét nhận để chặn thông đồng Phôi + KCS.

Giới hạn đã nêu: không chặn được thông đồng nếu không có Hàn quét/kiểm đột xuất; cảnh báo "mét đoạn > mét sắt nhận" chỉ cảnh báo, không
chặn, vì Phôi đôi khi bù lỗi bằng sắt thừa dưới xưởng. Đoạn dư ngoài nhu cầu PI không in tem, giữ quy ước "đoạn dư để dưới xưởng".

## 3. Kế hoạch (thời gian là ước tính)
- Bước 0 (2–3 ngày, chưa cần tem): cảnh báo Σ(SteelIssue.barCount × barLengthMm) vs Σ(CutPatternSegment.qty × cutLengthMm) theo PI + vật tư;
  báo cáo so Phôi báo vs Hàn làm ra.
- Bước 1 (~1 tuần): cấu hình số cây/bó (cột mới trên `segment_spec`, mặc định ở `system_config`) + nút "In tem" theo PI, bảng mới `steel_packs`.
- Bước 2 (~1 tuần): quét camera trên web (BarcodeDetector + thư viện dự phòng) "Đóng bó" → gọi lại `recordCutBatch`, không mở đường ghi mới.
- Bước 3 (~1 tuần): KCS quét nhận bó, chỉ bó đã nhận mới tính xong; bó lỗi ghi trên bó, "tem bù" đúng số lỗi; gợi ý bó kiểm ngẫu nhiên.
- Bước 4 (tuỳ chọn, 3–5 ngày): Hàn quét nhận — đụng quyết định cũ "Hàn/Sơn không đối chiếu số Phôi", cần Ban giám đốc chốt.
- Thiết bị: máy in tem nhiệt, decal nhựa chịu dầu, điện thoại tổ trưởng/KCS, mạng tại xưởng (giá chỉ tham khảo).

Trang trình bày cho người không chuyên kỹ thuật (artifact riêng tư, cần Share mới người khác mở được):
https://claude.ai/artifact/XENMGdcietX7GXRpF8zCFb — sơ đồ trước/sau, tem mẫu, cách chia bó, luồng 5 bước, bảng kiểu sai lệch, lộ trình, thiết bị, câu hỏi.

## 4. Chờ người dùng trả lời (ĐÃ THAY bằng mục 6.4)
1. Phôi có lương khoán theo số lượng không. 2. Bó hiện có cố định 1 loại sắt + 1 độ dài không, ai quyết số cây/bó, ví dụ thật.
3. Sau cắt bó đi đâu, KCS kiểm ở đâu, bó có bị tháo để Uốn/Dập không. 4. Ai cầm máy quét, mạng xưởng, có cân bàn không.
5. Có cho Hàn quét nhận không. 6. Kế hoạch AI đọc Zalo/Excel (changelog 2026-10-02) có còn làm phần sắt Phôi không — tránh làm trùng.

## 5. Kiểm tra
Không có thay đổi code, không chạy test. Trang artifact đã đăng.

## 6. Đọc thêm FE + DNA-DEXUAT → đổi đề xuất chính (cùng ngày)

### 6.1. Phát hiện
- DNA-DEXUAT `cat_sat/optimization_logic.py` (module MCTĐ cũ, ERP KHÔNG gọi) có tham số `factors` "Cây/bó" mặc định
  `14 16 18 20` + `max_manual_cuts` (factor 1 = cắt tay từng cây); `PHAN_TICH_HE_THONG_CatSat.md` mô tả "1 bó gồm N cây
  được cắt cùng lúc (máy cắt bó)". Tức là ở xưởng "bó" vốn là bó CÂY NGUYÊN cắt cùng lúc theo 1 kiểu cắt.
- Solver ERP đang dùng (`cat_sat/de_xuat_logic.py`) KHÔNG có ràng buộc bó — chỉ ra `barCount` mỗi pattern.
- FE `Phoi/HuongDanCatPage.tsx` ghi phương án cắt là "BẮT BUỘC", nhưng BE `recordCutBatch` vẫn cho khai lệch
  (`proposalPatternId` chỉ tham chiếu) và không chặn số (Sếp chốt KCS là chốt duy nhất).
- KCS (`reviewCutBundle`) chỉ nhập `failedQty`; số tổng vẫn là số Phôi khai → chưa ai xác nhận số tổng.
- `CutBundle.barCount`/`proposalPatternId` còn nguyên cột (ghi 0/null từ 2026-09-05). `SystemConfig` có sẵn
  `solverTrimStartMm`/`solverBladeWidthMm` cho phép đối chiếu bước 0.
- FE đã có mẫu cửa sổ in (`utils/cuttingGuide.ts`) và đã chạy trên điện thoại.

### 6.2. Đề xuất mới
Tem gắn vào bó cây nguyên lúc KHO xuất sắt: chia `CuttingProposalPattern.barCount` thành bó theo cây/bó tối đa của vật tư
(vd kiểu 1 37 cây → 16+16+5). Cắt xong quét tem → `recordCutBatch` với `barCount` + `proposalPatternId`, số đoạn =
`barCount × countPerBar` — công nhân không đếm đoạn, kho là người đếm độc lập, khôi phục cân bằng vật chất mà không bắt ai
gõ. Không sửa solver. Cắt lệch → đường "Cắt khác tem" gõ tay như cũ, gắn cờ cho KCS/QLSX. Tem bó đoạn (bản đầu) chuyển
thành bước 4 tuỳ chọn cho bàn giao Hàn.

Rủi ro kỹ thuật chính: `CutBundle` = đúng 1 SKU nhưng phương án tính gộp cả PI → 1 tem có thể phải sinh nhiều
`CutBundle`, chia theo phần còn thiếu của từng SKU. `undoLastCutBatch` phải trả tem về chưa cắt.

### 6.3. Lộ trình (ước tính)
Bước 0 đối chiếu mét sắt vào/đoạn ra, chỉ cảnh báo (2–3 ngày) → Bước 1 cấu hình cây/bó + in tem khi xuất sắt (~1 tuần)
→ Bước 2 quét "Đã cắt" + chia SKU + "Cắt khác tem" (1–1,5 tuần) → Bước 3 màn KCS/QLSX tách đợt khớp tem/khai tay
(3–5 ngày) → Bước 4 tuỳ chọn tem bó đoạn cho Hàn (~1 tuần, cần BGĐ vì đụng quyết định "Hàn/Sơn không đối chiếu Phôi").

Trang artifact đã cập nhật (version 2, cùng link https://claude.ai/artifact/XENMGdcietX7GXRpF8zCFb).

### 6.4. Chờ người dùng trả lời (ĐÃ THAY bằng mục 7)
1. "Bó" là bó cây nguyên cắt cùng lúc hay bó đoạn đã cắt? (quyết định cách làm)
2. Xưởng có cắt đúng kiểu trên Hướng dẫn cắt không, hay thường cắt lệch?
3. Kho có buộc bó + gắn tem lúc xuất sắt được không?
4. Cây/bó tối đa theo loại sắt; máy nào cắt bó, máy nào cắt từng cây (LS/TD/LSB)?
5. Phôi có lương khoán theo số lượng không?
6. Ai cầm máy quét, mạng xưởng; kế hoạch AI đọc Zalo/Excel còn làm phần sắt Phôi không?

Kiểm tra: không đổi code, không chạy test.

## 7. Đính chính: xưởng chỉ dùng máy cắt laser (cùng ngày)

Người dùng đính chính mục 6.1: "cây/bó" (`factors` 14/16/18/20) là của module **MCTĐ** cũ, xưởng KHÔNG cắt theo bó;
thực tế ngoài xưởng **chỉ dùng máy cắt laser** (cắt từng cây), và ERP gọi module **"Đề xuất thanh sắt"**
(`cat_sat/de_xuat_logic.py`, tính theo cây, công thức đồng bộ với MC Laser). → Kết luận "xưởng vốn cắt theo bó cây
nguyên cùng lúc" ở mục 6.1/6.2 là SAI, đã bỏ.

Đề xuất chính GIỮ NGUYÊN về bản chất, chỉ đổi đơn vị: tem gắn cho **LÔ** N cây nguyên cùng 1 kiểu cắt (đơn vị đếm/bàn giao,
không phải ràng buộc máy). Máy laser chạy hết lô theo chương trình kiểu k → quét tem → số đoạn = `barCount × countPerBar`.

**Điều kiện mới, quyết định cách làm:** máy laser phải chạy đúng kiểu cắt ERP đã duyệt. Nếu thợ tự xếp lại chương trình
trên phần mềm của máy (hoặc chạy MC Laser riêng) thì số tự tính sẽ sai → cách A không dùng được, quay về cách B (tem bó đoạn)
hoặc lấy số từ nhật ký máy laser.

Câu hỏi chờ (thay mục 6.4): 1. Chương trình nạp vào máy laser lấy từ đâu (Hướng dẫn cắt ERP / phần mềm máy tự xếp / MC Laser)?
2. Hãng máy laser, phần mềm máy có nhật ký số cây/chi tiết không? 3. Kho có chia lô + gắn tem lúc xuất được không?
4. Một lô bao nhiêu cây là tiện? 5. Lương khoán? 6. Người quét/mạng xưởng; kế hoạch AI Zalo còn làm phần sắt Phôi không?

Trang artifact cập nhật version 3 (cùng link). Không đổi code, không chạy test.

## 8. Người dùng trả lời 4 câu + thêm tài khoản công nhân và Hàn/Sơn (cùng ngày)

Trả lời: (1) kho chia lô + gắn tem lúc xuất được → kho là người đếm độc lập; (2) số cây/lô config, không cần chốt;
(3) công nhân lương theo cont hàng; (4) **công nhân là người quét, không phải thống kê** → tạo tài khoản con dưới
Phôi, Hàn, Sơn tương tự.

Đã đọc thêm: quyền hiện là theo module (`ROLE_GRANTS`, vd PHOI_STAFF có `STEEL_ISSUE:UPDATE` = mọi thao tác nhận sắt/báo
cắt/báo xong/hoàn tác) → KHÔNG được cấp lại quyền này cho công nhân. `User.email` đang bắt buộc + unique. `/auth/login`
đã có throttle. Hàn/Sơn báo theo mảnh qua `recordProductionBatch` (cộng dồn batch OPEN) → `finishProductionBatch` (Gửi KCS).

Bổ sung vào kế hoạch (artifact version 4, cùng link):
- Role mới `PHOI_WORKER`/`HAN_WORKER`/`SON_WORKER` chỉ có 1 quyền quét tem (module mới); endpoint quét gọi
  `recordCutBatch`/`recordProductionBatch` bên trong. `User.managerId`, kế thừa `mfgRole` + `warehouseScope`, email cho
  phép trống, thống kê tổ tạo/khoá/đặt PIN qua endpoint riêng (không qua `USER:CREATE` của admin). Bước 1b, 3–5 ngày.
- Hàn/Sơn: tem lô mảnh in theo nhu cầu PI (`bomPiece.qtyPerUnit × order.quantity`), công nhân quét → cộng vào "Lưu đợt";
  thống kê vẫn "Gửi KCS". Bước 4, 1–1,5 tuần. Không đối chiếu số Hàn với Phôi (giữ quyết định cũ). Tem bó đoạn đầu ra
  dời thành bước 5 tuỳ chọn.
- Tổng ước tính 4–5 tuần cho bước 0–4.

Câu hỏi còn treo: 1. chương trình nạp máy laser lấy từ đâu (VẪN là câu quyết định cho Phôi); 2. hãng máy/nhật ký máy;
3. Hàn/Sơn tem lô mảnh có đúng ý, Sơn quét tem Hàn hay tem riêng; 4. điện thoại riêng hay máy chung tổ; 5. lương cont chia
cả tổ hay theo người; 6. dừng phần sắt Phôi trong kế hoạch AI Zalo? Không đổi code, không chạy test.

## 9. Tự rà "đã tối ưu chưa" (2026-10-09) — CHƯA, có 1 xung đột với quyết định cũ

Người dùng hỏi kế hoạch mục 8 đã tối ưu nhất với hệ thống hiện tại chưa. Rà lại, kết luận: **chưa**.

1. **Xung đột quyết định 2026-08-22** (`changelog-2026-08-22-bao-cat-xong-theo-co-doan.md`): luồng cũ `completeCutting`
   "chọn kiểu cắt rồi FE bung số đoạn" đã bị BỎ vì "số liệu thực chất là CHÉP từ solver, không phải ĐO thực tế". Tem lô
   (mục 7–8) là quay lại đúng cách đó (chỉ thêm việc đếm cây). Lập luận để xin duyệt lại: máy laser chạy theo chương trình
   nên mỗi cây ra đúng kiểu, kho đếm cây độc lập, lệch thật chỉ do lỗi (KCS bắt) hoặc chạy khác kiểu (đường khai tay).
   Nhưng đây là ĐẢO quyết định của Sếp → phải được duyệt lại rõ ràng trước khi làm, không tự làm.
2. **Phần kiểm soát thật là đổi đơn vị báo từ "đoạn" sang "số cây × kiểu cắt" + đối chiếu số cây với số kho xuất**, không
   phải bản thân tem. Biến thể rẻ hơn đạt kiểm soát gần tương đương: in 1 QR cho mỗi KIỂU CẮT ngay trên bản "Hướng dẫn cắt"
   A4 đang in (`utils/cuttingGuide.ts`), công nhân quét kiểu + nhập số cây đã chạy, cảnh báo khi Σ cây báo > cây kho xuất.
   Không cần máy in tem, kho không phải gắn tem mỗi lần xuất. Mất: không gõ số hoàn toàn, nhãn "lô 4/5" trực quan.
   Tem lô do kho gắn để làm bước sau, nếu vẫn lệch.
3. **Tài khoản công nhân** là phần nặng nhất (email nullable, `managerId`, role mới, endpoint quản lý tổ, màn FE riêng).
   Phương án nhẹ hơn nếu xưởng dùng máy chung: 1 tài khoản/máy của tổ + danh sách công nhân (không đăng nhập), công nhân
   chọn tên/quét thẻ trước khi báo. Chọn theo câu hỏi "điện thoại riêng hay máy chung" (mục 8).
4. **Tem lô mảnh cho Hàn/Sơn** có lẽ thừa: mảnh to, đếm dễ; tài khoản công nhân tự nhập số (ghi đúng người) có thể đủ.
   Đề xuất hoãn tem Hàn/Sơn tới khi thấy cần.

Thứ tự đề xuất mới: Bước 0 cảnh báo (2–3 ngày) → báo theo kiểu cắt + số cây, QR trên Hướng dẫn cắt, chia SKU tự động,
đường khai tay (1–1,5 tuần, CẦN Sếp duyệt đảo quyết định 22/08) → công nhân tự báo (tài khoản hoặc máy chung, 3–5 ngày)
→ tuỳ kết quả: tem lô do kho gắn, tem Hàn/Sơn. Ước tính ~2,5–3 tuần tới khi Phôi chạy được (thay 4–5 tuần).
Câu hỏi máy laser chạy theo chương trình nào vẫn là điều kiện tiên quyết cho mọi biến thể báo theo kiểu cắt.
Chưa cập nhật artifact (chờ người dùng chọn). Không đổi code, không chạy test.

## 10. Live-test toàn chuỗi tới hết khâu sản xuất + chốt phương án QR (2026-10-09)

### 10.1. Cách chạy
Local (BE :3001, FE :3000, solver docker :18080, DB local). Dữ liệu: SKU thật GHE-J55 (7 loại sắt, công đoạn Uốn/Dập/Tán/
Tóp đầu/Xẻ), 2 đơn `QR-LIVE-A` (12) + `QR-LIVE-B` (8) gộp 1 PI để thử "1 kiểu cắt chia cho nhiều SKU".
- **UI thật**: Sales tạo PO A; KHSX chọn 2 SKU → Tính phương án cắt (#178: 146 cây, 0,24%, 26 kiểu, giải 55,6s) → Tạo lệnh
  gộp (PI-2026-039, id 44) → Gửi QLSX; Kho xuất 12 cây 12×12 (có hộp xác nhận); Phôi xác nhận nhận 1 đợt, xem Hướng dẫn cắt,
  báo cắt 12×12 cho SKU A (36/36) và B (24/24) + Gửi KCS; KCS chấm 2 đoạn 441 lỗi (bắt buộc chọn nguyên nhân); Hàn báo +
  gửi KCS Khung tựa đơn B; QLSX xem Tổng hợp lệnh SX.
- **API** (các chặng đã UI-test ngày 01/10 hoặc lặp lại): PO B, QLSX→Sếp duyệt, mua + nhập kho, floor-start, xuất 7 đợt còn
  lại (Sắt hộp 10×20 chia 20 + 21 cây), nhận sắt, báo cắt 6 loại sắt × 2 SKU, KCS, cắt bù 2 đoạn, 20 step-bundle (Uốn/Dập/
  Tán/Tóp đầu/Xẻ), Hàn + Sơn 5 mảnh × 2 SKU + KCS.
- Kết quả: QLSX "Khung cơ khí 100%" cho PI-2026-039. Log BE không lỗi. Console FE có 2 lỗi 403 (chưa xác định endpoint).

### 10.2. Số liệu dùng để chọn QR
146 cây / 26 kiểu (8 kiểu chỉ 1–2 cây, kiểu lớn nhất 14 cây) / 2.867 đoạn / tối đa 92 đoạn 1 cây (PHI-4: 3×185 + 89×60).
Lô 16 cây → 26 tem = đúng bằng số kiểu → với PI cỡ này "tem lô ở kho" và "QR theo kiểu" ra cùng số mã.
Đối chiếu bước 0 (tề 10mm, lưỡi 1mm theo SystemConfig) trên số thật: bắt đúng Sắt vuông 12×12 vượt 884mm (2 đoạn bù bằng sắt
ngoài); các loại khác dư 0–5.220mm → chỉ bắt được khai khống lớn (vd Sắt hộp 10×20 giấu được ~10 đoạn 470mm).

### 10.3. Phương án chốt đề xuất (thay mục 9)
**QR theo kiểu cắt in trên Hướng dẫn cắt** (`utils/cuttingGuide.ts`), công nhân quét + nhập **số cây đã chạy**, hệ thống tính
`barCount × countPerBar`, tự chia SKU theo phần còn thiếu, chặn Σ cây quét > Σ cây kho xuất theo PI + vật tư (chỉ đường quét;
"Khai tay" giữ nguyên không chặn). Lý do chọn thay tem lô ở kho: kho xuất theo loại sắt nhiều đợt và không có khái niệm kiểu cắt
(thêm việc cho kho), cần máy in tem, trong khi với PI cỡ hiện tại số mã bằng nhau. Tem lô ở kho + tem lô mảnh Hàn/Sơn → để sau,
khi thấy lệch hoặc PI rất lớn. Hàn/Sơn: chỉ tài khoản công nhân tự báo số mảnh. Lộ trình ~2,5–3 tuần. Điều kiện: máy laser chạy
đúng kiểu ERP (chạy thử không trả lời được) + Sếp duyệt đảo quyết định 22/08. Artifact version 5 (cùng link).

### 10.4. Lỗi/quan sát phát hiện khi chạy thử (mục 1–6 ĐÃ SỬA ở mục 12; 7–8 đúng thiết kế)
1. Phôi "Xác nhận nhận sắt": PI gộp → cột PO "—", không hiện mã PI → Phôi không biết đợt sắt thuộc lệnh nào.
2. Kho "Xuất sắt trong phôi": lúc đang tải hiện "Chưa có phương án cắt sắt đã duyệt…" (empty-state sai lúc loading); đầu trang PI
   gộp chỉ ghi "PO: QR-LIVE-B · 1 sản phẩm".
3. Phôi "Lệnh sản xuất": đổi SKU vẫn hiện "Đã lưu … Hoàn tác" của SKU trước (đợt đã gửi KCS) — BE trả 409 nên chỉ là hiển thị.
4. KHSX "Lệnh sản xuất mới": thẻ danh sách "Hạn hoàn thành 09/10/26" nhưng chi tiết ghi 31/10/2026.
5. Hàn: đã "Lưu đợt" 24 nhưng cột "Đã báo" = 0 cho tới khi gửi KCS.
6. Dữ liệu cũ ở "Xác nhận nhận sắt" hiện "Đạt −3/−5" (số âm khi lỗi > đã làm).
7. Hàn/Sơn báo 100% khi Phôi 95%; PI-2026-004 Hàn 172% — đúng thiết kế (memory han-son-no-phoi-stock-check), chỉ ghi nhận.
8. `recordCutBatch` nhận đoạn vượt sắt của chính lô (240m đoạn trên lô 120m) vì không cap — đúng thiết kế; bước 0 phải tính theo
   PI + vật tư, không theo từng `SteelIssue`.

Dữ liệu test để lại trong DB local: PO-156/157 (QR-LIVE-A/B), PI-2026-039, cutting proposal #178, purchase proposal #30,
production orders 39/40, steel issues 34–41, cut bundles 35–49, step bundles 1–20, production batches 84–103. Không đổi code,
không chạy test tự động.

## 11. Nguyên nhân + cách sửa 6 lỗi giao diện ở 10.4 (2026-10-09) — ĐÃ SỬA, xem mục 12

1. **Xác nhận nhận sắt – cột PO "—"** (`DNA-ERP/src/modules/pages/Phoi/XacNhanNhanSatPage.tsx:204,253`): hiện `salesOrderCode ?? '—'`;
   PI gộp có `salesOrderId = null` nên `salesOrderCode` null. Sửa: hiện `piCode` (đã có trong response) làm dòng chính + mã PO
   (nếu có) dòng phụ, đổi tiêu đề cột "PO" → "PI / PO" — giống cách dòng recipe (`:285`) và nhóm lịch sử (`:340`) đang làm.
2. **Xuất sắt – chữ "Chưa có phương án…" lúc tải + header 1 đơn** (`InboundWarehouse/XuatSatPage.tsx`):
   (a) `useFetch` cố ý không bật lại `isLoading` khi đổi deps → lần đầu đã tải `[]` (chưa chọn PI) nên khi chọn PI, `plan=[]` cũ
   hiện ngay empty-state. Sửa: fetch trả kèm `piId`, coi là đang tải khi `planData.piId !== selectedPi.productionInvoiceId`.
   (b) Nhóm PI dựng từ danh sách SKU (mẫu sản phẩm) + `lookupProductionOrderInfo` khoá `(PI, mfgProduct)` / `mfgProduct` → 2 lệnh
   cùng sản phẩm trong 1 PI (QR-LIVE-A/B) gộp thành 1, header chỉ còn 1 đơn; SKU chưa gắn PI rơi về khoá `mfgProduct` = lệnh đầu
   tiên tìm thấy → có nguy cơ cùng sản phẩm ở PI khác không hiện trong danh sách. Sửa: dựng nhóm PI thẳng từ
   `fetchProductionOrdersCached()` (group theo `productionInvoiceId`, gom mọi `salesOrderCode` + `factoryCode × quantity`).
3. **Lệnh SX Phôi – "Hoàn tác" sót của SKU trước** (`Phoi/LenhSanXuatPhoi.tsx:1168`): `lastSaved` là state cục bộ không gắn SKU/đợt.
   Sửa: chỉ hiện khi `lastSaved.bundleId === openBundle?.id` (đợt đang mở CỦA SKU đang chọn, còn CUTTING) — tự ẩn cả khi đổi SKU
   lẫn sau "Gửi KCS".
4. **KHSX – hạn trong danh sách ≠ chi tiết** (`ProductionPlan/LenhSXPage.tsx:658,893` vs `:674-680`; adapter
   `services/production-invoices-api.ts:146`): PI gộp "solve trước" tạo với `deadline = null` (BE `merge` lấy min hạn Khung cơ khí,
   chưa có lúc tạo) → adapter thay bằng `createdAt` (09/10); trang chi tiết lại tự tính hạn giao MUỘN NHẤT của các SKU (31/10).
   Sửa: 1 hàm dùng chung `piDisplayDeadline(pi)` = `pi.deadline` ?? hạn giao SỚM NHẤT của các SKU (khớp BE "theo SKU gấp nhất"
   và cột "Hạn giao (sớm nhất)" của QLSX), bỏ fallback `createdAt`. Cần chốt: chi tiết đang dùng muộn nhất — đổi về sớm nhất.
5. **Hàn/Sơn – "Đã báo" = 0 sau Lưu đợt** (`components/sanxuat/core.tsx:800` + `:433-435`, `:750`): `doneQty` = `passedQty`
   (KCS đã đạt), không cộng đợt OPEN và chờ KCS; "Còn lại" cũng không trừ đợt OPEN (vẫn 24). Sửa: "Đã báo" = đạt + chờ KCS +
   đã lưu chưa gửi; "Còn lại" = Cần − tổng đó (giống "Đã làm" của Cắt sắt, cộng ngay khi lưu).
6. **"Đạt −3/−5"** (`Phoi/XacNhanNhanSatPage.tsx:196-198`): `passed = (actualBarCount ?? barCount) − review.failedQty` — trừ số
   ĐOẠN lỗi khỏi số CÂY (2 đơn vị khác nhau), và chỉ lấy 1 review/lô dù KCS giờ chấm theo từng đợt cắt. Sửa: màn này chỉ hiện
   "KCS: đạt" / "Lỗi N đoạn" (Σ failedQty mọi review của lô), bỏ con số "Đạt" tính từ cây; số đạt chi tiết đã có ở Lệnh sản xuất.

Ước tính ~1 ngày cả 6 (toàn FE, không đổi BE/schema). → Đã làm ở mục 12 (lỗi 4 chốt: hạn giao SỚM NHẤT).

## 12. ĐÃ SỬA 6 lỗi giao diện (2026-10-09) — repo FE `D:\DNA-ERP`, chưa commit

Người dùng: "sửa luôn đi, lỗi 4 lấy hạn sớm nhất". Toàn bộ ở FE, không đổi BE/schema.

| # | File | Sửa |
|---|---|---|
| 1 | `modules/pages/Phoi/XacNhanNhanSatPage.tsx` | Cột "PO" → "PI / PO" (`PiPoCell`): mã PI dòng chính, mã PO hoặc "PI gộp nhiều đơn" dòng phụ |
| 2 | `modules/pages/InboundWarehouse/XuatSatPage.tsx`, `services/production-invoice-item.ts` | Gom PI thẳng từ lệnh sản xuất (`listProductionOrdersLite()` mới, thêm `quantity` vào type); đầu trang/danh sách ghi mọi đơn + "GHE-J55 ×8, GHE-J55 ×12". Kế hoạch + lịch sử gắn `piId` của lần tải, chưa đúng PI đang chọn thì hiện LoadingState (hết nháy "Chưa có phương án…"). Bỏ dùng `usePoInfoFloorGate` ở trang này |
| 3 | `modules/pages/Phoi/LenhSanXuatPhoi.tsx` | "Đã lưu… Hoàn tác" chỉ hiện khi `lastSaved.bundleId === openBundle?.id` |
| 4 | `services/production-invoices-api.ts`, `modules/pages/ProductionPlan/LenhSXPage.tsx` | `piDisplayDeadline()` = hạn giao SỚM NHẤT các SKU ?? `pi.deadline` ?? createdAt, dùng làm `pi.deadline` cho mọi màn; trang chi tiết + modal sửa thời hạn bỏ tự tính "muộn nhất"; lưu thời hạn PI cũng lấy sớm nhất |
| 5 | `components/sanxuat/core.tsx` | Chi tiết mảnh: "Đã báo" = đạt + chờ KCS + đã lưu chưa gửi, "Còn lại" trừ theo đó. Danh sách mảnh (`LineListBoard`, thêm prop `batchesByLine`): "đã lưu N, chưa gửi KCS", chỉ "đã … xong" khi không còn đợt chờ/mở |
| 6 | `modules/pages/Phoi/XacNhanNhanSatPage.tsx`, `services/steel-issues-api.ts` | Bỏ "Đạt" tính từ CÂY − ĐOẠN lỗi; hiện "KCS đã duyệt · Lỗi N đoạn" = Σ failedQty mọi review của lô. **Phát hiện thêm khi kiểm:** `getQcReviewsForSteelIssues()` chỉ lấy trang 1 (limit 100, BE trần 100) trong khi đã có 166 review → lỗi của lô cũ (PI-2026-004 "Lỗi 5/13") mất hẳn. Sửa: tải hết các trang (trần 20 trang = 2.000 review; vượt nữa nên cho BE trả sẵn tổng lỗi theo lô) |

Kiểm tra: `tsc --noEmit` sạch; `eslint` 7 file sửa 0 lỗi (chỉ warning cũ `no-explicit-any`/`no-unused-vars`); `vitest` 80/80.
Live-test UI (local, dữ liệu PI-2026-039):
- (1)(6) Phôi "Xác nhận nhận sắt": PI-2026-039 hiện mã PI + "PI gộp nhiều đơn"; 12×12 "KCS đã duyệt · Lỗi 2 đoạn"; PI-2026-004
  "Lỗi 5 đoạn", "Lỗi 13 đoạn" (trước "Đạt −3/−5"), không còn số âm.
- (2) Kho "Xuất sắt": danh sách PI-2026-039 "QR-LIVE-B, QR-LIVE-A · GHE-J55 ×8, GHE-J55 ×12"; mở PI theo dõi DOM suốt lúc tải: 0 lần
  hiện "Chưa có phương án…"; đầu trang "PO: QR-LIVE-B, QR-LIVE-A · 2 lệnh: …".
- (3) Phôi 12×12 SKU A lưu thử 1 đoạn → có "Hoàn tác"; sang SKU B → không có; về A → có; bấm Hoàn tác → về lại 36 (đã dọn).
- (4) KHSX "Lệnh sản xuất mới": PI-2026-016 thẻ = chi tiết = 05/12/2026 (SKU hạn 05/12 và 10/12 → sớm nhất); PI-2026-019 15/10
  cả 2 nơi (trước thẻ hiện ngày tạo 01/10). PI-2026-039 đã sang PRODUCING nên không còn ở danh sách này.
- (5) Hàn PI-2026-039 / QR-LIVE-A / Khung tựa: lưu 1 → "Đã báo 37", "Chưa gửi KCS 1"; danh sách mảnh "đã lưu 1, chưa gửi KCS".
- Log BE/FE không lỗi. Console: 401 (do đổi token giữa các vai khi test), 403 + cảnh báo `gap/rowGap` có từ trước.

Lưu ý / còn lại:
- Dữ liệu test thêm: 1 ProductionBatch OPEN 1 mảnh Khung tựa (Hàn, lệnh 39) — Hàn không có hoàn tác, để lại ở DB local.
- Lỗi 4: ước tính mốc công đoạn của từng SKU (khi chưa đặt) giờ lùi từ hạn SỚM NHẤT của PI (trước: muộn nhất) — SKU giao muộn hơn
  sẽ có mốc ước tính sớm hơn hạn giao của chính nó; vẫn sửa tay được trong "Sửa thời hạn".
- `/production-orders?limit=100` (nguồn gom PI ở Xuất sắt) cũng trần 100 như trước — chưa đổi.
- Chưa commit FE (repo FE còn thay đổi khác của người dùng: `docs/quy-doi-doan-phoi.md`, `e2e/golden-path.spec.ts`, `package.json`…).

## 13. Bổ sung thiết kế QR: kho giao lẻ (2026-10-09, chỉ kế hoạch)

Người dùng hỏi: số trên Hướng dẫn cắt có phụ thuộc kho xuất sắt không, kho mới xuất 5 cây thì tính sao. Chốt quy tắc (artifact v6):
- Hướng dẫn cắt = kế hoạch CẢ PI (vd Sắt tròn Ø21 35 cây = 14 + 9 + 8 + 4), KHÔNG đổi theo đợt kho giao.
- Trần khi quét = Σ `SteelIssue.barCount` đã **RECEIVED** (Phôi xác nhận nhận, không phải mới ISSUED) theo PI + vật tư − Σ cây đã báo
  qua QR. Vượt → chặn ("mới nhận 5 cây, đã báo 5"). Màn quét hiện "đã nhận / đã báo / còn trong tay" theo loại sắt.
- Theo kiểu: cây báo vượt `CuttingProposalPattern.barCount` của kiểu đó → chỉ cảnh báo "lệch phương án" (vd chạy kiểu 1 quá 14 cây).
- Kho xuất cây dài khác phương án (màn Xuất sắt cho sửa "Dài cây") → số cây đó không quét QR được (kiểu cắt tính cho chiều dài khác),
  bắt buộc "Khai tay"; trần QR chỉ tính cây đúng chiều dài `bestStockLengthMm`.
- Chia đoạn cho các SKU khi giao lẻ: đề xuất theo thứ tự ưu tiên giống Hàn "làm tuần tự" (đơn trước đủ mới sang đơn sau) — CHỜ Sếp chốt
  (khác lựa chọn "chia theo phần còn thiếu" ở 10.3 nếu nhiều đơn cùng cắt dở).
Không đổi code.

## 14. Đề xuất cải thiện QR theo chuẩn ERP/MES (2026-10-09, chỉ đề xuất)

Đối chiếu code hiện tại, phát hiện các chỗ lệch chuẩn ghi nhận sản xuất (operation confirmation):
- `CutBundle`, `CutPatternSegment`, `StepBatch` **không có cột người báo** (chỉ `StepBundle.submittedById`, `ProductionBatch`
  reportedBy). Báo cắt hiện không biết ai báo; audit log chỉ ghi lúc gán/sửa SKU (`writeAssignAudit`).
- `undoLastCutBatch` **xoá/trừ thẳng** dòng (không phải bút toán đảo) → mất dấu vết.
- `recordCutBatch` **không có Idempotency-Key** (cộng dồn) → quét lại khi mạng chập chờn sẽ cộng trùng.
- KCS duyệt không chặn **cùng người vừa báo vừa duyệt**.
- Không quản lý **lô sắt nhà cung cấp** (không có lot/heat number) → không truy được đoạn lỗi thuộc lô sắt nào.
Đề xuất xếp theo ưu tiên (đưa vào ngay khi làm QR): (1) mỗi lần quét = 1 bản ghi bất biến có người/giờ/máy/ca + mã thiết bị,
sửa bằng bút toán đảo có lý do; (2) Idempotency-Key + hàng đợi offline trên điện thoại; (3) mã QR = ID ngẫu nhiên + vô hiệu/in lại
có log, QR dạng link mở thẳng màn quét, mức sửa lỗi Q, giấy ép plastic; (4) tách nhiệm vụ: người báo ≠ người duyệt KCS; (5) báo cáo
chênh lệch kế hoạch–thực tế (cây, đoạn, hao hụt) theo PI/loại sắt/máy/ca thay cho "bước 0". Giai đoạn sau: kiểm kê định kỳ cây tồn
ở Phôi (bút toán điều chỉnh có duyệt), KPI năng suất theo máy/người, lô sắt NCC từ lúc nhập kho, lấy số trực tiếp từ máy laser.
Không đổi code.

## 15. ĐỔI HƯỚNG theo Sếp: QR dán tại máy/điểm làm việc, công nhân tự báo, QLSX kiểm rồi gửi KCS (2026-10-12, chỉ kế hoạch)

Quyết định Sếp (thay toàn bộ phương án QR ở mục 6–14, các mục đó còn là lịch sử):
- KHÔNG in/dán QR ở kho. Mã QR **cố định dán trên từng máy cắt laser**; Hàn, Sơn: **mỗi điểm làm việc 1 mã** (người dùng chọn).
- QLSX bấm "Bắt đầu" (floor-start đã có) → lệnh đó mới hiện trên màn quét.
- Quét → màn: chọn lệnh sản xuất (đang chạy) → SKU (PI gộp thì chọn) → tên mảnh / thanh sắt → nhập số lượng.
  Phôi nhập **SỐ ĐOẠN của thanh sắt** (người dùng chọn — không làm "số cây × kiểu cắt" tự tính).
- Màn Phôi/Hàn/Sơn gộp 1 cho QLSX kiểm; **QLSX kiểm rồi bấm "Gửi KCS"** (người dùng chọn). Công nhân = vai thống kê cũ, QLSX = quản lý.
- Tài khoản con cho công nhân quét. Xác nhận nhận sắt: người dùng hỏi ý → đề xuất **công nhân Phôi xác nhận trên màn quét**
  (người cầm sắt thật), QLSX được xác nhận thay (ghi rõ) + thấy đợt kho đã giao quá X giờ chưa ai nhận.

Thiết kế đề xuất (bám code hiện có):
- Bảng mới `workstations` (điểm làm việc): mã, tên, stage PHOI/HAN/SON + công đoạn (Cắt laser/Uốn/Dập/Tán/… cho Phôi), `qrToken`
  ngẫu nhiên unique, bật/tắt. QR = link mở thẳng màn quét. QLSX tạo + in QR.
- Tài khoản công nhân: role riêng chỉ quyền báo sản lượng tại điểm làm việc của tổ mình; QLSX tạo/khoá/đặt PIN; `User.email`
  cho phép trống; `managerId`. Không cấp `STEEL_ISSUE:UPDATE`.
- Bảng log bất biến `floor_reports` (người, điểm làm việc, lệnh/SKU, thanh sắt hoặc mảnh, số lượng, giờ, idempotencyKey, liên kết
  đợt cắt/ProductionBatch, đảo bằng bản ghi đảo ngược) → bù đúng lỗ hổng mục 14 (`CutBundle`/`StepBatch` không lưu người báo,
  hoàn tác xoá thẳng, không chống gửi trùng). Lưu xong gọi lại `recordCutBatch` / `recordStepBatch` / `recordProductionBatch`
  hiện có → tổng số, KCS, tiến độ QLSX giữ nguyên. Phôi: tự chọn lô sắt RECEIVED cùng vật tư trong PI.
- QLSX "Gửi KCS": hiện các route finish đang `@RequireMfgRole(PHOI|HAN|SON)` → phải mở cho PRODUCTION_MANAGER; lưu ý
  `finishProductionBatch` trừ tồn đoạn theo `warehouseScope` người gọi (QLSX null → kho gốc).
- Màn QLSX "Sản lượng xưởng": 1 màn, lọc Phôi/Hàn/Sơn, theo lệnh/SKU: đợt đang mở (chưa gửi KCS) + ai/máy nào báo bao nhiêu,
  Gửi KCS, đảo 1 lần báo, + quản lý công nhân + điểm làm việc/in QR. Màn Phôi/Hàn/Sơn cũ giữ chạy song song rồi ẩn.
- Giữ cảnh báo "sắt vào – đoạn ra" (mục 10.2) trên màn QLSX vì Phôi lại đếm đoạn bằng tay.
Lộ trình ước tính ~2–2,5 tuần dev + 1–2 tuần chạy song song. Artifact cập nhật v7. Chưa code — chờ người dùng đồng ý bắt đầu.

## 16. Thứ tự triển khai: chạy hệ thống hiện tại trước hay làm QR luôn (2026-10-12, tư vấn)

Đề xuất: **chạy hệ thống hiện tại trước (thống kê nhập ERP thay Excel) trên 1–2 PI thật, làm QR song song**, không chờ.
Lý do: chuỗi hiện tại đã live-test chạy hết (mục 10) + đã sửa 6 lỗi (mục 12); đổi cùng lúc 2 thứ (Excel→ERP và thống kê→công nhân
quét) nhân đôi rủi ro; QR chỉ có ý nghĩa khi các bước trước (Bắt đầu lệnh, kho xuất, nhận sắt) đã được dùng đều; chạy thật trả lời
được câu còn treo (máy laser có chạy đúng phương án, danh sách máy/điểm làm việc thật). Làm ngay 3 phần nền có lợi cả khi chưa có QR
(~2–3 ngày): lưu người báo cho đợt cắt/công đoạn phụ, chống gửi trùng, cảnh báo sắt vào–đoạn ra trên màn QLSX.
Mốc ước tính: tuần 1–2 chạy thật + làm phần nền; tuần 2–4 làm QR (2–2,5 tuần dev); tuần 4–5 thử QR trên 1 máy laser + 1 điểm Hàn
rồi mở rộng → QR chạy thật sau ~5 tuần (làm QR luôn ~3–4,5 tuần nhưng rủi ro cao hơn). Chưa code.

## 17. Sếp chốt nhận sắt: 1 mã QR ở khu Phôi, người nhận tự quét tự điền (2026-10-12, chỉ kế hoạch)

Sếp Trương Văn Nhân trả lời (Zalo, ảnh người dùng gửi): "người nhận tự xác nhận luôn", "làm 1 mã qr bên khu phôi", "người thợ hàng
nhận bao nhiêu tự quét tự điền". Thay đề xuất mục 15 (xác nhận ngay trên mã của máy laser, QLSX nhận thay):
- Workstation loại "Nhận sắt" — đúng 1 mã cho khu Phôi. Quét → các đợt `SteelIssue` ISSUED của lệnh đang chạy → điền số cây thực
  nhận (mặc định = `barCount`) → xác nhận.
- Hiện `receive()` chỉ đổi status ISSUED→RECEIVED, không lưu số/người/giờ. Cần thêm `receivedBarCount`, `receivedById`,
  `receivedAt` (KHÔNG dùng `actualBarCount` vì `syncIssueStatusFromBundles` ghi đè theo roll-up đợt cắt).
- Lệch số → vẫn RECEIVED với số thực nhận + thông báo kho và QLSX; KHÔNG tự ghi StockLedger (kho tự giao bù/điều chỉnh, cùng tinh
  thần các quyết định "không tự bút toán" trước đây). Cảnh báo sắt vào – đoạn ra dùng số thực nhận.
Artifact v8 (cùng link). Chưa code.

## 18. Rút gọn trang trình bày (2026-10-12)

Theo yêu cầu người dùng: bỏ tiểu tiết ("Sếp chốt", "Thay đổi so với hôm nay", mock màn hình, bảng chống khai khống, phần kỹ thuật),
artifact v9 chỉ còn 3 phần: Luồng (5 bước, gồm nhận sắt ở khu Phôi), Thời gian làm (phần nền 2–3 ngày + QR 3 phần × 3–4 ngày ≈
2,5–3 tuần, chưa tính chạy song song), và Thứ tự triển khai (chạy hệ thống hiện tại trước, làm QR song song, QR chạy thật ~5 tuần).
Nội dung kế hoạch không đổi so với mục 15–17. Không đổi code.

## 19. Mỗi tổ chạy 1 PI theo thứ tự — PI gắn cho tổ, QR không chứa PI (2026-10-12, chỉ kế hoạch)

Người dùng: tổ chạy theo thứ tự, xong PI này mới sang PI khác (không chạy nhiều PI cùng lúc). Hệ quả thiết kế:
- QR vẫn định danh máy/điểm làm việc (không in PI vào mã). PI **gắn cho tổ** trên hệ thống: mỗi tổ (Phôi/Hàn/Sơn) 1 hàng đợi PI do
  QLSX xếp, đúng 1 PI "đang chạy". Quét → màn tự hiện PI đó, công nhân chỉ chọn SKU (PI gộp) + thanh sắt/mảnh + số. Không báo được
  vào PI không phải của tổ.
- Hàng đợi từng tổ độc lập (Phôi có thể ở PI sau khi Hàn còn PI trước). Đủ số cần → nhắc QLSX; QLSX bấm "Chuyển PI tiếp" (không tự
  chuyển vì còn đợt chờ KCS/cắt bù). Lỗi KCS về sau → mục "Bù lỗi" trên màn quét cho đúng PI cũ còn thiếu, không cần chuyển ngược.
- Cần lưu lịch sử gắn PI–tổ (từ/đến) để mỗi lần báo biết thuộc PI nào tại thời điểm báo. Hiện floor-start cho phép nhiều lệnh ACTIVE
  cùng lúc theo SKU — hàng đợi là lớp mới ngồi trên, không đổi floorStage.
- Ước tính: máy chủ QR và màn QLSX mỗi phần +1 ngày (4–5 ngày) → tổng ~3 tuần. Còn chờ chốt: mã QR dán theo máy hay theo tổ
  (đề xuất theo máy, PI gắn theo tổ). Artifact v10.

## 20. Đánh giá + chấm điểm plan v10 (QR tại máy) và phương án so sánh (2026-10-12, chỉ tư vấn)

Người dùng hỏi plan v10 (artifact cùng link) có cách nào hay hơn, sát thực tế hơn không, chấm điểm và so sánh khi làm thật.

**Điểm: 6,5/10.** Hướng đúng (thứ tự triển khai, ghi người/máy/giờ, dùng lại `recordCutBatch`/`recordProductionBatch`,
nhận sắt có số thực nhận). Điểm yếu:
1. Không còn chống khai khống cho Phôi: công nhân vẫn tự đếm đoạn, QR dán máy chụp lại quét ở đâu cũng được, QLSX không đếm
   được hàng thật, KCS chỉ chấm lỗi, cảnh báo sắt vào–đoạn ra chỉ bắt lệch lớn (mục 10.2). Vì lương theo cont (mục 8) nên động cơ
   khai khống thấp → giá trị thật của plan là số liệu kịp thời + biết ai báo, nên nói rõ như vậy thay vì "chống khai khống".
2. Hàng đợi 1 PI/tổ cứng so với thực tế (kho giao lẻ, đơn gấp, cắt bù, gộp cắt cùng loại sắt nhiều PI) và thêm state mới
   (lịch sử gắn PI–tổ). Thay bằng: màn quét hiện các lệnh ACTIVE của tổ, chọn sẵn PI ưu tiên nhất, đổi được 1 chạm.
3. QLSX kiểm + bấm Gửi KCS cho cả 3 tổ dễ thành nút cao su và nút thắt. Thay bằng: tổ bấm "Xong đợt"/hết ca → tự sang KCS,
   QLSX chỉ xử lý ngoại lệ (lệch ngưỡng, báo vượt, báo ngoài giờ) — cần hỏi lại vì người dùng đã chọn QLSX gửi KCS.
4. Phôi gõ số đoạn: 1 cây tới 92 đoạn, 1 PI ~2.867 đoạn/26 kiểu → gõ nhiều, dễ sai. Gợi ý: chọn kiểu cắt + số cây → điền sẵn số
   đoạn, sửa được (vẫn là "nhập số đoạn" như đã chọn, chỉ là trợ giúp nhập).
5. Thiếu: báo bao lâu 1 lần (mỗi cây/mỗi lô/cuối ca), thiết bị (điện thoại riêng hay máy chung), offline/mạng xưởng, phiên đăng nhập
   dài trên điện thoại, thước đo thành công của pilot.
6. Ước tính 3 tuần dev lạc quan: thực tế ~4–5 tuần 1 dev (2 repo, bảng mới, tài khoản công nhân — `User.email` đang NOT NULL
   unique, màn mobile, in QR, test) + 1–2 tuần chạy song song.

**Phương án so sánh:** A plan v10 (6,5); B v10 tinh gọn — bỏ hàng đợi cứng, KCS tự nhận khi xong đợt/QLSX theo ngoại lệ, điền sẵn
từ kiểu cắt (đề xuất, ~7,5–8, ~3,5–4 tuần); C máy tính bảng cố định tại khu + thẻ QR công nhân, không tài khoản/PIN (~7, tuỳ có
điện thoại/mạng); D lấy số từ phần mềm máy laser (chính xác nhất, phụ thuộc hãng máy — nên khảo sát song song); E chỉ làm phần nền,
thống kê nhập ERP, chưa QR (~1 tuần, là giai đoạn 1 của mọi phương án).

Đề xuất: giữ thứ tự triển khai (chạy hệ thống hiện tại + phần nền trước), làm B, chọn thiết bị (A hay C) sau khi khảo sát xưởng,
khảo sát D song song. Cần Sếp/người dùng chốt lại: (1) bỏ hàng đợi cứng; (2) QLSX duyệt theo ngoại lệ thay vì bấm Gửi KCS mọi đợt;
(3) thiết bị; (4) tần suất báo. Không đổi code, không chạy test; artifact chưa cập nhật.

### 20.1. Làm rõ: QLSX có chống khai khống được không (2026-10-12)
Người dùng hỏi lại: có QLSX quản lý thì sao lại không chống khai khống. Làm rõ: QLSX là chốt kiểm soát thật **chỉ khi đếm hàng thật**;
"kiểm trên màn" chỉ thấy con số công nhân gõ nên không phát hiện được. Đề xuất thêm vào plan (~2–3 ngày): (1) **kiểm đếm ngẫu nhiên** —
hệ thống chọn ngẫu nhiên vài lần báo/ca (QLSX được thêm), QLSX ra máy đếm, nhập số thực; lệch ghi theo người, có lịch sử; (2) màn QLSX
gắn cờ bất thường: tốc độ báo vượt năng suất máy, đoạn ra > sắt nhận theo PI + vật tư, báo dồn cuối ca, 1 người báo nhiều máy cùng lúc.
Có 2 phần này thì điểm "chống khai khống" của plan lên ~7/10, tổng ~7/10 (bản B ~8/10). Không đổi code.

### 20.2. Chốt lại: chống khai khống là việc quản lý của QLSX, không bắt phần mềm gánh (2026-10-12)
Người dùng: khai khống là vấn đề con người, QLSX là quản lý sản xuất, tự ra khu Phôi kiểm tra được. Đồng ý — mục 20 chấm tiêu chí này
như thể phần mềm phải tự chặn, là sai góc nhìn; phần mềm chỉ cần cho QLSX biết ai báo, máy nào, lúc nào (plan v10 đã có). Bỏ điểm trừ
đó: **plan v10 ~7/10**, điểm trừ còn lại là hàng đợi PI cứng, QLSX bấm Gửi KCS mọi đợt, Phôi gõ nhiều số, ước tính 3 tuần lạc quan.
"Kiểm đếm ngẫu nhiên"/"gắn cờ bất thường" ở 20.1 hạ xuống tuỳ chọn, chỉ làm nếu QLSX thấy cần. Không đổi code.

### 20.3. Chính sách: khai khống thì phạt lương → yêu cầu với dữ liệu (2026-10-12)
Người dùng: phát hiện khai khống thì phạt tiền lương. Hệ quả cho thiết kế: số liệu phải đủ làm bằng chứng, công bằng cho cả 2 phía.
(1) Ghi đúng TỪNG NGƯỜI → tài khoản/PIN riêng cho mỗi công nhân, không dùng 1 tài khoản chung của tổ. (2) Log báo bất biến: không ai xoá/sửa
âm thầm, kể cả QLSX; sửa = bản ghi đảo có người + lý do (đã có trong thiết kế `floor_reports` mục 15). (3) Thêm nhỏ (~1 ngày): QLSX
"Ghi kết quả kiểm" trên 1 lần báo (số đếm thực, ảnh tuỳ chọn, giờ) → công nhân xem được lần báo nào bị kiểm, lệch bao nhiêu. Phạt bao
nhiêu, tính vào lương thế nào vẫn là việc của nhân sự, ERP không tự trừ lương. Không đổi code.

### 20.4. Account công nhân dùng để TÍNH CÔNG theo sản lượng (2026-10-12, chỉ kế hoạch) — đổi giả định mục 8
Người dùng: mỗi công nhân 1 account riêng, log số Phôi/Hàn/Sơn đã làm để tính công. → Thay giả định "lương theo cont" ở mục 8/20
(cần xác nhận: thay hẳn hay cộng thêm). Hệ quả:
1. Động cơ khai khống giờ CAO (báo nhiều = nhận nhiều) → kiểm của QLSX (20.2) và biên bản kiểm (20.3) thành bắt buộc, không còn tuỳ chọn.
2. **Lỗ hổng schema**: KCS chấm theo đợt (`QcReview.cutBundleId` / `productionBatchId` / `stepBundleId`), mà 1 đợt gom báo của NHIỀU
   công nhân (`ProductionBatch.reportedById` chỉ 1 người, `CutBundle` không có người) → không biết đoạn/mảnh lỗi của ai. Phải chọn:
   (a) 1 đợt = 1 người (mỗi công nhân mở đợt riêng, KCS chấm theo đợt người) — đề xuất, ít đổi KCS nhất; hoặc (b) KCS chấm theo từng
   lần báo `floor_reports`; hoặc (c) chia lỗi theo tỷ lệ số báo (không công bằng, không đề xuất).
3. Công tính trên số **ĐẠT KCS**, không trên số báo; tổng công cả tổ theo 1 PI/SKU/cỡ đoạn **không vượt nhu cầu PI + cắt bù đã duyệt**
   (quy tắc tính công, không chặn ghi — giữ quyết định không cap ở `recordCutBatch`). Khai khống khi đó hoặc lấy công của đồng nghiệp
   (họ tự phát hiện) hoặc lộ ra thiếu đoạn ở Hàn.
4. Phải log cả công đoạn Phôi phụ (Uốn/Dập/Tán/Tóp đầu/Xẻ — `StepBatch`/`StepBundle`) nếu có trả công.
5. Cần chốt: đơn giá theo gì (đoạn theo cỡ / mảnh / công đoạn); 2 người cùng làm 1 việc chia thế nào; cắt bù do lỗi của chính mình có
   công không; kỳ chốt (tuần/tháng) và khoá số sau kỳ chốt.
6. Phạm vi ERP: báo cáo "Sản lượng theo công nhân" (đạt KCS, lỗi, bị kiểm/lệch) theo kỳ, xuất Excel cho nhân sự; CHƯA làm bảng
   đơn giá/tính tiền. Ước tính thêm ~3–4 ngày (đợt theo người + báo cáo + khoá kỳ) vào plan.
Không đổi code.

### 20.5. Chốt phạm vi: tính lương để giai đoạn sau (nhân sự), giờ chỉ màn "Sản lượng của tôi" (2026-10-12)
Người dùng: phần nhân sự tính lương làm sau, chưa làm; giờ màn công nhân chỉ thống kê mình đã cắt/hàn/sơn bao nhiêu, nhân sự dựa vào đó.
→ Thay phạm vi 20.4 mục 6: KHÔNG làm báo cáo nhân sự/khoá kỳ/đơn giá lúc này. Làm thêm vào màn quét: tab **"Sản lượng của tôi"** — theo
ngày/tuần, theo PI/SKU, số đã báo, trạng thái (chưa gửi KCS / chờ KCS / đạt / lỗi), lần bị đảo + lý do. ~1–1,5 ngày.
Giữ từ 20.4 (làm ngay vì rẻ khi thiết kế từ đầu, đắt nếu sửa sau khi đã có dữ liệu): mỗi lần báo gắn đúng 1 công nhân + **mỗi công nhân
1 đợt riêng** để KCS đạt/lỗi biết của ai (20.4 cách a). Câu hỏi chốt đơn giá/chia công/cắt bù/kỳ chốt ở 20.4 mục 5 dời sang giai đoạn nhân sự.
Không đổi code.

## 21. ĐÃ LÀM phần nền trước QR (2026-10-12 → 13) — ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1), cả 2 repo
Người dùng: "dán theo máy, bắt đầu làm phần nền đi". Phần nền = 4 việc QR nào cũng cần, dùng được ngay với hệ thống hiện tại (mục 16:
chạy hệ thống trước, QR làm song song). Chưa làm gì của QR (máy/điểm làm việc, account công nhân, màn gộp QLSX, hàng đợi PI theo tổ).

### 21.1. Đã làm
1. **Lưu người báo — nhật ký bất biến `floor_reports` / `floor_report_lines`** (migration `20261012090000_floor_reports_and_steel_receipt`,
   chỉ THÊM bảng/cột nullable, không đụng dữ liệu cũ). Mỗi lần Lưu đợt cắt (`recordCutBatch`), đợt công đoạn phụ (`recordStepBatch`) và
   báo mảnh Hàn/Sơn (`recordProductionBatch`) ghi 1 dòng `kind` CUT/STEP/PIECE + người báo + từng cỡ đoạn/mảnh, CÙNG transaction với
   phần cộng dồn. "Hoàn tác đợt cuối" (`undoLastCutBatch`) ghi **bút toán đảo** (qty âm, `reversalOfId` trỏ dòng gốc) TRƯỚC khi trừ, không
   xoá log. CHECK DB: mỗi dòng có đúng 1 trong `segmentSpecId`/`pieceId`. Helper `src/common/utils/floor-report.util.ts`.
   Hiển thị: thẻ đợt cắt màn Phôi và màn KCS Phôi có "Người báo: ..." (`CutBundle.reportedByNames`, bỏ người của lần đã bị đảo).
2. **Chống lưu trùng — header `Idempotency-Key`** trên 3 endpoint báo ở trên (`floor_reports.idempotencyKey` UNIQUE). Gửi lại cùng
   khoá → trả kết quả cũ, không cộng lần 2; 2 request cùng khoá chạy song song → bên thua dính P2002, bắt lại và trả kết quả của bên
   thắng; khoá đã dùng cho loại báo khác → 409. FE: hook `useRetrySafeKey` (D:\DNA-ERP `src/hooks/useRetrySafeKey.ts`) GIỮ khoá khi
   lần trước không có phản hồi (mất mạng/timeout, `statusCode 0`) và nội dung không đổi; đổi khoá khi thành công, BE trả lỗi, hoặc sửa
   số. Gắn vào: form đợt cắt + form công đoạn phụ (`LenhSanXuatPhoi.tsx`), chốt vật tư TP (`VatTuTpDetail.tsx`), Hàn/Sơn
   (`components/sanxuat/core.tsx`). Không có header = hành vi cũ (tương thích ngược).
3. **Nhận sắt có điền số cây thực nhận** (theo Sếp mục 17: người nhận tự xác nhận, tự điền). `SteelIssue` thêm `receivedBarCount`,
   `receivedAt`, `receivedById` (KHÔNG dùng `actualBarCount` vì `syncIssueStatusFromBundles` ghi đè cột đó). `POST
   /steel-issues/:id/receive` nhận body `{ receivedBarCount? }` (bỏ trống = đủ số kho xuất), update có điều kiện `status = ISSUED` (bấm
   2 lần/2 người cùng bấm → 409). Lệch số → thông báo mới `STEEL_ISSUE_RECEIVED_MISMATCH` (ALERT/WARNING) cho người xuất kho + QLSX.
   **Không tự sửa tồn kho** — kho kiểm lại, đúng mục 17. FE: nút "Xác nhận đã nhận" mở ô "Đếm được [12] / 12 cây" (điền sẵn số kho
   xuất), lệch thì hiện "Thiếu/Thừa N cây · kho và QLSX sẽ được báo"; dòng đã nhận ghi "Nhận 11/12 cây · tên" hoặc "Đã nhận đủ · tên";
   lịch sử Xuất sắt bên kho ghi "Phôi nhận 11/12 cây · tên" khi lệch.
4. **Cảnh báo sắt vào – đoạn ra** (Bước 0 của mục 3, chỉ cảnh báo, KHÔNG chặn — giữ "không cap lúc báo, KCS kiểm soát" và việc Phôi
   bù lỗi bằng sắt thừa dưới xưởng). `phoi-progress` thêm `steelBalance` theo loại sắt: dùng được = Σ lần giao ĐÃ NHẬN (số thực nhận,
   thiếu thì số kho xuất) × (dài cây − tề đầu `solverTrimStartMm`); đã báo = Σ đoạn đã làm × (dài đoạn + mạch cắt `solverBladeWidthMm`);
   vượt = max(0, báo − dùng được). Lần giao làm lại (`reworkOfId`) giờ được tính vào sắt nhận nhưng vẫn bị loại khỏi "kho đã xuất" như
   cũ. FE QLSX "Tiến độ Phôi theo loại sắt": ô "Kho đã xuất cả PI" thêm "Phôi đã nhận X" và "⚠ Đoạn báo vượt sắt nhận N m" (tooltip
   giải thích số).
5. Phát hiện khi live-test, sửa luôn (FE `LenhSanXuatPhoi.tsx`): thẻ loại sắt màn Phôi ghi "12 cây × 4.250mm" dù Phôi vừa xác nhận
   chỉ nhận 11 → giờ ghi "11 cây × 4.250mm · kho xuất 12" (phần lệch màu cam) khi có lần giao bị lệch; khớp thì giữ như cũ.

### 21.2. Kiểm tra
- BE: `steel-issues.service.spec` 110/110 (thêm test nhận lệch số + race, ghi floor report, replay, race P2002, sai loại → 409, đảo
  trước khi xoá, step report/replay, 4 test `steelBalance`); `production-batches.service.spec` +2 test (ghi PIECE, replay không cộng
  đôi). Cả bộ BE 1509 pass / 1 skip. `tsc` sạch trừ lỗi có sẵn ở `prisma/seed-*.ts`.
- FE: `tsc` sạch, eslint 0 lỗi, vitest 99/99.
- Live-test local 2026-10-13 (BE :3001 + FE :3000, Postgres Docker; migration đã `migrate deploy` cùng 2 migration đang chờ từ commit
  trước của người dùng). Dựng nhanh PO `QR-NEN-72871` (GHE-J55 ×20) → PI-2026-040 (id 45) → lệnh 41, kho xuất 12 cây vuông 12×12
  (steel issue 43):
  - Phôi nhận qua UI, điền 11/12 → dòng ghi "Nhận 11/12 cây · (demo) Phôi"; khopsh + qlsx nhận thông báo "PI-2026-040: Phôi nhận
    11/12 cây SAT-VUONG-12X12"; lịch sử Xuất sắt của kho hiện "Phôi nhận 11/12 cây · (demo) Phôi".
  - `steelBalance` ban đầu: 11 cây → dùng được 46,64 m. Gửi đợt cắt 2 lần cùng khoá → vẫn 10 đoạn, `floor_reports` 1 dòng; khoá mới
    → 20 đoạn, dòng thứ 2. Hoàn tác → dòng đảo −10 `reversalOfId = 2`, log không mất.
  - Báo đủ 60×441 + 60×405 → "đã báo" 50,88 m, **vượt 4,24 m** (≈ đúng 1 cây thiếu); màn QLSX hiện "Phôi đã nhận 11 · ⚠ Đoạn báo vượt
    sắt nhận 4,24 m". Ở 1366px không vỡ bảng (ở pane 800px tiêu đề cột "Loại sắt" đè chữ — cách bảng co hẹp vốn đã vậy, không do mục này).
  - Lưu đợt qua UI → `floor_reports.idempotencyKey` là UUID do FE sinh. Thẻ đợt màn Phôi + màn KCS hiện "Người báo: (demo) Phôi".
  - Hàn báo 5 Khung tựa 2 lần cùng khoá → `reportedQty = 5`, 1 dòng PIECE.
  - Log BE không lỗi.

### 21.3. Chưa làm / còn treo
- **"Mỗi công nhân 1 đợt riêng"** (20.5) — ĐÃ LÀM ở mục 22 cho đợt cắt và đợt mảnh (công đoạn phụ chưa). Ghi chú lúc đó: hiện mỗi tổ 1 account thống kê nên tương đương; làm cùng account công nhân ở giai
  đoạn QR. `floor_reports` đã ghi đúng người từng lần nên khi tách đợt không phải sửa dữ liệu cũ.
- Toàn bộ phần QR (mục 15/17/19) — PHẦN BE ĐÃ LÀM ở mục 22, FE chưa: mã QR theo máy/điểm làm việc, account công nhân, màn quét, hàng đợi PI theo tổ + "Chuyển PI tiếp",
  màn gộp Phôi/Hàn/Sơn của QLSX + "Gửi KCS", "Sản lượng của tôi", QR nhận sắt khu Phôi (giờ đã có sẵn API nhận có số thực nhận).
- Dữ liệu test để lại ở DB local: PO-158 (chọn nhầm sản phẩm, bỏ), PO-159 `QR-NEN-72871` / proposal 179 / PI-2026-040 / lệnh 41 / steel
  issue 43 (nhận 11/12, đợt cắt 51 đang chờ KCS, có 1 đợt Hàn 5 Khung tựa).
- Chưa commit (BE + FE).

## 22. ĐÃ LÀM phần máy chủ (BE) cho QR tại máy (2026-10-13) — ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1) (giao diện: màn quét ở mục 23)
Người dùng: "tiếp tục làm phần tiếp theo" → phần 2 của kế hoạch (artifact v10, mục "Thời gian làm"): **Máy chủ cho QR** (danh sách
máy + mã QR, tài khoản công nhân, sổ ghi từng lần báo, hàng đợi PI theo tổ, QLSX được gửi KCS). Làm theo plan v10 người dùng đã chốt
(mục 15/17/19: QR dán theo máy, PI gắn cho tổ chạy 1 PI một lúc, QLSX kiểm rồi "Gửi KCS"), KHÔNG theo bản B ở mục 20 (bản B chưa được
chốt). Giao diện (màn quét điện thoại, màn chung QLSX) là 2 phần tiếp theo, chưa làm.

### 22.1. Đã làm
1. **Schema** — migration `20261013090000_floor_qr_workstations_queue` + `20261013100000_floor_report_production_invoice` (chỉ THÊM
   bảng/cột nullable, nới `users.email` thành NULL được):
   - `workstations` (điểm làm việc): `code`, `name`, `stage` (tổ), `kind` CUT (máy laser) / STEP (máy công đoạn phụ, có `processStep`)
     / PIECE (điểm Hàn/Sơn) / STEEL_RECEIVE (khu nhận sắt Phôi — Sếp chốt 1 mã cho cả khu, mục 17), `qrToken` ngẫu nhiên 24 ký tự,
     `isActive`. CHECK DB: STEP ⇔ có công đoạn khác Cắt; CUT/STEP/STEEL_RECEIVE chỉ tổ Phôi; không có tổ Đan.
   - `floor_queue_entries` (hàng đợi PI theo tổ, mục 19): QUEUED → RUNNING → DONE, `position`, ai/lúc nào xếp, bắt đầu, kết thúc (=
     lịch sử PI–tổ). Partial unique index: mỗi tổ đúng 1 PI RUNNING; UNIQUE (tổ, PI).
   - `floor_reports` thêm `workstationId` (máy đã quét), `productionInvoiceId` (ghi thẳng — đợt bị đảo hết thì bị xoá, FK đợt về NULL
     mà "Sản lượng của tôi" vẫn cần biết PI; backfill từ đợt còn tồn tại), `reason` (lý do ở dòng đảo).
   - `cut_bundles.openedById` (người mở đợt cắt).
2. **Tài khoản công nhân** — role mới `FLOOR_WORKER` (chỉ `FLOOR_REPORT` VIEW+CREATE), quyền mới `FLOOR_REPORT`. QLSX tạo/sửa/khoá/
   đặt lại PIN (`/floor/workers`): username + PIN 6 số, không email, tổ = `mfgRole`, `warehouseScope` = `phoi-son-han` như tài khoản
   thống kê cũ. Khoá / đổi tổ / đặt lại PIN → thu hồi mọi phiên. QLSX chỉ sửa được tài khoản mang role này. Đăng nhập vẫn qua
   `/auth/login` (`LoginDto` hạ MinLength 8 → 6 cho PIN; đặt mật khẩu thường vẫn ≥ 8). Công nhân KHÔNG có `STEEL_ISSUE:UPDATE` /
   `PRODUCTION_BATCH:CREATE` → gọi thẳng API màn thống kê cũ bị 403. Tài khoản thống kê tổ (PHOI/HAN/SON_STAFF) được thêm
   `FLOOR_REPORT` VIEW+CREATE (vẫn là "công nhân", mục 15) — quét được như tài khoản công nhân.
3. **Màn quét (API)** — `GET /floor/scan/:token`: máy + PI đang chạy của tổ + PI cũ còn "Bù lỗi" (tổ đã chuyển qua nhưng PI còn SKU
   ACTIVE) + dữ liệu để chọn: CUT/STEP → tiến độ theo loại sắt → cỡ đoạn (dùng lại `getPhoiProgress`/`getStepProgress`, có `byOrder`
   để lọc theo SKU, cờ "đã nhận sắt"); PIECE → kế hoạch mảnh theo SKU (`getBatchPlanBatch`); STEEL_RECEIVE → các đợt kho đã xuất
   chưa ai nhận. `POST /floor/scan/:token/reports` (Idempotency-Key BẮT BUỘC): kiểm mã còn dùng, công nhân cùng tổ với máy, PI là PI
   đang chạy hoặc PI bù lỗi, rồi gọi ĐÚNG hàm cũ `recordCutBatch` / `recordStepBatch` / `recordProductionBatch` (tiến độ, KCS không
   đổi) + ghi máy vào sổ. CUT tự chọn lần kho giao đã nhận của loại sắt (cùng quy tắc màn Phôi: ưu tiên lần giao đang giữ đợt CUTTING
   của chính người báo). `POST /floor/scan/:token/steel-issues/:id/receive`: chỉ mã khu nhận sắt, gọi `receive()` cũ (có số cây thực
   nhận, mục 21). `GET /floor/my-output`: "Sản lượng của tôi" — mọi lần mình báo (mặc định 7 ngày), PI, máy, trạng thái đợt (chưa gửi
   KCS / chờ KCS / đã KCS), lần bị đảo + lý do + ai đảo.
4. **Hàng đợi PI theo tổ (QLSX)** — `/floor/queue`: xếp PI vào tổ (PI phải đã có lệnh sản xuất), đổi thứ tự (gửi đủ tập PI đang chờ;
   lệch → 409 "tải lại"), bỏ PI chưa chạy, **"Chuyển PI tiếp"** (`POST /floor/queue/:stage/advance`: PI đang chạy → DONE, PI đầu hàng
   → RUNNING; chưa chạy PI nào thì chỉ bắt đầu PI đầu). Không tự chuyển khi đủ số (mục 19). Khoá advisory theo tổ. Mỗi dòng trả
   `hasActiveFloor` (QLSX đã bấm "Bắt đầu" SKU nào chưa) — chưa Bắt đầu thì công nhân quét thấy PI nhưng báo bị gate cũ chặn.
5. **QLSX kiểm + Gửi KCS + đảo lần báo** — `GET /floor/review?stage=`: đợt CHƯA gửi KCS của tổ (Phôi: đợt cắt CUTTING, nhóm công đoạn
   phụ chưa gửi theo PI + loại sắt + công đoạn + SKU, đợt mảnh OPEN; Hàn/Sơn: đợt mảnh OPEN) kèm TỪNG lần báo (ai, máy nào hoặc "màn
   cũ", lúc nào, bao nhiêu, đã đảo chưa). "Gửi KCS" (`/floor/review/.../send-kcs`) gọi đúng hàm cũ `finishCutBundle` /
   `finishProductionBatch` (kho trừ tồn đoạn = `phoi-son-han` như tài khoản tổ) / `submitStepBundle`. **Đảo 1 lần báo bất kỳ** (không
   chỉ lần cuối như "Hoàn tác" cũ) `POST /floor/reports/:id/reverse { reason }`: chỉ khi đợt chưa gửi KCS; ghi dòng sổ âm + lý do (cùng
   máy + PI) rồi trừ đúng số của lần đó (đợt cắt hết đoạn / công đoạn / đợt mảnh về 0 thì xoá đợt, sổ còn nguyên). Khoá dòng đợt
   (`FOR UPDATE` / cùng advisory key với "Lưu đợt") để không lẫn với "Gửi KCS" chạy cùng lúc. Mọi route QLSX gắn thêm
   `@RequireRole(PRODUCTION_MANAGER)` như floor-start → Sếp (VIEW+APPROVE mọi module) không tự gửi KCS được.
6. **Mỗi công nhân 1 đợt riêng** (mục 20.5, ghi treo ở 21.3): `recordCutBatch` chỉ cộng vào đợt CUTTING của CHÍNH người báo
   (`openedById`); đợt cũ chưa có người mở thì người báo đầu tiên nhận luôn. `recordProductionBatch` chỉ cộng vào đợt OPEN do chính
   người đó mở (`reportedById`). → KCS chấm đạt/lỗi theo đợt là biết của ai. Công đoạn phụ (`StepBatch`) CHƯA tách theo người (mỗi lần
   báo đã là 1 dòng riêng có người trong sổ, nhưng "Gửi KCS" vẫn gom cả nhóm PI + loại sắt + công đoạn + SKU).
7. **Sửa lỗi phát hiện khi làm** (của phần nền mục 21): `isIdempotencyConflict()` chỉ đọc `meta.target`, nhưng Prisma 7 + adapter-pg
   không có field đó — tên cột nằm ở `meta.driverAdapterError.cause.constraint.fields` (thử trực tiếp trên DB local). Hệ quả cũ: 2 lần
   "Lưu" cùng khoá chạy song song thì request thua nhận **500** thay vì kết quả cũ (số liệu KHÔNG bị cộng đôi vì transaction rollback,
   chỉ báo lỗi sai). Đã sửa đọc cả 2 chỗ + test với đúng dạng lỗi thật. Cùng kiểu đọc `meta.target` còn ở `all-exceptions.filter.ts`
   (thông báo "Duplicate value for: ...") và `material-groups.service.ts` — chưa sửa, ngoài phạm vi.

### 22.2. Kiểm tra
- BE: cả bộ **1533 pass / 1 skip** (+24 test: `floor-scan` 9, `floor-review` 4, `floor-admin` 5, `floor-report.util` 3, đợt theo người
  ở `steel-issues` 2 + `production-batches` 1). `tsc` sạch trừ lỗi có sẵn ở `prisma/seed-*.ts`; eslint sạch các file đã đụng (gồm sửa
  14 lỗi `no-unsafe-assignment` mà test mới của mục 21 đã thêm vào spec).
- Seed (`npm run seed`) đã tạo role `FLOOR_WORKER` + quyền `FLOOR_REPORT` (bước tạo user admin cuối seed lỗi P2002 username — dữ liệu
  local có sẵn, không liên quan; các bước role chạy trước đó).
- Live-test local bằng API (BE :3001, DB Docker), PI-2026-040 (id 45) từ mục 21:
  - QLSX tạo máy LASER-01 (CUT), HAN-01 (PIECE), NHAN-SAT (STEEL_RECEIVE); chặn đúng: máy cắt gán tổ Hàn (400), trùng mã (409), PIN
    không đủ 6 số (400), Sếp gọi API QLSX (403). Tạo 3 công nhân phoi.a, phoi.b, han.a — đăng nhập bằng PIN được; gọi thẳng
    `POST /steel-issues/43/cut-batches` → 403.
  - Tổ chưa có PI chạy → quét thấy `pi: null`. Mã sai → 404 "Mã QR không còn dùng"; công nhân Phôi quét mã HAN-01 → 403.
  - Xếp PI-040 cho Phôi + Hàn, "Chuyển PI tiếp" → RUNNING; xếp trùng → 409. Quét LASER-01 → PI-040 + 7 loại sắt, chỉ SAT-VUONG-12X12
    "đã nhận".
  - phoi.a báo 5 đoạn 441 (khoá qr-a1) → đợt 52; gửi lại cùng khoá → vẫn 5; **2 request song song cùng khoá → cả 2 trả đợt 52, chỉ cộng
    1 lần (sổ 1 dòng; id 10 bị bỏ qua = request thua đã rollback và trả kết quả cũ — kiểm chứng bản sửa 22.1.7)**. phoi.b báo 3 đoạn
    405 → **đợt 53 riêng**. Thiếu khoá → 400; loại sắt chưa nhận → 409 "quét mã khu nhận sắt".
  - han.a quét HAN-01 → kế hoạch 5 mảnh; báo 4 Khung tựa → đợt 106 riêng (đợt 105 của tài khoản thống kê Hàn hôm qua giữ nguyên); gửi
    lại cùng khoá → không cộng.
  - QLSX `review?stage=PHOI`: đợt 52 "mở bởi Nguyễn An", 2 lần báo @LASER-01; đợt 53 của Trần Bình. `stage=HAN`: lần báo từ màn cũ hiện
    "màn cũ", lần báo QR hiện @HAN-01.
  - QLSX đảo lần báo 11 của phoi.b có lý do → đợt 53 hết đoạn, bị xoá; sổ còn dòng gốc + dòng đảo có lý do; đảo lại → 409; công nhân tự
    gọi đảo → 403. "Sản lượng của tôi" của phoi.b hiện lần báo đó "đã đảo" + lý do + người đảo + PI-2026-040.
  - Gửi KCS đợt 52 và đợt 106 → AWAITING_QC; đảo sau khi gửi → 409 "đã gửi KCS".
  - Kho xuất 4 cây SAT-PHI-6 (issue 44) → phoi.b quét NHAN-SAT thấy đợt đó → nhận 3/4 → lưu người nhận, có thông báo lệch số; bấm lại →
    409; han.a quét NHAN-SAT → 403.
  - Xếp thêm PI-039, PI-036, đổi thứ tự đưa PI-036 lên trước, "Chuyển PI tiếp" → PI-036 RUNNING (`hasActiveFloor` false — QLSX chưa Bắt
    đầu), PI-040 DONE. Quét LASER-01 → đang chạy PI-036, mục "Bù lỗi" có PI-040; báo vào PI-040 vẫn được (đợt 54); báo vào PI-039 (đang
    chờ) → 409.
  - Khoá phoi.b → đăng nhập lại 401; mở lại được. Log BE không lỗi.

### 22.3. Chưa làm / còn treo
- **Giao diện**: (a) màn quét trên điện thoại — ĐÃ LÀM ở mục 23 (link thật là `<FE>/floor?ws=<qrToken>`; ghi chú lúc đó: link QR `<FE>/?m=floor&ws=<qrToken>` → đăng nhập PIN → PI tự hiện → chọn SKU / loại sắt
  / cỡ đoạn hoặc mảnh → nhập số; mục Bù lỗi; màn nhận sắt; tab "Sản lượng của tôi"); (b) màn chung QLSX (kiểm + Gửi KCS 3 tổ, hàng đợi
  + "Chuyển PI tiếp", đảo lần báo, quản lý công nhân, quản lý máy + in tem QR). FE Admin > Người dùng sẽ hiện "(null)" ở chỗ email của
  tài khoản công nhân — sửa cùng phần FE.
- Màn thống kê cũ (Phôi/Hàn/Sơn) chạy song song: khi cùng SKU có đợt mở của nhiều người, nút "Gửi KCS"/"Hoàn tác" của màn cũ vẫn thao
  tác theo đợt nó đang hiện — chưa rà lại từng màn cho trường hợp nhiều đợt mở; màn chung QLSX sẽ là nơi gửi KCS chính.
- "Đủ số cần của PI → nhắc QLSX chuyển PI" (mục 19) chưa làm — làm cùng màn chung QLSX (cần tiến độ theo tổ).
- ~~Công đoạn phụ chưa tách đợt theo người (22.1.6)~~ — ĐÃ LÀM ở mục 26.
- ~~PIN 6 số: chống dò chỉ dựa vào giới hạn 8 lần/phút/IP~~ — ĐÃ có khoá tài khoản sau 5 lần sai (mục 25). Mục 22.1.2 (QLSX đặt PIN) đã được thay bằng công nhân tự đặt PIN (mục 25).
- Dữ liệu test thêm ở DB local: 3 máy (LASER-01, HAN-01, NHAN-SAT), 3 công nhân (phoi.a, phoi.b, han.a — PIN lưu ở scratchpad, không ghi
  ở đây), hàng đợi Phôi (PI-036 đang chạy, PI-039 chờ, PI-040 xong), Hàn (PI-040 đang chạy), đợt cắt 52 (chờ KCS) + 54 (đang cắt), đợt
  Hàn 106 (chờ KCS), steel issue 44 (nhận 3/4).
- Chưa commit (BE + FE).

## 23. ĐÃ LÀM màn quét trên điện thoại (FE) (2026-10-13) — ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Người dùng: "tiếp tục làm màn quét trên điện thoại" → phần 3 của kế hoạch (artifact v10). Repo FE `D:\DNA-ERP`, dùng API mục 22.

### 23.1. Đã làm
1. **Trang riêng `/floor`** (`src/app/floor/page.tsx` → `src/modules/pages/Floor/FloorScanApp.tsx`), KHÔNG nằm trong MfgApp. **Link in
   trên tem QR = `<FE>/floor?ws=<qrToken>`** (đổi so với dự kiến `/?m=floor&ws=` ở 22.3 - trang riêng gọn hơn, không kéo theo khung
   ERP). Thiết kế cho điện thoại: 1 cột tối đa 560px, chữ 16-22px, nút cao 52px, ô số `inputMode="numeric"` (mở bàn phím số),
   nút Lưu dính đáy màn hình (có `safe-area-inset-bottom`).
2. **Đăng nhập PIN ngay trên màn** (không chuyển sang `/login` để không mất `ws` trong link): tên đăng nhập (nhớ lần trước) + PIN 6
   số. Nhớ máy quét gần nhất (localStorage, bọc try/catch) - mở `/floor` không có `ws` vẫn về đúng máy.
3. **Tab "Báo sản lượng"** theo loại máy:
   - Máy cắt laser / công đoạn phụ: PI đang chạy tự chọn, chip "PI-xxx · bù lỗi" cho PI cũ (chọn thì hiện cảnh báo "Đang báo BÙ LỖI");
     chọn SKU (chỉ hiện khi PI có nhiều SKU); chọn loại sắt (chỉ loại có cỡ đoạn thuộc SKU, đánh dấu "chưa nhận"); mỗi cỡ đoạn 1 dòng
     "441 mm · Đã cắt 78/60 · vượt 18" + ô nhập số đoạn; nút "Lưu N đoạn". Loại sắt chưa nhận → khoá ô nhập + nhắc quét mã khu nhận
     sắt. SKU QLSX chưa "Bắt đầu" → cảnh báo.
   - Điểm Hàn/Sơn: danh sách mảnh "Đã gửi KCS x/y · chờ QLSX gửi z" → chạm chọn mảnh → ô số + "Lưu N <tên mảnh>".
   - Khu nhận sắt: mỗi đợt kho đã xuất chưa ai nhận 1 thẻ, ô "Đếm được [10] / 10 cây" điền sẵn số kho xuất, lệch → "Thiếu/Thừa N cây ·
     kho và QLSX sẽ được báo", nút "Xác nhận đã nhận".
   - Lưu xong: thông báo "Đã lưu 4 đoạn 441mm" + tải lại tiến độ. Chống gửi trùng: `useRetrySafeKey` (giữ khoá khi mất mạng, mục 21);
     mất mạng hiện "kiểm tra mạng rồi bấm lại (không bị cộng 2 lần)". Màn KHÔNG có nút gửi KCS (QLSX gửi, mục 15).
4. **Tab "Sản lượng của tôi"**: 7 ngày, nhóm theo ngày, mỗi lần báo: số (đoạn theo cỡ / mảnh), giờ, PI, công đoạn, máy (hoặc "màn
   thống kê"), trạng thái (Chưa gửi KCS / Chờ KCS / Đã KCS); lần bị đảo gạch ngang + "Đã bị đảo bởi … : <lý do>". Ghi rõ đây là số ĐÃ
   BÁO, chưa phải số đạt KCS.
5. **Điều hướng**: `User.isFloorWorker` (normalizeUser suy từ role `FLOOR_WORKER`); `resolveDefaultModule` → 'floor'; trang `/`
   tự chuyển công nhân sang `/floor` (công nhân có mfgRole PHOI/HAN/SON nên trước đây sẽ rơi vào MfgApp và dính 403 hàng loạt). Tài
   khoản không thuộc tổ Phôi/Hàn/Sơn mở `/floor` → thông báo + nút "Về trang chính".
6. **BE thêm nhỏ** (phát hiện khi thử): (a) kế hoạch mảnh của màn quét trả thêm `openQty` (đã báo, chưa gửi KCS) - trước đó báo xong
   con số "Đã gửi KCS 4/60" không đổi, công nhân dễ tưởng chưa lưu; (b) thông báo sai tổ dùng tên tổ tiếng Việt ("tổ Hàn" thay "HAN").

### 23.2. Kiểm tra
- FE: `tsc` sạch, eslint 0 lỗi/0 cảnh báo ở file mới (1 `eslint-disable` set-state-in-effect cho effect tải dữ liệu, cùng cách các
  file Guide đang dùng), vitest 99/99. BE: `floor` 18/18, eslint sạch.
- Thử trên trình duyệt ở cỡ điện thoại 375×812, BE + FE local:
  - `/floor?ws=<LASER-01>` chưa đăng nhập → form PIN; đăng nhập phoi.a → "Báo cắt · Máy laser 1"; PI-036 đang chạy hiện cảnh báo
    "QLSX chưa bấm Bắt đầu" + "sắt chưa nhận"; chọn "PI-2026-040 · bù lỗi" → cảnh báo bù lỗi, tự chọn loại sắt đã nhận; chọn Sắt vuông
    12×12, nhập 4 đoạn 441 → "Lưu 4 đoạn" → "Đã lưu 4 đoạn 441mm", tiến độ 441 lên 78/60.
  - Tab "Sản lượng của tôi" (phoi.a): 4 lần báo, đúng PI/máy/trạng thái.
  - Quét mã HAN-01 bằng tài khoản Phôi → "Mã này của tổ … - tài khoản của bạn thuộc tổ khác".
  - Đăng nhập han.a ở HAN-01 → 5 mảnh; chọn Khung tựa, nhập 3 → "Đã lưu 3 Khung tựa", dòng hiện "chờ QLSX gửi 8" (5 của tài khoản
    thống kê + 3 vừa báo, khớp DB).
  - Kho xuất 10 cây Sắt phi 4 → phoi.b ở NHAN-SAT thấy đợt đó, sửa 10 → 9 hiện "Thiếu 1 cây · kho và QLSX sẽ được báo", xác nhận →
    "Đã nhận 9/10 cây Sắt phi 4", danh sách trống.
  - "Sản lượng của tôi" (phoi.b): lần báo 3 đoạn 405 gạch ngang + "Đã bị đảo bởi (demo) Quản lý sản xuất: <lý do>".
  - Công nhân mở `/` → tự chuyển `/floor`. Console: chỉ lỗi kết nối lúc BE tự khởi động lại khi sửa code và 403 của bước thử sai tổ.

### 23.3. Chưa làm / còn treo
- ~~**Màn chung QLSX** (phần 4)~~ — ĐÃ LÀM ở mục 24 (trừ "nhắc đủ số" chỉ hiện trên màn, chưa có thông báo đẩy). Ghi chú lúc đó: kiểm + Gửi KCS 3 tổ, hàng đợi + "Chuyển PI tiếp", đảo lần báo, quản lý công nhân, quản lý máy + **in
  tem QR** (link `/floor?ws=<qrToken>`), nhắc "đủ số cần của PI". Admin › Người dùng hiện "(null)" ở email tài khoản công nhân - sửa
  cùng phần này.
- ~~Màn quét chưa có trình quét QR trong app~~ — ĐÃ THÊM nút quét QR ở mục 23.4 (cần https khi triển khai thật) — **rồi ĐÃ GỠ BỎ ngày 2026-10-15 (mục 37)**.
- Tên người dùng FE ghép "Tên Họ" (vd "An Nguyễn") theo `normalizeUser` cũ của cả hệ thống - BE ghép "Họ Tên". Chưa đổi (đụng mọi màn).
- Chưa thử trên điện thoại thật / mạng xưởng; chưa có chế độ offline (mất mạng thì báo lỗi, bấm lại không bị cộng đôi).
- Dữ liệu test thêm ở DB local: đợt Hàn 107 (han.a, 3 Khung tựa, OPEN), steel issue 45 (Sắt phi 4, nhận 9/10), đợt cắt 54 thêm 4 đoạn.
- Chưa commit (BE + FE).

### 23.4. Thêm nút quét QR trong màn công nhân (2026-10-13) — ĐÃ GỠ BỎ 2026-10-15, xem mục 37
Người dùng: "ở màn của [công] nhân có 1 icon QR click vào sẽ hiện chỗ để quét QR". Đã làm (FE `D:\DNA-ERP`):
- Nút biểu tượng QR ở đầu màn (cạnh "Đăng xuất", chỉ hiện với tài khoản tổ Phôi/Hàn/Sơn) + nút to "Quét mã QR" khi chưa có máy nào.
  Bấm → khung quét toàn màn hình dùng camera sau (`QrScanner.tsx`), khung ngắm giữa màn, nút "Đóng" (Esc trên máy tính). Quét được
  tem → chuyển sang đúng máy đó (`/floor?ws=…`, cùng link với khi quét bằng app camera), về tab "Báo sản lượng".
- Giải mã: ưu tiên `BarcodeDetector` có sẵn của trình duyệt (Chrome Android), không có (Safari iPhone) thì đọc từng khung hình bằng
  thư viện **`jsqr@1.4.0`** (thêm vào `package.json` qua pnpm, chạy hoàn toàn trong máy, không gửi ảnh đi). Khung hình thu nhỏ cạnh dài
  ~640px cho máy yếu.
- An toàn: CHỈ lấy mã máy từ link có đường dẫn `/floor?ws=` (hoặc token trần đúng dạng) - mã QR khác (link trang lạ, Zalo…) báo "không
  phải tem máy của xưởng", KHÔNG mở link trong mã (`qrToken.ts` + 3 test vitest).
- Camera chỉ mở được trên **https hoặc localhost** (quy định của trình duyệt): mở bằng `http://<IP>` trong mạng xưởng thì màn báo
  "Trình duyệt chặn camera vì trang không chạy https…" - **khi triển khai thật phải chạy FE bằng https** (hoặc công nhân dùng app
  camera của điện thoại). Từ chối quyền camera → hướng dẫn bật lại trong cài đặt.
- Kiểm tra: FE `tsc` sạch, eslint sạch, vitest **102/102** (+3). Trên trình duyệt cỡ điện thoại: nút QR hiện ở đầu màn, bấm mở khung
  quét, "Đóng" tắt khung. **Chưa thử quét bằng camera thật** - trình duyệt nhúng dùng để thử chặn camera (màn hiện đúng thông báo
  "Chưa cho phép dùng camera…"); cần thử trên điện thoại thật.

## 24. ĐÃ LÀM màn chung của QLSX "Sản lượng xưởng" + review UI/UX + đề xuất cải thiện (2026-10-13) — ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Người dùng: "làm màn QLSX, review kỹ càng kể cả UI UX, đề xuất hướng cải thiện để better". Phần 4 (cuối) của kế hoạch v10. Repo FE
`D:\DNA-ERP` + bổ sung BE. Menu QLSX có mục mới **"Sản lượng xưởng"** (chấm số đỏ = số đợt công nhân đã báo mà chưa gửi KCS).

### 24.1. Đã làm
**Màn "Sản lượng xưởng"** (`src/modules/pages/Floor/QlsxFloorPage.tsx` + `QlsxQueue/QlsxReview/QlsxSetup/qlsxUi/qrPrint`), 3 tab:
1. **Sản lượng & gửi KCS** — chọn tổ Phôi/Hàn/Sơn (mỗi nút kèm "N chờ gửi", nhớ tổ xem gần nhất). Mỗi tổ 2 khối:
   - *PI đang chạy + hàng đợi*: mã PI, ai/lúc nào bắt đầu, thanh tiến độ "Đã báo x/y" (mỗi cỡ đoạn/mảnh chặn trần ở số cần), nút
     **"Chuyển PI tiếp"** (hộp xác nhận nêu rõ hệ quả + số đợt còn chờ KCS; chỉ tô nổi bật khi tổ báo đủ số, còn lại là nút phụ để
     tránh bấm nhầm). Nhắc xanh "Tổ đã báo đủ số cần…" khi đủ; nhắc vàng khi QLSX chưa "Bắt đầu" SKU nào của PI. Hàng đợi: thêm PI
     (ô chọn chỉ liệt kê PI đã có lệnh SX và chưa nằm trong hàng đợi tổ, kèm "x SKU đã/chưa Bắt đầu"), đưa lên/xuống, bỏ; "Xem N PI đã xong"
     (lịch sử PI–tổ: từ/đến, ai chuyển).
   - *Chờ gửi KCS*: mỗi đợt 1 thẻ (Cắt/công đoạn phụ/mảnh · PI · SKU · người báo · tổng · "chờ 5 giờ ⚠" khi ≥ 4 giờ) → mở ra thấy
     TỪNG lần báo (giờ, số, người, máy hoặc "màn cũ"), mỗi lần có nút **Đảo** (hộp nhập lý do ≥ 3 ký tự, công nhân thấy lý do);
     **Gửi KCS** từng đợt (xác nhận, nhắc "gửi rồi không đảo được") hoặc **Gửi KCS tất cả** (báo kết quả từng đợt, lỗi 1 đợt không chặn
     các đợt khác). Thông báo xanh sau mỗi thao tác; đợt rỗng hiện câu hướng dẫn.
2. **Máy & tem QR** — bảng máy (tổ, loại, bật/tắt), "Thêm máy" (form ép đúng ràng buộc: máy cắt/công đoạn phụ/nhận sắt chỉ tổ Phôi, STEP
   phải chọn công đoạn), "Xem / in" (mã QR lớn + link + chép link; **cảnh báo khi đang mở bằng địa chỉ nội bộ** vì tem in từ đó chỉ dùng
   trong mạng đó), **In tem** 1 máy hoặc **In tất cả tem** (A4, 2 tem/hàng, viền cắt, tên máy + tổ + loại việc + hướng dẫn 1 dòng, QR mức
   sửa lỗi Q cho tem bẩn/xước), **Đổi mã QR** (tem mất/bị chụp — hộp xác nhận cảnh báo tem cũ hết dùng).
3. **Công nhân** — bảng tài khoản, "Thêm công nhân" (PIN 6 số điền sẵn ngẫu nhiên, sau khi tạo hiện PIN MỘT LẦN để ghi lại), "Đặt lại PIN"
   (PIN ngẫu nhiên điền sẵn, hiện một lần, đăng xuất mọi máy), Khoá/Mở khoá (xác nhận). Màn Admin › Người dùng không còn hiện "(null)" ở
   email công nhân (hiện tên đăng nhập).

**BE bổ sung để màn này dùng được:** (a) entity realtime mới `FLOOR_REPORT` (topic `floor`) + `FloorRealtimeInterceptor` phát sau MỌI
thao tác ghi của `/floor/*` → màn QLSX + chấm số menu tự cập nhật khi công nhân vừa báo, không cần bấm làm mới (cũng tải lại khi quay lại
tab); (b) `GET /floor/summary` (số đợt chờ gửi KCS theo tổ); (c) `GET /floor/queue/candidates` (PI để thêm vào hàng đợi); (d) `progress`
trên dòng hàng đợi RUNNING (Phôi: đoạn cắt; Hàn/Sơn: mảnh, tính cả đợt chưa gửi KCS) — chỉ để nhắc, không chặn gì.

### 24.2. Kiểm tra
- BE: cả bộ **1536 pass / 1 skip** (+3 test tiến độ hàng đợi: trần theo từng dòng, tính cả đợt chưa gửi KCS, lỗi tính không làm hỏng danh
  sách); `tsc` + eslint sạch. FE: `tsc` sạch, vitest **103/103** (+1: giải mã lại đúng link từ ảnh QR do chính thư viện tạo, bằng chính
  bộ đọc jsQR dùng trong app), eslint file mới sạch (2 lỗi `react/no-unescaped-entities` ở `SpecSteelPage.tsx` là có sẵn).
- Thử trên trình duyệt (BE + FE local, tài khoản QLSX): menu có "Sản lượng xưởng" + chấm số; tab Phôi hiện PI-036 đang chạy + hàng đợi
  + đợt chờ; mở đợt thấy 2 lần báo (Nguyễn An @LASER-01); **Đảo** 1 lần báo có lý do → đợt giảm còn 4 đoạn, dòng cũ gạch + lý do; **Gửi
  KCS** → thông báo xanh, đợt biến mất, nút "Tổ Phôi" mất "1 chờ gửi", chấm menu 4 → 3 (realtime); tab Máy: 3 máy, "Xem / in" ra QR +
  cảnh báo localhost; tab Công nhân: 3 người, nút đặt PIN/khoá; cỡ điện thoại 375px không tràn ngang.
- Lỗi phát hiện khi thử: `tsc --noEmit` KHÔNG bắt được lỗi TS4053 (kiểu `FloorProgress` dùng ở controller nhưng không export) — chỉ
  `nest start` (có phát file khai báo) mới báo, làm BE không khởi động. Đã export; **trước khi bàn giao phải chạy `nest build`**, không chỉ `tsc --noEmit`.

### 24.3. Review UI/UX — đã sửa trong lúc làm
1. Câu giải thích thanh tiến độ quá dài, lẫn thuật ngữ → rút gọn "Đã báo x/y", phần giải thích vào tooltip.
2. "Chuyển PI tiếp" luôn nổi bật dù tổ còn đang làm → dễ bấm nhầm; nay chỉ nổi bật khi tổ báo đủ số (hoặc chưa chạy PI nào).
3. Tóm tắt đợt thừa chữ ("6 đoạn: 6×441") khi chỉ 1 cỡ → "6 đoạn 441mm".
4. Hàng tab có thanh cuộn ngang thừa → cho xuống dòng.
5. Màn Admin hiện "(null)" cho email công nhân → hiện tên đăng nhập.
6. Màn không tự cập nhật khi công nhân báo (BE chưa phát realtime cho `/floor`) → thêm realtime (24.1).

### 24.4. Review — vấn đề còn lại và đề xuất cải thiện (xếp theo giá trị, CHƯA làm)
**Cao (nên làm trước khi chạy thật):**
1. ~~**Thẻ "Chờ gửi KCS" chưa cho QLSX thấy "cần bao nhiêu"**~~ — ĐÃ LÀM ở mục 26 (ghi chú lúc đó): — chỉ thấy số công nhân báo (vd 441mm: 4 đoạn), không thấy "đã 78/60 → vượt 18". Đúng cái cần bắt (khai khống) lại nằm ở màn khác. Đề xuất: mỗi dòng cỡ/mảnh hiện "đã báo/cần" + cờ vàng khi vượt; thêm cảnh báo "sắt vào – đoạn ra" (mục 21.1.4) ngay trên thẻ Phôi. API đã có số liệu (`getPhoiProgress`, `steelBalance`).
2. **Hai đường gửi KCS song song**: tài khoản tổ cũ (màn Phôi/Hàn/Sơn) vẫn tự "Gửi KCS" được, QLSX gửi ở màn này → có thể lệch quy trình. Đề xuất: khi chạy thật bật cờ ẩn nút "Gửi KCS" ở màn tổ cũ, hoặc ghi rõ quy ước.
3. ~~**Chống dò PIN**~~ — ĐÃ LÀM ở mục 25 (khoá 15 phút sau 5 lần sai; chưa báo QLSX khi có tài khoản bị khoá).
4. **Tem QR cần thử thật**: in thử máy in xưởng, độ tương phản, cán nhựa, quét ở khoảng cách/ánh sáng thật; thêm "mã dự phòng" (số ngắn dưới QR) để nhập tay khi camera hỏng. Camera trong app cần https khi triển khai.
**Trung bình:**
5. ~~**Nhắc việc chủ động**~~ — ĐÃ LÀM ở mục 26 (thông báo; chưa có giờ làm việc). Ghi chú lúc đó: đợt chờ > 4 giờ hiện ⚠ chỉ khi mở màn. Đề xuất thông báo (hệ thống thông báo sẵn có) lúc cuối ca/khi có đợt chờ > X giờ, và khi tổ đủ số ("sẵn sàng chuyển PI") — hiện chỉ hiện ở màn.
6. **Gửi KCS tất cả** chưa cho chọn từng đợt (chọn bằng ô tích, "chỉ gửi đợt đã kiểm"); thêm lọc theo công nhân/máy/SKU và gom theo PI khi có nhiều SKU.
7. **Máy**: hiện "lần báo gần nhất" từng máy để thấy máy lâu không dùng / tem dán nhưng không ai quét; hiện ai đang đăng nhập.
8. **Hàng đợi**: kéo-thả (hiện dùng nút lên/xuống), hiện hạn giao + tiến độ cả PI đang chờ, gợi ý xếp theo hạn giao, "thêm PI cho cả 3 tổ" 1 lần.
9. **Công nhân**: tạo hàng loạt (dán danh sách), hiện lần đăng nhập/báo cuối, nhật ký đặt lại PIN (ai, lúc nào), in phiếu PIN.
10. **Lịch sử**: chưa có chỗ xem "đã gửi KCS gần đây" / ai gửi — để QLSX tra lại và đối chiếu khi KCS hỏi.
11. **Kiểm đếm ngẫu nhiên** (mục 20.1/20.3): nút "Ghi kết quả kiểm" trên 1 lần báo (số đếm thực, ảnh) để làm bằng chứng phạt lương — chưa làm.
**Thấp / kỹ thuật:**
12. Truy cập bàn phím: tab chưa chuyển bằng phím mũi tên; hộp xác nhận dùng chung đã có.
13. Danh sách đợt chưa phân trang (đủ cho 1 xưởng; cần nếu tồn hàng trăm đợt). Đồng hồ "chờ x giờ" tính theo giờ trình duyệt.
14. `summary` chạy 3 truy vấn mỗi lần có thay đổi realtime — ổn ở quy mô này, cần gộp nếu tăng.
15. Màn công nhân (mục 23): chưa offline, chưa tự đăng xuất khi dùng chung máy, chưa có "tổng hôm nay" ở đầu màn.

### 24.5. Chưa làm / còn treo
- Mục 24.4 (trừ #1 và #5 đã làm ở mục 26). ~~Công đoạn phụ chưa tách đợt theo người~~ — đã làm ở mục 26. Việc phụ sửa đọc lỗi trùng (`meta.target`) đang chạy ở phiên riêng.
- Chưa thử với điện thoại/máy in thật; chưa chạy thử song song 1–2 tuần (mục 16).
- Dữ liệu test local: đợt cắt 54 đã gửi KCS, lần báo 2 đoạn 441 (Nguyễn An) đã đảo kèm lý do; hàng đợi/máy/công nhân như mục 22.3.
- Chưa commit (BE + FE).

## 25. ĐÃ LÀM công nhân tự đặt PIN lần đầu + khoá tạm sau 5 lần nhập sai (2026-10-13) — ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Người dùng chốt: (1) điện thoại là máy riêng từng người; (2) "đăng nhập lần đầu nếu chưa có PIN thì hiện lên bắt nhập PIN và nhập xác nhận
lần 2; khoá sau 5 lần nhập sai". Lý do (đã trao đổi): số báo là bằng chứng ai làm bao nhiêu (mục 20.3-20.5, có thể liên quan lương) - nếu
QLSX đặt/biết PIN thì công nhân có thể nói "QLSX báo bằng tài khoản của tôi" và dữ liệu không bác bỏ được. Thay cách làm ở mục 22/24 (QLSX
đặt PIN, hiện một lần).

### 25.1. Đã làm
1. **Schema** (migration `20261013110000_floor_worker_pin_setup_lockout`, chỉ thêm cột): `users.pinPending`, `pinClaimExpiresAt`, `pinSetAt`,
   `failedLoginCount`, `lockedUntil`.
2. **Tạo công nhân không có PIN**: QLSX nhập họ tên + tên đăng nhập + tổ; mật khẩu lưu là hash của chuỗi ngẫu nhiên không ai biết,
   `pinPending = true`, hạn đặt PIN **72 giờ**. Màn QLSX hướng dẫn công nhân "mở link quét tem → Lần đầu đăng nhập? Tự đặt PIN". **[ĐÃ THAY ở mục 34: bỏ nút này; nhập tên là màn tự nhận ra tài khoản chưa có PIN]**
3. **Đặt PIN lần đầu** `POST /auth/pin-setup` (không cần đăng nhập, giới hạn 8 lần/phút/IP như login): nhập PIN 6 số 2 lần; chặn PIN dễ đoán
   (000000, 123456/654321, 121212, 123123, 112233…); chỉ chạy được khi tài khoản là công nhân + đang chờ đặt PIN + còn hạn (lỗi dùng chung
   thông điệp để không lộ tài khoản nào tồn tại); `updateMany` có điều kiện `pinPending` nên 2 người cùng đặt chỉ 1 người thắng; lưu hash
   argon2 (không lưu PIN thô) rồi **đăng nhập luôn**. QLSX không bao giờ thấy PIN.
4. **[LUỒNG NÀY ĐÃ ĐỔI Ở MỤC 34 - xem đó]** **Màn công nhân (`/floor`)**: đăng nhập với tài khoản chưa có PIN (gõ PIN bất kỳ) → BE trả 403 `PIN_SETUP_REQUIRED` → app **tự chuyển**
   sang màn "Tự đặt PIN của bạn" (PIN mới + nhập lại + ô "Hiện PIN" + lời nhắc tránh PIN dễ đoán); cũng có nút "Lần đầu đăng nhập? Tự đặt
   PIN" để vào thẳng. Đặt xong vào luôn màn báo của máy vừa quét.
5. **Khoá tạm**: chỉ tài khoản công nhân. Sai 5 lần liên tiếp → khoá **15 phút** (đúng PIN cũng bị từ chối trong lúc khoá); sai lần 3-4 báo "còn
   N lần thử trước khi bị khoá tạm"; **lần sai thứ 5 báo khoá ngay** (không để tới lần 6 mới biết); đúng PIN thì xoá bộ đếm. Tài khoản khác
   (admin, QLSX…) KHÔNG áp khoá này - tránh bị người ngoài cố tình khoá quản trị.
6. **QLSX**: cột Trạng thái hiện "Chờ tự đặt PIN (hạn …)" / "Đã đặt PIN" / "Quá hạn đặt PIN" / "**PIN do QLSX đặt**" (tài khoản cũ, nên cho đặt
   lại) / "Khoá tạm đến …". Nút **"Cho đặt lại PIN"** (xoá PIN, đăng xuất mọi máy, công nhân tự đặt PIN mới trong 72 giờ - QLSX vẫn không
   biết PIN), **"Mở khoá tạm"** (khi bị khoá do sai PIN), Khoá/Mở khoá tài khoản như cũ.

### 25.2. Kiểm tra
- BE: cả bộ **1565 pass / 1 skip** (+29: `auth` 12 [chưa có PIN → 403, sai PIN tăng bộ đếm, báo còn N lần, khoá ở lần 5, đúng PIN vẫn bị
  từ chối khi đang khoá, hết khoá vào được, admin không bị khoá, đặt PIN hợp lệ lưu hash, khác nhau/dễ đoán/không chờ/quá hạn, 2 người cùng
  đặt], `pin.util` 13, `floor-admin-workers` 4). `tsc`, eslint sạch. FE: `tsc` sạch, vitest 103/103.
- Live-test API: tạo `phoi.c` → `pinState: PENDING`; đăng nhập → 403 `PIN_SETUP_REQUIRED`; đặt PIN 2 lần khác nhau → 400; PIN `123456` → 400;
  username lạ / tài khoản QLSX → 400 chung thông điệp; đặt PIN hợp lệ → có token; đặt lần 2 → 400; đăng nhập PIN đúng → vào. Sai 5 lần → khoá
  (lần 6 đúng PIN vẫn bị từ chối, thông báo 15 phút); QLSX thấy `lockedUntil`; "Mở khoá tạm" → đăng nhập được; "Cho đặt lại PIN" → PIN cũ
  hết dùng, quay lại `PIN_SETUP_REQUIRED`.
- Thử trên trình duyệt cỡ điện thoại: gõ `phoi.c` + PIN bất kỳ → app tự sang màn đặt PIN; PIN `123456` → "PIN quá dễ đoán…"; 2 lần lệch →
  "Hai lần nhập PIN chưa giống nhau"; nhập đúng → vào thẳng màn báo LASER-01. Màn QLSX hiện `phoi.c` "Đã đặt PIN".

### 25.3. Rủi ro / còn treo
- **Ai biết tên đăng nhập có thể đặt PIN trước công nhân** trong 72 giờ chờ (vì chưa có gì khác để xác thực). Giảm nhẹ: hạn 72 giờ, giới hạn
  8 lần/phút/IP, QLSX thấy trạng thái + giờ đặt, công nhân đặt xong thấy ngay nếu bị người khác đặt trước (đăng nhập không được → báo QLSX cho
  đặt lại). Nếu muốn chắc hơn: thêm **mã kích hoạt dùng 1 lần** QLSX đưa kèm tên đăng nhập (đổi 1 bước), hoặc rút hạn còn vài giờ. Chưa làm.
- Tài khoản công nhân tạo trước mục 25 (`phoi.a`, `phoi.b`, `han.a`) có PIN do QLSX đặt → hiện "PIN do QLSX đặt"; khi chạy thật nên "Cho đặt lại PIN"
  hoặc tạo mới.
- Khoá theo TÀI KHOẢN (không theo IP): người xấu biết tên đăng nhập có thể cố tình sai 5 lần để khoá công nhân 15 phút (QLSX mở khoá được).
- Công nhân đổi PIN chủ động khi đang đăng nhập (không cần QLSX) chưa có; hiện đổi PIN = nhờ QLSX "Cho đặt lại PIN".
- Dữ liệu test local: tài khoản `phoi.c` (PIN tự đặt trong lúc thử, không ghi ở đây).
- Chưa commit (BE + FE).

## 26. ĐÃ LÀM 3 việc còn thiếu trong plan: nhắc QLSX, công đoạn phụ tách đợt theo người, "đã báo/cần" + cảnh báo vượt trên thẻ chờ gửi KCS (2026-10-13) — ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Người dùng: "làm việc 1 đến 3 đi" (3 việc code còn thiếu so với plan v10, xem câu trả lời "phần nào chưa làm"), kèm dặn "suy nghĩ kỹ rồi hẳn thực hiện".

### 26.1. Đã làm
1. **Nhắc QLSX** (2 loại thông báo mới, người nhận = role QLSX, link tới màn "Sản lượng xưởng"):
   - `FLOOR_STAGE_COMPLETE` (ACTION_REQUIRED): tổ báo ĐỦ số cần của PI đang chạy → "kiểm các đợt chờ rồi Chuyển PI tiếp". Tự đóng khi QLSX chuyển PI.
   - `FLOOR_BATCH_STALE` (ACTION_REQUIRED/WARNING): có đợt chờ gửi KCS quá **4 giờ** (tính từ lần báo còn hiệu lực đầu tiên). Mỗi tổ 1 thông báo, tự đóng khi hết đợt quá hạn.
   - `FloorAlertsService`: kiểm tra (a) ngay sau MỖI thao tác ghi của `/floor/*` (gom 3 giây, chạy nền, không chặn request), (b) quét định kỳ 10 phút (bắt cả báo từ màn thống kê cũ), (c) 60 giây sau khi BE khởi động. Tắt bằng `FLOOR_ALERTS=off`; không chạy khi test.
   - **Không nhắc lặp**: `NotificationsService.emit()` với `dedupeKey` đang mở sẽ GỘP vào thông báo cũ và đánh dấu CHƯA ĐỌC lại → quét 10 phút/lần sẽ làm QLSX bị nhắc đi nhắc lại. Nên service tự tra thông báo đang mở trước, có rồi thì bỏ qua (test riêng). Chỉ là nhắc, không chặn và không tự chuyển PI.
2. **Công đoạn phụ (Uốn/Dập/…) tách đợt theo công nhân**: migration `20261013120000_step_batch_reported_by` (`step_batches.reportedById`, `step_bundles.reportedById`, backfill từ sổ `floor_reports`). `recordStepBatch` lưu người báo; `submitStepBundle(…, worker?)` — có `worker` thì CHỈ gom lần báo của người đó và gắn người vào `StepBundle` (KCS chấm biết của ai); `worker.id = null` = đợt cũ chưa biết người; không truyền (màn Phôi cũ) = gom hết như trước (tương thích). Màn QLSX hiện mỗi người 1 nhóm (cùng PI/loại sắt/công đoạn/SKU vẫn tách), `Gửi KCS` gửi đúng nhóm của người đó. Đợt cũ chưa gắn SKU: nút Gửi KCS khoá + giải thích (trước đây có thể lỗi `g.order!`).
3. **Thẻ "Chờ gửi KCS" hiện "đã báo / cần" + cảnh báo vượt**: mỗi cỡ đoạn/mảnh "441mm: đã 78/60 · vượt 18" (số của ĐÚNG SKU; đợt cũ không gắn SKU dùng số cả PI), viền vàng + nhãn "N có cảnh báo vượt" ở đầu danh sách; đợt Phôi thêm "⚠ Đoạn báo vượt sắt đã nhận 12,2 m (nhận 11 cây)" (sắt vào – đoạn ra, mục 21.1.4). Hộp xác nhận Gửi KCS / Gửi tất cả nhắc rõ các cảnh báo (nút chuyển màu nguy hiểm). **Vẫn KHÔNG chặn gửi** (quy tắc "không cap lúc báo, KCS là chốt kiểm soát"). Lấy tiến độ lỗi thì thẻ chỉ không có số cần, danh sách vẫn hiện.
4. **Sửa kèm**: "chờ bao lâu" nay tính từ **lần báo còn hiệu lực đầu tiên** (bỏ lần đã đảo), không phải lúc mở đợt (đợt mở sáng, báo thêm chiều trước đây hiện chờ lâu hơn thật); dùng chung cho thẻ, dấu ⚠ và thông báo quá hạn.

### 26.2. Kiểm tra
- BE: cả bộ **1584 pass / 1 skip** (+19: `floor-alerts` 9, `floor-review-list` 7, `steel-issues` +3), **`nest build` không lỗi** (kiểm riêng vì `tsc --noEmit` từng bỏ sót, mục 24.2), eslint sạch (1 cảnh báo `any` có sẵn). FE: `tsc` sạch, vitest 103/103.
- Live-test local:
  - Công đoạn phụ: tạo máy UON-01 (STEP/UON); phoi.a báo 5 đoạn 441 + 2 đoạn 405, phoi.c báo 3 đoạn 441 → màn QLSX ra **2 nhóm riêng** (An 7 đoạn, Cường 3 đoạn), "đã 8/60" tính chung 2 người; gửi KCS nhóm của An → `StepBundle` 21 chứa đúng 2 lần báo của An, `reportedById` = An; nhóm của Cường vẫn chờ.
  - Nhắc: đợt Hàn chờ > 4 giờ → đúng **1** thông báo "Tổ Hàn: 2 đợt chờ gửi KCS quá 4 giờ" (không lặp qua nhiều lần thao tác ghi); gửi KCS hết các đợt Hàn → thông báo tự **đóng** (resolved).
  - Trên giao diện: thẻ Cắt viền vàng "441mm: đã 78/60 · vượt 18" + "⚠ Đoạn báo vượt sắt đã nhận 12,2 m"; thẻ Uốn "Lê Cường" riêng; hộp xác nhận Gửi KCS in đúng dòng "⚠ Cảnh báo: 441mm báo 78/60 (vượt 18); đoạn báo vượt sắt…".
  - Chưa thử tận mắt nhắc "tổ báo đủ số" trên dữ liệu thật (cần 1 PI báo đủ số cần) - đã có test đơn vị cho nhánh này.

### 26.3. Còn treo
- KCS chưa hiện "công nhân" của đợt công đoạn phụ (dữ liệu `StepBundle.reportedById` đã có, chưa hiển thị ở màn KCS).
- Màn Phôi cũ vẫn gom công đoạn phụ cả nhóm (gọi `submitStepBundle` không worker) - xử lý khi ẩn màn cũ (mục 24.4 #2).
- Nhắc chưa có "giờ làm việc": đợt báo cuối ca chiều sẽ nhắc lúc 4 giờ sau kể cả ban đêm (1 thông báo/tổ, không lặp).
- Đợt cũ trước 2026-10-12 không có sổ báo nên không được tính vào nhắc quá hạn.
- Dữ liệu test local thêm: máy UON-01, đợt Uốn của Cường (đang chờ), đợt cắt 55 (đang chờ, báo vượt 18), thông báo quá hạn đã đóng.
- Chưa commit (BE + FE).

## 27. Địa chỉ ERP dùng cho tem QR — cấu hình ở màn Admin; ghi nhận yêu cầu mới "chỉ đăng nhập được từ mạng công ty" (2026-10-13) — ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Người dùng hỏi tem QR khi đang ở local thì sao, rồi nêu: hiện chỉ chạy local, **đưa lên hệ thống thật (https://erpdna.vercel.app) thì mới gắn địa chỉ web vào**; và dặn "địa chỉ đó để cho màn admin config". Làm theo đó.

### 27.1. Đã làm
- **`SystemConfig.floorPublicUrl`** (migration `20261013130000_system_config_floor_public_url`, cột nullable): địa chỉ gốc in lên tem (`scheme://host[:port]`). **Theo từng môi trường (mỗi DB 1 giá trị)**: mã QR của máy chỉ có nghĩa trên hệ thống chứa máy đó, nên máy local để TRỐNG (tem từ local trỏ về địa chỉ đang mở), chỉ điền khi lên hệ thống thật. Tem in từ local mà gắn địa chỉ thật sẽ báo "Mã QR không còn dùng" vì máy thật không có mã đó.
- **Admin đặt ở "Cấu hình hệ thống"** (ô mới "Địa chỉ ERP dùng cho tem QR máy xưởng" + giải thích): dùng `PUT /system-config` sẵn có (quyền `SYSTEM_CONFIG:UPDATE`, nhật ký ghi ai đổi vì `SystemConfig` nằm trong AUDITED_MODELS). `normalizePublicUrl()` chuẩn hoá: dán cả `https://erpdna.vercel.app/login` → `https://erpdna.vercel.app`; thiếu `http(s)://` → https; rỗng → xoá; chặn giao thức lạ, nhúng mật khẩu, tên miền thiếu. Không gửi field = giữ nguyên.
- **QLSX chỉ ĐỌC** (`GET /floor/settings`, tab "Máy & tem QR" hiện thẻ "Địa chỉ trên tem": đã cài → "Tem trỏ về …"; chưa cài → "dùng địa chỉ đang mở … nhờ Admin điền ở Admin › Cấu hình hệ thống"). Cửa sổ xem tem/in tem dùng địa chỉ này; cảnh báo vàng nếu địa chỉ nội bộ (localhost/IP LAN - điện thoại không mở được), ghi chú xanh nếu địa chỉ đã cài khác nơi đang xem. (Bản đầu tôi làm ô sửa ngay trên tab QLSX; đã GỠ theo góp ý - `PATCH /floor/settings` không còn, 404.)
- Sửa nhỏ: bản đầu form dựng lại sau khi lưu làm mất dòng "Đã lưu" (đã gỡ cùng ô sửa).

### 27.2. Kiểm tra
BE: **1593 pass / 1 skip** (+9: chuẩn hoá địa chỉ 4, system-config 3, đọc cài đặt 2), `nest build` không lỗi, eslint sạch. FE: `tsc` sạch, vitest **106/106** (+3). Live-test API: QLSX đọc được; QLSX `PUT /system-config` → 403 (thiếu SYSTEM_CONFIG:UPDATE); `PATCH /floor/settings` → 404; Admin đặt `https://erpdna.vercel.app/login` → lưu `https://erpdna.vercel.app`; địa chỉ `ftp://…` → 400; xoá (rỗng) → null; sửa tên công ty không gửi field → không đụng địa chỉ. Giao diện Admin hiện ô mới. **DB local đã trả về trống** (đã thử đặt rồi xoá).

### 27.3. Lưu ý khi đưa lên hệ thống thật (https://erpdna.vercel.app)
- FE thật phải **deploy bản có trang `/floor`**; BE thật phải chạy 4 migration mới (từ mục 21 đến 27) + seed (role `FLOOR_WORKER`, quyền `FLOOR_REPORT`) và cấu hình `CORS_ORIGIN` cho `https://erpdna.vercel.app`; `NEXT_PUBLIC_API_BASE_URL` của FE thật trỏ về BE thật.
- Máy, công nhân, hàng đợi PI phải **tạo lại trên hệ thống thật** (dữ liệu local không sang); tem in từ ERP thật sau khi Admin điền địa chỉ.
- Có https nên camera quét QR trong app bật được.

### 27.4. YÊU CẦU MỚI từ Sếp Nhân (Zalo, 2026-10-13) — ĐÃ LÀM ở mục 28 (phạm vi: chỉ công nhân). Ghi chú lúc đó:
Người dùng hỏi Sếp "có nhất thiết phải là mạng công ty mới đăng nhập được hệ thống không?" - Sếp: **"cần á anh, nếu thiết kế được như vậy luôn thì càng ok"** → chỉ đăng nhập được khi đang ở **mạng công ty**. Ảnh hưởng: ERP đang ở Vercel (công khai) nên phải chặn theo IP công ty ở BE; điện thoại công nhân phải nối Wi-Fi công ty (4G không vào được); tem quét ngoài xưởng sẽ không đăng nhập được. Cần chốt trước khi làm: (1) phạm vi - mọi tài khoản hay chỉ công nhân; Sếp/Admin có được vào từ xa không; (2) cách nhận biết mạng công ty - danh sách IP công cộng của công ty (cần IP tĩnh) hay cách khác; (3) chỉ chặn lúc đăng nhập hay chặn cả phiên đang mở; (4) khi đi sau proxy (Vercel/hosting BE) phải đọc đúng IP thật của client.

## 28. ĐÃ LÀM giới hạn mạng công ty cho công nhân (2026-10-13) — ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Yêu cầu ở 27.4. Người dùng hỏi Sếp Nhân "áp cho công nhân thôi hay tất cả" → Sếp: **"công nhân thôi, ai mà có cái chức năng quét mã á"**. Làm theo đó.

### 28.1. Đã làm
- **Phạm vi** (`isNetworkRestrictedAccount`): tài khoản có chức năng quét mã = role `FLOOR_WORKER` + tài khoản tổ Phôi/Hàn/Sơn (mfgRole PHOI/HAN/SON, cũng quét/báo được). **KHÔNG áp** cho Sếp, QLSX, KCS, thủ kho, Admin (Admin còn cần vào từ ngoài để sửa danh sách).
- **Danh sách IP**: `SystemConfig.floorAllowedIps` (migration `20261013140000_system_config_floor_allowed_ips`, mặc định rỗng). **Rỗng = tắt** (mặc định và máy local). Admin sửa ở Cấu hình hệ thống (`PUT /system-config`, có nhật ký ai đổi): mỗi dòng 1 IP (IPv4/IPv6 cụ thể) hoặc dải IPv4 CIDR `/8–/32` (`/0–/7` bị từ chối vì gần như "cho cả Internet"; IPv6 chưa hỗ trợ dải); chuẩn hoá + bỏ trùng; 1 dòng sai → 400 nêu rõ dòng.
- **Chặn ở 4 chỗ** (`NetworkAccessService` nhớ danh sách 30 giây, Admin lưu xong xoá cache ngay trên instance đang xử lý):
  1. **Đăng nhập**: kiểm tra SAU khi PIN/mật khẩu đúng (người ngoài dò tài khoản không phân biệt được "tên không tồn tại" với "tài khoản công nhân"; công nhân đúng PIN mà ở ngoài được báo rõ "Tài khoản công nhân chỉ dùng được khi nối mạng (Wi-Fi) của công ty…"); KHÔNG tính vào số lần nhập sai (không bị khoá oan).
  2. **Đặt PIN lần đầu** (kể cả bước báo `PIN_SETUP_REQUIRED`): phải ở mạng công ty → người ngoài không giành đặt PIN trước công nhân (giảm rủi ro "ai biết tên đăng nhập" ở 25.3).
  3. **Gia hạn phiên (refresh)**: ở ngoài không gia hạn, KHÔNG thu hồi token (về lại mạng công ty dùng tiếp được).
  4. **Mọi request** (`NetworkAccessGuard`, chạy ngay sau JwtAuthGuard): công nhân mang điện thoại ra khỏi mạng công ty mất quyền NGAY (không chờ token 15 phút hết hạn).
- **IP thật của client sau proxy**: BE trước đây không khai `trust proxy` nên sau Render/Cloudflare sẽ chỉ thấy IP proxy. Thêm biến **`TRUST_PROXY_HOPS`** (số lớp proxy, mặc định 0 = chạy local; production sau Render đặt 1) → `app.set('trust proxy', n)`. Dùng SỐ LỚP (không dùng `true`) để client không giả được header `X-Forwarded-For`. Cũng sửa luôn IP ghi vào refresh token (trước đó cũng là IP proxy).
- **Màn Admin**: ô "Mạng công ty được phép đăng nhập (công nhân)" + nút **"Thêm IP hiện tại của tôi"** (`GET /system-config/my-ip`: IP mà BE thấy). Nếu IP là nội bộ/loopback thì cảnh báo "BE chưa thấy IP thật (chạy thử, hoặc chưa khai TRUST_PROXY_HOPS)" và KHÔNG tự thêm. Hiện trạng thái "Đang BẬT (n mục)" / "Đang tắt" và nói rõ ai bị giới hạn, 4G bị chặn.

### 28.2. Kiểm tra
- BE: **1635 pass / 1 skip** (+42: IP util 21, service 6, guard 3, auth 8, system-config 4), `nest build` không lỗi, eslint sạch. FE: `tsc` sạch, vitest 106/106.
- Live-test API (local): Admin xem IP BE thấy (`::1`, nội bộ); bật giới hạn chỉ cho `203.0.113.0/24` → **phiên công nhân đang mở bị 403 ngay**, đăng nhập mới đúng PIN → 403 có thông báo; QLSX và Admin KHÔNG bị chặn; thêm `::1` → công nhân đăng nhập được; sai PIN vẫn là lỗi thường; `0.0.0.0/0` → 400; tắt (danh sách rỗng) → mọi thứ như cũ. **DB local đã trả về trống** (`floorAllowedIps = {}`).
- Kiểm tra proxy bằng 1 bản BE tạm `TRUST_PROXY_HOPS=1`: `X-Forwarded-For: 203.0.113.9` → BE thấy `203.0.113.9`; client giả mạo `1.1.1.1, 203.0.113.9` → vẫn `203.0.113.9`; không có header → `::1`.
- Giao diện Admin: ô mới hiện, nút "Thêm IP hiện tại" báo đúng "IP nội bộ, chưa thêm".

### 28.3. Khi đưa lên hệ thống thật
- **BẮT BUỘC đặt `TRUST_PROXY_HOPS`** trên BE thật (số lớp proxy/CDN trước app; Render thường 1). Đặt sai hoặc quên → BE thấy IP proxy: bật giới hạn sẽ chặn nhầm cả công nhân. Luôn kiểm bằng nút "Thêm IP hiện tại của tôi" từ mạng công ty TRƯỚC KHI bật (phải ra IP công cộng của công ty, không phải IP nội bộ).
- Công ty cần **IP công cộng cố định** (hỏi nhà mạng/IT). IP đổi thì công nhân bị chặn - sửa danh sách ở Cấu hình hệ thống (Admin không bị chặn nên luôn sửa được).
- Thử trên điện thoại thật: Wi-Fi công ty → vào được; 4G → bị chặn với thông báo rõ.

### 28.4. Còn treo / lưu ý
- Kênh realtime (socket) chưa kiểm tra mạng: công nhân ngoài mạng vẫn mở được socket nhưng mọi API đều bị chặn, và sự kiện chỉ mang tên topic (không có dữ liệu).
- Khi công nhân đổi sang 4G giữa chừng: request kế tiếp 403, thông báo hiện ở lần lưu; phiên không bị huỷ (về lại Wi-Fi công ty dùng tiếp, nếu token còn hạn hoặc refresh được).
- Danh sách chỉ nhận IPv4 dải CIDR; IPv6 phải liệt kê từng địa chỉ. Công ty dùng IPv6 thì cần nhập đúng địa chỉ BE thấy.
- Chưa có thông báo cho QLSX khi công nhân bị chặn (có thể thêm nếu cần để biết ai đang thử đăng nhập từ ngoài).
- Chưa commit (BE + FE).

### 28.5. Hai địa điểm: văn phòng Quy Nhơn (thử trước) và xưởng Tây Sơn (làm sau) — ghi chú theo từng dòng
Người dùng: "hiện tại test với mạng công ty trên văn phòng ở Quy Nhơn trước, còn mạng ở xưởng ở tận Tây Sơn". Hai địa điểm = hai IP công cộng khác nhau. Danh sách IP vốn đã nhận nhiều dòng; thêm **ghi chú sau `#`** để Admin phân biệt: `203.0.113.5 # Văn phòng Quy Nhơn`, `198.51.100.7 # Xưởng Tây Sơn` (≤ 60 ký tự, khớp IP bỏ qua ghi chú, trùng địa chỉ thì giữ dòng có ghi chú). Màn Admin: ô "Tên mạng" cạnh nút "Thêm IP hiện tại của tôi".
- Cách làm: giai đoạn thử, Admin mở Cấu hình hệ thống từ mạng văn phòng Quy Nhơn → ghi "Văn phòng Quy Nhơn" → "Thêm IP hiện tại của tôi" → Lưu; công nhân thử trên Wi-Fi văn phòng. Khi đưa vào xưởng, Admin mở màn này từ Wi-Fi xưởng Tây Sơn (Admin không bị chặn) → ghi "Xưởng Tây Sơn" → thêm; hoặc xin IP của IT/nhà mạng xưởng. Sau đó có thể bỏ dòng văn phòng nếu không muốn công nhân dùng ở văn phòng.
- Cần kiểm tra IP xưởng có **cố định** không (ở tỉnh thường là cáp quang gói gia đình/4G router có thể đổi IP hoặc dùng chung IP với nhiều khách - CGNAT; khi đó đặt theo IP sẽ chặn nhầm/hở). Nếu không cố định: xin IP tĩnh từ nhà mạng, hoặc dùng VPN/tên miền động.
- Kiểm tra: BE **1639 pass / 1 skip** (+4), `nest build` không lỗi, FE vitest 106/106. Live-test: lưu 3 dòng có ghi chú (chuẩn hoá khoảng trắng, bỏ trùng) → công nhân từ `::1` đăng nhập được; bỏ `::1`, chỉ còn 2 địa điểm thật → bị chặn 403; DB local đã trả về trống.

### 28.6. Triển khai trên Render: số lớp proxy + công cụ chẩn đoán (2026-10-14)
Người dùng xác nhận BE đặt ở **Render** (FE ở Vercel `https://erpdna.vercel.app`).
- **Vì sao phải chẩn đoán thay vì đặt cứng 1:** tài liệu Render không nói rõ số lớp proxy; Render nối `X-Forwarded-For` thêm IP của chính nó và KHÔNG lọc header client gửi lên, nên dùng `trust proxy` kiểu `true` sẽ bị giả IP. Có thể có Cloudflare phía trước (khi đó 2 lớp). Chỉ cách đo thực tế mới chắc.
- **Đã làm (BE):** `GET /system-config/my-ip` trả thêm `forwardedFor` (chuỗi `X-Forwarded-For` BE nhận) và `trustProxyHops` (số lớp BE đang tin) → [system-config.controller.ts](../src/modules/system-config/system-config.controller.ts). Controller nhận thêm `ConfigService`.
- **Đã làm (FE):** nút "Thêm IP hiện tại của tôi" ở Cấu hình hệ thống hiện tooltip chuỗi trên, và dòng hướng dẫn "mở trang 'what is my ip' trên cùng máy — phải ra đúng IP đang hiện; khác thì chỉnh TRUST_PROXY_HOPS" (chỉ hiện khi IP là IP công cộng).
- **`render.yaml`:** thêm `TRUST_PROXY_HOPS` (mặc định `'1'`, có chú thích). Blueprint sync sẽ ghi đè giá trị chỉnh tay trên dashboard nên nếu đổi số thì sửa trong file này.
- **Quy trình đo (làm TRƯỚC khi bật danh sách IP):** (1) deploy với `TRUST_PROXY_HOPS=1`; (2) Admin mở Cấu hình hệ thống từ Wi-Fi văn phòng Quy Nhơn, bấm "Thêm IP hiện tại của tôi"; (3) mở "what is my ip" trên cùng máy so sánh: trùng → giữ 1; ra IP của Cloudflare/Render (khác IP văn phòng) → đổi `TRUST_PROXY_HOPS=2`, deploy lại, đo lại; (4) khi trùng mới Lưu danh sách. Không bao giờ đặt `true`.
- **Các bước còn lại khi lên Render** (không đổi code): migration tự chạy mỗi lần deploy (`docker/entrypoint.js` → `prisma migrate deploy`, 7 migration mới của QR/PIN/IP); **seed phải chạy tay** trên DB thật để tạo role `FLOOR_WORKER` + quyền `FLOOR_REPORT` (seed cũng đồng bộ quyền của mọi role theo code); `CORS_ORIGIN=https://erpdna.vercel.app`; deploy FE có trang `/floor`; tạo máy/công nhân/hàng đợi trên môi trường thật; Admin điền "Địa chỉ ERP dùng cho tem QR" rồi in tem.
- **Kiểm tra:** `nest build` không lỗi, jest các thư mục auth + common + system-config 126/126, eslint sạch, FE `tsc` + eslint sạch. Chưa thử trên Render thật (cần deploy).
- **Còn treo:** số lớp proxy thật trên Render (đo ở bước trên); IP xưởng Tây Sơn có cố định không (28.5); chưa commit (BE + FE).

## 29. Test local toàn diện trước khi lên Render (2026-10-14) — KHÔNG phát hiện lỗi code; ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Người dùng yêu cầu "test ở local trước, kỹ càng". Không sửa code ở mục này; chỉ chạy test và ghi kết quả.

### 29.1. Môi trường & cách làm
- Docker Desktop đang tắt → bật lại; Postgres dev (`dna-erp-be-postgres-1`) và Postgres test (cổng 5433, rỗng) đều lên.
- **Backup DB dev trước khi test**: `backups/dna_erp_20261014_pre-local-test.dump` (thư mục `backups/` đã gitignore). Test xong đã **khôi phục DB dev về đúng như trước** (143 migration, 4 công nhân, 4 máy, 19 báo cáo, 4 dòng hàng đợi, danh sách IP rỗng) để không để lại công nhân/báo cáo thử.
- Kịch bản API viết bằng Node (`fetch`) có assert; chạy trên BE dev :3001 (và 2 bản BE tạm :3002/:3003 để mô phỏng proxy, đã tắt). Script nằm ở thư mục tạm của phiên, **chưa đưa vào repo**.

### 29.2. Kết quả
| Hạng mục | Kết quả |
|---|---|
| Jest BE (75 suite) | 1639 pass / 1 skip có sẵn |
| Vitest FE | 106/106 |
| `tsc` BE + FE, `nest build` | sạch |
| eslint | BE sạch; FE còn đúng 2 lỗi cũ ở `SpecSteelPage.tsx` (không phải của việc này) |
| **DB sạch (giống lần deploy đầu trên Render)** | `prisma migrate deploy` trên DB rỗng: áp đủ, `migrate diff` so `schema.prisma`: **không lệch**, `npm run seed`: 15 role (có `FLOOR_WORKER`) |
| Đăng nhập / tự đặt PIN / khoá 5 lần / mở khoá / reset / phân quyền | **46/46** |
| Nhận sắt → báo cắt → chống trùng (kể cả 5 request song song cùng key) → đợt riêng từng công nhân → cảnh báo vượt → "Sản lượng của tôi" → đảo có lý do → gửi KCS | 64/68 lần đầu; 4 lỗi đều là **giả định sai của test** (xem 29.3), đã chạy lại phần liên quan: đạt hết |
| Công đoạn uốn + tổ Hàn (mảnh): chặn uốn quá số đã cắt, đợt riêng từng người, gửi KCS không kéo theo người khác | đạt (1 lỗi nhỏ là nhóm cũ cùng tên hiển thị từ lần chạy trước, không phải lỗi hệ thống) |
| Hàng đợi PI: xếp / trùng / sắp xếp / gỡ / "Chuyển PI tiếp" (kể cả 3 lệnh song song → không bao giờ 2 PI cùng chạy) | 19/19 |
| Địa chỉ tem QR: chuẩn hoá `/login`, thiếu `https://`, chữ hoa, cổng; từ chối `ftp:`, `javascript:`, có user:pass, thiếu tên miền | đạt |
| Giới hạn mạng: nhập sai (`0.0.0.0/0`, `/7`, IPv6 CIDR, ghi chú quá dài…) → 400 và không ghi dở; bật → chặn đăng nhập đúng PIN, đặt PIN, gia hạn phiên, phiên đang mở; sai PIN vẫn lỗi thường (không lộ thông tin mạng); không tính vào lần sai; QLSX/KCS/Sếp/Admin/thủ kho không bị; tài khoản tổ Phôi bị | đạt (1 lỗi là chạm giới hạn 8 lần/phút, không phải lỗi hệ thống) |
| **Mô phỏng proxy Render** (BE tạm `TRUST_PROXY_HOPS=1` và `=2`) | **17/17**: lấy IP phải-nhất; client giả `X-Forwarded-For` đầu chuỗi không qua được; CIDR /24 xưởng khớp; có Cloudflare mà đặt 1 lớp → BE thấy IP Cloudflare và công nhân văn phòng bị chặn oan (đúng kịch bản cần đo trước); đặt 2 lớp → vào được |
| Nhắc QLSX | `FLOOR_BATCH_STALE` (đợt chờ quá 4 giờ) và `FLOOR_STAGE_COMPLETE` (PI đủ số) đều phát thật trong DB |
| **Giao diện** (375px công nhân; QLSX; Admin) | công nhân: tự đặt PIN (báo PIN yếu, hai lần không khớp), vào màn quét, "Tổ Phôi chưa có PI đang chạy…", báo cắt (banner "Đã lưu", tiến độ 12→17/60), "Sản lượng của tôi". QLSX: danh sách chờ gửi KCS + cảnh báo vượt/chờ lâu, **tự cập nhật khi công nhân báo (realtime)**, mở từng lần báo, đảo (lý do <3 ký tự khoá nút; có thông báo + dòng gạch ngang + lý do), gửi KCS (hộp xác nhận nói rõ không đảo được nữa), tab Công nhân, tab Máy & tem QR. Admin: ô địa chỉ tem, ô IP, "Tên mạng", nút "Thêm IP hiện tại" (local → báo IP nội bộ; phản hồi công cộng giả lập → hiện IP, hướng dẫn kiểm tra, số lớp proxy, chuỗi nhận được) |

### 29.3. Giả định sai của test (không phải lỗi code, hành vi hiện tại là đúng thiết kế)
- Cảnh báo "còn N lần" chỉ hiện ở **2 lần sai cuối** (code `attemptsLeft <= 2`), 2 lần đầu là lỗi chung — để gõ nhầm lần đầu không gây hoảng.
- `PUT /system-config` bắt buộc có `companyName` (các trường khác tuỳ chọn; trường sàn không gửi = giữ nguyên).
- Hàng đợi có ràng buộc duy nhất (tổ, PI): PI đã có dòng (kể cả DONE) không xếp lại được; báo bù cho PI đã xong đi qua cơ chế "làm lại".
- Báo cắt bị chặn khi loại sắt chưa được xác nhận nhận (đúng); sắt phải do thủ kho xuất đúng số còn thiếu, xuất vượt → 400.
- Cân đối sắt chỉ báo vượt khi tổng mm đoạn báo lớn hơn mm sắt đã nhận (kiểm bằng cách báo 200 đoạn → vượt 46.576mm, cỡ 460 vượt 152 đoạn; đã đảo lại).

### 29.4. Quan sát — mục 1 và 2 ĐÃ SỬA ở mục 30 (30.1, 30.2); mục 3 chưa
1. Bấm "Chuyển PI tiếp" nhầm thì không hoàn tác được (PI đó không xếp lại hàng đợi); chỉ còn báo bù qua "làm lại". Thông báo lỗi khi xếp lại PI đã xong là "đã có trong hàng đợi", hơi khó hiểu — có thể đổi thành "PI đã chạy xong ở tổ này, báo bù ở mục làm lại".
2. Tab "Công nhân" ở khung ~670px: cột nút thao tác bị cắt bên phải (bảng cuộn ngang được). Màn rộng bình thường không bị.
3. Hai công nhân trùng họ tên hiển thị giống hệt trên thẻ duyệt (chỉ là chuyện dữ liệu thật hiếm gặp; có thể thêm tên đăng nhập vào tooltip).

### 29.5. CHƯA test được / còn treo — quét camera (giả lập), màn nhận sắt, tổ Sơn ĐÃ test ở 30.3; image Docker ở 30.4
- **Quét QR bằng camera điện thoại thật** (cần https và thiết bị thật; trên local chỉ test được phần giải mã và luồng sau khi có mã).
- Màn nhận sắt trên giao diện (mới test bằng API); tổ Sơn (chưa có máy/công nhân trong dữ liệu).
- **Render thật**: số lớp proxy đo theo quy trình ở 28.6; seed chạy tay; IP xưởng Tây Sơn có cố định không.
- Chưa commit (BE + FE); `render.yaml` đã thêm `TRUST_PROXY_HOPS` nhưng chưa deploy.

## 30. Sửa 2 điểm ở 29.4 + test thêm các phần "chưa test được" (2026-10-14) — ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Người dùng hỏi "cách fix tối ưu" cho 2 quan sát ở 29.4 và "còn cách nào test phần chưa test được không". Đã làm cả hai.

### 30.1. "Chuyển PI tiếp" nhầm → thêm "Mở lại PI vừa chuyển" (BE + FE)
- **Vì sao chọn cách này:** chuyển nhầm không mất dữ liệu (báo cáo gắn theo PI, hàng đợi chỉ quyết PI nào là mặc định ở màn quét) nhưng công nhân quét sẽ ra PI sai và phải tự chọn "Bù lỗi". Hoàn tác là cách ít bất ngờ nhất. Không dùng "cho xếp lại PI đã xong" vì ràng buộc duy nhất (tổ, PI) là chủ đích và sửa nó đụng cả cơ chế "làm lại".
- **Quy tắc (BE, `FloorAdminService.reopenLast`, `POST /floor/queue/:stage/reopen`, chỉ QLSX):** PI đóng gần nhất của tổ chạy lại (giữ giờ bắt đầu cũ, xoá giờ kết thúc); PI đang chạy (nếu có) trở về hàng đợi, **giữ nguyên vị trí nên vẫn đứng đầu hàng**. **Chỉ làm khi PI đang chạy CHƯA có lần báo nào của công nhân tại tổ đó** — đã có người báo thì đó là lần chuyển có chủ đích, trả 409 nêu số lần báo và cách báo bù (mục "Bù lỗi"). Làm trong 1 transaction có khoá theo tổ, trả PI đang chạy về hàng đợi TRƯỚC khi mở PI cũ (mỗi tổ đúng 1 dòng RUNNING).
- **`listQueue` trả thêm `canReopen`:** chỉ `true` ở dòng DONE đóng gần nhất khi mở lại được → FE chỉ bày nút khi bấm được, không để QLSX bấm rồi mới bị từ chối.
- **FE (`QlsxQueue.tsx`):** link nhỏ "↶ Chuyển nhầm? Mở lại PI-xxx" cuối khối PI đang chạy; hộp xác nhận nói rõ hai PI sẽ ra sao. Nút tự biến mất khi PI đang chạy đã có người báo.
- **Lời báo khi xếp lại PI đã xong** đổi từ "đã có trong hàng đợi" thành lời nói rõ "đã chạy xong ở tổ…, vừa chuyển nhầm thì bấm Mở lại, muốn báo bù thì chọn ở mục Bù lỗi". (Giao diện vốn không đưa PI đã có dòng vào danh sách "Thêm PI" nên lời này chỉ gặp qua API hoặc khi 2 QLSX thao tác cùng lúc.)
- **Kiểm tra:** 7 test mới ở `floor-admin.service.spec.ts` (thứ tự cập nhật, tổ không có PI chạy, bị chặn khi đã có báo, chưa chuyển PI nào, `canReopen`, 2 lời báo xếp trùng); live-test API **19/19** (vòng chuyển → mở lại giữ đúng vị trí và giờ; bị chặn khi đã có báo + hàng đợi không đổi; công nhân 403; tổ sai 400; chưa đăng nhập 401); giao diện: nút hiện đúng, hộp xác nhận đúng chữ, bấm xong PI-040 chạy lại và PI-036 về đầu hàng, nút tự biến mất.

### 30.2. Tab "Công nhân" bị cắt ở khung hẹp (FE, `QlsxSetup.tsx`)
- Bảng 5 cột (họ tên / tên đăng nhập / tổ / trạng thái / nút) + nút `nowrap` → gộp thành **3 cột** (Công nhân = tên + "tên đăng nhập · tổ", Trạng thái, Thao tác), nút tự xuống dòng. Dưới 640px dùng **thẻ thay bảng** theo quy ước chung của FE (`useIsMobile`).
- Kiểm tra: ở 668px bảng vừa khít (573/573, không tràn); ở 375px hiện thẻ, không có bảng, trang không tràn ngang.

### 30.3. Các phần "chưa test được" ở 29.5 — test được thêm bằng cách nào
- **Quét QR bằng camera:** dùng "camera giả" (canvas phát hình mã QR của tem thật, trả qua `getUserMedia` giả) ở màn công nhân 375px. Chạy đúng đường **jsQR** (trình duyệt thử không có `BarcodeDetector` = đường của iPhone Safari). Kết quả: xin camera sau (`facingMode: environment`, không bật mic); chữ thường không phải tem → "Mã này không phải tem máy của xưởng", bộ quét vẫn mở; **tem giả trỏ tên miền lạ → chỉ lấy mã, không bao giờ mở link lạ**, app ở lại đúng miền và báo "Mã QR không còn dùng"; tem máy uốn thật → tự đóng bộ quét và chuyển sang "Báo Uốn · UON-01"; tem khu nhận sắt → mở màn nhận sắt. **Còn lại chỉ phần cứng thật**: hộp xin quyền camera, lấy nét/ánh sáng, iOS thật.
- **Màn nhận sắt trên giao diện:** thủ kho xuất phiếu thật (14 cây) → công nhân quét tem khu nhận sắt → ô đếm được điền sẵn số kho xuất → đổi 13 → "Đã nhận 13/14 cây".
- **Tổ Sơn (API 16/16):** tạo điểm sơn, công nhân Sơn tự đặt PIN, xếp/chuyển PI, báo mảnh có chống trùng, QLSX thấy đợt Sơn và gửi KCS, chặn chéo tổ (Sơn↔Phôi↔Hàn), `summary` có tổ SON.

### 30.4. Chạy thử image Docker production (đúng đường Render) trên DB sạch
- Build từ **bản sao sạch của repo** (chỉ gồm file git sẽ có: `git ls-files -co --exclude-standard`, không `node_modules`/`dist`/`.env`) → đồng thời xác nhận **7 migration mới, module `floor`, module `network`, `render.yaml` đều nằm trong tập file sẽ commit (không bị gitignore nhầm)**. Build thành công (`nest build` bên trong image), image 948MB.
- Chạy container với cấu hình y như `render.yaml` (`NODE_ENV=production`, `CORS_ORIGIN=https://erpdna.vercel.app`, `TRUST_PROXY_HOPS=1`) trên **DB rỗng**: `entrypoint` tự áp đủ **143 migration** ("All migrations have been successfully applied"), app lên, health 200.
- **Seed không chạy được trong container**: image production cài `--prod` nên **không có `ts-node`/`tsc`** (đã kiểm tra). Trên Render phải seed **từ máy dev** bằng URL NGOÀI của DB Render: `DATABASE_URL=<URL ngoài> npm run seed` (idempotent; tạo role `FLOOR_WORKER`, quyền `FLOOR_REPORT`, đồng bộ quyền các role). Lệnh `npm run seed` chạy trong Shell của Render sẽ lỗi `ts-node: not found`.
- Smoke test vào container **18/18**: CORS (cho phép `https://erpdna.vercel.app` + header `Idempotency-Key`, từ chối tên miền lạ); chẩn đoán proxy (XFF → đúng IP, giả đầu chuỗi vô hiệu, `trustProxyHops=1`); QLSX tạo máy + công nhân, công nhân tự đặt PIN (argon2 chạy được trên alpine), quét máy; giới hạn mạng qua XFF (văn phòng vào được, 4G và giả mạo bị chặn, phiên đang mở ra mạng ngoài bị chặn, Admin không bị chặn).
- Đã dọn: container, image, thư mục build tạm; DB test về rỗng; DB dev khôi phục lại từ backup (143 migration, 4 công nhân, 19 báo cáo, danh sách IP rỗng).
- Gặp khi dựng: `seed:demo` lỗi P2002 nếu admin seed đặt tên đăng nhập `admin` (trùng tài khoản demo `admin@demo.com`) — lỗi cục bộ đã biết, không ảnh hưởng Render (không chạy seed:demo).
- **Còn treo (cần Render/thiết bị thật):** số lớp proxy thật trên Render (đo theo 28.6); hộp xin quyền camera, lấy nét, iOS thật; IP xưởng Tây Sơn có cố định không; chưa commit (BE + FE).


## 31. KẾ HOẠCH cải thiện UI/UX phần QR (2026-10-14) — GĐ1 ĐÃ LÀM ở mục 32; bước 0 và GĐ2–4 CHƯA LÀM, chờ chốt D1/D3/D4 ở 31.5 (D2 đã chốt theo đề xuất)
Bối cảnh: tự chấm UX khoảng **7/10** (mục tiêu **≥ 8.5**). Điểm trừ lớn nhất là chưa có người dùng thật thử ở xưởng; kế tiếp là chịu mạng yếu, truy cập (tương phản), và ô nhận sắt điền sẵn số.

### 31.1. Hai điều chỉnh sau khi đọc lại code (so với lần chấm trước)
- **Mất sóng:** số đã nhập KHÔNG mất ngay — `ReportTab.send` chỉ xoá ô khi thành công, và `useRetrySafeKey` giữ nguyên khoá khi không có phản hồi. Lỗ hổng thật: (a) phải bấm gửi lại thủ công; (b) mất số khi tải lại trang / điện thoại tắt trình duyệt nền; (c) không có chỗ nào cho công nhân thấy "còn N lần báo chưa gửi".
- **Tương phản:** `--text3` nền sáng `#9a9a94` trên `#f5f5f3` ≈ **2.6:1** (tự tính, chuẩn AA chữ nhỏ là 4.5:1); `--text2` ≈ 6.3:1 đạt; nền tối `--text3` ≈ 5.4:1 đạt. Chữ phụ trên màn công nhân (13px, như "Đã cắt 17/60 · còn 43") đang rơi vào vùng này. Phải đo lại bằng Lighthouse/axe (31.3, bước 0).
- Cỡ chạm đã ĐẠT (nút chính 52px, ô nhập 48px, chip 44px, bàn phím số `inputMode="numeric"`) — không cần sửa.

### 31.2. Nguyên tắc xếp thứ tự
1. **Đo trước khi đoán:** thử với công nhân thật chạy song song từ đầu, kết quả quyết định phần ưu tiên của giai đoạn sau.
2. **Việc ảnh hưởng độ tin cậy số liệu làm trước việc đẹp/nhanh.**
3. **Việc đụng chính sách thì hỏi Sếp trước khi code** (31.5).
4. **FE-only trước, BE sau:** giai đoạn 1–2 gần như chỉ FE; không migration.
5. **Không phình scope:** không làm offline đọc dữ liệu, không làm app native, không đổi luồng quét (đã tốt).

### 31.3. Các giai đoạn
**Bước 0 — Đo (song song, không code, ~1 ngày chuẩn bị + 1 ca thử):**
- *Thử với 3–5 công nhân thật*, 1 máy laser làm pilot, QLSX đi cùng, 4 nhiệm vụ: (1) lần đầu đặt PIN, (2) quét + báo 2 cỡ, (3) nhận sắt có chênh, (4) sửa số báo nhầm. Ghi: thời gian từ mở mã đến lưu, số lần sai/phải hỏi, găng tay/ánh sáng/tay bẩn, chỗ sóng Wi-Fi yếu. Tiêu chí: ≥ 4/5 xong cả 4 việc không cần giúp; không có lần báo nhầm PI.
- *Audit truy cập baseline* bằng Lighthouse/axe: màn công nhân (đăng nhập, báo, nhận sắt, "Sản lượng của tôi") + 3 tab QLSX + Cấu hình hệ thống. Mục tiêu sau sửa: Lighthouse Accessibility ≥ 95, mọi chữ trên màn công nhân ≥ 4.5:1.

**Giai đoạn 1 — Làm nhanh, FE (~1.5–2 ngày) — ĐÃ LÀM, xem mục 32:**
| # | Việc | Làm thế nào | Nghiệm thu |
|---|---|---|---|
| 1.1 | **Nhận sắt: bỏ điền sẵn** | Ô đếm trống; chip "Đủ N cây" bấm để ĐIỀN vào ô (không gửi); nút xác nhận chỉ bật khi có số; nếu chênh ≠ 0 thì hộp xác nhận "Thiếu/Thừa N cây — kho và QLSX sẽ được báo". | Không thể xác nhận khi chưa có số; test giao diện 375px. |
| 1.2 | **Tương phản + cỡ chữ** | Ghi đè token **chỉ trong phạm vi `/floor`** (`--text3` → tối hơn, ≥ 4.5:1) — KHÔNG đổi token toàn ERP; chữ phụ 13→14px; "còn N" in đậm to hơn; trạng thái ngoài màu còn có biểu tượng + chữ. | Đo lại bằng axe ≥ 4.5:1; ERP khác không đổi giao diện. |
| 1.3 | **Truy cập** | Banner "Đã lưu/Lỗi" có `role="status"`/`aria-live`; vòng focus thấy rõ; kiểm khoá focus của hộp thoại; nhãn cho mọi ô. | Lighthouse A11y ≥ 95. |
| 1.4 | **Bộ quét** | Nút **đèn pin** khi `getCapabilities().torch` có (Android Chrome; iOS không có thì ẩn); **rung** `navigator.vibrate` + **bíp ngắn** khi quét được (bíp sau cử chỉ chạm nên không bị chặn); khung ngắm + chữ "Đang tìm mã…"; dòng "Không quét được? Mở tem bằng app camera của điện thoại hoặc báo QLSX". | Thử bằng camera giả (đã có cách ở 30.3) + máy thật khi có. |
| 1.5 | **Lời lỗi mạng** | Tách "mất mạng" (tự gửi lại ở GĐ2) khỏi "máy chủ từ chối" (đọc lý do, sửa số); hiện giờ đã gửi. | Test thủ công DevTools offline. |

**Giai đoạn 2 — Độ tin cậy ngoài xưởng (~3–4 ngày):**
- **2.1 Hàng chờ gửi lại (FE):** báo chưa gửi được (mất mạng / quá thời gian, `statusCode 0`) lưu vào `localStorage` gồm userId + máy + `Idempotency-Key` + nội dung + giờ bấm; banner "Có N lần báo chưa gửi — sẽ tự gửi lại"; tự gửi khi có mạng (`online` + 15 giây, giãn dần); BE trả 4xx thì chuyển sang "Bị từ chối" kèm lý do + nút bỏ. **Chốt chặn:** (a) chờ quá **30 phút** thì hỏi lại công nhân xác nhận trước khi gửi (số có thể đã lỗi thời so với PI/đợt); (b) không bao giờ gửi dưới user khác (đổi tài khoản → giữ riêng/hỏi); (c) đăng xuất khi còn hàng chờ → cảnh báo; (d) token hết hạn khi offline → làm mới rồi gửi tiếp. BE KHÔNG đổi (đã có chống trùng). Giới hạn cần biết: giờ ghi sổ = lúc BE nhận, không phải lúc bấm — nếu Sếp cần giờ thực thì thêm `clientReportedAt` (1 migration nhỏ) ở lần sau. Nghiệm thu: DevTools Offline → báo → bật mạng lại: lưu đúng 1 lần; tắt tab giữa chừng rồi mở lại: vẫn còn; đổi user; token hết hạn.
- **2.2 Công nhân tự huỷ lần báo nhầm — CẦN SẾP QUYẾT (D1):** đề xuất mặc định: chỉ lần báo CỦA MÌNH, đợt còn chưa gửi KCS, trong **5 phút**, tối đa 3 lần/ca; ghi như đảo (lý do "Công nhân tự huỷ"), QLSX vẫn thấy dòng gạch; không phát thông báo (tránh nhiễu) nhưng đếm để soi. BE: `POST /floor/reports/:id/cancel` dùng lại logic đảo hiện có. Rủi ro gian lận thấp (tăng rồi huỷ không có lợi) nhưng cần giới hạn + log.

**Giai đoạn 3 — Hiệu quả QLSX (sau pilot, ~3–4 ngày, chọn theo dữ liệu):** (1) "Đã gửi gần đây" (hôm nay) để kiểm lại/audit; (2) chỉ báo **máy im lặng** (PI đang chạy mà máy không có lần báo > X giờ); (3) chọn nhiều đợt rồi "Gửi KCS" (thay vì chỉ "tất cả"); (4) KCS thấy tên công nhân ở công đoạn phụ; (5) kéo-thả hàng đợi (↑↓ hiện đủ dùng — để sau cùng).

**Giai đoạn 4 — Cắt cửa (governance, sau khi pilot ổn) — CẦN SẾP QUYẾT (D3):** ẩn/chặn các màn báo cũ không qua QR của tổ Phôi/Hàn/Sơn. Còn đường cũ thì chống khai khống bằng QR vẫn bị vòng qua; nhưng cắt sớm khi công nhân chưa quen sẽ làm đứng xưởng.

**Pilot:** 1 máy laser + 3 công nhân, 1 tuần; theo dõi thời gian giữa các lần báo, số lần báo bị đảo, số lần phải hỏi QLSX; quyết định mở rộng/không.

### 31.4. Điểm kỳ vọng (ước lượng, không cam kết)
Sau GĐ1 ≈ 7.7 · sau GĐ2 ≈ 8.2 · sau khi sửa theo kết quả thử thật ≈ 8.5+ · GĐ3 nâng khía cạnh QLSX lên ~8.5. Tổng công dev GĐ1–3 ước ~9–11 ngày; GĐ1+2 khoảng 5–6 ngày.

### 31.5. Quyết định cần chốt trước khi làm
- **D1 (Sếp):** có cho công nhân tự huỷ lần báo nhầm không; nếu có thì cửa sổ 5 phút / 3 lần mỗi ca có hợp lý không.
- **D2 (bạn):** nhận sắt dùng "ô trống + chip Đủ N cây" như đề xuất 1.1 hay muốn "2 nút lớn Đủ / Thiếu-Thừa nhập số".
- **D3 (Sếp):** thời điểm cắt các màn báo cũ (sau pilot bao lâu).
- **D4 (bạn/QLSX):** máy + 3 công nhân nào làm pilot, ngày nào thử ca đầu.

### 31.6. Không làm (có chủ đích)
Chế độ offline đầy đủ (đọc dữ liệu khi mất mạng); app native; chế độ tối riêng cho màn công nhân; thay đổi luồng quét; đổi token màu toàn ERP.


## 32. ĐÃ LÀM giai đoạn 1 cải thiện UX màn công nhân (2026-10-14) — chỉ FE, ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Thực hiện giai đoạn 1 ở mục 31 (31.3). **Không đổi BE, không migration.** D2 (nhận sắt) làm theo đề xuất: ô trống + chip "Đủ N cây".

### 32.1. Đã làm (FE `D:\DNA-ERP`)
| # | Việc | Chi tiết |
|---|---|---|
| 1.1 | **Nhận sắt: bỏ điền sẵn** | Ô đếm để trống (placeholder "?"); chip "Đủ N cây" chỉ ĐIỀN vào ô, không gửi; nút khoá, ghi "Nhập số cây đếm được", đến khi có số; đúng số kho xuất thì gửi thẳng; **lệch thì hỏi lại 1 lần** ("Bạn đếm 13 cây, kho xuất 14 cây: thiếu 1 cây. Kho và QLSX sẽ được báo. Đã đếm kỹ chưa?" + "Đúng, nhận 13 cây" / "Đếm lại"); đổi số thì tự huỷ bước hỏi lại. |
| 1.2 | **Tương phản + cỡ chữ** | Token riêng `.floor-root` trong `globals.css` (`--floor-hint`, `--floor-primary`, `--floor-tab-active`), KHÔNG đổi token toàn ERP; chữ phụ 13→14px (9 chỗ); dòng cỡ đoạn: "Đã cắt 17/60 · **còn 43**" (đậm, 16px), "⚠ vượt N" / "✓ đủ" (không chỉ bằng màu); giờ lưu thành công hiện kèm "· 09:07". |
| 1.3 | **Truy cập** | `aria-pressed` cho mọi nút chọn (PI, SKU, loại sắt, mảnh); 1 `h1` (tên app) + `h2` tiêu đề từng màn; `tabpanel` + `aria-controls`/`aria-labelledby` (chỉ khi có tab); banner lỗi/mất mạng dùng `role="alert"`; hộp quét: focus vào nút Đóng khi mở và trả focus khi đóng; nhãn ô nhận sắt có tên loại sắt. (Đã có sẵn: banner `role`, `aria-modal`, focus-visible toàn cục, `lang="vi"`.) |
| 1.4 | **Bộ quét** | **Đèn pin** (chỉ hiện khi camera khai báo `torch`; Android Chrome có, iPhone không); **rung 80ms + bíp ngắn** khi quét được; sau **8 giây** chưa thấy mã hiện gợi ý ("Đưa lại gần hơn, giữ yên tay, tránh lóa hoặc bật đèn") và dòng dự phòng "Không quét được? Mở tem bằng app camera của điện thoại, hoặc báo QLSX". |
| 1.5 | **Lỗi mạng** | Tách "mất mạng" (banner vàng/`alert`: "Chưa gửi được vì mất kết nối. Số bạn nhập vẫn còn nguyên - có mạng thì bấm lưu lại, sẽ không bị cộng 2 lần.") khỏi "máy chủ từ chối" (đỏ, nguyên lý do tiếng Việt từ BE); 429 hiện "thao tác quá nhanh - đợi khoảng 1 phút" thay vì "ThrottlerException"; banner kết quả **tự cuộn vào tầm nhìn** (công nhân bấm Lưu ở thanh dưới khi đang kéo xuống thì trước đây không thấy). |
- File mới: `floorUi.ts` (logic thuần: `describeError`, `receiveVerdict`, `hhmm`, `scanFeedback`, `supportsTorch`, `setTorch`), `floorUi.test.ts`, `floorTheme.test.ts`. Sửa: `FloorScanApp.tsx`, `QrScanner.tsx`, `globals.css`.

### 32.2. Số đo (trước/sau)
- **Tương phản (tính từ token):** giao diện sáng chỉ `--text3` hụt (2.46–2.83:1); mọi màu trạng thái đạt (5.4–8.6:1). Giao diện tối: chữ trắng trên nút xanh 3.91:1, tab đang chọn 4.37:1. Sau sửa trong `/floor`: gợi ý `#66665f` (sáng, 5.0–5.8:1) / `#a3a29b` (tối, 5.9–7.3:1), nút chính tối `#2b68ad` (5.7:1), tab chọn tối dùng `blue-text` (9.5:1). **Test giữ ngưỡng**: `floorTheme.test.ts` đọc thẳng `globals.css`, đỏ nếu ai đổi màu làm tụt dưới 4.5:1.
- **axe-core (bộ có sẵn trong dự án) chạy trên trình duyệt thật 375px:** màn đăng nhập ở lần đo đầu (đã đổi màu/cỡ chữ nhưng chưa thêm `h1`/tabpanel có điều kiện): 1 vi phạm (thiếu `h1`) + 1 mục chưa chắc → **sau khi sửa nốt 0 vi phạm, 0 chưa chắc** (chưa đo mốc trước toàn bộ giai đoạn 1 nên không có số "trước" của axe; mốc trước chỉ là phép tính tương phản từ token ở trên); màn báo cắt 0 vi phạm (36 mục đạt); "Sản lượng của tôi" 0; nhận sắt (ô trống + hỏi lại) 0; cả **giao diện tối**: 0. (Lần đầu axe báo lỗi màu ở tab giao diện tối là do hiệu ứng chuyển màu 0.15s chưa xong khi đo; chờ đủ lâu thì đạt, màu thật kiểm bằng `getComputedStyle`.)
- Test: FE vitest **126/126** (+20), `tsc` sạch, eslint không thêm lỗi/cảnh báo (còn 2 lỗi cũ ở `SpecSteelPage.tsx`).

### 32.3. Kiểm tra trên trình duyệt (375px, camera giả + mất mạng giả lập)
Bộ quét: focus vào Đóng ✓; đèn pin bật gọi đúng `{"advanced":[{"torch":true}]}` ✓ nhãn "Tắt đèn" + `aria-pressed` ✓; sau 8 giây hiện gợi ý ✓; quét tem nhận sắt → rung 80ms ✓ 1 tiếng bíp ✓ tự sang màn nhận sắt ✓. Nhận sắt: ô trống + nút khoá ✓; chip điền 14 nhưng KHÔNG gửi ✓; gõ 13 → hộp hỏi lại ✓ (phát hiện và **sửa lời bị lặp "thiếu 1 1…"** ngay trong lúc thử) → "Đếm lại" quay về, không gửi ✓ → "Đúng, nhận 13 cây" → "Đã nhận 13/14 cây … · 09:06" ✓. Báo cắt mất mạng giả lập: banner `alert` ✓, số "4" còn trong ô ✓, bật mạng bấm lại → **cùng Idempotency-Key** ✓, chỉ ghi **4** đoạn (không phải 8) ✓, tiến độ 4/60 · còn 56 ✓. Banner tự cuộn: từ cuối trang (420) lên thấy rõ (71) ✓.

### 32.4. Chưa làm / còn treo
- **Đèn pin/rung/bíp: người dùng quyết định KHÔNG cần thử trên máy thật (2026-10-14)** — mới thử bằng giả lập `getCapabilities`/`vibrate`/`AudioContext`; iPhone không có đèn pin/rung nên các nút này tự ẩn/bỏ qua. Coi như đóng. **Sau đó (2026-10-15) cả bộ quét trong app đã bị gỡ (mục 37) nên đèn pin/rung/bíp không còn nữa.**
- **Bước 0: người dùng tự đóng vai công nhân để thử (xem mục 33)**; audit của 3 tab QLSX + Cấu hình hệ thống chưa làm — giai đoạn 1 mới audit màn công nhân.
- Giai đoạn 2 (hàng chờ gửi lại, công nhân tự huỷ lần báo) và 3–4 chưa làm; D1/D3/D4 ở 31.5 vẫn chờ chốt. Điểm tự chấm kỳ vọng ≈ 7.7 (ước lượng).
- Chưa commit (BE + FE). DB dev đã khôi phục lại như trước khi thử.

## 33. Bước 0 — người dùng tự đóng vai công nhân, thử trước ở mạng văn phòng (2026-10-14) — ĐÃ DỰNG môi trường thử qua Wi-Fi (local), người dùng đang thử
Người dùng: "tôi sẽ đóng giả làm công nhân để test bước 0, hiện tại lấy IP wifi của văn phòng tôi đang ngồi thử trước". Không cần thử đèn pin/rung/bíp trên máy thật (đóng ở 32.4).
- **Mạng văn phòng (tra ngày 2026-10-14 từ máy dev, chỉ đọc, chưa đổi cấu hình nào):** IPv4 công cộng **171.243.8.52**; **không có đường ra IPv6** (nên danh sách IPv4 đủ dùng, không vướng chuyện IPv6 ở 28.4); Wi-Fi "Ctydongnama", máy dev 192.168.1.207/24, gateway 192.168.1.1.
- **Dấu hiệu IP có thể không cố định / dùng chung:** IP ra ngoài (171.243.8.52) khác dải ở đầu đường (27.79.72.x) và đường đi qua mạng riêng 10.255.x → nhiều khả năng nhà mạng NAT. Hệ quả nếu đúng: người khác dùng chung IP đó cũng "ở trong mạng công ty" (kiểm soát yếu), và IP có thể đổi khi router/nhà mạng đổi. Hôm nay thử được; trước khi bật thật nên hỏi nhà mạng IP tĩnh (xem 28.5, 28.6). Cách tự kiểm: tra lại IP sau khi khởi động lại router / sang ngày hôm sau, thấy đổi là không dùng được cho giới hạn mạng.
- **Môi trường đã chọn: máy local qua Wi-Fi văn phòng** (không deploy, không commit; dữ liệu là bản dev). Lý do: nhanh, không đụng dữ liệu thật; các lựa chọn khác (Render, đường hầm https) để dành: Render để đo số lớp proxy với IP công cộng 171.243.8.52; đường hầm cần tải công cụ + lộ tài khoản demo ra Internet.
### 33.1. Cấu hình TẠM đã đổi (phải hoàn nguyên khi thử xong)
| Nơi | Đổi | Giá trị gốc |
|---|---|---|
| BE `.env` (git bỏ qua) | `CORS_ORIGIN` thêm nguồn LAN | `http://localhost:3000` |
| FE `.env` (git bỏ qua) | `NEXT_PUBLIC_API_BASE_URL` trỏ IP Wi-Fi | `http://localhost:3001/api/v1` |
| FE `.env` | thêm `DEV_ALLOWED_ORIGINS=192.168.1.207` | (chưa có) |
| DB dev (Cấu hình hệ thống) | `floorPublicUrl=http://192.168.1.207:3000` (địa chỉ in trên tem); `floorAllowedIps=["192.168.1.0/24 # Wi-Fi văn phòng Quy Nhơn (thử nội bộ)"]` | rỗng / rỗng |
| DB dev | PHOI chạy lại PI-040 (dùng "Mở lại"); phiếu sắt SAT-VUONG-20X20 14 cây chờ nhận; 4 tài khoản công nhân mới (`cn.phoi.1`, `cn.phoi.2`, `cn.han.1` chờ tự đặt PIN; `kt.lan` của tôi để kiểm LAN) | — |
- **Thay đổi GIỮ LẠI trong code (FE, tracked):** `next.config.mjs` thêm `allowedDevOrigins` đọc từ biến `DEV_ALLOWED_ORIGINS` (trống = như cũ, chỉ ảnh hưởng `next dev`, không ảnh hưởng build/deploy) + dòng chú thích trong `.env.example`. **Cần thiết:** Next 16 ở chế độ dev chặn tài nguyên từ nguồn khác `localhost` (WebSocket HMR và một số script trả 403) → trang kẹt ở "Đang tải…" trên điện thoại; sau khi khai IP thì tài nguyên trả 200.
- **Tường lửa Windows:** KHÔNG phải mở thêm — Wi-Fi đang ở loại "Public" và đã có sẵn luật cho phép Node.js (chiều vào, Public); cả hai cổng nghe trên mọi địa chỉ (`::`). Không đổi cài đặt hệ thống nào.
### 33.2. Kiểm tra từ máy dev
- BE/FE truy cập được qua IP Wi-Fi; CORS preflight từ nguồn LAN được phép (kèm `Idempotency-Key`), nguồn lạ bị từ chối.
- Giới hạn mạng dải 192.168.1.0/24: BE thấy IP `::ffff:192.168.1.207` → cho phép; đi qua `localhost` (BE thấy `::1`) → công nhân bị chặn 403 với thông báo "Tài khoản công nhân chỉ dùng được khi nối mạng (Wi-Fi) của công ty…"; đặt PIN lần đầu qua LAN được. (6/6)
- Trang `/floor` mở được ở địa chỉ Wi-Fi; FE gọi đúng `http://192.168.1.207:3001/api/v1`; đăng nhập với `Origin` LAN trả 200 + `Access-Control-Allow-Origin` đúng.
- **Giới hạn của kiểm tra:** khung trình duyệt tích hợp chặn lời gọi từ trang `192.168.1.207:3000` sang cổng 3001 (`ERR_BLOCKED_BY_CLIENT`) nên không đăng nhập trọn vẹn ngay trong khung đó được; đây là hạn chế của khung, không phải của ứng dụng (cùng lời gọi bằng curl/Node chạy bình thường). **Phần chưa kiểm chứng được từ máy dev:** điện thoại thật có tới được máy này không (phụ thuộc router: có bật "cô lập máy khách"/mạng khách hay không).
- Camera trong app KHÔNG chạy qua `http://<IP>` (trình duyệt chặn camera ngoài https/localhost, app hiện hướng dẫn) → quét tem bằng app camera của điện thoại (tem là link thường). Đây là hành vi đúng thiết kế, ghi lại để khỏi tưởng lỗi.
### 33.3. Hoàn nguyên khi thử xong (chờ người dùng nói "xong")
Trả `CORS_ORIGIN` và `NEXT_PUBLIC_API_BASE_URL` về giá trị gốc, bỏ `DEV_ALLOWED_ORIGINS` khỏi `.env`, xoá `floorPublicUrl` + `floorAllowedIps` (hoặc khôi phục DB từ `backups/dna_erp_20261014_pre-local-test.dump` — mất dữ liệu đóng vai), khởi động lại BE + FE.
### 33.4. IP Wi-Fi của máy dev ĐÃ ĐỔI (192.168.1.207 → 192.168.1.239) giữa buổi thử — đã cập nhật
Router cấp lại địa chỉ (DHCP) sau vài giờ; đồng thời BE dev đã dừng (chỉ còn FE). Hệ quả: FE trỏ API vào IP cũ nên hỏng, **link tem/mã QR đã in ra mang IP cũ cũng hỏng**. Đã làm: sửa CORS BE + `NEXT_PUBLIC_API_BASE_URL` + `DEV_ALLOWED_ORIGINS` + `floorPublicUrl` sang IP mới, khởi động lại BE + FE, kiểm tra qua IP mới. Danh sách IP `192.168.1.0/24` không cần đổi (cùng dải /24).
- **Mã QR/link in trước giờ này không dùng được nữa** — mở lại "Xem / in" ở màn QLSX để lấy mã mới (địa chỉ in trên tem đọc từ `floorPublicUrl` lúc hiển thị).
- Tránh lặp lại: đặt IP tĩnh cho máy dev ở router (DHCP reservation / "giữ IP"), hoặc chạy lại `prep_account.mjs` (tự lấy IP hiện tại và cập nhật tem) rồi khởi động lại BE + FE sau khi sửa `.env`. Trên Render (có tên miền) sẽ không còn vấn đề này.
- Cấu hình tạm hiện tại: CORS BE `http://localhost:3000,http://192.168.1.239:3000`; FE `NEXT_PUBLIC_API_BASE_URL=http://192.168.1.239:3001/api/v1`, `DEV_ALLOWED_ORIGINS=192.168.1.239`; `floorPublicUrl=http://192.168.1.239:3000`. Thêm tài khoản thử `cn.test` (đã có PIN do người thực hiện đặt, chỉ cho buổi thử).
- **Rủi ro trong lúc thử:** ai ở cùng Wi-Fi cũng truy cập được app dev; tài khoản demo mật khẩu `demo1234` (QLSX/Admin không bị giới hạn IP). Mạng công ty nên chấp nhận được, nhưng không để mở lâu ngoài giờ thử.

### 33.5. Máy dev khởi động lại sáng 2026-10-15: Docker/BE/FE tắt, IP đổi lần 2 (192.168.1.239 → 192.168.1.5) — đã dựng lại
Máy khởi động lại lúc 07:21 ngày 15/10 (Wi-Fi hiện tên "Ctydongnama 2"): Docker Desktop, DB dev, BE, FE đều tắt và IP đổi → mã QR/link cũ (.239) lại hỏng. Đã làm: mở Docker Desktop (DB dev lên lại, **dữ liệu đóng vai còn nguyên**: `cn.test` đã có PIN; `cn.phoi.1`, `cn.phoi.2`, `cn.han.1` vẫn chờ đặt PIN, hạn đặt đến 17/10 02:23); thay `.239` → `.5` ở `CORS_ORIGIN` (BE `.env`), `NEXT_PUBLIC_API_BASE_URL` + `DEV_ALLOWED_ORIGINS` (FE `.env`) và `system_config.floorPublicUrl`; khởi động lại BE + FE. Kiểm tra: `/api/health` và `/floor` trả 200 qua `192.168.1.5`; `POST auth/pin-status` đúng (`cn.phoi.1` → `needsPin:true`, `cn.test` và tên không tồn tại → `needsPin:false`); mã QR LASER-01 hiển thị ở màn QLSX giải mã bằng jsQR ra `http://192.168.1.5:3000/floor?ws=o-34kYIvouVC7Ol9m6UW_qyq` (token tem không đổi, chỉ đổi địa chỉ). Danh sách IP `192.168.1.0/24` vẫn đúng.
- **Giải đáp thắc mắc "tài khoản đặt-PIN-lần-đầu sao không có mật khẩu":** đúng thiết kế — QLSX tạo tài khoản công nhân không kèm mật khẩu (`pinPending`), công nhân tự chọn PIN 6 số ở lần đăng nhập đầu (nhập 2 lần, trong hạn 72 giờ, và phải ở mạng công ty); QLSX/Admin không biết PIN của ai. Chỉ `cn.test` có sẵn PIN (`482915`) vì là tài khoản thử đã đặt.
- Lặp lại lần 2 → nên đặt IP tĩnh/giữ IP cho máy dev trên router trước khi thử tiếp. Cấu hình tạm hiện tại: CORS `http://localhost:3000,http://192.168.1.5:3000`; FE `http://192.168.1.5:3001/api/v1`, `DEV_ALLOWED_ORIGINS=192.168.1.5`, `floorPublicUrl=http://192.168.1.5:3000`.

### 33.6. LỖI THẬT tìm ra ở bước 0: nút "Lưu" báo "Có lỗi, thử lại" trên điện thoại qua `http://IP` — ĐÃ SỬA (FE, chưa commit)
**Hiện tượng (người dùng báo từ điện thoại, 15/10 07:40):** đăng nhập `cn.phoi.1` (vừa tự đặt PIN) → vào máy LASER-01 → nhập số đoạn → bấm "Lưu 110 đoạn" → banner đỏ "Có lỗi, thử lại". Log BE **không có** request nào tới `POST /floor/scan/:token/reports` → lỗi xảy ra ở điện thoại trước khi gửi.
**Nguyên nhân:** `crypto.randomUUID()` (tạo Idempotency-Key ở `useRetrySafeKey.ts` và `withIdempotencyKey` trong `services/core/http.ts`) **chỉ tồn tại ở "secure context"** (HTTPS hoặc `localhost`). Điện thoại mở app qua `http://192.168.1.5:3000` → `crypto.randomUUID` là `undefined` → `TypeError` → màn công nhân gom vào câu báo lỗi chung. Các lần test trước đều chạy qua `localhost` nên không bao giờ gặp. Trên Render + Vercel (HTTPS) không bị; vẫn sửa vì bản chạy trong mạng LAN không có HTTPS (hoặc thử qua Wi-Fi như lần này) sẽ chết đúng chỗ này. Đây là điều chỉ thử trên điện thoại thật qua IP mới lộ ra — đúng mục đích của bước 0.
**Đã sửa:**
- Thêm `src/services/core/uuid.ts` → `newUuid()`: dùng `crypto.randomUUID` nếu có, không thì UUID v4 từ `crypto.getRandomValues` (có ở mọi ngữ cảnh), không nữa thì `Math.random`.
- `useRetrySafeKey.ts`, `http.ts` (`withIdempotencyKey`), `realtimeClient.ts` (`newCorrelationId`) đều gọi `newUuid()`.
- Test mới `uuid.test.ts`: (1) có `randomUUID` thì dùng; (2) không có `randomUUID` vẫn ra UUID v4 hợp lệ, 200 mã không trùng; (3) không có cả `crypto`; (4) **chốt chặn**: quét toàn bộ `src` (trừ test và `uuid.ts`), nếu ai viết lại `crypto.randomUUID` trực tiếp thì test đỏ.
- Rà các API khác chỉ chạy ở HTTPS trong màn công nhân: `navigator.mediaDevices` (bộ quét trong app) đã có kiểm tra `isSecureContext` + hướng dẫn mở bằng app camera; `navigator.clipboard` chỉ ở màn QLSX (máy tính) và đã dùng `?.`. Không còn chỗ nào khác chết âm thầm.
**Kiểm tra:** FE vitest 130/130 (trước 126; +4), `tsc --noEmit` sạch, eslint các file đổi sạch. **Chạy thật bằng luồng đầy đủ trên bản FE đang chạy**: gỡ `crypto.randomUUID` khỏi trình duyệt (mô phỏng trang HTTP) → đăng nhập `cn.test` bằng PIN → mở link tem LASER-01 → nhập 3 đoạn 185mm → bấm Lưu → banner "Đã lưu 3 đoạn 185mm · 07:46"; dòng sổ số 22 mang `idempotencyKey` UUID v4 hợp lệ (do hàm dự phòng sinh). Trước khi sửa, đúng kịch bản này chết ở bước Lưu.
**Dọn sau khi kiểm tra:** báo cáo thử số 22 đã được QLSX đảo (dòng số 23, `reversalOfId=22`, lý do "Báo cáo thử kiểm tra bản sửa - hoàn tác"), số "Đã cắt" của LASER-01 về 0; dải mạng tạm mở cho `localhost` (để chạy thử từ máy dev) đã gỡ, `floorAllowedIps` trở lại chỉ còn `192.168.1.0/24`.
**Tác dụng phụ của lần kiểm tra (đã xử lý):** QLSX và công nhân dùng chung `localStorage` trong cùng một trình duyệt, nên việc đăng nhập `cn.test` trong khung kiểm tra đã thay phiên QLSX đang mở; màn "Máy & tem QR" báo "Requires role to be one of: PRODUCTION_MANAGER". Đã xoá phiên, đăng nhập lại QLSX, mở lại tem LASER-01 (QR vẫn là `http://192.168.1.5:3000/floor?ws=o-34kYIvouVC7Ol9m6UW_qyq`). Lần sau thử vai công nhân thì dùng cửa sổ/ngữ cảnh trình duyệt riêng, hoặc điện thoại.
**Chưa làm/còn treo:** điện thoại cần **tải lại trang** để nhận bản FE mới. Lỗi chung "Có lỗi, thử lại" che mất nguyên nhân — nên cho `describeError` phân biệt lỗi phía máy (không gửi được) với lỗi từ máy chủ; ghi vào danh sách việc GĐ2.

## 34. Đổi luồng đăng nhập công nhân theo phản hồi bước 0: bỏ nút "Lần đầu đăng nhập?" (2026-10-14) — BE + FE, ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Phản hồi của người dùng khi tự đóng vai công nhân trên điện thoại: *"sao lại để nút 'Lần đầu đăng nhập? Tự đặt PIN' làm gì — khi đăng nhập thì check BE: PIN của tài khoản công nhân đó đã có thì chỉ nhập PIN là vào; chưa có thì hiện lên bảo nhập PIN rồi nhập lại lần nữa để xác nhận."*

### 34.1. Vì sao luồng cũ chưa đúng
Công nhân mới phải **gõ một PIN giả** để BE trả `PIN_SETUP_REQUIRED` (hoặc tự biết bấm nút "Lần đầu…"). Hai đường vào cùng một việc, và nút thừa làm người dùng phải đoán mình thuộc nhóm nào.

### 34.2. Đã làm
- **BE: `POST /auth/pin-status` {username} → `{ needsPin, expired }`** (công khai, giới hạn **60 lần/phút/IP** — mỗi route có bộ đếm riêng, rộng hơn đăng nhập 8/phút vì cả xưởng dùng chung 1 IP công cộng). **Chống dò tài khoản:** chỉ trả `needsPin: true` cho công nhân đang chờ đặt PIN VÀ người hỏi đang ở trong mạng công ty; mọi trường hợp khác (tên không tồn tại, đã khoá, không phải công nhân, đã có PIN, ngoài mạng công ty) trả **đúng cùng một kết quả** `{needsPin:false, expired:false}`. `expired`: chờ đặt PIN nhưng quá hạn 72 giờ → FE báo ngay, khỏi để công nhân gõ PIN xong mới bị từ chối. Thêm `NetworkAccessService.isAccountAllowed()` (bản không ném lỗi).
- **FE `/floor`: đăng nhập 3 bước, bỏ hẳn nút "Lần đầu đăng nhập? Tự đặt PIN"**: (1) nhập tên → (2) BE trả lời → (3a) đã có PIN: chỉ ô PIN (focus sẵn) / (3b) chưa có: "Đặt PIN lần đầu" gồm "PIN mới" + "**Nhập lại PIN để xác nhận**" + "Hiện PIN". Dòng "Tài khoản: abc [Đổi]" để sửa tên. **Công nhân quen (tên đã nhớ) tự bước qua bước 1** → không thêm thao tác nào so với trước. Quá hạn → màn "Chưa đặt được PIN - báo QLSX cho đặt lại" (không có ô PIN). Giữ đường dự phòng: nếu đăng nhập vẫn nhận `PIN_SETUP_REQUIRED` (QLSX vừa cho đặt lại giữa chừng) thì tự sang bước đặt PIN.
- **Màn QLSX**: lời hướng dẫn sau khi tạo công nhân sửa cho khớp (không còn nhắc nút đã bỏ).

### 34.3. Kiểm tra
- BE jest **1652** (+6: `pinStatus` 5 ca gồm chống dò + `isAccountAllowed`), eslint sạch, `nest build` sạch; FE vitest 126, `tsc` sạch.
- Live API **14/14**: chờ PIN trong mạng → true (kể cả tên viết hoa/thừa khoảng trắng); đã có PIN / tên lạ / qlsx / chờ PIN nhưng hỏi từ ngoài mạng → false; **4 câu trả lời "không" giống hệt nhau**; thiếu tên/tên quá ngắn → 400; đặt PIN và đăng nhập cũ không hỏng; 25 lần hỏi liên tiếp không bị chặn.
- Giao diện 375px (khung trình duyệt tích hợp, dùng thủ thuật tạm chuyển hướng gọi API về localhost + thêm tạm `::1` vào danh sách IP để coi là "trong mạng" — **đã gỡ `::1` ngay sau đó**): bước 1 chỉ còn "Tiếp tục" (không còn nút Lần đầu); tài khoản chưa có PIN → tự sang "Đặt PIN lần đầu", ô đầu focus sẵn; hai PIN không khớp → "Hai lần nhập PIN chưa giống nhau"; PIN yếu → lời từ BE, ô xác nhận được xoá; PIN hợp lệ → vào luôn màn báo, tên được nhớ; **đăng xuất → tự sang bước nhập PIN ngay (focus sẵn)**; sai PIN → "Sai tên đăng nhập hoặc PIN", ở lại bước PIN, PIN bị xoá; "Đổi" quay về bước 1; mất mạng khi kiểm tra → ở lại bước 1 + "Mất kết nối - kiểm tra mạng rồi thử lại."; quá hạn (giả lập) → "Chưa đặt được PIN" + lời báo, không có ô PIN; Enter ở bước 1 chạy; tài khoản có PIN → PIN → vào. **axe-core 0 vi phạm, 0 chưa chắc ở cả 4 màn** (nhập tên, đặt PIN, nhập PIN, quá hạn).

### 34.4. Còn treo / quan sát (chưa sửa)
- **Giới hạn đăng nhập 8 lần/phút/IP so với xưởng thật:** cả xưởng dùng chung 1 IP công cộng (NAT) nên đầu ca khoảng 30 công nhân đăng nhập trong vài phút sẽ bị chặn (429 → "đợi khoảng 1 phút"). Đề xuất: đếm theo (IP + tên đăng nhập) hoặc nới riêng cho IP trong danh sách mạng công ty (đã có khoá tài khoản 5 lần/15 phút chống đoán PIN). **ĐÃ QUYẾT 2026-10-15: GIỮ NGUYÊN, không sửa** (người dùng: mỗi công nhân 1 điện thoại + 1 tài khoản nên không cần). Ghi lại để khỏi hiểu nhầm: giới hạn đếm theo IP nên điện thoại riêng vẫn chung 1 IP công cộng của xưởng, chỉ chạm khi > 8 lượt đăng nhập/đặt PIN trong cùng 1 phút; phiên giữ 7 ngày (`JWT_REFRESH_EXPIRES_IN`) nên đăng nhập thưa. Cách tránh không cần code: ngày đầu cho công nhân đặt PIN theo từng nhóm ≤ 8 người/phút. Nếu pilot vẫn vướng thì mới làm đề xuất trên.
- `POST /auth/pin-setup` vẫn trả 400 "không ở trạng thái chờ đặt PIN" cho tài khoản không chờ, nhưng 403 mạng cho tài khoản chờ khi ở ngoài mạng → người ngoài mạng có thể suy ra "tên này là công nhân đang chờ đặt PIN" (rủi ro nhỏ: cần đúng định dạng PIN, bị giới hạn 8/phút). `pin-status` mới thì đồng nhất.
- Bước 0 đang chạy: các hướng dẫn thử ở mục 33 không còn bước bấm "Lần đầu đăng nhập" (chỉ nhập tên là đủ).

## 35. Nhận xét màn báo sản lượng sau khi thử trên điện thoại thật + ĐỀ XUẤT màn "Báo cáo sản lượng đạt KCS" theo ngày/tháng/năm (2026-10-15) — ĐÃ LÀM ở mục 36
Bối cảnh: sau khi sửa lỗi nút Lưu (33.6), người dùng lưu được 20 đoạn 185mm + 100 đoạn 60mm (07:49) trên điện thoại, xem "Sản lượng của tôi" (thẻ "Chưa gửi KCS"), rồi hỏi: (1) có nên làm màn thống kê cập nhật khi KCS duyệt, chọn được theo ngày/tháng/năm; (2) UI báo sản lượng hiện tại thế nào.

### 35.1. Nhận xét UI màn báo sản lượng (từ 2 ảnh chụp điện thoại thật) — chấm ~7.5/10
- **Tốt:** vùng chạm lớn (chip/nút cao ~50px), đầu trang cho biết đang ở đâu ("Phôi 1 Thử · tổ Phôi", "Máy laser 1 · LASER-01"), nút lưu dính đáy có số tức thời ("Lưu 110 đoạn"), "Sản lượng của tôi" nói rõ "ĐÃ BÁO, chưa phải số đạt KCS" + nhãn trạng thái.
- **Yếu 1 (quan trọng nhất):** màn đầu bị phần chọn chiếm hết, ô nhập số nằm sát đáy, bị nút Lưu che nửa. Thanh tab + tiêu đề + chip PI + dòng SKU + "Loại sắt" 7 chip (~4 hàng, ~450px) rồi mới tới ô "185 mm". Trong 7 chip có **4 chip "chưa nhận"** (chưa dùng được) chỉ làm rối → gom lại thành 1 dòng "4 loại chưa nhận" thu gọn, chỉ hiện loại đã nhận; ô nhập lên trên nếp gập.
- **Yếu 2:** lưu số lớn (110 đoạn) không có bước xác nhận; công nhân không tự sửa được, chỉ QLSX đảo trước KCS → nên có 1 bảng xác nhận gọn "20 đoạn 185mm + 100 đoạn 60mm — Lưu?" khi tổng lớn hoặc vượt số còn lại.
- **Yếu 3 ("Sản lượng của tôi"):** chỉ danh sách 7 ngày phẳng; không có tổng theo ngày, không chọn tháng, sau KCS không thấy đạt/lỗi. Mỗi thẻ ghi số bằng một câu dài ("20 đoạn 185mm, 100 đoạn 60mm") → khi nhiều cỡ nên thành bảng nhỏ Cỡ | Số đoạn.
- Ghi nhận: thanh địa chỉ có cảnh báo "không bảo mật" vì `http://` — hết khi lên HTTPS (Render/Vercel); bộ quét camera trong app cũng chỉ chạy được ở HTTPS (đã có hướng dẫn dùng app camera).

### 35.2. Đề xuất màn "Báo cáo sản lượng đạt KCS"
Ý kiến: **nên làm**, và nó cũng là nền cho tính công sau này (người dùng đã nói "nhân sự dựa vào đó" - mục 20.4/20.5). Căn cứ dữ liệu (đã đối chiếu schema):
- Nguồn số: `qc_reviews` (`reviewedAt`, `failedQty`, `reviewedById`) + `qc_review_segments` (chấm theo cỡ đoạn); người làm lấy từ chủ đợt (`cut_bundles.openedById`, `step_bundles.reportedById`, `production_batches.reportedById`). Sau KCS **không đảo được nữa** (floor-review.service: "đã gửi KCS - không đảo được") nên số đạt ổn định, hợp để làm số chính thức.
- **Mốc thời gian = ngày KCS duyệt** (đúng ý "KCS pass thì cập nhật"). Một đợt gom nhiều lần báo của nhiều ngày nên không tách được "ngày công nhân làm" chính xác; muốn tính công theo ngày làm thì phải chốt riêng (câu hỏi 1 ở 35.4).
- **Tính theo ngày giờ Việt Nam (UTC+7)**: DB lưu UTC, nhóm theo ngày phải cộng 7 giờ, nếu không số lúc 0–7 giờ sáng lọt sang hôm trước.
- **Không cộng gộp đơn vị:** Phôi/công đoạn phụ đếm ĐOẠN (theo cỡ), Hàn/Sơn đếm MẢNH → báo cáo tách theo tổ/công đoạn, không có "tổng chung".
- Nội dung: bộ chọn Ngày / Tháng / Năm (+ khoảng tuỳ chọn) và tổ, công nhân, PI/SKU; thẻ tổng (đạt, lỗi, tỷ lệ đạt, **đang chờ KCS** để khớp với số công nhân đã báo); biểu đồ cột theo ngày/tháng; bảng theo công nhân và theo cỡ đoạn/mảnh; xuất Excel/CSV. Đặt thành tab thứ 4 của "Sản lượng xưởng" (QLSX, Admin/Giám đốc xem). Tên **"Báo cáo sản lượng"** — không dùng chữ "Thống kê" vì trong ERP chữ đó đã là tên vai/màn nhập số cũ ("Thống kê Phôi").
- Phía công nhân (làm sau, nhỏ): trong "Sản lượng của tôi" thêm tổng theo ngày, chọn tháng, và số "đạt/lỗi" khi KCS đã duyệt.
- Kỹ thuật: 1 endpoint tổng hợp `GET /floor/stats?from&to&groupBy=day|month|year&stage&workerId` + thêm chỉ mục theo `qc_reviews.reviewedAt` (hiện chưa có) cho truy vấn theo khoảng ngày; dữ liệu cũ trước QR (đợt không có người) gom vào dòng "Chưa rõ người". Ước ~2–3 ngày BE + FE.

### 35.3. Làm trước / sau
Theo thứ tự đề xuất: (a) sửa 3 điểm UI ở 35.1 (nhỏ, FE, ~0.5–1 ngày); (b) màn "Báo cáo sản lượng" cho QLSX/Admin; (c) phần số đạt KCS ở "Sản lượng của tôi".

### 35.4. Cần chốt trước khi làm — ĐÃ CHỐT khi bắt tay làm (2026-10-15, xem mục 36)
1. Báo cáo tính theo **ngày KCS duyệt** — người dùng không trả lời riêng, tôi làm theo đề xuất (đơn giản); "ngày công nhân làm" vẫn là câu hỏi mở nếu sau này tính công theo ngày.
2. Ai được xem — người dùng chốt: **công nhân chỉ xem số của chính mình; QLSX xem tất cả và xem riêng từng công nhân** (BOSS/ADMIN cũng xem được ở BE).
3. Xuất Excel — có, làm luôn đợt đầu.
**Trạng thái: ĐÃ LÀM (3 điểm UI 35.1 + màn Báo cáo 35.2 + số đạt/lỗi cho công nhân 35.3c) — xem mục 36.**

## 36. ĐÃ LÀM: 3 điểm UI màn báo sản lượng + màn "Báo cáo sản lượng đạt KCS" + số đạt/lỗi cho công nhân (2026-10-15) — BE + FE, ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Làm theo mục 35 sau khi người dùng bảo "làm 3 điểm UI trước, rồi làm màn báo cáo". Người dùng bổ sung trong lúc làm: *"lưu gì lớn hay bé cũng xác nhận"*; *"công nhân A chỉ xem được sản lượng của công nhân A, QLSX xem tất cả và xem từng cá nhân"*; và chỉ ra tooltip "Lỗi 2 · 99,9% đạt" thiếu đơn vị/khó hiểu.

### 36.1. Màn báo sản lượng (FE `FloorScanApp.tsx`, `floorUi.ts`)
- **Gọn để ô nhập số lên trên nếp gập:** tổ chỉ có 1 PI (đang chạy, không PI bù lỗi) → bỏ hàng nhãn + chip chọn PI, ghép mã PI vào dòng SKU. Báo cắt: chip loại sắt chỉ gồm loại ĐÃ nhận (4/7 chip trước đây là "chưa nhận"), phần chưa nhận gom thành 1 nút "N loại sắt chưa nhận ▾"; chỉ 1 loại thì là dòng chữ. Đo ở khung 390×780: ô nhập số đầu tiên ở y≈414px (trước đây nằm dưới nếp gập).
- **Mọi lần lưu đều hỏi xác nhận** (báo cắt, công đoạn phụ, mảnh Hàn/Sơn): bảng `ConfirmSheet` liệt kê từng dòng + tổng + "vượt N so với kế hoạch (cần X, đã Y)" nếu có (`overBy`). Nút "Sửa lại", nền mờ hoặc Esc đóng và GIỮ số đã nhập; focus trả về nút Lưu; lỗi mạng cũng giữ số. Nhận sắt: đủ số cũng hỏi "khớp - xác nhận đã nhận?" (trước đây đủ số gửi thẳng).
- **"Sản lượng của tôi":** chọn 7 ngày qua / Tháng này / Tháng trước (theo ngày lịch VN); tổng theo kỳ và theo ngày **theo từng loại việc** (không cộng Cắt với Uốn - đếm đôi); mỗi lần báo hiện bảng "cỡ | số đoạn"; thẻ **"Đã KCS duyệt"** (đạt, lỗi, tỷ lệ đạt, đang chờ KCS) lấy từ `GET /floor/my-stats`; lỗi tải thẻ chỉ ẩn thẻ.

### 36.2. BE: báo cáo
- `GET /floor/stats?from&to&groupBy=day|month|year&stage&workerId` — QLSX, BOSS, ADMIN (route chỉ ĐỌC; công nhân gọi → 403). Trả `rows` chi tiết (kỳ × loại việc × công nhân × cỡ/mảnh: đạt, lỗi), `buckets` (đủ kỳ, kỳ trống = 0), `pending` (đã báo mà KCS chưa duyệt, **theo từng công nhân**, tách "chưa gửi KCS" / "chờ KCS", tính đến bây giờ không theo kỳ).
- **Mốc = ngày KCS duyệt** (`qc_reviews.reviewedAt`) theo **giờ VN (UTC+7)** (`common/utils/floor-stats.util.ts`: 00:30 sáng 15/10 = 17:30Z ngày 14 vẫn thuộc ngày 15). Giới hạn: theo ngày ≤ 92 ngày, tháng ≤ 5 năm, năm ≤ 10 năm; > 50.000 dòng báo hẹp lại.
- **Công thức theo từng nhánh** (đúng cách KCS ghi): Cắt = Σ `cut_pattern_segments` của đợt − lỗi theo cỡ (`qc_review_segments`); công đoạn phụ = Σ `step_batch_segments` các đợt trong bundle − lỗi theo cỡ; Hàn/Sơn (và mảnh Phôi) = `production_batches.reportedQty` (đã bị KCS ghi đè thành phần ĐẠT) và `failedQty` của lần duyệt. Người làm = chủ đợt (`openedById` / `reportedById`); đợt cũ/gom nhiều người → "Chưa rõ người". Không cộng chung đoạn với mảnh, không cộng chung các công đoạn.
- Migration `20261015090000_qc_reviews_reviewed_at_index` (chỉ mục `qc_reviews(reviewedAt)`); đã áp vào DB dev, `prisma migrate diff` rỗng.
- `GET /floor/my-stats?from&to&groupBy` — mọi tài khoản có `FLOOR_REPORT:VIEW` (công nhân): **id lấy từ token, ép làm `workerId`**; DTO không có `workerId`/`stage` → gửi lên bị 400 ("property workerId should not exist"). Công nhân A không xem được số của B.

### 36.3. FE: tab "Báo cáo" trong "Sản lượng xưởng" (`QlsxStats.tsx`, `floorStats.ts`, `floorStatsExport.ts`)
Chọn kỳ **Ngày / Tháng / Năm / Khoảng** (◀ ▶ lùi/tiến, không tiến quá hôm nay), lọc **Tổ** (gọi lại BE) và **Công nhân** (lọc tại chỗ trên dữ liệu đã có - bấm tên trong bảng "theo công nhân" cũng xem riêng người đó; công nhân chỉ có số đang chờ vẫn có trong danh sách). Ô tổng theo loại việc (đạt, lỗi N đoạn/mảnh, tỷ lệ đạt) bấm để chọn loại việc xem; biểu đồ cột theo ngày/tháng (hướng dẫn dataviz: cột mảnh ≤ 24px, hở 2px giữa đạt/lỗi, lưới mờ, chú giải, chỉ ghi số cột cao nhất, tooltip khi rê/chạm/focus + bảng số liệu thay thế); bảng theo công nhân và theo cỡ đoạn/mảnh; ghi chú "Đang chờ KCS"; **Xuất Excel** 3 sheet (Tổng, Theo công nhân, Chi tiết - đúng những gì đang lọc, tên file ghi tên công nhân nếu lọc 1 người); tự tải lại khi có sự kiện KCS; tải lại giữ khung cũ mờ đi (không nháy trắng).

### 36.4. Sửa theo phản hồi / phát hiện trong lúc làm
- Tooltip "Lỗi 2" thiếu đơn vị, "99,9% đạt" khó hiểu → "Lỗi 2 đoạn", dòng riêng "Tỷ lệ đạt 99,9%" (= 2.820 ÷ (2.820 + 2) = 99,93%, hiển thị làm tròn 1 số lẻ); ô tổng và nhãn đọc màn hình cũng có đơn vị.
- **Lỗi làm tròn:** 55.541 đạt / 23 lỗi = 99,96% bị làm tròn thành "100%" che mất lỗi → `ratePct` chặn trần 99,9 khi còn lỗi (dùng cho màn hình và Excel); có test.
- `slugName` đổi "Đ" hoa thành "d" thường → sửa giữ hoa/thường (test bắt được).
- Số lớn ở "Sản lượng của tôi" bỏ `tabular-nums` (chỉ dùng trong cột số); cột biểu đồ thêm `role="img"` (axe `aria-prohibited-attr`); ô chọn đặt `width:auto` (CSS toàn cục `width:100%` làm bộ lọc xếp dọc).

### 36.5. Kiểm tra
- BE: jest **1692** (+40: 36 mới ở `floor-stats.util.spec` + `floor-stats.service.spec`, gồm giờ VN, 3 nhánh, nhóm ngày/tháng/năm, lọc, pending theo người, `getMyStats` ép id), `nest build` sạch, eslint sạch. FE: vitest **174** (+48), `tsc`, eslint sạch.
- **Đối chiếu SQL độc lập** (viết riêng, cộng theo giờ VN): `/floor/stats` năm 2026 khớp **8/8 loại việc** (Cắt 55.541/23, Hàn 15.102/6, Sơn 15.020/2, Uốn 780, Dập 480, Tán 480, Tóp đầu 120, Xẻ 120).
- **Chạy hết luồng thật:** cn.test báo → QLSX gửi KCS → KCS duyệt (1 đoạn 185mm lỗi) → số "đang chờ" chuyển đúng từ chưa gửi sang chờ KCS khi gửi, số đạt chỉ hiện sau khi KCS duyệt (Cắt đạt 2/lỗi 1; Hàn đạt 1), số chờ giảm đúng.
- **Phân quyền trên máy chủ chạy thật:** công nhân → `/floor/stats` 403; `/floor/my-stats` chỉ ra tên mình; cố truyền `workerId`/`stage` → 400; QLSX xem toàn xưởng và lọc từng người; không đăng nhập → 401.
- **Giao diện:** desktop 1280, điện thoại 390, chế độ tối; không tràn ngang; **axe-core 0 vi phạm** ở màn báo (xác nhận, "Sản lượng của tôi") và ở panel Báo cáo (sáng + tối). Lỗi axe còn lại ở khung ứng dụng có từ trước (chữ `--text3` ở thanh bên, thiếu `<main>`/region) không thuộc phần này. Bảng màu đạt/lỗi: chế độ sáng PASS toàn bộ; chế độ tối chỉ trượt "dải độ sáng" của màu lỗi `--red` (màu trạng thái dùng chung cả app, đạt tương phản và phân biệt CVD) nên giữ.
- Đã thử trên điện thoại thật: lưu được ở 07:49 (sau sửa `randomUUID`, mục 33.6); phần xác nhận/báo cáo mới CHƯA thử trên điện thoại thật.

### 36.6. Dữ liệu thử còn lại trong DB dev (không dọn được vì KCS không đảo)
Đợt cắt 58 của `cn.test` (2 đoạn 185mm: 1 đạt + 1 lỗi; 1 đoạn 60mm đạt) và lô Hàn 108 của `cn.test.han` (1 mảnh Mê ngồi) đã qua KCS ngày 15/10. `cn.test.han` đã vô hiệu. Danh sách IP tạm mở cho `localhost` (để chạy thử từ máy dev) đã gỡ, trở lại chỉ `192.168.1.0/24`. **Không đụng** đợt 57 của `cn.phoi.1` (người dùng đang đóng vai: 20 đoạn 185mm + 100 đoạn 60mm, chưa gửi KCS). Khôi phục toàn bộ về trước thử: `backups/dna_erp_20261014_pre-local-test.dump` (xem 33.3).

### 36.7. Chưa làm / còn treo
- Cập nhật tự động khi KCS vừa duyệt dựa vào kết nối thời gian thực; khung trình duyệt của công cụ chặn kết nối đó (địa chỉ LAN) nên chỉ thử được nút "Làm mới" (chạy đúng). Chưa bấm tải file Excel thật (đã test dựng file rồi đọc lại bằng thư viện, tên sheet hợp lệ, tiếng Việt đúng). Chưa chạy `next build` (tránh đè thư mục build của server dev đang chạy).
- **Ngày KCS duyệt vs ngày công nhân làm** (35.4-1) vẫn là câu hỏi mở nếu sau này tính công theo ngày làm.
- Không có màn cho BOSS/ADMIN trên FE (BE đã cho phép gọi `/floor/stats`; tab chỉ hiện ở menu QLSX).
- Luật "Advisor (Opus 5.5)" theo yêu cầu người dùng đã thêm vào `CLAUDE.md` của BE; bản `D:\DNA-ERP\CLAUDE.md` bị hệ thống chặn quyền sửa nên chưa có. Chưa commit.

## 37. GỠ BỎ icon và nút quét QR trong app công nhân (2026-10-15) — FE, ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Người dùng: *"nếu thế thì icon QR trong web đâu cần thiết đâu"* → chọn *"bỏ hẳn icon và nút quét trong app"* (hai hướng đã nêu: bỏ hẳn, hoặc chỉ ẩn khi chưa có HTTPS).
**Vì sao:** luồng chính không cần - công nhân quét tem bằng app camera của điện thoại, link mở ra vào thẳng màn của máy (phiên đăng nhập nằm ở trình duyệt nên đổi máy chỉ cần quét tem khác). Bộ quét trong app chỉ chạy được ở HTTPS (ở bản thử qua `http://IP` icon vẫn hiện nhưng chỉ báo "mở bằng app camera"), thêm màn xin quyền camera và khá nhiều code.
**Đã làm (FE):** `FloorScanApp.tsx` bỏ icon QR ở đầu trang, nút "Quét mã QR" ở màn chưa có mã máy (nay chỉ còn dòng "Quét mã QR dán ở máy / điểm làm việc bằng app camera của điện thoại để bắt đầu báo."), trạng thái `scanning`, `onScanned`, `useRouter`; xoá `QrScanner.tsx`, `qrToken.ts`, `qrToken.test.ts`; `floorUi.ts` bỏ `scanFeedback` (rung/bíp), `supportsTorch`, `setTorch` (đèn pin) và 2 test tương ứng; `qrPrint.test.ts` kiểm link trên tem bằng `new URL(...).searchParams.get('ws')` thay cho `extractWorkstationToken`. Thư viện `jsqr` giữ lại (còn dùng trong `qrPrint.test.ts`), `qrcode` vẫn dùng để in tem.
**Hệ quả cần biết:**
- Đổi máy = quét tem máy khác bằng app camera. Nếu app camera mở link bằng **trình duyệt khác** (vd trình duyệt trong Zalo) thì phiên đăng nhập không dùng chung và công nhân phải đăng nhập lại → hướng dẫn công nhân **mở link bằng Chrome/trình duyệt mặc định** (nên ghi vào tờ hướng dẫn dán ở xưởng).
- Danh sách việc trước khi lên server thật: mục "HTTPS vì camera trong app" không còn là lý do nữa (HTTPS vẫn nên có vì mật khẩu/PIN đi qua mạng, nhưng không còn bắt buộc để quét).
- Mất cách "Không quét được? Mở tem bằng app camera" trong bộ quét (không còn bộ quét).
**Kiểm tra:** FE vitest **169** (174 − 2 test đèn pin − 3 test `qrToken`), `tsc` + eslint sạch. Xem thật ở khung 390px (đăng nhập `cn.test`): các nút ở đầu trang chỉ còn "Đăng xuất" + 2 tab, không còn icon QR; màn chưa có mã máy chỉ hiện dòng hướng dẫn. Chưa thử trên điện thoại thật. Dải IP tạm mở cho `localhost` để chạy thử đã gỡ lại.

## 38. Chuẩn bị commit/deploy: những gì phát hiện và đã sửa (2026-10-15) — ĐÃ COMMIT + deploy 2026-10-15 (QR-QLSX, xem mục 46.1)
Người dùng hỏi nên làm gì trên Render, env BE/FE, file nào FE cần commit. Quyết định đã chốt: **chỉ deploy sau khi hoàn tất và ổn thỏa ở local** (không push/deploy trước đó).
**Đã sửa:** `D:\DNA-ERP\package-lock.json` (file khóa mà git theo dõi; Vercel cài bằng `npm ci`) **thiếu 3 gói mới** `qrcode@1.5.4`, `jsqr@1.4.0`, `@types/qrcode@1.5.6` (đã có trong `package.json` nhưng lệch file khóa) → chạy `npm install --package-lock-only --ignore-scripts` (không đụng `node_modules` pnpm của máy dev): +283/−7 dòng, `lockfileVersion` vẫn 3, 7 dòng bỏ chỉ là cờ `dev`/`peer` do cây phụ thuộc tính lại, không đổi phiên bản gói cũ nào; `package.json` không bị sửa thêm. Kiểm tra: script so khớp báo "KHỚP", `npm ci --dry-run` thoát 0. File khóa cũ sao lưu ở thư mục tạm của phiên.
**Cần làm ở Render (BE), khi deploy:** biến môi trường chỉ có **1 biến mới `TRUST_PROXY_HOPS=1`** (bản đang chạy bỏ qua biến lạ nên thêm trước an toàn) + kiểm `CORS_ORIGIN` là địa chỉ web thật; tắt Auto-Deploy tạm; sao lưu DB; sau deploy chạy `npm run seed` từ máy dev với External Database URL (image production không có `ts-node`), đo IP thật bằng "Thêm IP hiện tại của tôi" (ra IP Render/Cloudflare thì đổi thành `2`), đặt `floorPublicUrl`, bật danh sách IP công ty SAU CÙNG. Gói `free` của Render sẽ ngủ khi vắng người — nên dùng gói trả phí cho xưởng. Migration: 8 cái, chỉ thêm bảng/cột/chỉ mục; chỗ duy nhất đụng cột cũ là `users.email` nới thành cho phép trống.
**Cần làm ở Vercel (FE):** không biến mới; chỉ cần `NEXT_PUBLIC_API_BASE_URL=https://<dịch vụ>.onrender.com/api/v1` cho Production và Preview (gắn lúc build). `.env.example` của FE **lỗi thời** (nói `BACKEND_ORIGIN`/`rewrites()` mà code không dùng, biến thật là `NEXT_PUBLIC_API_BASE_URL`) và đang ở trạng thái bị xóa trong cây làm việc (không phải tôi xóa).
**Không nên commit:** `.claude/` của BE (549 MB, KHÔNG bị `.gitignore` chặn - chỉ thêm đúng file cần, đừng `git add .`), `tsconfig.tsbuildinfo` (tôi tạo ra khi chạy `tsc`, nên thêm vào `.gitignore`), `next-env.d.ts` (Next tự sinh khi chạy dev). `pnpm-lock.yaml`/`pnpm-workspace.yaml` đang chưa theo dõi trong khi git theo dõi `package-lock.json` → cần chọn MỘT trình quản lý gói (đề xuất giữ npm vì Vercel đang dùng npm).
**Lệch phiên bản local và production:** máy dev cài bằng pnpm (vd `axios 1.20.0`) còn file khóa npm ghim `axios 1.18.1`, nên `next build` ở local không giống hệt Vercel. Cách thử đúng: sao chép repo sang thư mục tạm, `npm ci`, `next build` ở đó (chưa làm).
**CI của BE trên GitHub báo lỗi `Multiple versions of pnpm specified` — ĐÃ SỬA:** `.github/workflows/ci.yml` khai phiên bản pnpm ở 2 nơi: `version: 9` trong bước `pnpm/action-setup@v4` (lặp ở cả 3 job lint/test/build) và `"packageManager": "pnpm@9.15.9"` trong `package.json` (đã có sẵn trong commit cuối, nên CI có thể hỏng từ trước phần QR) → công cụ từ chối chạy, cả 3 job dừng ngay ở bước này mà chưa chạy dòng code nào. Đã xoá 3 cặp `with: version: 9`, giữ `package.json` làm nguồn duy nhất; YAML vẫn hợp lệ. Sau khi sửa, CI chạy được và nhật ký GitHub cho thấy **lint, `prisma migrate deploy` và toàn bộ test đơn vị đã XANH** (bước e2e là bước sau cùng của job test nên mới tới được), chỉ **e2e hỏng**: `P1001 Can't reach database server at localhost:5433` — bộ e2e gắn cứng DB test ở cổng **5433** (`test/test-db.constants.ts`, khớp `docker-compose.test.yml` trên máy dev) còn Postgres của CI chỉ mở cổng 5432 → thêm `- 5433:5432` vào `services.postgres.ports` trong `ci.yml`. Chạy e2e thử ở máy dev (DB test riêng cổng 5433, không đụng DB dev) lộ thêm 1 lỗi sẽ xuất hiện ngay sau đó: bài `/api/health` trả **503** vì chỉ báo bộ nhớ (`checkHeap`, ngưỡng 1 GiB) đo heap của chính tiến trình jest — chạy riêng 1 bộ chỉ 740 MB, nhưng 2 bộ e2e chạy chung 1 tiến trình (runner CI 2 nhân) làm heap vượt 1 GiB; không phải app dùng nhiều bộ nhớ → `test/app.e2e-spec.ts` ghi đè `MemoryHealthIndicator` thành "up" (bài chỉ kiểm app + DB sống; mã production không đổi). Thêm `testPathIgnorePatterns` bỏ thư mục `.claude` vào `test/jest-e2e.json` (jest ở máy dev còn quét nhầm 2 bộ test trong `.claude/worktrees`, CI sạch không có). Kết quả: e2e **4/4 qua** (chạy như CI và chạy chung 1 tiến trình); lint test 0 lỗi. Job `build` của CI chưa từng chạy (phải đợi `test` xanh) — `nest build` ở máy dev đã sạch.
**(Đã seed xong cùng ngày, xem mục "Seed production" bên dưới.) Production đã nhận code mới nhưng CHƯA seed → QLSX báo `Missing required permission(s): FLOOR_REPORT:VIEW` (ảnh người dùng gửi 2026-10-15):** các route `/floor/*` trả 403 (không phải 404) nên BE trên Render đã có code QR; FE Vercel đã có đủ 4 tab; còn quyền `FLOOR_REPORT` và vai trò công nhân nằm ở `npm run seed` chưa chạy. Việc cũ (đơn mua, thông báo) vẫn 200.
**Sao lưu DB production (2026-10-15 15:16) — XONG:** `D:\DNA-ERP-BE\backups\prod_20261015_1516_truoc-seed.dump` (859.354 byte, định dạng custom của `pg_dump` bản 17; thư mục `backups/` đã nằm trong `.gitignore`). DB production là **Prisma Postgres (PostgreSQL 17.2, đường pooled)**, không phải Render Postgres; 23 MB, 94 bảng, 46 người dùng, 1833 dòng nhật ký, **0 PI và 0 đợt cắt** (production chưa có dữ liệu sản xuất). 147 migration đã áp dụng, mới nhất `20261015090000_qc_reviews_reviewed_at_index` → 8 migration QR đã chạy trên production. Vai trò hiện có KHÔNG có `FLOOR_WORKER` (xác nhận seed chưa chạy) và có thêm `WEAVING_MANAGER` không nằm trong `roles.constant.ts` (seed không đụng vai trò ngoài danh sách). **Kiểm chứng bản sao lưu:** khôi phục vào container Postgres 17 tạm, cô lập, đã xoá: 46 người dùng / 1833 nhật ký / 147 migration / 94 bảng KHỚP production; chỉ 2 lỗi bỏ qua được về extension riêng của dịch vụ (`prisma_postgres`). Pooled endpoint vẫn `pg_dump` được. Mật khẩu DB người dùng gửi trong chat chỉ dùng qua biến môi trường của lệnh, KHÔNG ghi vào file/changelog/bộ nhớ; nên đổi mật khẩu DB sau khi xong việc.
**Seed production — ĐÃ CHẠY THẬT (2026-10-15), sau bản thử chỉ đọc:** `prisma/seed-dry-run.ts` (mới, chỉ `SELECT`, không ghi; in tên vai trò/quyền/kho, không in dữ liệu cá nhân) so production với những gì `prisma/seed.ts` sẽ làm. Kết quả: **tạo mới 5 quyền `FLOOR_REPORT`** (VIEW/CREATE/UPDATE/DELETE/APPROVE; bảng `permissions` từ 175 dòng lên 180, trong đó 5 dòng thừa như nêu ở phát hiện phụ (2)); **thêm quyền cho 6 vai trò, GỠ 0 quyền nào** (ADMIN +5, BOSS +2, PRODUCTION_MANAGER +5 = chính vai trò QLSX đang báo thiếu `FLOOR_REPORT:VIEW`, PHOI_STAFF/HAN_STAFF/SON_STAFF +2 mỗi vai trò); **tạo mới vai trò `FLOOR_WORKER` (3 quyền)**; 8 vai trò còn lại không đổi; `WEAVING_MANAGER` ngoài danh sách nên seed không đụng; 7 kho cố định đều "giữ nguyên" (seed ghi đè tên/ghi chú nhưng đã trùng nên không đổi gì); kho `thanh-pham-1788485485362` ngoài danh sách nên không đụng; 6 nhóm vật tư hệ thống đã đủ tiền tố mã. **Phát hiện phụ:** (1) production có **2 tài khoản ADMIN: `sysadmin` (`admin@dna-erp.local`) và `admin` (`admin@demo.com`)** — tài khoản email demo nằm trên môi trường thật, nên xem lại mật khẩu/có cần giữ không (chưa đụng); (2) DB có 5 quyền `MATERIAL_INSPECTION` không còn trong code (seed không xoá bảng `permissions`, không vai trò nào dùng — vô hại). **Bước admin của seed:** `user.upsert` theo email, nhánh cập nhật chỉ đặt `username`, không đụng mật khẩu; để không tạo admin mới/không đổi tên phải chạy với `SEED_ADMIN_EMAIL=admin@dna-erp.local` + `SEED_ADMIN_USERNAME=sysadmin` (mật khẩu truyền vào là giá trị tuỳ ý, bị bỏ qua khi tài khoản đã có). Lần đề xuất đầu bị bộ phân loại quyền của Claude Code chặn và một lần người dùng ngắt; người dùng hỏi lại seed có tạo admin mới không (trả lời: không, khớp tài khoản có sẵn) rồi yêu cầu "hãy chạy cho tôi" → chạy với `SEED_ADMIN_EMAIL=admin@dna-erp.local`, `SEED_ADMIN_USERNAME=sysadmin`, mật khẩu giả (bị bỏ qua), URL DB chỉ qua biến môi trường. **Kết quả:** thoát 0, in `Seed complete. Roles synced: 15. Warehouses synced: 7. Material groups synced: 6. Admin: admin@dna-erp.local`. **Kiểm lại bằng chính bản thử chỉ đọc:** quyền cần tạo = 0, mọi vai trò THÊM +0/GỠ −0 (ADMIN 175, BOSS 70, PRODUCTION_MANAGER 26, PHOI/HAN/SON_STAFF 16/10/10), `FLOOR_WORKER` có 3 quyền, `permissions` 180 dòng, kho không đổi, vẫn **đúng 2 tài khoản ADMIN** (`sysadmin`, `admin`) → không tạo admin mới, không đổi tên. Chưa kiểm bằng đăng nhập thật bằng tài khoản QLSX trên web production (người dùng cần đăng xuất/đăng nhập lại để lấy quyền mới).
**Còn treo:** chạy e2e của BE (CI của BE chạy `test:e2e` trên Postgres sạch, chưa chạy với code mới; lint toàn dự án đã chạy: 0 lỗi); FE chưa có CI; chưa dựng staging; chưa chia commit/nhánh; chưa chạy `next build` kiểu Vercel.

## 39. Báo cáo sản lượng: ô chọn tháng/năm dạng lịch + sửa nút ◀ ▶ (2026-10-15) — chỉ FE, ĐÃ COMMIT 2026-10-15 (QR-QLSX, xem mục 46.1)
Người dùng góp ý màn "Báo cáo" (ảnh chụp production): chọn tháng/năm bằng hai ô `<select>` rời trông thô ("phèn"), và (ảnh thứ hai) nút ◀ ▶ bị tách khỏi ô ngày, nằm trên/dưới nó, mũi tên chỉ còn một vạch nhỏ.
**Đã làm (FE `D:\DNA-ERP`):** (1) `src/components/MonthYearPicker.tsx` (mới): `MonthPicker` (lưới 12 tháng, đổi năm bằng ‹ ›, nút tắt "Tháng này") và `YearPicker` (lưới 12 năm, đổi trang 12 năm, nút "Năm nay"), cùng kiểu ô bấm + lịch nổi như `DatePicker` (position fixed, tự dịch vào trong màn hình/lật lên khi hết chỗ, đóng khi bấm ngoài hoặc Esc); kỳ sau tháng/năm hiện tại bị mờ không chọn được (khớp nút ▶ đã khoá). (2) `QlsxStats.tsx`: chế độ Tháng/Năm dùng hai ô mới thay cho `<select>` (bỏ danh sách năm cố định 4 năm gần nhất — giờ chọn lùi được bao nhiêu năm tuỳ ý). (3) **Lỗi bố cục có sẵn từ mục 36 được sửa:** `DatePicker` tự đặt `width: 100%` nên trong hàng bộ lọc nó chiếm cả hàng và đẩy ◀ ▶ xuống dòng khác (màn hẹp ~800px thấy rõ) → bọc ô ngày trong hộp rộng 150px, nhóm `◀ [kỳ] ▶` không cho xuống dòng (riêng chế độ Khoảng có 2 ô ngày được phép xuống dòng). (4) **Nguyên nhân mũi tên "tí hon":** CSS toàn cục cho mọi `<button>` `padding: 7px 14px`, nút 36px chỉ còn 6px bề ngang cho icon → icon bị co còn 6×18px. Đã tách `StepButton` (padding 0, icon 18px nét đậm hơn, không co), có nhãn/chú thích theo kỳ ("Ngày trước/sau", "Tháng trước/sau", "Năm trước/sau" thay cho "Kỳ trước/sau"), khoá thì mờ và không nhận chuột. (5) `DatePicker` thêm prop tuỳ chọn `minHeight` (không đổi chỗ khác đang dùng) để ô ngày cao 36px ngang nút và ô tháng/năm (trước 33px).
**Kiểm tra:** `tsc` sạch (trừ tsbuildinfo), eslint 0 lỗi 3 file đã đụng, vitest FE 169/169; chạy thật trong trình duyệt (BE local + FE dev, đăng nhập `qlsx`): chọn tháng (cả lùi sang 2025), "Tháng này", Esc đóng, chọn năm (trang 2015–2026 và lùi 12 năm), "Năm nay", nút ◀ ▶ ở cả 4 chế độ (cùng một hàng, cao 36px, icon 18px), ▶ khoá ở kỳ mới nhất, popup lật lên ở viewport 800×514. **Chưa làm:** axe cho ô mới; kiểm chủ đề tối; bàn phím mũi tên trong lưới (hiện chỉ Tab/Enter); gộp phần tính vị trí của `DatePicker` và `MonthYearPicker` thành một hook dùng chung (đang lặp ~25 dòng, cố ý không động vào `DatePicker` đang được 5 màn dùng).
**Phát hiện thêm khi lấy tài khoản thử:** `prisma/seed-demo.ts` đặt MẶC ĐỊNH chung mật khẩu `demo1234` cho mọi tài khoản demo và ghi chú "phản ánh tài khoản có trên production" — tài khoản ADMIN `admin@demo.com` trên production (xem mục 38) nhiều khả năng đến từ lần chạy seed demo đó, nên có thể vẫn dùng mật khẩu mặc định. Chưa kiểm (không thử đăng nhập production); khuyến nghị đổi mật khẩu hoặc vô hiệu hoá tài khoản đó.

## 40. QA phần QR (/testing-qa): kiểm kê, lấp khoảng trống test, kiểm tra đột biến (2026-10-15) — chưa commit
Người dùng gọi `/testing-qa` cho "phần QR đã làm". Cách làm: kiểm kê test hiện có → chạy toàn bộ cổng chất lượng → đo độ phủ (coverage) riêng các module QR để tìm chỗ hổng → viết test lấp hổng → **kiểm tra đột biến** (cố ý sửa 1 dòng logic, test phải ĐỎ) để chắc test mới thật sự bắt lỗi chứ không chỉ "xanh".
**Khoảng trống tìm thấy (độ phủ dòng của `modules/floor` lúc đầu 66,9%):** `floor-scan.service.ts` — chính là lõi công nhân báo số — chỉ 48,7% (chưa test: màn quét `getContext` trừ vài ca, `myOutput` "Sản lượng của tôi" và cách suy ra trạng thái OPEN/chờ KCS/đã KCS, nhánh công đoạn phụ STEP, nhận sắt thành công, kiểm đầu vào); `floor-review.service.ts` — đảo lần báo công đoạn phụ (STEP) hoàn toàn chưa test, cùng nhánh 2 QLSX đảo cùng lúc (P2002), nhánh đợt đã gửi KCS, các hàm gửi KCS; `floor-admin.service.ts` — sửa/khoá công nhân (thu hồi phiên đăng nhập), tạo công nhân (role chưa seed, trùng tên), đổi mã QR, tạo máy; `floor-realtime.interceptor.ts` 0%; **không có test nào khoá phân quyền từng route** của `/floor/*` — mà các guard toàn cục là no-op khi route thiếu `@RequirePermissions`/`@RequireRole`, nên một route mới quên gắn sẽ MỞ cho mọi tài khoản đã đăng nhập (kể cả công nhân) mà không ai biết.
**Đã thêm (BE, chỉ file test; không sửa code nghiệp vụ):** `floor.controller.spec.ts` (mới) — ma trận quyền của cả 29 route (quyền, vai trò, mfgRole; bắt buộc cập nhật khi thêm/xoá route; không route nào @Public; GET chỉ cần VIEW, ghi không bao giờ chỉ VIEW; BOSS/ADMIN chỉ được đọc báo cáo; route công nhân không đòi vai trò QLSX); `auth.controller.spec.ts` (mới) — route đăng nhập/PIN công khai + khoá con số **8 lần/phút/IP** (đăng nhập, đặt PIN) và 60 (hỏi trạng thái PIN) mà người dùng đã chốt giữ nguyên, `me`/đổi mật khẩu không được @Public; `floor-realtime.interceptor.spec.ts` (mới); mở rộng `floor-scan.service.spec.ts` (9 → 49 test), `floor-review.service.spec.ts` (4 → 23), `floor-admin.service.spec.ts` + `floor-admin-workers.service.spec.ts` (thêm 18 test: ranh giới quyền — QLSX chỉ sửa/đặt lại PIN/mở khoá được tài khoản có role FLOOR_WORKER chưa xoá, id tài khoản admin → 404, không sửa gì; khoá hoặc đổi tổ thì thu hồi mọi phiên đăng nhập, sửa tên/mở khoá lại thì không). FE: `monthYearLogic.ts` + test (6) — tách phép tính trang năm/khoá tháng của ô chọn tháng/năm mục 39. `test/jest-integration.json` thêm `testPathIgnorePatterns` bỏ `.claude` (trước đó chạy nhân đôi các bài tích hợp trong `.claude/worktrees`; cùng cách đã làm cho e2e ở mục 38).
**Kết quả:** BE test đơn vị **1700 → 1828 qua** (80 bộ qua + 1 bộ bỏ qua có sẵn); độ phủ dòng `modules/floor` **66,9% → 89,5%** (`floor-scan` 48,7 → 100, `floor-review` 86,5 → 98,1, `floor-admin` 79,5 → 91,9, interceptor 0 → 100); e2e 4/4; test tích hợp (Postgres thật cổng 5433) 3 bộ / 8 test qua; `nest build` thoát 0; eslint toàn BE 0 lỗi (94 cảnh báo có sẵn, ở file test e2e). FE: `tsc` sạch, vitest 175 qua (17 file), eslint thư mục `Floor` + component mới 0; **build kiểu Vercel đã chạy** — chép cây làm việc sang thư mục sạch (bỏ node_modules/.next/.git/.claude và 2 file pnpm chưa theo dõi), `npm ci` theo `package-lock.json` (486 gói) thoát 0, `next build` thoát 0 (có route `/floor`) — xác nhận file khóa mục 38 đủ cho Vercel. **Kiểm tra đột biến: 30/30 lỗi cố ý bị test mới bắt** (thêm quyền thiếu `@RequireRole`, đổi 8 → 100 lần/phút, bỏ lọc `reportedById`, bỏ `reversalOfId: null`, loại sắt nào cũng coi đã nhận, đảo ghi số dương, bỏ chặn đợt đã gửi KCS ở cả 3 nhánh đảo, bỏ ánh xạ P2002, khoá tài khoản không đăng xuất máy, QLSX sửa được tài khoản không phải công nhân, đổi mã QR không đổi token, tổ Đan tạo được máy QR…); file nguồn đã khôi phục sạch sau mỗi lần (`git status` kiểm). Bằng chứng sống thêm: đăng nhập công nhân từ máy local (ngoài danh sách IP) bị chặn đúng với thông báo "chỉ dùng được khi nối mạng (Wi-Fi) của công ty".
**Lỗi có sẵn không thuộc QR (chưa sửa):** `SpecSteelPage.tsx` dòng 863 (FE) có 2 lỗi eslint `react/no-unescaped-entities` (dấu `"` trong chữ "Gửi phê duyệt"); `next build` mới không chạy eslint nên không chặn build, nhưng nên sửa trước khi thêm CI cho FE.
**CHƯA làm / còn hổng:** (1) **chưa có test tích hợp trên DB thật cho luồng QR** — mọi test QR giả lập Prisma nên câu `where`, giao dịch và `SELECT ... FOR UPDATE` của việc đảo chỉ được kiểm bằng các script chạy tay (đối chiếu SQL 8/8 ở mục 36), chưa thành test lặp lại được; nên làm tiếp (dựng PI + máy + công nhân trên DB 5433, báo → gửi KCS → đảo → thống kê); (2) chưa có Playwright e2e cho `/floor` và màn QLSX; (3) FE chưa có test component cho `FloorScanApp`, `QlsxFloorPage`, `QlsxStats`, ô chọn tháng/năm (chỉ test phần logic) và chưa chạy axe cho ô chọn tháng/năm; (4) chưa thử tải/đồng thời (≥ 20 công nhân báo cùng lúc, gửi lại cùng Idempotency-Key); (5) còn vài dòng chưa phủ ở `floor-admin` (tính tiến độ hàng đợi), `floor-alerts` (85%), `floor-stats` dòng 281; (6) điện thoại thật trong xưởng + mạng công ty thật vẫn là bước pilot (D4).

## 41. Thử tải phần QR: nhiều công nhân báo cùng lúc (2026-10-16) — script mới, chưa commit
Người dùng hỏi cách thử "nhiều công nhân báo cùng lúc" và "điện thoại thật trong xưởng" (hai việc còn hổng ở mục 40) → chọn làm script tải trước. Điện thoại thật KHÔNG script được (là bước pilot: phủ Wi-Fi, tem quét trong điều kiện thật, găng tay, ra khỏi vùng Wi-Fi) — phiếu pilot chưa soạn.
**Đã làm:** `test/load/floor-load.mjs` (mới, Node thuần, không cần cài; `npm run load:floor`) giả lập **24 điện thoại ảo** (14 Phôi · 6 Hàn · 4 Sơn), mỗi cái một IP riêng qua `X-Forwarded-For`. Tự dựng nền (tạo máy Sơn nếu thiếu, đưa PI vào hàng đợi, tạo công nhân thử + tự đặt PIN, nhận sắt) và có chốt an toàn: từ chối mọi địa chỉ không phải máy local. **Cách chạy an toàn đã dùng:** nhân bản DB dev sang DB riêng `dna_erp_load` (`pg_dump | pg_restore` trong container), đặt dải IP xưởng ảo `10.77.0.0/16` trong bản sao, chạy một BE thứ hai cổng 3002 với `TRUST_PROXY_HOPS=1` (đúng cấu hình Render) trỏ bản sao → dữ liệu đóng vai của người dùng ở DB dev không bị đụng. Xong đã tắt BE 3002 và `DROP DATABASE dna_erp_load` (DB dev: 0 tài khoản `load.*`).
**Kết quả (lần chạy cuối, 596 yêu cầu, 280 giây): 27 kiểm tra qua, 0 hỏng, 1 cảnh báo.**
- **B — 14 công nhân Phôi báo cắt cùng lúc vào 1 máy + 1 PI (6 lần/người):** 84/84 thành công, p95 286ms, ~46 lần báo/giây; tổng từng cỡ đoạn khớp 14/14 người ở cả "Sản lượng của tôi" lẫn đợt cắt đang mở của QLSX (mỗi người một đợt riêng, không mất/đè số).
- **C — Hàn 6 người (36/36) + Sơn 4 người (24/24) báo mảnh cùng lúc:** tổng từng loại mảnh khớp.
- **D — điện thoại mất sóng gửi lại:** 14 người, mỗi người bắn 3 lần đồng thời cùng `Idempotency-Key` rồi 1 lần nữa sau 0,8 giây → cả 4 lần trả về cùng một đợt, mỗi người chỉ có ĐÚNG 1 lần báo (không cộng 2–4 lần). Độ trễ p95 ~1,2 giây vì các lần gửi cùng khoá xếp hàng chờ nhau (chấp nhận được).
- **E — đua:** công nhân báo liên tục 12 lần trong khi QLSX đảo 1 lần báo (120ms) và gửi KCS đợt đó (200ms): xong trong ~0,5 giây, không lỗi 500, không treo; công nhân thấy đủ 15 lần báo, đúng 1 lần bị đảo; lần báo sau khi đợt vừa gửi KCS mở đợt mới bình thường.
- **F — ca làm việc 60 giây, cả xưởng dùng chung 1 IP, ~1 lần báo/người/phút, có QLSX ngồi cùng mạng (màn tự tải lại sau mỗi lần báo, trễ 400ms như `useRealtimeRefetch`):** 183 yêu cầu, p95 111ms, route đông nhất `/floor/summary` 48 yêu cầu/60 giây, **không bị chặn 429**. Chạy ép (12 lần báo/người/phút — vô lý với thực tế): bắt đầu bị 429 sau ~31 giây, vẫn không lỗi 500, công nhân sẽ thấy "Bạn thao tác quá nhanh - đợi khoảng 1 phút". **Đo được:** giới hạn chung 100/phút/IP tính RIÊNG cho từng route (gọi route A 110 lần: 429 từ lần 101, route B ngay sau đó vẫn 200) — nên nỗi lo "cả xưởng dùng chung 1 IP sẽ chạm 100 yêu cầu/phút gộp" là không đúng; một route phải có > 100 lần/phút/IP mới bị chặn (≈ cả xưởng báo > 100 lần/phút).
- **A — đăng nhập dồn (cảnh báo duy nhất):** 24 công nhân cùng đăng nhập từ 1 IP công cộng (NAT xưởng) → **8 vào ngay, 16 bị 429 (`Retry-After: 60`); nếu mỗi người tự thử lại sau 60 giây thì cả xưởng vào hết sau ~125 giây.** Cùng giới hạn 8 lần/phút/IP cũng áp cho **đặt PIN lần đầu** → ngày đầu 24 người vừa đặt PIN vừa đăng nhập ≈ 48 yêu cầu ≈ 6 phút. Phiên đăng nhập trượt 7 ngày nên chỉ gặp ở ngày đầu/khi hết phiên, không phải mỗi sáng. **Đây là số đo thật cho quyết định đã chốt "giữ 8 lần/phút/IP" (2026-10-15) — chưa đổi gì;** nếu pilot gặp cảnh này có 3 hướng: cho công nhân vào lần lượt ngày đầu (không cần sửa code), rải lịch tạo/đặt PIN, hoặc nâng giới hạn đăng nhập/đặt PIN theo IP (đã có khoá tài khoản 5 sai/15 phút chống dò PIN từng tài khoản).
**Sai sót của chính script đã sửa:** lần chạy đầu kịch bản E báo "thấy 16 ≠ 15" — không phải lỗi BE mà do script đếm nhầm 1 lần báo của kịch bản D trước đó (khoảng trễ lọc 1,5 giây quá rộng) → thu về 300ms (kiểm bằng truy vấn sổ `floor_reports`: dòng thừa là khoá `…-d-0`).
**CHƯA làm / giới hạn của phép thử:** (1) chưa kiểm "sức phát hiện" của script bằng cách cố ý làm hỏng BE (test đơn vị ở mục 40 đã qua kiểm tra đột biến, script này chưa); (2) chạy trên máy local (Postgres Docker cùng máy) nên **chưa đo độ trễ thật của Render + Prisma Postgres** (mỗi giao dịch nhiều câu truy vấn sẽ chậm hơn khi DB ở xa; gói Render miễn phí còn ngủ/khởi động nguội) — nên chạy lại với `BE_URL` trỏ môi trường thử gần Render nếu có staging (cần `ALLOW_REMOTE=1`, KHÔNG dùng production); (3) chưa thử realtime WebSocket nhiều máy kết nối cùng lúc; (4) quy mô thử 24 người, chưa thử 50+; (5) điện thoại thật trong xưởng + phiếu pilot chưa làm. Script đặt 24 tài khoản `load.*` — đã nằm trong bản sao đã xoá nên DB dev không có.

## 42. Playwright thử điện thoại công nhân: 3 loại máy giả lập (2026-10-16) — chỉ FE + file test, chưa commit
Người dùng hỏi "Playwright có thay điện thoại thật được không" → trả lời: thay được phần PHẦN MỀM trên điện thoại, không thay được phần vật lý ở xưởng; chọn làm Playwright trước.
**Đã làm (FE `D:\DNA-ERP`, không đụng code nghiệp vụ):** `playwright.floor.config.ts` + `e2e/floor/{env,fixtures,worker-phone.spec}.ts` (mới). 3 hồ sơ máy: **Pixel 7** (Chromium), **iPhone 14** (WebKit — đã cài thêm trình duyệt WebKit 59,6MB cho Playwright), **Moto G4** (Android rẻ: CPU chậm gấp 4 + mạng ~3G chậm, chỉ Chromium làm được). Trang mở bằng `http://<IP Wi-Fi của máy>:3100` chứ không phải localhost → trình duyệt coi là "ngữ cảnh không an toàn" y như điện thoại thật mở `http://IP` (lỗi `crypto.randomUUID` trước đây chỉ xảy ra ở đây). Hỗ trợ: `next.config.mjs` đọc `NEXT_DIST_DIR` + `typescript.tsconfigPath` (không đặt = như cũ) để bản FE thử build riêng ở `.next-e2e`/`tsconfig.e2e.json`, không ghi đè `.next` của `npm run dev`; `.gitignore` và `eslint.config.mjs` bỏ qua thư mục sinh ra. **Môi trường an toàn:** bản sao DB dev + BE riêng cổng 3002 (`TRUST_PROXY_HOPS=1`, dải IP công ty ảo `10.88.0.0/16`), mỗi bài một công nhân + một IP điện thoại riêng (qua `X-Forwarded-For`) nên không ăn hạn mức đăng nhập của nhau; fixture từ chối chạy nếu địa chỉ BE không thuộc mạng nội bộ. Cách dựng ghi ở đầu file config.
**14 bài × 3 loại máy = 42 lượt:** (1) lần đầu: quét link → đặt PIN → vào màn báo cắt (+ đo thời gian tải); (2) đăng nhập lần sau, sai PIN báo rõ, mở lại link vẫn còn đăng nhập; (3) sai PIN 5 lần → khoá tạm kể cả khi sau đó nhập đúng; (4) **ngoài mạng công ty** → báo rõ phải nối Wi-Fi công ty; (5) phiên hết hạn giữa ca (xem phát hiện); (6) trình duyệt không có `crypto.randomUUID` vẫn đăng nhập + lưu được; (7) báo cắt → bảng xác nhận → "Đã lưu" → số vào "Sản lượng của tôi" và sổ BE; (8) "Sửa lại" không ghi gì, số còn nguyên; (9) **mất mạng lúc xác nhận** → báo rõ, số còn nguyên, có mạng bấm lại ghi đúng 1 lần; (10) **BE đã ghi nhưng điện thoại không nhận được phản hồi** → bấm lưu lại không bị cộng 2 lần (dùng đúng `Idempotency-Key`); (11) 429 → "đợi khoảng 1 phút", không lộ chữ `ThrottlerException`; (12) lỗi 500 → có thông báo, số còn nguyên; (13) không tràn ngang, nút Lưu luôn trong tầm nhìn, nút/ô nhập ≥ 44px; (14) axe WCAG 2 A/AA ở màn đăng nhập và màn báo.
**Kết quả:** lần chạy đầy đủ cuối **41 qua / 1 hỏng** — lần hỏng là trang trắng đơn lẻ ở bài (8) trên Pixel 7, **không tái hiện được** khi lặp lại bài đó 8 lần (8/8 qua) → đặt `retries: 1` để lần như vậy hiện "flaky" thay vì làm hỏng cả lần chạy; bài (5) đúng như dự kiến "hỏng" ở cả 3 máy. **Kiểm tra đột biến:** cố ý làm hỏng `useRetrySafeKey.settle` (mất phản hồi vẫn đổi khoá) → bài (10) bắt được ngay: **2 lần báo thay vì 1** (đúng lỗi "cộng 2 lần khi gửi lại"); đã khôi phục file. Kiểm bổ sung: FE `tsc` sạch, eslint 0 lỗi (5 cảnh báo `any` giống các bài e2e cũ), BE/FE không đổi hành vi.
**Phát hiện thật:** (a) **phiên hết hạn giữa ca → công nhân bị chuyển sang `/login` của ERP** (tên + mật khẩu), không phải màn PIN của máy (xác nhận cả 3 máy; bài (5) khẳng định hành vi MONG MUỐN và đánh dấu `test.fail` — khi sửa xong Playwright sẽ báo "dự kiến hỏng mà lại qua" → gỡ dòng đó; trùng lỗ hổng đã ghi ở mục 31/GĐ2); (b) **lỗi 500 hiện tiếng Anh "Internal server error"** cho công nhân (cả 3 máy); (c) màn đăng nhập trên máy yếu (CPU ×4 + 3G) tải **~4,2 giây** so với 0,2–0,5 giây máy thường — vẫn dưới ngưỡng đặt (25 giây) nhưng là con số để theo dõi ở pilot; (d) axe: 0 vi phạm nghiêm trọng; lần đầu báo 1 lỗi tương phản là dương tính giả do hiệu ứng đổi màu 0,15 giây của nút (CSS toàn cục) — đã tắt hiệu ứng khi đo, không phải lỗi giao diện.
**Sai sót của chính bộ thử đã sửa:** ngắt mạng bằng `context.setOffline` không có tác dụng khi đang giả lập CPU/mạng chậm (hai cách điều khiển mạng ghi đè nhau → bài (9) trên máy yếu "lưu thành công" thay vì báo mất mạng) → thêm fixture `phoneNet.setOffline`; bài (5) lúc đầu chạy đua (kiểm URL trước khi trang kịp bị chuyển) nên iPhone/Android yếu "qua" nhầm → chờ 2,5 giây sau lần làm mới phiên.
**Dọn:** tắt FE 3100 và BE 3002, `DROP DATABASE dna_erp_e2e`, xoá `.next-e2e` và thư mục kết quả; DB dev: 0 tài khoản `e2e.*`/`load.*`.
**CHƯA làm / không thay được:** (1) chỉ phủ luồng đăng nhập + báo **cắt** (Phôi); chưa có bài UI cho Hàn/Sơn báo mảnh, màn nhận sắt, tab "Sản lượng của tôi" theo kỳ; (2) **chưa kiểm số nhập dở có mất khi tải lại trang / điện thoại khoá màn hình hay không**; (3) WebKit của Playwright ≈ Safari iOS nhưng không phải Safari thật; Zalo/trình duyệt nhúng của hãng máy chưa có; (4) phần vật lý vẫn cần điện thoại thật ở xưởng: phủ Wi-Fi từng máy, tem quét được khi dính dầu/chói sáng, găng tay, ra khỏi vùng Wi-Fi rồi quay lại; (5) chạy tay, chưa đưa vào CI; (6) build bản production chạy cục bộ nên số đo thời gian là chuẩn mực tương đối, không phải Render/Vercel thật.

## 43. Màn "Lệnh sản xuất" (PI + chiều dài thanh sắt) của tổ Phôi/Hàn/Sơn cho QLSX — hỏi lại, chưa làm (2026-10-16)
Người dùng hỏi: màn của tài khoản thống kê Phôi/Hàn/Sơn ở phần nhập liệu (màn hiện PI rồi chiều dài thanh sắt) "bạn xoá rồi à, sao không để qua bên QLSX để quản lý". **Kiểm tra: KHÔNG bị xoá** — `LenhSanXuatPhoi/Han/Son` vẫn còn nguyên trong code (`MfgApp.tsx`, tab "Lệnh sản xuất") và đã đăng nhập thử bằng tài khoản `phoi`/`han`/`son` (vai trò `*_STAFF`, bản sao DB demo): vẫn thấy "Lệnh sản xuất · Hướng dẫn cắt · Xác nhận nhận sắt · Danh sách định mức mảnh · Kho phôi" (Phôi), "Lệnh sản xuất · Xác nhận sản lượng · …· Khung hàn" (Hàn), "…Mảnh chờ đan" (Sơn). Đợt QR chỉ gỡ nút quét camera trong app công nhân (`QrScanner.tsx`), không đụng các màn này. **Điều thật sự thiếu:** tab "Lệnh sản xuất" chỉ hiện cho `isPhoi || isHan || isSon || isDirector`, nên **QLSX không có màn này** (menu QLSX: Tổng hợp lệnh SX · Xử lý lệnh sản xuất · Sản lượng xưởng · Danh sách SKU · Tổng hợp vật tư · Tổng hợp kho). Cả 3 màn đã có chế độ `readOnly` (đang dùng cho Tổng giám đốc) nên thêm cho QLSX là việc nhỏ. **Vướng mắc đã đo:** QLSX gọi được `phoi-progress`, `steel-issues`, `cut-bundles`, `production-batch-plan` nhưng **không gọi được `/qc-reviews`** (thiếu quyền `QC_REVIEW:VIEW`) — màn cũ cần danh sách KCS để hiện trạng thái đợt, nên cần một trong hai: cấp `QC_REVIEW:VIEW` cho vai trò QLSX (đổi `role-permissions.constant.ts` + chạy lại seed trên production) hoặc để màn tự bỏ phần KCS khi 403. Chờ người dùng xác nhận đúng màn và chọn cách; chưa sửa code.

## 44. Rà UX các màn điều hành của QLSX (Phôi/Hàn/Sơn) — 2026-10-16, chưa sửa code
Người dùng: "QLSX là quản lý toàn bộ sản xuất của Phôi Hàn Sơn, có nên cải thiện lại chỗ này" → đồng ý rà trước khi thiết kế. **Cách rà:**
bản sao DB dev (`dna_erp_ux`) + BE 3002 + bản FE build riêng, đăng nhập `qlsx` bằng Playwright, đi đúng câu hỏi điều hành "PI đang chạy của tổ đã
xong chưa, chuyển PI tiếp được chưa", chụp từng bước. Xong đã tắt server, xoá bản sao và bản build.
**Hiện trạng 3 màn:** "Tổng hợp lệnh SX" (danh sách 31 PI → chi tiết PI → bấm SKU → khung cơ khí có tab Phôi/Hàn/Sơn; Phôi có bảng rất đủ: từng
loại sắt × từng công đoạn Cắt/Uốn/Dập/Tán… × từng cỡ đoạn, cần/đã làm/còn lại/lỗi, sắt đã nhận, cảnh báo báo vượt sắt); "Xử lý lệnh sản xuất"
(danh sách PI chờ Bắt đầu); "Sản lượng xưởng" (thẻ PI đang chạy theo tổ + hàng đợi + chờ gửi KCS + báo cáo).
**Phát hiện (chấm màn điều hành của QLSX ~6/10):**
1. **Dữ liệu chi tiết có đủ nhưng nằm sai chỗ:** muốn biết PI-2026-040 còn thiếu gì phải vào Tổng hợp lệnh SX → PI → SKU → tab tổ (3–4 lần bấm),
   trong khi nút quyết định "Chuyển PI tiếp" ở màn khác (Sản lượng xưởng). Thẻ "PI đang chạy · tổ Phôi" chỉ có "30% · Đã báo 840/2.820", không
   bấm vào xem được, không nói thiếu loại sắt nào — thực tế Sắt hộp 10×20 cả 7 cỡ = 0 và chưa nhận sắt. Rủi ro: chuyển PI tiếp quá sớm.
2. **Hai con số khác nhau cho cùng một việc, không ghi chú:** tổ Phôi của PI-040 = **30%** ở Sản lượng xưởng nhưng **17%** ở Tổng hợp lệnh SX.
   *(Đính chính khi lên plan mục 45, sau khi đọc code: chênh chủ yếu do MẪU SỐ — thẻ hàng đợi chỉ tính đoạn CẮT (`computeProgress`, 2.820 đoạn),
   Tổng hợp tính Cắt + mọi công đoạn phụ (Uốn/Dập/Tán…); cả hai đều lấy `done` gồm cả đợt chưa gửi KCS, Tổng hợp trừ thêm lỗi KCS. Ghi ban
   đầu "30% = đã báo, 17% = đạt KCS" là sai.)*
3. **[ĐÃ SỬA ở mục 47]** **Nhãn sai ở bảng Hàn/Sơn trong Tổng hợp lệnh SX (lỗi hiển thị thật):** cột ghi "Đã báo (cái)" nhưng lấy `passedQty` (số ĐẠT KCS,
   `ThongKePagePlan.tsx` `doneQty: item.passedQty`) → Khung tựa có 12 cái đang chờ KCS vẫn hiện 0 kèm "cần hàn thêm 1 cái" / "chưa cân đối" →
   QLSX đọc như tổ Hàn chưa làm gì.
4. **Thao tác điều hành rải 3 nơi:** Bắt đầu PI (Xử lý lệnh sản xuất), xếp/chuyển PI theo tổ (Sản lượng xưởng), Tạm dừng/Kết thúc SKU (chi tiết PI
   trong Tổng hợp lệnh SX).
5. QLSX không có "Hướng dẫn cắt"; không xem được `/qc-reviews` (thiếu `QC_REVIEW:VIEW`, mục 43).
**Đề xuất (chờ chốt, chưa làm):** (A) thẻ "PI đang chạy" ở Sản lượng xưởng có nút "Xem chi tiết" mở ngăn bên phải với ĐÚNG bảng chi tiết của tổ đó
(dùng lại `PhoiMaterialBoard`/`VatTuDetailBoard` chỉ xem, cùng nguồn số với màn Phôi/Hàn/Sơn), trên thẻ tóm tắt "còn thiếu N loại sắt/mảnh, M
loại chưa nhận sắt", và hỏi lại khi bấm "Chuyển PI tiếp" lúc còn thiếu; (B) thống nhất 3 lớp số ở mọi màn: đã báo · chờ KCS · đạt KCS (sửa nhãn
"Đã báo" ở bảng Hàn/Sơn thành "Đạt KCS" + thêm cột chờ KCS/chưa gửi); (C) mở "Hướng dẫn cắt" chỉ xem từ ngăn chi tiết Phôi; (D) cấp
`QC_REVIEW:VIEW` cho QLSX nếu cần danh sách lỗi KCS (phải seed lại production). Ước lượng: B ~0,5 ngày, A ~2 ngày, C ~0,5 ngày.

## 45. PLAN chi tiết: màn điều hành của QLSX cho Phôi/Hàn/Sơn (2026-10-16) — 45.9 câu 1, 2, 4 ĐÃ CHỐT 2026-10-19; giai đoạn B ĐÃ LÀM ở mục 47, A ĐÃ LÀM ở mục 48; C chưa làm
Người dùng: "lên plan chi tiết, đảm bảo UI UX với tư duy của một senior". Dựa trên rà ở mục 44 + đọc code nguồn số.

### 45.1. QLSX cần trả lời được gì (việc phải làm, không phải màn)
| # | Câu hỏi / quyết định trong ca | Hiện tại phải làm gì |
|---|---|---|
| Q1 | Tổ nào đang chạy PI gì, đã tới đâu? | Sản lượng xưởng: chỉ có 1 % + "Đã báo x/y" |
| Q2 | **Còn thiếu đúng cái gì** (loại sắt/cỡ đoạn/công đoạn, mảnh nào), cái nào chưa nhận sắt? | Tổng hợp lệnh SX → PI → SKU → tab tổ (3–4 lần bấm, màn khác) |
| Q3 | Có bất thường cần xử lý ngay không (báo vượt sắt nhận, đợt chờ gửi KCS lâu, Hàn lệch bộ, KCS chấm lỗi)? | rải ở thẻ chờ KCS + bảng Tổng hợp |
| Q4 | **Chuyển PI tiếp được chưa?** | bấm ở Sản lượng xưởng mà không thấy Q2 |
| Q5 | Trả lời Sếp/KHSX "PI này tới đâu" | Tổng hợp lệnh SX (ổn, giữ nguyên) |
Mục tiêu: Q1–Q4 trả lời được **ngay tại thẻ PI của tổ**, tối đa 1 lần bấm, số giống hệt ở mọi màn. Q5 giữ ở Tổng hợp lệnh SX.

### 45.2. Nguyên tắc thiết kế
1. **Một định nghĩa số dùng chung mọi nơi** (gốc của lỗi 2–3 ở mục 44). Mỗi dòng (cỡ đoạn × công đoạn, hoặc mảnh) có:
   `Cần` · `Đã báo` = `Chưa gửi KCS` + `Chờ KCS` + `KCS đã chấm`; `KCS đã chấm` = `Đạt` + `Lỗi`; `Còn thiếu` = max(0, Cần − (Đã báo − Lỗi)).
   % tiến độ của tổ = Σ min(Đã báo − Lỗi, Cần) / Σ Cần trên **mọi công đoạn tổ đó phải làm** (Phôi = Cắt + công đoạn phụ). BE tính, FE chỉ hiển
   thị; tên cột giống nhau ở cả 3 màn (QLSX, tài khoản Phôi/Hàn/Sơn, Tổng hợp).
2. **Thông tin đặt ở chỗ ra quyết định**: chi tiết mở ngay từ thẻ PI tổ, không chuyển màn.
3. **Không thêm tab/màn mới** (menu QLSX đã 6 mục). Dùng ngăn trượt bên phải (drawer) — giữ nguyên ngữ cảnh hàng đợi + chờ gửi KCS phía sau.
4. **Hé lộ dần**: thẻ (1 dòng tóm tắt) → "Còn thiếu" (đầu ngăn) → bảng đầy đủ (gập/mở) → Hướng dẫn cắt.
5. **Rào chắn mềm, không chặn cứng**: hiện điều hành cho phép chuyển PI khi chưa đủ (bù lỗi vẫn báo được); giữ vậy, nhưng hỏi lại có nêu rõ thiếu gì.
6. **Dùng lại bảng đang có** (`PhoiMaterialBoard`, `VatTuDetailBoard` chế độ chỉ xem) để số và cách đọc giống màn Phôi/Hàn/Sơn; không vẽ bảng thứ 3.
7. Trạng thái tải/lỗi/rỗng rõ ràng; tự cập nhật realtime như các màn QLSX khác; bàn phím + trình đọc màn hình (ngăn có focus trap, Esc đóng,
   trả focus về nút mở); dùng được trên tablet (ngăn thành toàn màn hình khi hẹp < 900px).

### 45.3. Giai đoạn B — Thống nhất số + sửa nhãn sai (làm trước, ~1–1,5 ngày)
**BE (chỉ thêm trường, không đổi trường cũ → không vỡ màn đang dùng):**
- `SteelIssuesService.getPhoiProgress` / batch: mỗi `segment` (Cắt) và `steps[].segments` (công đoạn phụ) thêm `openQty` (đoạn trong đợt cắt
  `CUTTING` / step batch chưa vào đợt), `awaitingQcQty` (đợt `AWAITING_QC`), giữ `done`/`failed` như cũ (đều theo từng SKU trong `byOrder`).
- `ProductionBatchesService.getBatchPlan(Batch)`: mỗi item thêm `openQty` (lô `OPEN` chưa gửi KCS) — hiện `FloorScanService` và
  `computeProgress` đang tự cộng riêng, gom về một chỗ.
- `FloorAdminService.computeProgress`: Phôi tính **cả công đoạn phụ** (đúng nguyên tắc 1) và trả thêm `breakdown` theo công đoạn
  (`[{ step:'CAT', required, reported }, { step:'UON', … }]`) + `missing` (số dòng còn thiếu, số loại sắt chưa nhận sắt). **Hệ quả cần biết:**
  `complete` của tổ Phôi sẽ khó đạt hơn (phải xong cả Uốn/Dập…) → nhắc "đủ số, chuyển PI tiếp" (`floor-alerts`) đến muộn hơn nhưng đúng hơn.
**FE:**
- File logic chung `src/modules/pages/Floor/progressModel.ts` (+ test): từ dữ liệu BE ra bộ số chuẩn ở 45.2.1, dùng cho mọi màn.
- `ThongKePagePlan.tsx` (Tổng hợp lệnh SX): bảng Hàn/Sơn đang ghi **"Đã báo (cái)" nhưng là `passedQty`** → đổi sang số đã báo thật + dòng nhỏ
  "chờ KCS n · chưa gửi n" (bảng `VatTuDetailBoard` đã có sẵn tham số `choKcsFor`, chỉ màn Tổng hợp chưa truyền); cảnh báo "cần hàn thêm"/"chưa cân
  đối bộ" tính trên số đã báo, không phải số đạt. Phôi: cột "Đã xong (đạt)" đang = đã làm − lỗi (gồm cả chưa gửi KCS) → đổi tên "Đã làm (trừ lỗi)"
  hoặc tách cột theo 45.2.1 — chốt ở 45.7.
- Rà tất cả nơi dùng `VatTuDetailBoard`/`PhoiMaterialBoard` (`core.tsx`, `ThongKePagePlan.tsx`, `LenhSanXuatPhoi.tsx`, `VatTuTpDetail.tsx`) để nhãn
  và số khớp nhau; thẻ PI ở Sản lượng xưởng hiện cùng % với Tổng hợp.
**Nghiệm thu B:** cùng 1 PI, cùng 1 tổ, % và số "đã báo/chờ KCS/đạt/còn thiếu" **bằng nhau ở 3 màn** (QLSX Sản lượng xưởng, Tổng hợp lệnh SX, tài
khoản thống kê của tổ) — có bài Playwright so 3 màn trên cùng dữ liệu.

### 45.4. Giai đoạn A — Thẻ PI của tổ + ngăn chi tiết (~2–2,5 ngày)
**Thẻ "PI đang chạy · tổ Phôi" (thay dòng "Đã báo 840/2.820"):**
```
PI đang chạy · tổ Phôi                                   [Chuyển PI tiếp >]
PI-2026-040                                     Bắt đầu 08:10 13/10 · QLSX
███████░░░░░░░░░░░░░░░░  17%   Cắt 30% · Uốn 0% · Dập 0% · Tán 0% · Xẻ 0%
⚠ Còn thiếu 5 loại sắt (2 loại chưa nhận sắt) · 4 đợt chờ gửi KCS
                                                       [Xem còn thiếu gì]
```
- Thanh tiến độ xếp chồng 3 màu: đạt / chờ KCS / chưa gửi (màu + chú giải chữ, không chỉ dựa vào màu); dòng công đoạn chỉ hiện công đoạn PI có.
- Dòng cảnh báo chỉ hiện khi có; tất cả số bấm được → mở ngăn đúng phần đó.

**Ngăn chi tiết (bên phải, rộng ~720px; < 900px thì toàn màn hình):**
```
PI-2026-040 · tổ Phôi · GHE-J55                                         [×]
17% ███░░░  Đạt 470 · Chờ KCS 0 · Chưa gửi 370 · Lỗi 1 · Còn thiếu 4.120
[Còn thiếu] [Tất cả] [Bất thường 3]           SKU: (Tất cả ▾)   [Hướng dẫn cắt]
── Còn thiếu (sắp theo số còn thiếu, chưa nhận sắt lên đầu) ──────────────
Sắt hộp 10×20   CHƯA NHẬN SẮT   Cắt 0/720 · Uốn 0/120 · Dập 0/480 · Tán 0/120
  470mm  Cắt 0/120   Uốn 0/120   Dập 0/120 …
Sắt tròn Ø21    CHƯA NHẬN SẮT   …
Sắt phi 4       Cắt 719/720  (thiếu 1 · 185mm, do KCS chấm lỗi 1)
── Bất thường ──────────────────────────────────────────────────────────────
⚠ Sắt vuông 12×12: báo vượt sắt đã nhận 12,2 m        [Xem đợt chờ KCS]
⚠ 2 đợt chờ gửi KCS quá 4 giờ                         [Đến danh sách]
Mở đầy đủ trong "Tổng hợp lệnh SX" ›
```
- Tab "Còn thiếu" là mặc định (trả lời Q2/Q4 ngay); "Tất cả" = bảng đầy đủ dùng lại `PhoiMaterialBoard`; "Bất thường" gom: báo vượt sắt, chờ
  gửi KCS quá ngưỡng, KCS chấm lỗi, Hàn lệch bộ — mỗi dòng có nút đi tới chỗ xử lý.
- Hàn/Sơn: cùng khung, phần thân là bảng mảnh (`VatTuDetailBoard` chỉ xem) + dòng "Đồng bộ: N bộ, cần thêm…".
- PI nhiều SKU: chọn SKU ở góc (mặc định gộp cả PI); đợt cũ chưa gắn SKU hiện dòng riêng như Tổng hợp đang làm.
- Mở được cho PI trong hàng đợi (xem trước PI kế tiếp: đã nhận sắt chưa) và PI vừa chuyển xong (bù lỗi).
- Tự cập nhật khi công nhân báo/QLSX gửi KCS (cùng cơ chế realtime của màn), giữ vị trí cuộn và tab đang xem.

**"Chuyển PI tiếp" khi còn thiếu** — hộp xác nhận nêu đúng thiếu gì, nút an toàn là mặc định:
```
Chuyển PI tiếp cho tổ Phôi?
PI-2026-040 còn thiếu 4.120 đoạn ở 5 loại sắt (2 loại chưa nhận sắt):
 · Sắt hộp 10×20 — chưa nhận sắt, 0/1.440
 · Sắt tròn Ø21 — chưa nhận sắt, 0/1.080   … và 3 loại khác
Còn 4 đợt chờ gửi KCS.
Sau khi chuyển, công nhân vẫn báo bù lỗi được cho PI này.
            [Xem còn thiếu gì]   [Vẫn chuyển PI tiếp]
```
- Đủ số + không còn đợt chờ: hộp xác nhận ngắn như hiện tại. Không thêm bước nào cho trường hợp bình thường.

### 45.5. Giai đoạn C — Hướng dẫn cắt chỉ xem cho QLSX (~0,5–1 ngày)
- Nút "Hướng dẫn cắt" trong ngăn Phôi mở `HuongDanCatPage` ở chế độ chỉ xem, lọc đúng PI (màn đã nhận `initialPiId`).
- Cần kiểm trước khi làm: màn gọi `GET /steel-issues?status=…` — QLSX đã gọi được `/production-invoices/:id/steel-issues` nhưng chưa thử route này;
  thiếu quyền thì thêm vào `ROLE_GRANTS` của QLSX (phải seed lại production) hoặc đổi màn sang route theo PI.

### 45.6. Giai đoạn D — quyền xem KCS (chỉ khi cần)
- Ngăn chi tiết lấy số lỗi từ `phoi-progress`/`batch-plan` (đã có `failed`), **không cần** `/qc-reviews`. Chỉ cấp `QC_REVIEW:VIEW` cho QLSX nếu muốn hiện
  thêm ghi chú/lý do lỗi của từng lần KCS chấm (đổi `role-permissions.constant.ts` + seed production). Đề xuất: chưa làm.

### 45.7. Kiểm thử & nghiệm thu
- BE: test đơn vị cho trường mới (`openQty`/`awaitingQcQty`, `breakdown`, `missing`, Phôi tính cả công đoạn phụ) + kiểm tra đột biến như mục 40.
- FE: test `progressModel.ts` (mọi trường hợp: chưa nhận sắt, báo vượt, lỗi KCS, PI nhiều SKU, đợt cũ chưa gắn SKU).
- Playwright (desktop + tablet, chạy trên bản sao DB như mục 42): mở thẻ → ngăn → "Còn thiếu" đúng; **số khớp 3 màn**; công nhân báo thêm → ngăn tự
  cập nhật; "Chuyển PI tiếp" khi thiếu hiện đúng danh sách, khi đủ thì không hỏi thêm; Esc/Tab/focus; axe 0 lỗi nghiêm trọng; < 900px toàn màn hình.
- Thử với QLSX thật 1 ca: đo số lần bấm để trả lời Q2/Q4 (mục tiêu ≤ 1) và có lần nào chuyển PI sớm nhầm không.

### 45.8. Ngoài phạm vi đợt này
Gộp "Xử lý lệnh sản xuất" (Bắt đầu PI) vào hàng đợi; đổi bố cục "Tổng hợp lệnh SX"; màn Đan; app công nhân.

### 45.9. Cần người dùng chốt
1. % tiến độ tổ Phôi tính **cả công đoạn phụ** (đúng hơn, nhắc "đủ số" đến muộn hơn) hay giữ chỉ Cắt?
2. Bảng Phôi trong Tổng hợp: đổi tên cột "Đã xong (đạt)" → "Đã làm (trừ lỗi)" (nhanh) hay tách đủ cột Chưa gửi / Chờ KCS / Đạt (rõ hơn, bảng rộng hơn)?
3. Có cần ghi chú/lý do lỗi của KCS trong ngăn không (quyết định có làm D)?
4. Thứ tự B → A → C có đồng ý không? Ước lượng tổng ~4,5–6 ngày công (gồm test), sau mỗi giai đoạn dừng cho xem trước khi làm tiếp.

## 46. Review đối chiếu changelog QLSX ↔ code thật (2026-10-19) — CHỈ ĐỌC, không sửa code
Yêu cầu: xem phần QLSX đã triển khai tới đâu so với changelog. Đối chiếu file này (mục 21–45), `changelog-2026-09-25-notification-review-va-plan.md` mục 31,
`changelog-2026-09-24-dropdown-vo-ui-chon-kho-qlsx.md` với BE `main@bd70135` + FE `demo@d022c98`, kèm thay đổi chưa commit của cả 2 repo.
Bổ sung cho `changelog-2026-10-19-review-tong-the-hr-qlsx.md` mục 3 (cùng ngày), không lặp lại phần HR.

### 46.1. Trạng thái commit thật (sửa chữ "chưa commit" đã cũ)
- **Mục 21–39 ĐÃ COMMIT**: BE `bff7692 QR-QLSX` (PR hgbao85/DNA-ERP-BE#42, 2026-10-15: module `floor`, `common/network`, 8 migration 2026-10-12→15,
  `pin.util`, `floor-stats.util`), FE `d7db412 QR-QLSX` + `30db5fc fix date-time QLSX`. Mục 38 cho biết production đã nhận code + đã seed. Tiêu đề các
  mục 21–30, 32, 34, 36–39 đã đổi theo.
- **Mục 40–42 CHƯA COMMIT**: BE `floor.controller.spec.ts`, `auth.controller.spec.ts`, `floor-realtime.interceptor.spec.ts`, `test/load/`,
  `prisma/seed-dry-run.ts` chưa theo dõi; 4 spec floor mở rộng đang `M`. FE `e2e/floor/`, `playwright.floor.config.ts`, `monthYearLogic.*` chưa theo dõi.
- **Mục 45 giai đoạn B đang dở, chưa commit** (xem 46.3).

### 46.2. Bảng đối chiếu
| Hạng mục | Changelog | Code thật | Ghi chú |
|---|---|---|---|
| 21 Phần nền: sổ `floor_reports`, Idempotency-Key, nhận sắt có số thực nhận, `steelBalance` | Xong | Có, đã commit | migration `20261012090000_*`, `src/common/utils/floor-report.util.ts` |
| 22 BE QR: máy/QR, hàng đợi PI theo tổ, API quét, QLSX kiểm + Gửi KCS + đảo, đợt theo người | Xong | Có | `floor.controller.ts` đúng 29 route như ma trận quyền mục 40 |
| 23 Màn quét `/floor` | Xong | Có | `FloorScanApp.tsx` |
| 24 Màn "Sản lượng xưởng" (3 tab + realtime + summary) | Xong | Có | `QlsxFloorPage/QlsxQueue/QlsxReview/QlsxSetup.tsx`; menu `MfgApp.tsx:172` |
| 25 Tự đặt PIN + khoá 5 lần | Xong | Có | migration `20261013110000_*`, `pin.util.ts` |
| 26 Nhắc QLSX, công đoạn phụ tách người, "đã báo/cần" | Xong | Có | `floor-alerts.service.ts` (`FLOOR_STAGE_COMPLETE`, `FLOOR_BATCH_STALE`), migration `20261013120000_*` |
| 27–28 Địa chỉ tem, giới hạn mạng công nhân, `TRUST_PROXY_HOPS` | Xong | Có | `src/common/network/*`, `render.yaml` |
| 30.1 "Mở lại PI vừa chuyển" | Xong | Có | `POST /floor/queue/:stage/reopen` (`floor.controller.ts:267`) |
| 34 `/auth/pin-status` | Xong | Có | `auth.controller.ts:37-39` (60/phút), login/pin-setup 8/phút |
| 36 Báo cáo đạt KCS + `/floor/my-stats` | Xong | Có, **nhưng tự tải lại sau KCS duyệt không chạy với QLSX** | xem 46.4-1 |
| 37 Gỡ bộ quét trong app | Xong | Đúng | không còn `QrScanner.tsx` |
| 40 QA (1828 test, ma trận quyền, đột biến) | Xong | Có trên đĩa, **chưa commit** | chạy lại: 14 suite / 420 test floor + steel-issues + production-batches + network qua |
| 41 Thử tải / 42 Playwright | Xong | Có trên đĩa, **chưa commit** | — |
| 42a Phiên hết hạn → `/login` ERP thay vì màn PIN | Phát hiện, chưa sửa | **Còn nguyên** | `D:\DNA-ERP\src\context\AuthContext.tsx:128` |
| 42b Lỗi 500 hiện tiếng Anh | Phát hiện, chưa sửa | **Còn nguyên** | `floorUi.ts` `describeError` trả thẳng `e.message` cho mọi mã ≠ 0/429 |
| 43 Tab "Lệnh sản xuất" cho QLSX | Chưa làm | Chưa | `MfgApp.tsx:173` chỉ `isPhoi‖isHan‖isSon‖isDirector` |
| 44-3 Nhãn "Đã báo (cái)" lấy `passedQty` | Phát hiện | **ĐÃ SỬA ở mục 47** | `ThongKePagePlan.tsx:270`, `:301` vs tiêu đề `core.tsx:431` |
| 45 B — thống nhất số | Đã chốt 2026-10-19 | **ĐÃ LÀM ở mục 47** | xem 46.3 |
| 45 A / C / D | Chờ chốt | Chưa | — |
| 24.4#2 / 31 GĐ4: hai đường gửi KCS, cắt màn cũ | Chưa làm (chờ D3) | Chưa | màn tổ cũ vẫn tự "Gửi KCS" |
| 31 GĐ2: hàng chờ gửi lại, công nhân tự huỷ | Chưa làm (chờ D1) | Chưa | — |
| 22.1.7 đọc lỗi trùng `meta.target` ở chỗ khác | Ghi "ngoài phạm vi" | **Còn trên main** | `all-exceptions.filter.ts:95`, `material-groups.service.ts:55` (bản sửa nằm ở worktree riêng, xem review 10-19 mục 5) |
| 09-24 Dropdown "Chọn kho" vỡ UI | Đã sửa | Có | `SearchableSelect.tsx:76` dùng `createPortal` + `position: fixed`; 5/6 màn còn lại vẫn chưa thử bằng mắt |
| 09-25 §31 P1/P2 (audit lệnh SX, thông báo Bắt đầu/Tạm dừng/Kết thúc, "Kho được nhận hàng", đổi hạn) | Đã làm | Có | `recordFloorChange`, `PRODUCTION_ORDER_FLOOR_*`, `PI_ITEM_DEADLINE_CHANGED`, `audit-event.util.ts`, FE `FloorStoppedBanner.tsx` |
| 09-25 §31 P3 (cảnh báo quá hạn/kẹt trạng thái) | Treo | Chưa | chỉ có nhắc riêng của xưởng (`floor-alerts`, quét 10 phút) |

### 46.3. Giai đoạn B (mục 45.3) — làm tới đâu (ĐÃ LÀM XONG ở mục 47)
- **Đã có (chưa commit):** `getPhoiProgress`/công đoạn phụ trả thêm `openQty`, `awaitingQcQty` theo cỡ và theo SKU (`steel-issues.service.ts`, gom về
  `buildOrderBreakdown`); `getBatchPlan`/batch trả thêm `openQty` (`production-batches.service.ts`). Logic khớp schema (`StepBatch.stepBundleId` NULL =
  chưa gửi; `StepBundleStatus` AWAITING_QC/QC_PASSED).
- **Chưa có:** (1) **0 test** cho trường mới — `steel-issues.service.spec.ts` và `production-batches.service.spec.ts` không có ca `openQty`/`awaitingQcQty`
  mới (45.7 yêu cầu test + đột biến); (2) `FloorAdminService.computeProgress` (`floor-admin.service.ts:457`) chưa tính công đoạn phụ, chưa có
  `breakdown`/`missing` → 30% vs 17% (mục 44-2) vẫn còn; (3) `src/modules/floor/floor-progress.util.ts` không được import ở đâu (code chết) và chú thích
  trỏ tới FE `src/modules/pages/Floor/progressModel.ts` **không tồn tại**; (4) FE chưa đọc trường mới (chỉ `FloorScanApp.tsx:579` dùng `openQty` mảnh, có từ
  mục 23); (5) câu 45.9 chưa có ghi nhận đã chốt — nên chốt (đặc biệt câu 1, vì nó đổi lúc phát `FLOOR_STAGE_COMPLETE`) trước khi làm tiếp.

### 46.4. Lỗi/rủi ro mới thấy khi đọc code
1. **[ĐÃ SỬA ở mục 47 — làm cả 2 cách]** **Màn QLSX không nhận realtime của KCS.** Sự kiện KCS (`QC_REVIEW`) chỉ phát vào phòng `perm:QC_REVIEW` (`src/realtime/realtime.contract.ts:82-85`,
   cả topic `production-batches` của nó), mà QLSX không có `QC_REVIEW:VIEW` (`role-permissions.constant.ts`, khối `PRODUCTION_MANAGER`). Hệ quả:
   tab "Báo cáo" (`QlsxStats.tsx:228` chỉ nghe `qc-reviews`) **không tự tải lại khi KCS duyệt** như mục 36.3 ghi; `QlsxFloorPage.tsx:26` nghe `qc-reviews`
   cũng vô ích với QLSX. Mục 36.7 đã nói chưa thử được realtime — nay xác định là không chạy với vai QLSX. Sửa: cấp `QC_REVIEW:VIEW` cho QLSX (cần seed
   production, trùng hướng 45.6/D) hoặc cho route `QC_REVIEW` phát thêm vào phòng `FLOOR_REPORT`/`PRODUCTION_BATCH` — cần người dùng chọn.
2. Bắt đầu/Tạm dừng/Kết thúc SKU vẫn dùng `window.confirm` (`ThongKePagePlan.tsx:1637`) — khác hộp xác nhận dùng chung ở các màn QLSX khác (U-1).
3. `/floor/summary` được gọi từ 2 nơi mỗi lần có sự kiện (`MfgApp.tsx:198` chấm menu + `QlsxFloorPage.tsx:33/66`) — nhỏ, đúng như 24.4#14 đã nêu.
4. Lần chạy jest đầu báo "1 suite failed" do worker bị ép thoát (máy đang tải nặng, suite ~95 giây), chạy lại 14/14 qua — chưa thấy lỗi thật, ghi để theo dõi.

### 46.5. Kiểm tra đã làm / chưa làm
- Đã làm: đọc changelog + đối chiếu từng hạng mục bằng grep/đọc code 2 repo; `npx jest src/modules/floor src/modules/steel-issues src/modules/production-batches
  src/common/network` → 14 suite / 420 test qua (lần 2).
- Chưa làm: không chạy FE test, `tsc`, `nest build`, Playwright; không chạy app/live-test; không đụng DB; không sửa code.

### 46.6. Nên làm tiếp (đề xuất, thứ tự)
1. Commit phần test mục 40–42 (đang chỉ nằm trên máy dev) — tách khỏi việc HR đang dở.
2. Chốt 45.9 rồi làm xong giai đoạn B: test cho `openQty`/`awaitingQcQty`, `computeProgress` + `breakdown`/`missing`, dùng (hoặc xoá) `floor-progress.util.ts`,
   FE `progressModel.ts`, sửa nhãn `ThongKePagePlan.tsx:270/301`.
3. Chọn cách sửa 46.4-1 (realtime KCS cho QLSX), gộp với quyết định D.
4. Sửa 42a (hết phiên → màn PIN của máy) và 42b (lỗi 500 → câu tiếng Việt) — nhỏ, ảnh hưởng thẳng công nhân khi pilot.
5. Pilot bước 0 / D4, sau đó mới quyết D3 (cắt màn cũ) và D1 (tự huỷ lần báo).

## 47. ĐÃ LÀM giai đoạn B (mục 45.3): thống nhất số tiến độ 3 màn + sửa nhãn "Đã báo" + realtime KCS cho QLSX (2026-10-19) — BE + FE, chưa commit
Người dùng: "tiếp tục các phần của QLSX", rồi chốt (2026-10-19): làm **B → A → C**, dừng cho xem sau mỗi giai đoạn; **45.9-1: % tổ Phôi tính
Cắt + công đoạn phụ**; **45.9-2: bảng Phôi tách đủ cột**; realtime KCS cho QLSX (46.4-1): **làm cả 2 cách**. 45.9-3 (giai đoạn D) chưa hỏi lại.
Mục này là giai đoạn B; A và C chưa làm.

### 47.1. Đã làm — BE (`D:\DNA-ERP-BE`)
1. **`FloorAdminService.computeProgress` viết lại theo `floor-progress.util.ts`** (hết là code chết): mỗi dòng = `bucketLine` (đạt → chờ KCS →
   chưa gửi, chặn trần ở số cần, đã trừ lỗi KCS). Phôi = **Cắt + mọi công đoạn phụ** (lấy từ `getPhoiProgressBatch`, cùng nguồn với "Tổng hợp lệnh
   SX") + **mảnh Phôi + vật tư thành phẩm** (batch-plan PHOI) — đúng phạm vi tab Phôi của Tổng hợp; Hàn/Sơn = mảnh (đạt + chờ + chưa gửi, dùng
   `openQty` mới thay cho `groupBy` riêng). Trả thêm `passed/awaiting/open/failed`, **`breakdown`** theo công đoạn (`CAT`, `UON`…, `PIECE`) và
   **`missing`** `{ lines, materialsNotReceived }` (loại sắt còn thiếu mà Phôi chưa nhận đợt sắt nào) — dữ liệu cho thẻ PI ở giai đoạn A. PI bị
   batch bỏ khỏi kết quả (lỗi tính) → ném lỗi → `progress = null` (không coi là "đủ số").
   **Hệ quả đã chốt:** nhắc `FLOOR_STAGE_COMPLETE` của tổ Phôi chỉ phát khi xong cả công đoạn phụ (đến muộn hơn trước).
2. **`percentOf` đổi sang đúng quy tắc `pctOf` của FE** (làm tròn xuống, có làm thì ≥ 1%, chưa đủ không hiện 100). Trước BE làm tròn thường
   (840/2.820 = 30%) còn Tổng hợp làm tròn xuống (29%) → lệch 1% dù cùng số.
3. `bucketLine` gia cố: tổng 3 ngăn luôn = min(Đã báo − Lỗi, Cần) kể cả dữ liệu lệch (lỗi lớn hơn phần đã chấm).
4. **Realtime KCS:** route `QC_REVIEW` phát thêm vào phòng `FLOOR_REPORT` (`src/realtime/realtime.contract.ts`) + **cấp `QC_REVIEW:VIEW` cho QLSX**
   (`role-permissions.constant.ts`). Công nhân (có `FLOOR_REPORT:VIEW`) cũng nhận tín hiệu (chỉ tên topic, không dữ liệu).
5. Test: `floor-progress.util.spec.ts` (mới, 6), `floor-admin.service.spec.ts` (progress: chặn trần, công đoạn phụ + lỗi + breakdown + chưa nhận sắt,
   PI lỗi → null, mảnh Phôi + vật tư TP vào `PIECE`, Hàn có `openQty`, % không làm tròn lên 100), `steel-issues.service.spec.ts` (+2: tách
   `openQty`/`awaitingQcQty` của Cắt theo PI + SKU; công đoạn phụ chưa vào đợt / AWAITING_QC / QC_PASSED), `production-batches.service.spec.ts`
   (+2: `openQty` 1 lệnh và gộp nhiều lệnh, không lẫn sang chờ/đạt).

### 47.2. Đã làm — FE (`D:\DNA-ERP`)
1. **`src/modules/pages/Floor/progressModel.ts` (+ test 6 ca)** — bản sao đúng công thức BE (chú thích 2 bên trỏ nhau: sửa 1 bên thì sửa cả 2).
2. **"Tổng hợp lệnh SX" (`ThongKePagePlan.tsx`):**
   - Bảng **Phôi tách đủ cột**: Cần · Chưa gửi · Chờ KCS · Đạt · Lỗi · Còn thiếu (bỏ cột "Đã xong (đạt)" vốn gồm cả số chưa gửi KCS); bảng con
     từng công đoạn × cỡ đoạn cùng cột; số 0 hiện "—" mờ để mắt chỉ dừng ở ô có số. Thêm "Phôi chưa nhận sắt" ở cột kho xuất. Cột "Công đoạn"
     gộp xuống dưới tên loại sắt.
   - **Sửa nhãn sai mục 44-3:** bảng Hàn/Sơn/mảnh Phôi "Đã báo" = đạt + chờ KCS + chưa gửi (trước là `passedQty`) + dòng "chờ KCS n · chưa gửi n"
     (`ProcLine.kcs` mới trong `core.tsx`); cảnh báo "cần hàn thêm"/"chưa cân đối" giờ tính trên số đã báo. Vật tư thành phẩm: "Đã báo (cái)" =
     đạt + chờ KCS.
3. **Thẻ PI ở "Sản lượng xưởng" (`QlsxQueue.tsx`):** thanh tiến độ dùng `percent` của BE (`ProgressBar` thêm prop `percent` tuỳ chọn — trước tự
   làm tròn thường nên lệch 1% với Tổng hợp); nhãn "Đã báo (trừ lỗi) x/y" + tooltip nói rõ cách tính, Phôi gồm Cắt + công đoạn phụ + mảnh. Kiểu
   `BeFloorProgress` đủ trường mới (`floor-api.ts`). Kiểu `openQty`/`awaitingQcQty` thêm vào `steel-issues-api.ts`, `production-batches-api.ts`.

### 47.3. Kiểm tra
- BE: jest `floor` + `steel-issues` + `production-batches` + `realtime` + `common`: **29 suite, 538 qua / 1 bỏ qua có sẵn**; `nest build` thoát 0;
  eslint các file đụng 0 lỗi (đã `--fix` định dạng prettier ở 4 spec).
- FE: `tsc` sạch, eslint 0 lỗi (3 cảnh báo có sẵn), vitest **201/201** (21 file).
- DB local: chạy `npm run seed` (bước đồng bộ quyền qua; bước tạo admin cuối lỗi P2002 username — lỗi cục bộ đã biết từ mục 22.2) → `PRODUCTION_MANAGER`
  có `QC_REVIEW:VIEW` (kiểm bằng SQL).
- **Live (dữ liệu dev, PI-2026-040):** BE riêng cổng 3002 (bản `dist` mới, `FLOOR_ALERTS=off`, đã tắt sau khi thử) — `GET /floor/queue` tổ Phôi
  **17% (849/4.800)**, breakdown Cắt 29 · Uốn 1 · Dập/Tán/Tóp đầu/Xẻ 0, thiếu 39 dòng, 4 loại sắt chưa nhận; Hàn **4% (13/300)**; QLSX gọi
  `/qc-reviews` → 200. FE "Tổng hợp lệnh SX" cùng PI: tab **Phôi 17%, Hàn 4%** → **khớp, hết chênh 30% vs 17% của mục 44-2**. Tab Hàn: Khung tựa
  "12 · chờ KCS 12" (trước 0 + "cần hàn thêm"). Bảng Phôi: Sắt vuông 12×12 Chưa gửi 3 · Chờ KCS 127 · Đạt 0; Sắt phi 4 Đạt 2 · Lỗi 1 · Còn thiếu 1.
  Bố cục: ở 1366px cột "Loại sắt" 167px; ở khung 820px lần đầu cột này **chỉ còn 6px** (cột cố định chiếm hết — lỗi có từ trước, cột mới làm nặng
  hơn) → thu hẹp cột số còn 74px, gộp cột "Công đoạn" → còn 136px, không cuộn ngang trang. Console không lỗi.

### 47.4. Chưa làm / còn treo
- **BE đang chạy ở cổng 3001 (phiên khác, `node dist/main`) chưa khởi động lại** sau lần sửa `percentOf` → thẻ PI ở "Sản lượng xưởng" trên bản
  local đó vẫn trả 18% cho tới khi BE được khởi động lại. Không tự tắt server của phiên khác.
- **Production:** khi deploy phải chạy lại `npm run seed` (từ máy dev với URL DB ngoài, như mục 38) để QLSX có `QC_REVIEW:VIEW`; chưa deploy.
- Bài Playwright "số khớp 3 màn" (45.3 nghiệm thu) chưa viết — đã đối chiếu tay 2 màn (Tổng hợp ↔ API thẻ PI); màn tài khoản tổ Phôi không hiện %
  nên chỉ đối chiếu được số từng cỡ đoạn (chưa làm).
- Mức PI nhiều SKU: Tổng hợp gộp mảnh theo PI, BE chặn trần theo từng (SKU × mảnh) → có thể lệch nếu 1 SKU báo vượt mà SKU khác thiếu (hiếm).
- ~~Giai đoạn A (thẻ PI + ngăn "còn thiếu gì" + hỏi lại khi chuyển PI sớm)~~ — ĐÃ LÀM ở mục 48. C (Hướng dẫn cắt chỉ xem) chưa làm.
  42a/42b vẫn chưa sửa.
- Chưa commit (BE + FE).

## 48. ĐÃ LÀM giai đoạn A (mục 45.4): thẻ PI của tổ + ngăn "còn thiếu gì" + hỏi lại khi "Chuyển PI tiếp" lúc còn thiếu (2026-10-19) — BE + FE, chưa commit
Người dùng: "Giai đoạn B ổn, làm tiếp giai đoạn A". Làm theo thiết kế 45.4; C (Hướng dẫn cắt chỉ xem) chưa làm.

### 48.1. Đã làm — BE
1. **`GET /floor/queue/:stage/detail/:productionInvoiceId`** (QLSX, `FLOOR_REPORT:VIEW` + `@RequireRole(PRODUCTION_MANAGER)`): trả `progress` +
   **đúng dữ liệu gốc** BE dùng để tính (`phoi` = phoi-progress gộp công đoạn phụ, `plans` = batch-plan theo SKU, `orders`) → ngăn chi tiết dựng bảng
   bằng bảng sẵn có mà số không lệch thẻ. Mở được cho PI đang chạy, đang chờ, đã xong; PI không có → 404.
2. `FloorAdminService`: tách `loadStageData` (tải 1 lần) + hàm thuần `progressFrom` (tính); `computeProgress` và `stageDetail` dùng chung.
   `missing` thêm `materials` (số loại sắt còn thiếu) và `pieces` (số mảnh còn thiếu) cho dòng cảnh báo trên thẻ.
3. Test: ma trận quyền `floor.controller.spec.ts` thêm route mới (30 route); `floor-admin.service.spec.ts` +3 (`stageDetail`: 404, trả đúng dữ liệu gốc +
   số thiếu, Hàn không gọi phoi-progress).

### 48.2. Đã làm — FE
1. **Thẻ "PI đang chạy"** (`QlsxQueue.tsx`): thanh **xếp chồng 3 ngăn** Đạt KCS / Chờ KCS / Chưa gửi KCS + chú giải bằng chữ (không chỉ màu) + Lỗi +
   "Còn thiếu x/y" (`StackedProgress` mới trong `qlsxUi.tsx`); dòng % theo công đoạn ("Cắt 29% · Uốn 1% · …", chỉ khi có > 1 công đoạn); dòng cảnh báo
   "Còn thiếu N loại sắt (M chưa nhận sắt) · K mảnh · X đợt chờ gửi KCS" (chỉ ghi phần có); nút **"Xem còn thiếu gì"** (đủ số thì "Xem chi tiết").
   Hàng đợi và "PI đã xong" có nút **"Xem"** (xem trước PI kế tiếp đã nhận sắt chưa; xem PI cũ để báo bù).
2. **Ngăn chi tiết** (`QlsxPiDetail.tsx` mới): bên phải ~760px, **< 900px toàn màn hình**; `role="dialog"`, focus vào nút Đóng, Tab không thoát ra ngoài,
   **Esc đóng và trả focus** về nút đã mở; tự tải lại theo realtime (giữ dữ liệu cũ khi tải, không nháy). Đầu ngăn: tên SKU, **chọn SKU** khi PI nhiều
   SKU ("Cả PI" mặc định), thanh 3 ngăn + % công đoạn. 3 tab:
   - **Còn thiếu** (mặc định): mỗi loại sắt thiếu 1 thẻ — "Chưa nhận sắt" lên đầu rồi theo số thiếu, tiến độ từng công đoạn, các dòng cỡ đoạn × công
     đoạn còn thiếu ("470 mm · Cắt 0/120 · thiếu 120", có "(KCS lỗi n)" khi thiếu do lỗi), quá 6 dòng thì "… và N dòng khác"; mảnh còn thiếu
     (đã báo/cần, chờ KCS, chưa gửi). Đủ hết thì báo xanh "Không còn thiếu gì".
   - **Tất cả**: dùng lại đúng bảng của "Tổng hợp lệnh SX" — bảng Phôi đã **tách ra `components/sanxuat/PhoiMaterialBoard.tsx`** (cùng `mapPhoiProgress`,
     Tổng hợp import lại từ đó) + `VatTuDetailBoard` chỉ xem cho mảnh/Hàn/Sơn.
   - **Bất thường**: báo vượt sắt đã nhận, đợt chờ gửi KCS quá 4 giờ **của đúng PI này**, KCS chấm lỗi, Hàn/Sơn lệch bộ — mỗi dòng có nút "Đến danh sách chờ
     gửi KCS" (đóng ngăn, cuộn + focus tới khối Chờ gửi KCS) hoặc "Xem bảng đầy đủ".
   Logic thuần ở `piDetailModel.ts` (+ 6 test): mảnh chặn trần theo từng (SKU × mảnh) rồi mới gộp — cùng cách BE.
3. **Hỏi lại khi "Chuyển PI tiếp" lúc tổ CHƯA đủ số** (hoặc không tính được tiến độ): hộp riêng nêu % hiện tại, dòng tóm tắt thiếu, **3 mục thiếu đầu tiên +
   "… và N mục khác"**, số đợt chờ gửi KCS của PI, PI nào chạy tiếp, nhắc "công nhân vẫn báo bù được". Nút **focus sẵn là "Xem còn thiếu gì"** (an toàn, mở
   ngăn, không chuyển); "Vẫn chuyển PI tiếp" màu nguy hiểm; Esc/bấm nền = đóng. Đủ số thì vẫn là hộp xác nhận ngắn như cũ (không thêm bước).
4. Không đụng: luồng "Mở lại PI vừa chuyển", hàng đợi, gửi KCS.

### 48.3. Kiểm tra
- BE: jest `floor` + `steel-issues` + `production-batches` + `realtime`: **17 suite, 457 qua / 1 bỏ qua có sẵn**; eslint `src/modules/floor` 0 lỗi;
  `nest build` thoát 0. FE: `tsc` sạch, eslint `Floor/` + file mới 0 lỗi, vitest **207/207** (22 file).
- **Live** (dữ liệu dev, BE riêng 3002 + FE riêng 3100 `NEXT_DIST_DIR=.next-e2e`, thêm 2 cấu hình `be-3002-qlsx`, `fe-3100-qlsx` vào
  `.claude/launch.json` của BE; đã tắt cả 2 và xoá `.next-e2e` sau khi thử). Tài khoản `qlsx`, tổ Phôi, PI-2026-040:
  - Thẻ: 17% · Đạt 2 · Chờ KCS 127 · Chưa gửi 720 · Lỗi 1 · Còn thiếu 3.951/4.800 · "Cắt 29% · Uốn 1% · Dập 0% · Tán 0% · Tóp đầu 0% · Xẻ 0%" ·
    "Còn thiếu 7 loại sắt (4 chưa nhận sắt) · 4 đợt chờ gửi KCS" (cùng % với "Tổng hợp lệnh SX").
  - Ngăn: mở → focus "Đóng"; Còn thiếu (7): Sắt hộp 10×20, Sắt tròn Ø21, Sắt vuông 10×10, 20×20 "Chưa nhận sắt" lên đầu … Sắt phi 4 "thiếu 1 (KCS lỗi 1)";
    Bất thường (4): 2 dòng báo vượt sắt (5,01 m / 12,2 m), "4 đợt chờ gửi KCS quá 4 giờ", "KCS chấm lỗi 1 đoạn"; Tất cả: bảng Phôi 8 cột, cột "Loại sắt"
    171px, không cuộn ngang; Esc đóng, focus về "Xem còn thiếu gì". Khung 700px: ngăn toàn màn hình, không tràn.
  - "Chuyển PI tiếp": hiện hộp hỏi lại đúng nội dung (3 loại sắt đầu + "… và 4 mục khác", 4 đợt chờ, PI-2026-039 chạy tiếp), focus sẵn "Xem còn thiếu gì";
    bấm nút đó → mở ngăn, **PI-040 vẫn đang chạy** (không chuyển thật, dữ liệu dev không đổi).
  - Console: chỉ 1 lỗi của script công cụ trình duyệt (`<anonymous>`), không có lỗi app; log BE không lỗi.

### 48.4. Chưa làm / còn treo
- Giao diện tối chưa thử được (giả lập `prefers-color-scheme` không đổi theme của app — app tự chọn theme); màu dùng token nên dự kiến theo theme.
- Chưa có bài Playwright tự động cho ngăn/hộp hỏi lại; chưa chạy axe cho ngăn (đã có role/aria-modal/nhãn, focus, Esc).
- "Mở đầy đủ trong Tổng hợp lệnh SX ›" (45.4) chưa làm — cần cơ chế điều hướng sang đúng PI ở tab Tổng hợp.
- Ngăn lấy danh sách đợt chờ từ dữ liệu "Chờ gửi KCS" của tổ đang xem → đếm đợt chờ quá lâu đúng cho mọi PI của tổ đó.
- BE 3001 của phiên khác vẫn chạy bản cũ (không có route mới) — cần khởi động lại để FE 3000 dùng được ngăn chi tiết.
- Production: deploy BE + FE cùng lúc (FE gọi route mới); vẫn cần seed lại vì `QC_REVIEW:VIEW` (mục 47).
- Giai đoạn C (Hướng dẫn cắt chỉ xem) chưa làm; 42a/42b chưa sửa. Chưa commit (BE + FE).

## 49. Đổi chữ "Đảo" → "Hủy" (lần báo) cho dễ hiểu (2026-10-20) — BE + FE, chưa commit
Người dùng hỏi nút "Đảo" là gì, rồi hỏi nên dùng chữ nào cho chuẩn ERP vì công nhân "chưa học hết cấp 2", chọn phương án (a): chỉ đổi chữ.
**Vì sao "Hủy":** "đảo" là thuật ngữ kế toán (bút toán đảo — SAP *Reverse*, MISA *Bỏ ghi*), người xưởng không hiểu. "Hủy" ai cũng hiểu và đúng nghĩa
(lần báo vẫn được lưu kèm lý do, chỉ không còn được tính); không dùng "Xóa" vì sai sự thật. Viết "Hủy" (dấu kiểu cũ) cho thống nhất với cả app. Chỉ đổi
**chữ hiển thị**; tên hàm/route/cột BE giữ nguyên (`reverse`, `reversalOfId`…).

**Đã làm:**
- FE `QlsxReview.tsx` (màn QLSX): nút "Đảo" → **"Hủy"** (thêm tooltip "Hủy lần báo sai này (phải ghi lý do, công nhân sẽ thấy)" + nhãn đọc màn hình nêu rõ
  lần báo/người báo); hộp xác nhận "Đảo lần báo" → **"Hủy lần báo này?"**, ô **"Lý do hủy …"**, nút **"Hủy lần báo"**; dòng đã hủy "Đã đảo: …" → **"Đã hủy: …"**;
  thông báo xanh "Đã hủy lần báo …"; hộp Gửi KCS "không đảo được" → "không hủy được".
- FE `ReasonModal.tsx` (dùng chung): thêm prop tùy chọn **`cancelLabel`** (mặc định "Hủy" như cũ) — ở hộp này đặt **"Không hủy"** để không có 2 nút cùng chữ
  "Hủy" cạnh nhau. Các màn khác không đổi.
- FE `FloorScanApp.tsx` (điện thoại công nhân, "Sản lượng của tôi"): "Đã bị đảo bởi X: lý do" → **"X đã hủy lần này. Lý do: …"** (không có tên thì "Quản lý
  đã hủy lần này"); câu giải thích "Lần bị QLSX đảo có ghi lý do" → "Lần nào quản lý hủy sẽ có ghi lý do".
- BE (câu QLSX thấy khi bị chặn): "không đảo lại được / đã bị đảo rồi / vừa được người khác đảo / đã gửi KCS - không đảo được nữa" → bản "hủy" tương ứng
  (`floor-review.service.ts`); thông báo nhắc đợt chờ quá 4 giờ "(hoặc đảo nếu báo sai)" → "(hoặc hủy lần báo sai)" (`notification-types.ts`); mô tả
  Swagger của `reason`.

**Kiểm tra:** BE jest `floor` + `notifications` 14 suite / 256 qua (sửa 1 test khớp chữ "người khác hủy"); FE `tsc` sạch, eslint 0 lỗi, vitest 207/207.
Trên trình duyệt (FE 3000 + BE 3001 local, `qlsx`): nút "Hủy" ở dòng báo của Lê Cường, hộp "Hủy lần báo này?" với 2 nút "Không hủy" / "Hủy lần báo";
bấm "Không hủy" → đóng, lần báo còn nguyên (không hủy thật). Màn điện thoại công nhân chưa xem tận mắt (tài khoản công nhân bị giới hạn mạng khi vào từ
máy dev) — chỉ đổi chữ, có tsc/vitest.

**Chưa làm (người dùng chưa chọn, xem lại ở mục 50):** (b) làm gọn màn QLSX (nút "Gửi KCS" ở từng thẻ, chữ viết tắt "đã 8/60 · vượt 18", "1 lần báo", mã máy); (c) viết lại
chữ màn điện thoại công nhân cho người ít chữ ("Chưa gửi KCS" → "Chờ quản lý kiểm", "Chờ KCS" → "Đang chờ kiểm hàng", "Đã KCS" → "Đã kiểm xong"…).

## 50. Rà UI/UX 6 màn của QLSX theo chuẩn ERP (2026-10-20) — rà xong; vấn đề #1–#5 (đợt 1) ĐÃ SỬA ở mục 51, #6–#13 chưa làm
Người dùng gửi ảnh menu QLSX: "kiểm tra các màn của QLSX từ sản lượng xưởng, tổng hợp lệnh SX, xử lý lệnh… xem đã chuẩn chỉnh ERP từ UI, UX, có dễ
nhìn, dễ dùng hay chưa". Cách rà: đăng nhập `qlsx` trên FE 3000 + BE 3001 local (dữ liệu dev), đi qua từng màn ở **1024px** (cỡ màn người dùng đang
dùng, ảnh gửi ~1020px) và **1366px**, đo độ rộng cột/tràn bảng bằng `getBoundingClientRect`, đọc console. Không bấm thao tác ghi nào.

### 50.1. Điểm tự chấm (ước lượng)
| Màn | Điểm | Ý chính |
|---|---|---|
| Tổng hợp lệnh SX | ~6,5 | Đủ thông tin, có tìm kiếm + lọc; ở 1024px bảng tràn, nút thao tác lẫn với nhãn trạng thái, cuộn lồng ở chi tiết SKU |
| Xử lý lệnh sản xuất | ~6,5 | Nút chính rõ ("Chọn kho sản xuất", "Từ chối"); KHÔNG báo quá hạn |
| Sản lượng xưởng | ~7,5 | Mới làm (mục 47–49), số khớp; ở 1024px khối việc chính bị đẩy xuống |
| Danh sách SKU | ~7,5 | Gọn, có lọc + tìm; cột "#" vô nghĩa |
| Tổng hợp vật tư | ~5,5 | Cột tên bị bóp 80px, cột cuối bị cắt (ô tìm CÓ - lúc rà bị thông báo nổi che, đính chính ở mục 51) |
| Tổng hợp kho | ~6 | Thẻ kho rõ; cột "Nhóm vật tư" trống do lỗi quyền |
Tổng thể ~6,5/10 — luồng và số liệu đã đúng, phần "đọc nhanh ở màn laptop" và "báo việc cần làm" còn yếu.

### 50.2. Vấn đề — Cao (lỗi thật hoặc dễ gây sai)
1. **[ĐÃ SỬA mục 51]** **QLSX thiếu quyền `MATERIAL_GROUP:VIEW`** → `MfgWarehousesPage` gọi `getMaterialGroups` bị **403** (console "Missing required permission(s):
   MATERIAL_GROUP:VIEW"); hệ quả thấy được: chi tiết kho cột **"Nhóm vật tư" trống "—" ở mọi dòng**. Sửa: cấp VIEW cho QLSX (+ seed lại production).
2. **[ĐÃ SỬA mục 51]** **Thông báo nổi ("Cần xử lý", "Kết quả") bật lại ở MỌI lần chuyển màn** và che góc phải: ô tìm kiếm (Tổng hợp lệnh SX), lọc "Đã duyệt" (Danh sách SKU),
   cột "Hạn giao" dòng đầu (Xử lý lệnh), tab "Công nhân" (Sản lượng xưởng). Thông báo cũ còn chữ "(hoặc đảo nếu báo sai)" — lưu trong DB trước mục 49
   (thông báo mới đã là "hủy").
3. **[ĐÃ SỬA mục 51]** **"Xử lý lệnh sản xuất" không báo quá hạn:** PI-2026-026 hạn 07/10/26, PI-2026-019 hạn 15/10/2026 đều đã qua (hôm nay 20/10) nhưng không đỏ; các
   mốc "ước tính" Mua hàng/Khung CK/Đan/Đóng gói đều đã qua mà không đánh dấu. Ở "Tổng hợp lệnh SX" thì có đỏ "Có SKU quá hạn".
4. **[ĐÃ SỬA mục 51]** **Bảng ở 1024px (cỡ màn đang dùng):** Tổng hợp lệnh SX bảng 811px trong khung 751px → cuộn ngang, cột "Xưởng" bị cắt ("1 đang c…"); cột "Mã PI"
   64px nên "PI-2026-040" xuống 3 dòng, "Mã PO" bẻ dòng, trong khi "Số SKU" chiếm 70px. Tổng hợp vật tư: **"Tên vật tư" chỉ 80px** ("Sơn E…", "Sắt E2…")
   — cột quan trọng nhất lại hẹp nhất, "Khả dụng" bị cắt (780/751). Ở 1366px vừa.
5. **[ĐÃ SỬA mục 51]** **Tạm dừng / Kết thúc** (chi tiết PI) cùng kiểu "nhãn" với trạng thái "Đang chạy" trong cùng một ô → khó biết đâu là trạng thái, đâu là nút; "Kết thúc"
   đỏ nằm ngay trong danh sách, xác nhận bằng hộp mặc định của trình duyệt (`window.confirm`, `ThongKePagePlan.tsx`) — khác hộp xác nhận chung của app.

### 50.3. Vấn đề — Trung bình
6. Chi tiết SKU: bảng Phôi **cuộn bên trong khung cao 536px** (nội dung 3.394px) trong khi cả trang cũng cuộn → cuộn lồng cuộn.
7. Chi tiết SKU: tiêu đề lớn là **mã PO** ("QR-NEN-72871"), PI chữ nhỏ xám, tên SKU dòng phụ — QLSX tìm theo PI/SKU nên thứ bậc nên ngược lại.
8. "Khung cơ khí 7%" là trung bình Phôi 17% / Hàn 4% / Sơn 0% nhưng không giải thích; dấu ⚠ cạnh "Khung cơ khí" (lệch bộ) không có chú thích.
9. Sản lượng xưởng ở 1024px: 2 cột xếp chồng → khối **"Chờ gửi KCS"** (việc hằng ngày) bị đẩy xuống dưới thẻ PI + hàng đợi; mỗi thẻ có nút xanh "Gửi KCS" → rối.
10. Danh sách SKU: cột "#" là id trong DB (26, 25, 17…) — không có ý nghĩa với người dùng; tên sản phẩm bị cắt "…".
11. Ngày không thống nhất: "07/10/26" (Xử lý lệnh), "31/10/2026" (Tổng hợp), "08:10 13-10" (Sản lượng xưởng, dấu gạch).
12. "—" và "0" lẫn lộn: cùng vật tư, "Tổng hợp vật tư" ghi "—", chi tiết kho ghi "0".
13. Nút tròn "Hướng dẫn sử dụng" (góc phải dưới) đè lên nút "Gửi KCS tất cả"/dòng cuối bảng ở 1024px.

### 50.4. Thấp / dữ liệu (không phải lỗi giao diện)
14. Dữ liệu thử (SKU/vật tư "E2E…", công nhân "kt.ui1…") lẫn trong danh sách — chỉ ở DB dev, dọn trước khi dùng thật.
15. Tem QR đang trỏ `http://192.168.1.28:3000` — cấu hình tạm bước 0 (mục 33), IP máy dev đã đổi.
16. Báo cáo: "Chưa rõ người" 7.681/7.683 đoạn — dữ liệu trước khi có QR, tự đúng khi dùng QR thật.

### 50.5. Điểm tốt nên giữ
Thanh bên + chấm số việc chờ thống nhất; lọc dạng chip có số đếm; ô tìm kiếm ở danh sách chính; thanh tiến trình công đoạn; hộp xác nhận có lý do; số
tiến độ đã khớp giữa các màn (mục 47–48); màn chưa thấy tràn ngang cả trang ở 1024px.

### 50.6. Đề xuất thứ tự sửa (chưa làm, chờ người dùng chọn)
- **Đợt 1 (~1 ngày):** #1 quyền nhóm vật tư; #2 thông báo nổi chỉ hiện 1 lần (không bật lại khi đổi màn); #3 đỏ quá hạn ở Xử lý lệnh; #4 độ rộng cột ở
  1024px (mã không bẻ dòng, "Tên vật tư" rộng nhất); #5 Tạm dừng/Kết thúc thành nút rõ + hộp xác nhận chung.
- **Đợt 2 (~1 ngày):** #6 bỏ cuộn lồng; #7 tiêu đề SKU theo PI/SKU; #8 chú thích %/⚠; #9 Chờ gửi KCS lên trước ở màn hẹp + (b) của mục 49; #10–13.
- (c) của mục 49 (chữ màn công nhân) làm riêng.

**Kiểm tra:** chỉ rà trên trình duyệt + console; không chạy test, không sửa code, không đổi dữ liệu.

## 51. ĐÃ SỬA đợt 1 của mục 50: quyền nhóm vật tư, thông báo nổi, quá hạn ở Xử lý lệnh, độ rộng cột 1024px, nút Tạm dừng/Kết thúc (2026-10-20) — BE + FE, chưa commit
Người dùng: "Làm đợt 1: quyền nhóm vật tư, thông báo nổi không bật lại, đỏ quá hạn ở Xử lý lệnh, độ rộng cột ở 1024px, nút Tạm dừng/Kết thúc rõ ràng."

### 51.1. Đã làm
1. **Quyền (BE `role-permissions.constant.ts`):** QLSX thêm `MATERIAL_GROUP:VIEW` (chỉ xem). Đã `npm run seed` ở DB local (bước đồng bộ quyền qua; bước admin
   cuối lỗi P2002 username — lỗi cục bộ đã biết). **Production phải seed lại** khi deploy (cùng đợt với `QC_REVIEW:VIEW` của mục 47).
2. **Thông báo nổi (FE `hooks/useNotifications.ts`):** nguyên nhân — mỗi lần trang tải lại (F5, đổi module, đăng nhập lại), "số chưa đọc lần trước" về 0 nên
   lần kiểm đầu thấy "tăng" và bật lại thông báo chưa đọc mới nhất (vd "đợt chờ quá 4 giờ" của 6 ngày trước). Sửa: **lần kiểm đầu sau khi mở app / đổi người
   đăng nhập chỉ lấy mốc, không bật**; thông báo thật sự mới (realtime hoặc vòng kiểm sau) vẫn bật như cũ. Thông báo cũ vẫn ở chuông + "Cần xử lý".
3. **Quá hạn ở "Xử lý lệnh sản xuất" (FE `LenhSXPage.tsx`, dùng chung cho màn "Duyệt lệnh sản xuất" của Sếp):** danh sách PI — ngày đỏ + nhãn **"Quá hạn N
   ngày"**, tiêu đề "N PI chờ xử lý · ⚠ M quá hạn"; chi tiết PI — hạn đỏ + nhãn; bảng SKU — mốc đã qua đỏ kèm "đã qua" / "ước tính · đã qua", cột hạn giao
   "quá hạn N ngày". Ngày ở danh sách đổi `dd/MM/yy` → `dd/MM/yyyy` cho khớp màn khác. Hàm `utils/overdue.ts` `overdueDays` (+ 3 test): tính theo ngày lịch,
   hạn hôm nay chưa tính là quá.
4. **Độ rộng cột ở 1024px:**
   - "Tổng hợp lệnh SX" danh sách PI (`ThongKePagePlan.tsx`): 7 cột → 5 — "Số SKU" gộp dưới Mã PI, "Mã PO" gộp dưới Khách hàng (mỗi mã 1 dòng, dài thì
     cắt "…" có chú thích); mã PI không bẻ dòng; tiêu đề "Hạn giao" (chú thích "sớm nhất"). Bảng SKU trong chi tiết PI: "Mã PO" + "Khách hàng" gộp dưới tên
     SKU, cột "Xưởng" rộng 214px.
   - "Tổng hợp vật tư" (`VatTuDashboardPage.tsx`): thu hẹp cột phụ (Mã 92, Quy cách 120, Nhóm 110, Kho 128, Tồn 76, Khả dụng 80; `minWidth` 780 → 720) →
     "Tên vật tư" 80 → 145px ở khung 751px; tên vật tư + kho có chú thích khi bị cắt. **Đính chính mục 50:** màn này CÓ ô tìm kiếm — lúc rà bị thông báo nổi che.
5. **Tạm dừng / Kết thúc (FE `ThongKePagePlan.tsx`):** nhãn trạng thái (viên tròn có chấm màu) tách dòng khỏi nút; nút là khung chữ nhật có viền + biểu tượng
   (▶ Bắt đầu / ▶ Tiếp tục: nền xanh — việc chính; ⏸ Tạm dừng: viền cam; ■ Kết thúc: viền đỏ, không tô nền). Hộp xác nhận đổi từ `window.confirm` sang **hộp
   chung của app** (`useConfirm`) có tiêu đề, tên SKU + PO, câu dễ hiểu ("Kết thúc lệnh? KHÔNG hoàn tác được…"), nút "Không"; lỗi BE hiện ngay trong hộp (thay
   `alert`). "Nạp lại định mức" đổi `window.prompt` sang `ReasonModal` (bắt nhập lý do). `ReasonModal` thêm prop `cancelLabel` từ mục 49.

### 51.2. Kiểm tra
- FE: `tsc` sạch, eslint 0 lỗi (chỉ cảnh báo có sẵn), vitest **193/193** (21 file, có `overdue.test.ts` mới). BE: jest `common` + `realtime` 16 suite / 112 qua.
- **Trên trình duyệt** (FE 3000 + BE 3001 local, `qlsx`, khung **1024×768**), không bấm thao tác ghi nào:
  - Đăng nhập lại và tải lại trang: **không còn thông báo nổi** bật lên; ô tìm kiếm của Tổng hợp lệnh SX thấy rõ.
  - Tổng hợp lệnh SX: bảng **751/751px** (hết cuộn ngang), cột: Mã PI 120 · Khách hàng · Mã PO 190 · Công đoạn 190 · Hạn giao 130 · Xưởng 121; PI-2026-037/036
    vẫn đỏ "Có SKU quá hạn".
  - Chi tiết PI-2026-040: bảng SKU 756/756px, ô Xưởng "● Đang chạy" + [⏸ Tạm dừng] [■ Kết thúc] **cùng một hàng**; bấm "Tạm dừng" → hộp "Tạm dừng lệnh?" với
    "Ghế J55 (500×875×445) (GHE-J55) · PO QR-NEN-72871" + giải thích → bấm **"Không"** → đóng, lệnh vẫn "Đang chạy".
  - Xử lý lệnh sản xuất: "3 PI chờ xử lý · ⚠ 2 quá hạn", PI-2026-026 "07/10/2026 · Quá hạn 13 ngày", PI-2026-019 "Quá hạn 5 ngày"; chi tiết PI-019: các mốc
    "ước tính · đã qua" đỏ, hạn giao "quá hạn 5 ngày".
  - Tổng hợp kho → Kho Phôi Sơn Hàn: cột "Nhóm vật tư" **có giá trị** (Sắt / Vật tư khác) thay cho "—".
  - Tổng hợp vật tư: bảng 751/751px, "Tên vật tư" 145px ("Sơn E2E 43351487" đủ chữ), "Khả dụng" không bị cắt.

### 51.3. Ghi chú / còn treo
- **Số test FE giảm 207 → 193 không do mục này:** thư mục giao diện HR chưa commit (`src/modules/pages/Hr/`, `src/services/hr-api.ts`, `src/app/nghi-phep/`) và
  `src/modules/hr` + migration HR của BE **không còn trong cây làm việc** (`app.module.ts`, schema, quyền HR cũng đã về như cũ). **Người dùng xác nhận
  (2026-10-20): đã tự xoá phần HR, sẽ làm lại sau** — các changelog HR (10-17, 10-19) mô tả code không còn tồn tại.
- Đợt 2 của mục 50 (#6–#13) và (b)/(c) của mục 49 chưa làm. Production: seed lại (2 quyền mới) khi deploy. Chưa commit (BE + FE).

## 52. Chấm lại UI/UX 6 màn QLSX sau đợt 1 (2026-10-20) — chỉ đánh giá, không sửa code
Xem lại ở 1024px sau mục 51 (cùng cách rà mục 50). Điểm (ước lượng): Tổng hợp lệnh SX 6,5 → **7,5**; Xử lý lệnh SX 6,5 → **8**; Sản lượng xưởng **7,5**
(không đổi — đợt 1 không đụng); Danh sách SKU **7,5**; Tổng hợp vật tư 5,5 → **7**; Tổng hợp kho 6 → **7**. **Tổng thể ~6,5 → ~7,5/10.**
- Đã hết: tràn bảng/cuộn ngang ở 1024px, thông báo nổi che góc phải, không báo quá hạn ở Xử lý lệnh, nút lẫn nhãn trạng thái, hộp xác nhận mặc định của trình
  duyệt, cột Nhóm vật tư trống. Số liệu đã khớp giữa các màn (mục 47–48).
- Còn kéo điểm (đợt 2, mục 50 #6–#13): cuộn lồng ở chi tiết SKU; tiêu đề chi tiết SKU lấy mã PO thay vì PI/SKU; "Khung cơ khí 7%" và dấu ⚠ không giải thích; ở
  1024px "Chờ gửi KCS" của Sản lượng xưởng nằm dưới thẻ PI + hàng đợi (đầu khối ở y≈686/768 — vẫn thấy tiêu đề nhưng phải cuộn mới làm việc được), mỗi thẻ 1
  nút "Gửi KCS" + viết tắt (mục 49 b); cột "#" ở Danh sách SKU; ngày không thống nhất (dd/MM/yy vs dd/MM/yyyy vs "08:10 13-10"); "—" vs "0"; nút Hướng dẫn
  đè góc phải dưới. Chưa có người dùng thật (QLSX) thử — điểm chỉ là tự chấm. **→ Toàn bộ đợt 2 ĐÃ LÀM ở mục 53.**

## 53. ĐÃ LÀM đợt 2 của mục 50 (#6–#13) + (b) của mục 49 (2026-10-20) — chỉ FE, chưa commit
Người dùng: "Làm đợt 2: bỏ cuộn lồng, tiêu đề SKU theo PI/SKU, chú thích %/⚠, Chờ gửi KCS lên trước ở màn hẹp + gọn thẻ, bỏ cột #, thống nhất ngày, — vs 0,
nút Hướng dẫn."

### 53.1. Đã làm (FE `D:\DNA-ERP`)
1. **Bỏ cuộn lồng (#6):** nguồn là `tableScrollBox` (`styles/table.ts`, `maxHeight: 70vh` + `overflowY: auto`) mà `LenhSanXuatBoard` dùng cho mọi bảng — ở chi
   tiết SKU bảng Phôi (3.394px) bị nhốt trong khung 536px bên trong trang đã cuộn. Thêm prop **`fullHeight`** cho `LenhSanXuatBoard` (bỏ trần + không cuộn
   riêng) và `VatTuDetailBoard` (chuyển tiếp); bật ở `PhoiMaterialBoard` (luôn), 3 bảng tab Phôi/Hàn/Sơn + bảng vật tư thành phẩm của "Tổng hợp lệnh SX", và
   2 bảng trong ngăn chi tiết PI (`QlsxPiDetail`). Màn tổ Phôi/Hàn/Sơn (nhập liệu, bảng dài có tiêu đề dính) giữ nguyên.
2. **Tiêu đề chi tiết SKU (#7):** tên SKU to nhất → dòng mã xưởng (xanh) + mã PI → dòng "PO: …" (trước: mã PO to nhất, PI chữ nhỏ xám).
3. **Chú thích (#8):** "Khung cơ khí 7%" ở thẻ công đoạn thêm chữ "· trung bình 3 tổ" + tooltip "Trung bình 3 tổ: Phôi 17% · Hàn 4% (lệch bộ) · Sơn 0%. Lệch
   bộ = số mảnh đã báo không đều giữa các mảnh của 1 bộ" (`frameStatsTitle`); dấu ⚠ đỏ ở danh sách PI và bảng SKU có tooltip + nhãn đọc màn hình "Lệch bộ".
4. **Sản lượng xưởng (#9 + mục 49 b):** `QlsxFloorPage` — dưới **1180px** (lưới chỉ xếp được 1 cột) khối **"Chờ gửi KCS" lên trước** thẻ PI + hàng đợi
   (`useMaxWidth(1180)`; lúc đầu dùng `useIsCompact` = 900px nên 1024px vẫn chưa đổi — đã sửa); ≥ 1180px vẫn 2 cột như cũ. `QlsxReview` — **cả đầu thẻ bấm
   được** để mở/đóng (có phím Enter/Space, `aria-expanded`), góc phải ghi "Kiểm & gửi"/"Thu gọn", nhãn "vượt" khi có cảnh báo, "⚠ chờ 7 ngày"; **nút "Gửi KCS"
   bỏ khỏi đầu thẻ, chuyển xuống cuối phần mở ra** ("Gửi KCS đợt này" + câu nhắc "Đã kiểm xong thì gửi…" / "Có cảnh báo vượt - kiểm số thật trước khi gửi");
   "Gửi KCS tất cả" vẫn ở đầu danh sách; "đã 8/60" → "đã báo 8/60"; mã máy "UON-01" → **tên máy "Máy uốn 1"** (mã ở tooltip).
5. **Danh sách SKU (#10):** bỏ cột "#" (id DB); ô SKU có tooltip tên đầy đủ khi bị cắt.
6. **Ngày thống nhất (#11):** `LenhSXPage` 6 chỗ `dd/MM/yy` → `dd/MM/yyyy`; `qlsxUi.fmtTime` "08:10 13-10" → **"08:10 13/10/2026"** (thẻ PI, dòng lần báo).
7. **"—" vs "0" (#12):** "Tổng hợp vật tư" (`VatTuDashboardPage`): vật tư chưa có dòng tồn hiện **0** (mờ) như chi tiết kho, thay cho "—" (`fmtQty`).
8. **Nút Hướng dẫn (#13):** nhỏ hơn (44 → 38px), sát mép (20 → 12px), mờ 85%; phân hệ Sản xuất đệm đáy 72px (`MfgApp` desktop) để dòng cuối bảng không nằm dưới nút.

### 53.2. Kiểm tra
- `tsc` sạch, eslint 0 lỗi (chỉ cảnh báo có sẵn), vitest 193/193.
- Trình duyệt 1024×768 (`qlsx`, FE 3000 + BE 3001 local, không thao tác ghi): chi tiết SKU GHE-J55 chỉ còn **1 vùng cuộn** (768/4.089px, trước có thêm
  536/3.394px), tiêu đề "Ghế J55 (500×875×445) / GHE-J55 PI-2026-040 / PO: QR-NEN-72871", "7% · trung bình 3 tổ" có tooltip đúng. Sản lượng xưởng: "Chờ gửi
  KCS" ở y=223 (thẻ PI xuống y=863); mở thẻ → "15:25 13/10/2026 · 3 đoạn 441mm · Lê Cường · Máy uốn 1 · [Hủy]" + "Gửi KCS đợt này"; ở 1366px vẫn 2 cột (thẻ PI
  x=266, chờ gửi KCS x=795). Danh sách SKU: 4 cột, không còn "#". Tổng hợp vật tư: tồn/khả dụng "0/0" thay "—". Xử lý lệnh: mọi ngày dạng dd/MM/yyyy. Nút
  Hướng dẫn 38px cách mép 12px.

### 53.3. Còn treo
- Chưa có người dùng thật (QLSX) thử; ~~(c) của mục 49 (chữ màn điện thoại công nhân) chưa làm~~ — ĐÃ LÀM ở mục 54; chưa commit (BE + FE); production
  cần seed lại (mục 47, 51).

## 54. ĐÃ LÀM (c) của mục 49: viết lại chữ màn điện thoại công nhân cho người ít chữ + sửa 42a/42b (2026-10-20) — chỉ FE, chưa commit
Người dùng: "làm (c) xong đánh giá lại". Nguyên tắc: câu ngắn, mỗi câu một ý; **không viết tắt** (KCS, QLSX, PI, SKU); nói rõ việc phải làm khi gặp lỗi.

### 54.1. Đã làm (FE `D:\DNA-ERP`)
1. **Từ điển đổi chữ** (`FloorScanApp.tsx`): QLSX → **quản lý**; KCS → **kiểm hàng / kiểm xong**; PI → **lệnh** (vẫn hiện mã PI-2026-040); SKU → **sản phẩm**
   (hiện tên sản phẩm, mã trong ngoặc); "bù lỗi" → **làm bù**; mã máy "LASER-01" → **tên máy "Máy laser 1"** (mã ở tooltip); "màn thống kê" → "báo trên máy tính".
   - Trạng thái lần báo: "Chưa gửi KCS" → **Chờ quản lý kiểm**, "Chờ KCS" → **Đang kiểm hàng**, "Đã KCS" → **Đã kiểm xong**.
   - Thẻ số: "Đã KCS duyệt" → **"Đã kiểm xong" + "Đây là số được tính cho bạn."**; "Đang chờ KCS: Cắt: 597 đoạn chưa gửi" → "Chưa kiểm xong: Cắt: 597 đoạn chờ
     quản lý kiểm"; "tỷ lệ đạt" → "đạt"; câu dưới: "Dưới đây là số bạn **đã báo**… Số được tính là số đã kiểm xong ở trên."
   - Hàn/Sơn: "Đã gửi KCS 12/60 · chờ QLSX gửi 3" → **"Đã báo 15/60 · 3 chờ quản lý kiểm"**.
   - Đăng nhập/PIN: "báo QLSX cho đặt lại" → "báo quản lý…", bỏ "(kể cả QLSX)", "Hết hạn đặt PIN…", "Quên PIN: báo quản lý. Nhập sai 5 lần sẽ bị khoá 15 phút."
   - Cảnh báo: "Tổ Phôi chưa có PI đang chạy - báo QLSX bấm “Chuyển PI tiếp”" → "Tổ Phôi chưa có lệnh nào để làm. Báo quản lý xếp lệnh cho tổ."; "SKU này QLSX chưa
     bấm “Bắt đầu”…" → "Sản phẩm này quản lý chưa cho làm (hoặc đang tạm dừng). Chưa báo được."; "Đang báo BÙ LỖI cho … (PI tổ đã chuyển qua)" → "Đang báo LÀM BÙ
     cho lệnh … (lệnh này tổ đã làm qua rồi)."; "Có cỡ vượt kế hoạch… QLSX sẽ thấy cảnh báo vượt khi kiểm" → "Có cỡ báo nhiều hơn số cần. Đếm lại cho chắc. Quản
     lý sẽ thấy cảnh báo này."; nhận sắt "khớp" → "đúng số", "Kho và QLSX sẽ được báo. Đã đếm kỹ chưa?" → "Kho và quản lý sẽ được báo. Bạn đã đếm kỹ chưa?".
2. **Lỗi (`floorUi.ts` `describeError`):** mất mạng → "Mất mạng, chưa gửi được. Số bạn nhập vẫn còn nguyên. Có mạng thì bấm Lưu lại, không bị cộng 2 lần."; 429 →
   "Bấm nhanh quá. Đợi khoảng 1 phút rồi thử lại."; **mới: 5xx → "Hệ thống đang lỗi, chưa lưu được. Số bạn nhập vẫn còn nguyên. Đợi một lát rồi bấm Lưu lại; vẫn
   lỗi thì báo quản lý."** (sửa **42b** — trước hiện "Internal server error"); lỗi lạ → "Có lỗi. Bấm thử lại; vẫn lỗi thì báo quản lý."
3. **42a (`AuthContext.tsx`):** phiên hết hạn khi đang ở `/floor` → chỉ xoá phiên, **không** đẩy sang `/login` của ERP; màn công nhân tự hiện lại ô nhập PIN của
   đúng máy đã quét (mã máy nhớ trong localStorage).
4. Test: `floorUi.test.ts` cập nhật câu + thêm ca 500/502; Playwright `worker-phone.spec.ts` cập nhật câu 429 và **thêm kiểm tra câu 500 không còn tiếng Anh**
   (bài (5) "hết phiên" vẫn đánh dấu `test.fail` — khi chạy lại sẽ báo "dự kiến hỏng mà lại qua" → gỡ dòng đó; chưa chạy Playwright lần này).

### 54.2. Kiểm tra
- `tsc` sạch, eslint 0 lỗi, vitest **194/194**.
- **Trên trình duyệt 375×812** bằng tài khoản công nhân thử `cn.test` (DB dev; tạm thêm `::1` vào danh sách IP công ty để đăng nhập từ máy dev, **đã gỡ ngay sau**;
  phiên QLSX ở tab kia bị đăng xuất theo vì cùng trình duyệt — đã đăng nhập lại): đăng nhập 2 bước đúng chữ mới; màn "Báo cắt · Máy laser 1 · tổ Phôi" hiện "Lệnh
  PI-2026-040 · Sản phẩm Ghế J55 (500×875×445) (GHE-J55) · 20 cái", 3 chip loại sắt đã nhận + "4 loại sắt chưa nhận ▾", "Đã cắt 120/120 · ✓ đủ", không tràn ngang.
  "Sản lượng của tôi": "Đã kiểm xong · 7 ngày qua / Đây là số được tính cho bạn / Cắt (đoạn) đạt 2 / Lỗi 1 đoạn · đạt 66,7% / Chưa kiểm xong: Cắt: 597 đoạn chờ
  quản lý kiểm"; nhãn lần báo "Chờ quản lý kiểm" / "Đã kiểm xong"; dòng "11:20 · PI-2026-040 · Cắt · Máy laser 1"; lần bị hủy ghi "(demo) Quản lý sản xuất đã hủy
  lần này. Lý do: …". Không thao tác ghi nào.
- Chưa thử trên điện thoại thật; chưa chạy Playwright/axe lần này.

### 54.3. Chấm lại sau (c)
Màn điện thoại công nhân: **~7,5 → ~8,5/10** cho đối tượng ít chữ — không còn chữ viết tắt; mỗi trạng thái nói rõ ai đang giữ việc (quản lý kiểm / đang kiểm
hàng / đã kiểm xong); lỗi nào cũng nói việc phải làm; hết phiên không còn rơi vào màn đăng nhập ERP. Còn kéo điểm: chưa có công nhân thật thử (phông chữ, găng tay,
nắng); "PIN", "mm", "lệnh" vẫn là từ phải học; chưa có hàng chờ tự gửi lại khi mất mạng (31 GĐ2). **Toàn bộ QLSX + công nhân sau các mục 47–54: ~8/10** — số
liệu nhất quán, việc cần làm hiện đúng chỗ, bố cục không vỡ ở 1024px; phần còn lại chủ yếu cần người dùng thật thử rồi mới chốt.

### 54.4. Còn treo
- Chưa commit (BE + FE); production seed lại (mục 47, 51); Playwright bài "hết phiên" cần gỡ `test.fail`; (31 GĐ2) hàng chờ gửi lại + D1 công nhân tự hủy; pilot thật.

## 55. Hướng dẫn sử dụng (/guide) CHƯA có phần QR / "Sản lượng xưởng" (2026-10-20) — rà xong; ĐÃ VIẾT BỔ SUNG ở mục 56
Người dùng hỏi hướng dẫn đã cập nhật chưa, "Sản lượng xưởng" và "Tổng hợp lệnh SX" liên quan gì, nên làm gì trước. Rà `D:\DNA-ERP\src\modules\pages\Guide\content\`:
- **Không có mục nào nói "Sản lượng xưởng"** (0 lần trong cả 11 file); danh sách tab QLSX ở `manufacturing.ts` mục `mfg-overview` vẫn thiếu tab này; không có mục
  cho: hàng đợi PI theo tổ + "Chuyển PI tiếp"/"Mở lại", kiểm + Gửi KCS + Hủy lần báo, máy & tem QR, tài khoản công nhân/PIN, báo cáo sản lượng đạt KCS, ngăn
  "còn thiếu gì"; màn điện thoại công nhân (`/floor`) cũng chưa có hướng dẫn (tổ Phôi/Hàn/Sơn vẫn chỉ được hướng dẫn màn thống kê cũ).
- Mục `mfg-floor-gate` (Bắt đầu/Tạm dừng/Kết thúc ở Tổng hợp lệnh SX) còn đúng về luồng; chưa nói quan hệ với hàng đợi của "Sản lượng xưởng".
- **Quan hệ 2 màn (đã trả lời người dùng):** hai "cổng" độc lập, công nhân chỉ báo được khi qua CẢ HAI — (1) "Tổng hợp lệnh SX" → PI → SKU → **Bắt đầu** = cho phép
  xưởng làm SKU đó; (2) "Sản lượng xưởng" → tổ → **hàng đợi + PI đang chạy** = tổ đó làm PI nào trước (công nhân quét mã máy thấy đúng PI đang chạy). Thứ tự đề
  xuất: Xử lý lệnh (chọn kho → Sếp duyệt) → Tổng hợp: Bắt đầu SKU → Sản lượng xưởng: xếp PI vào hàng đợi từng tổ, bắt đầu PI đầu → hằng ngày kiểm & Gửi KCS (hủy
  lần báo sai) → đủ số thì Chuyển PI tiếp → xong SKU thì Kết thúc ở Tổng hợp. Thẻ PI tự nhắc khi quên bước 2 ("QLSX chưa bấm Bắt đầu SKU nào…").
- ~~Chưa sửa hướng dẫn — chờ người dùng đồng ý.~~ Đã viết ở mục 56.

## 56. ĐÃ VIẾT bổ sung Hướng dẫn sử dụng: luồng QLSX 6 bước, 4 tab "Sản lượng xưởng", màn điện thoại công nhân (2026-10-20) — chỉ FE; ĐÃ GỘP với bài của nhánh mới ở mục 57, đã stage
Người dùng: "Viết bổ sung vào Hướng dẫn sử dụng: luồng QLSX (thứ tự 6 bước giữa Tổng hợp lệnh SX và Sản lượng xưởng), từng tab của Sản lượng xưởng, và màn điện
thoại công nhân." Nội dung viết theo đúng tên nút/nhãn đã đối chiếu trong code (`QlsxQueue`, `QlsxReview`, `QlsxPiDetail`, `QlsxSetup`, `QlsxStats`,
`FloorScanApp`, `floorUi`) sau các mục 47–54.

### 56.1. Đã làm (FE `src/modules/pages/Guide/content/manufacturing.ts`)
- **6 bài mới** (đặt ngay sau bài "gate Bắt đầu/Kết thúc"):
  1. `mfg-qlsx-luong` — **QLSX — luồng điều hành 6 bước**: khối nổi bật "Hai cổng — công nhân chỉ báo được khi qua CẢ HAI" (cổng 1 = Bắt đầu SKU ở Tổng hợp
     lệnh SX; cổng 2 = PI đang chạy trong hàng đợi tổ ở Sản lượng xưởng) + 6 bước (Xử lý lệnh → Bắt đầu SKU → xếp hàng đợi 3 tổ → hằng ngày kiểm & gửi KCS / hủy
     lần báo sai → theo dõi %, Chuyển PI tiếp → Kết thúc), bảng "Việc nào làm ở màn nào", lưu ý (thứ tự bước 2–3 đảo được; hỏi lại khi chuyển sớm; "Mở lại PI";
     2 màn cùng 1 cách tính %), 3 lỗi thường gặp (2 câu báo của công nhân khi thiếu cổng 1/cổng 2; ô Thêm PI không có PI cần xếp).
  2. `mfg-qlsx-san-luong-kcs` — tab **Sản lượng & gửi KCS** (thẻ PI 3 màu, ngăn "Xem còn thiếu gì" 3 tab, hàng đợi, Chờ gửi KCS: Kiểm & gửi / Hủy / Gửi KCS đợt
     này / tất cả) + trạng thái + lưu ý (gửi rồi không hủy được; hủy không xoá; vượt chỉ cảnh báo; thông báo tự động).
  3. `mfg-qlsx-bao-cao` — tab **Báo cáo** (QLSX + Sếp; mốc = ngày KCS duyệt, "Chưa rõ người", Xuất Excel).
  4. `mfg-qlsx-may-tem` — tab **Máy & tem QR** (4 loại máy, Xem / in, In tất cả tem, Đổi mã QR, địa chỉ trên tem do Admin cài).
  5. `mfg-qlsx-cong-nhan` — tab **Công nhân** (QLSX không biết PIN; 4 trạng thái PIN; Cho đặt lại PIN, Mở khoá tạm, Khoá; Wi-Fi công ty; đặt PIN theo nhóm ≤ 8/phút).
  6. `mfg-cong-nhan-dien-thoai` — **Công nhân — báo sản lượng bằng điện thoại** (vai Phôi/Hàn/Sơn; viết bằng chữ mới của mục 54: quét bằng app camera → mở bằng
     Chrome → tên → PIN → Lưu → "Đúng, lưu…"/"Sửa lại"; nhận sắt; "Sản lượng của tôi"; 4 trạng thái; 5 lỗi thường gặp).
- Bài `mfg-overview`: danh sách tab QLSX thêm "Sản lượng xưởng (4 tab)" + dòng công nhân dùng điện thoại. Bài `mfg-floor-gate`: thêm lưu ý "Bắt đầu chỉ là cổng 1…".
- `search.test.ts` thêm 4 ca: "san luong xuong" → `mfg-qlsx-luong`, "gui kcs" → `mfg-qlsx-san-luong-kcs`, "tem qr" → `mfg-qlsx-may-tem`, "quet qr" →
  `mfg-cong-nhan-dien-thoai` (đều trong 2 kết quả đầu).

### 56.2. Kiểm tra
- `tsc` sạch, eslint thư mục Guide 0 lỗi, vitest toàn FE qua (Guide 16/16).
- Trình duyệt `/guide`: nhóm "Sản xuất" liệt kê đủ 6 bài mới; mở `?a=mfg-qlsx-luong` hiện tiêu đề, phần mục đích, sơ đồ nút, khối "Hai cổng…", "Khoảng 6 phút
  đọc", tab "Lỗi thường gặp (3)"; `?a=mfg-cong-nhan-dien-thoai` có các bước + tab "Lỗi thường gặp (5)" + tab "Trạng thái" ("Chờ quản lý kiểm"…). Console không lỗi.

### 56.3. Chưa làm
- Chưa có ảnh chụp màn hình thật (`public/guide-screens/`) cho 6 bài mới — đang dùng sơ đồ minh hoạ (`mock`). Chưa cập nhật bài "Hành trình một đơn hàng"
  (`journey.ts`) để nhắc bước QR. Chưa commit.

## 57. Fetch + pull nhánh mới nhất, gộp Hướng dẫn trùng, STAGE phần QR/QLSX (2026-10-20) — chưa commit (người dùng tự commit)

Người dùng: "những gì tôi cần commit là gì bạn hãy đưa xuống stage tôi sẻ tự commit, mà trước khi đưa xuống hãy fetch và pull nhánh mới nhất".
Hai câu hỏi đã chốt: bài hướng dẫn trùng → **Gộp**; cách pull khi còn thay đổi chưa commit → **git stash**.

### 57.1. Pull
- **BE** (`main`): `git fetch` → đã mới nhất so với `origin/main`, không cần pull.
- **FE** (`demo`): sao lưu bản vá (`fe-before-pull.patch` trong scratchpad) → `git stash push -m "truoc-pull-2026-10-20 (Claude, theo yeu cau nguoi dung)"`
  → `git pull --ff-only` (lên `3704086 fix-tumlum`, 3 commit của nhánh) → `git stash pop`. `MfgApp.tsx` tự gộp sạch (thay đổi SpecSteelPage của nhánh
  + padding 72px của mình). **Xung đột 1 file:** `src/modules/pages/Guide/content/manufacturing.ts` — nhánh mới cũng đã thêm 4 bài QR (có ảnh chụp thật
  `public/guide-screens/mfg-qr-*.png`) trùng chủ đề với 6 bài của mục 56.
- Vì pop có xung đột nên git **giữ lại** stash `stash@{0}` "truoc-pull-2026-10-20…" — nội dung đã nằm đủ trong thư mục làm việc; chưa xoá, người dùng
  có thể `git stash drop stash@{0}` khi đã commit xong.

### 57.2. Gộp bài Hướng dẫn (theo lựa chọn "Gộp")
- **Giữ 4 bài của nhánh mới** (có ảnh): `mfg-qr-qlsx-thiet-lap`, `mfg-qr-qlsx-hang-doi`, `mfg-qr-qlsx-baocao`, `mfg-qr-bao-san-luong`.
- **Giữ 2 bài của mình:** `mfg-qlsx-luong` (luồng 6 bước / hai cổng) và `mfg-qlsx-cong-nhan` (tab Công nhân, đặt ngay sau bài thiết lập).
- **Bỏ 4 bài trùng của mình** (`mfg-qlsx-san-luong-kcs`, `mfg-qlsx-bao-cao`, `mfg-qlsx-may-tem`, `mfg-cong-nhan-dien-thoai`), phần riêng của chúng bổ sung vào bài nhánh:
  - `mfg-qr-qlsx-hang-doi`: thanh 3 màu Đạt/Chờ/Chưa gửi KCS, dòng "Còn thiếu…", ngăn "Xem còn thiếu gì" (3 tab), "Gửi KCS đợt này", **"Hủy" thay "Đảo"**
    (nhánh vẫn ghi "Đảo"), hộp hỏi lại khi "Chuyển PI tiếp" lúc chưa đủ, khối "Chờ gửi KCS" lên đầu ở màn hẹp, bảng trạng thái, 2 lỗi thường gặp, tag "đảo lần báo" để ai
    gõ chữ cũ vẫn tìm thấy.
  - `mfg-qr-qlsx-baocao`: thêm vai trò Sếp + 3 lưu ý (tính theo ngày KCS duyệt, "Chưa rõ người", không cộng chung loại việc / đoạn với mảnh).
  - `mfg-qr-bao-san-luong`: viết lại theo chữ mới của màn công nhân (mục 54), **sửa kỳ "Sản lượng của tôi"** (nhánh ghi "7 ngày / 30 ngày / quý / năm" — sai;
    thực tế là 7 ngày qua / Tháng này / Tháng trước), trạng thái "Chờ quản lý kiểm / Đang kiểm hàng / Đã kiểm xong / gạch ngang khi bị hủy", 5 lỗi thường gặp
    đúng câu chữ đang hiện, giữ các lưu ý của nhánh (mất mạng, khoá PIN, Wi-Fi công ty, máy không gắn cứng lệnh).
  - `mfg-qr-qlsx-thiet-lap`: thêm 1 lưu ý trỏ sang bài tab Công nhân.
- Xung đột ở `mfg-overview`: lấy bản của mình (liệt kê 4 tab + câu về công nhân), đổi tên bài được nhắc tới cho khớp bài còn lại. Sửa mọi chỗ "xem bài …" trỏ tới
  bài đã bỏ hoặc sai vị trí (bài kế tiếp/bài trước đổi do thứ tự mới), kể cả câu ở `mfg-phoi-nhan-sat` của nhánh.
- `search.test.ts`: "gui kcs" → `mfg-qr-qlsx-hang-doi`, "tem qr" → `mfg-qr-qlsx-thiet-lap`, "quet qr" → `mfg-qr-bao-san-luong` (đứng trong 2 kết quả đầu).
- Giữ CRLF như file gốc.

### 57.3. Đã stage (chưa commit)
- **BE — 28 file:** `src/modules/floor/**` (gồm `floor-progress.util.ts` + spec, `floor.controller.spec.ts`, `floor-realtime.interceptor.spec.ts`),
  `src/modules/auth/auth.controller.spec.ts`, `src/modules/steel-issues/**`, `src/modules/production-batches/**`, `notification-types.ts`, `realtime.contract.ts`,
  `role-permissions.constant.ts`, `test/load/floor-load.mjs` + `package.json` (script `load:floor`), `test/jest-integration.json`, `prisma/seed-dry-run.ts`,
  `.env.example` (`TRUST_PROXY_HOPS`), và changelog này.
- **FE — 43 file:** `src/modules/pages/Floor/**`, Guide (`manufacturing.ts`, `search.test.ts`), `sanxuat/*` (gồm `PhoiMaterialBoard.tsx` mới), `ProgressBar`, `ReasonModal`,
  `MonthYearPicker` + `monthYearLogic.*`, `ThongKePagePlan`, `MfgApp`, `LenhSXPage`, `SKUListPage`, `VatTuDashboardPage`, `utils/overdue.*`, `page.tsx` (nút Hướng dẫn),
  `AuthContext`, `useNotifications`, 3 service API, bộ thử điện thoại (`e2e/floor/*`, `playwright.floor.config.ts`, `tsconfig.e2e.json`, `next.config.mjs`,
  `.gitignore`, `eslint.config.mjs`).
- **Cố ý KHÔNG stage:**
  - FE: xoá `.env.example` (không phải của mình — cần người dùng xác nhận), `next-env.d.ts` (Next tự sinh khi chạy dev), `tsconfig.tsbuildinfo`,
    `pnpm-lock.yaml`/`pnpm-workspace.yaml` (dự án dùng npm + `package-lock.json`), `AGENTS.md`, `CLAUDE.md`, `.claude/`, các tài liệu `docs/*` phân tích cũ +
    `docs/quy-doi-doan-phoi.md`, `e2e/golden-path.spec.ts` (đổi tên khách MEIJING → Meiying), `e2e/full-flow.spec.ts`, `e2e/helpers.ts`,
    `e2e/solve-truoc-tao-lenh.spec.ts`, `playwright.nows.config.ts` (thuộc đợt solver/e2e khác).
  - BE: `CLAUDE.md`, `.claude/`, `start-dev.bat`, 3 changelog cũ đang sửa (09-06, 09-12, 09-25) và ~24 changelog chưa theo dõi của các chủ đề khác
    (solver, AI, HR, MXH nội bộ…) — chỉ là tài liệu, người dùng tự quyết commit riêng hay gộp.

### 57.4. Kiểm tra
- FE: `tsc --noEmit` sạch; vitest **198/198** (21 file), riêng Guide 16/16.
- BE: `nest build` thoát 0. (Các bộ test floor/steel-issues/production-batches đã qua ở mục 47–56; không có thay đổi code BE sau lần chạy đó.)
- **Kiểm riêng bản STAGED (người dùng hỏi "đủ hết code QLSX chưa"):** xuất đúng nội dung index của 2 repo ra thư mục tạm (`git checkout-index`), chạy độc lập: BE `nest build` thoát 0 + jest floor/steel-issues/production-batches/auth/realtime/common **593 qua, 1 bỏ qua**; FE `tsc` sạch + vitest **198/198** → không file staged nào phụ thuộc file chưa stage. Không còn file `src/` nào sửa mà chưa stage ở cả 2 repo, không file nào stage một nửa.
- Chưa mở lại /guide trên trình duyệt sau khi gộp (nội dung là dữ liệu tĩnh, đã có test tìm kiếm + tsc kiểm cấu trúc).

### 57.5. Chưa làm / còn treo
- Chưa commit (người dùng tự commit). Chưa push, chưa deploy.
- Stash `stash@{0}` trên FE còn giữ — xoá khi đã commit ổn.
- Production vẫn phải chạy lại `npm run seed` khi deploy (quyền `QC_REVIEW:VIEW`, `MATERIAL_GROUP:VIEW` cho QLSX).

### 57.6. Việc cần làm trên production sau khi push bản staged này (người dùng hỏi, 2026-10-20)
- **Migration: không có.** Bản staged không đổi `prisma/schema.prisma`, không thêm thư mục migration (so với `origin/main` cũng không có migration nào mới).
  Dù vậy container Render vẫn tự chạy `prisma migrate deploy` lúc khởi động (`docker/entrypoint.js`) — không cần làm tay.
- **Seed: CÓ — bắt buộc 1 lần.** `ROLE_GRANTS` thêm cho `PRODUCTION_MANAGER` (QLSX) 2 quyền chỉ xem: `QC_REVIEW:VIEW` (xem kết quả KCS + nhận realtime KCS)
  và `MATERIAL_GROUP:VIEW` (cột "Nhóm vật tư" ở "Tổng hợp kho"). Không seed thì: thẻ PI/ngăn "còn thiếu gì" không tự cập nhật khi KCS chấm, cột Nhóm vật tư trống "—".
  Cách chạy giống mục 38: sao lưu DB trước (Prisma Postgres 17, `backups/`) → chạy bản thử chỉ đọc `prisma/seed-dry-run.ts` với URL production, mong đợi chỉ
  "PRODUCTION_MANAGER +2, gỡ 0" → `npm run seed` từ máy dev (image production không có `ts-node`) với `SEED_ADMIN_EMAIL=admin@dna-erp.local`,
  `SEED_ADMIN_USERNAME=sysadmin` (để không tạo admin mới) → chạy lại bản thử, mong đợi +0/−0.
- **Đăng nhập lại: không bắt buộc.** Quyền nằm trong access token 15 phút; lần làm mới token (`refresh`) đọc lại vai trò từ DB nên tài khoản QLSX tự có quyền mới
  trong ≤ 15 phút; muốn có ngay thì đăng xuất/đăng nhập lại.
- **Biến môi trường: không có biến mới.** `TRUST_PROXY_HOPS` đã có trong `render.yaml` từ mục 28 (chỉ cần kiểm Render đang có giá trị). FE không cần biến mới
  (`NEXT_DIST_DIR`, `DEV_ALLOWED_ORIGINS` trong `next.config.mjs` chỉ dùng cho máy dev/bài thử điện thoại; không đặt = như cũ). FE không đổi `package.json`.
- **Kiểm sau deploy:** đăng nhập QLSX → "Sản lượng xưởng": thẻ PI có thanh 3 màu + "Xem còn thiếu gì" mở được; "Tổng hợp kho" có cột Nhóm vật tư; một lần báo sai
  hiện nút "Hủy" (không còn "Đảo").
