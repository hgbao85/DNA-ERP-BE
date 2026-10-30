# Changelog 2026-09-25 — Review tổng thể Notification (DNA-ERP + DNA-ERP-BE) & plan xây lại

> Trạng thái: **Phase 1 (nền tảng BE) và Phase 2 (Notification Center FE + URL) ĐÃ XONG (2026-09-25)
> — xem mục 11, 12** (gồm các đợt sửa sau phản hồi người dùng ở 12.5, 12.6: phân loại lại 21 thông
> báo cũ, bỏ `link` của 4 type cắt sắt). **2026-09-26 (mục 14):** người dùng chốt bỏ hẳn luôn cả 3
> loại thông báo "không thành công" của cắt sắt (cần duyệt tay/auto-duyệt lỗi/solver lỗi) - QLSX giờ
> CHỈ nhận thông báo khi tính xong VÀ tự duyệt OK, đúng flow trước khi có notification.
> **2026-09-26 (mục 15, 16, 17): Phase 3a ĐÃ XONG TOÀN BỘ** - nhóm 7.1 "SKU/định mức" (9 type),
> nhóm 7.2 "Lệnh sản xuất PI" (6 type), nhóm 7.4 "Đề xuất mua hàng" (4 type), cả 3 đều có live-test
> FE thật. **Mục 18:** sửa 1 bug thật (`warehouseIds` sai kiểu dữ liệu) phát hiện lúc rà code chuẩn
> bị Phase 3b. **Mục 19: Phase 3b bắt đầu** - nhóm 7.5-i "Sắt → Phôi → KCS" (4 type) ĐÃ XONG, có
> live-test FE thật.
> **Đang chờ người dùng quyết định:** có xây màn "chi tiết 1 CuttingProposal" (Duyệt/Từ chối) ở FE
> hay không (mục 12.5, 12.6) - bớt cấp thiết hơn sau mục 14 vì QLSX không còn thấy thông báo "cần
> duyệt tay" để mà cần bấm vào nữa.
> **2026-09-28 (mục 20):** dọn nốt các việc nhỏ còn treo của Phase 2 - sửa double-poll (mục 12.4),
> khôi phục sau sự cố merge Git làm mất lại `NotificationCenter`/gỡ `NotifBell` ở 3 file, thêm `?p=`
> URL-sync cho `AdminApp.tsx` và `SalesApp.tsx` (nay cả 7/7 app shell đồng bộ URL).
> **2026-09-28 (mục 21): xây trang "Thông báo của tôi" riêng - PHASE 2 HOÀN TẤT TOÀN BỘ.**
> **2026-09-28 (mục 22): Phase 3b nhóm 7.5-ii "Xuất vật tư tiêu hao/thành phẩm/bao bì" ĐÃ XONG**
> (3 type mới) + nhân tiện gắn `link` cho 3 type nhóm 7.5-i (mục 19) vốn thiếu vì lúc đó `?p=` chưa
> có ở `MfgApp.tsx`.
> **2026-09-28 (mục 23): Phase 3b nhóm 7.5-iii "Chuyển kho ngoài đơn hàng" ĐÃ XONG** (2 type mới) -
> nhân tiện vá 1 lỗ hổng THẬT trong cơ chế điều hướng chung: `NotificationLink.params` được khai báo
> từ đầu nhưng chưa từng được đọc ở FE, chặn deep-link vào sub-tab.
> **2026-09-28 (mục 24): Phase 3b nhóm 7.5-v "Chuyền kiểm có lỗi" ĐÃ XONG** (1 type mới, tái dùng
> `NotificationsService` đã có sẵn ở `production-invoices.service.ts` từ Phase 3a, không cần DI mới).
> **2026-09-28 (mục 25): Phase 3b nhóm 7.5-vi "Đóng gói xong → Sales" ĐÃ XONG** (1 type mới, cùng
> service).
> **2026-09-28 (mục 26): Phase 3b nhóm 7.5-iv "Xuất/nhận đan" ĐÃ XONG (1 type mới) - PHASE 3B HOÀN
> TẤT TOÀN BỘ 6 NHÓM.** Người dùng chốt thiết kế trước khi code (đơn giản, non-tech): mirror
> `PI_SENT_TO_QLSX` - `entityId` khoá ghép `(productionOrderId, pieceId, weavingPointId)`, tự đóng
> khi tổng đang treo tại điểm đan về đúng 0. **Rà lại mục 7/8 sau đó (mục 26.5): "Phase 3c" trong
> plan gốc (hàng về, đóng gói xong → Sales) hoá ra đã làm xong từ trước trong 3a/mục 17 và 3b/mục 25
> - PHASE 3 (3a+3b+3c) ĐÃ ĐÓNG HOÀN TOÀN, không còn việc gì treo lại.** Đang bắt đầu Phase 4 (badge
> "việc chờ tôi", mục 6.3/8).
> **2026-09-29 (mục 27): Phase 4 ĐÃ XONG TOÀN BỘ (BE+FE) - PHASE 1–4 HOÀN TẤT.** BE: endpoint
> `GET /me/work-queue` (10 khoá đếm theo 9 role, research trước khi code phát hiện bảng plan mục 6.3
> SAI/THIẾU ở 5 chỗ - đáng chú ý nhất: đếm thẳng cột `SalesOrderItem.status` sẽ LUÔN ra 0 vì cột đó
> đứng yên vĩnh viễn từ 2026-09-24, và Mua hàng "NEW/QUOTING" theo plan gốc bỏ sót ~36 dòng thật).
> FE: gắn badge vào 6/7 app shell (Admin không có role nào trong bảng mục 6.3). Live-test thật đối
> chiếu `psql` cho cả 15 account demo (BE) + chụp trực tiếp trên UI cho 4 ca (FE) - khớp tuyệt đối.
> **2026-09-29 (mục 28): Người dùng chốt Phase 5 (realtime SSE, cài đặt theo loại, kênh ngoài Web
> Push/Zalo) chưa cần thiết - HOÃN vô thời hạn. DỰ ÁN NOTIFICATION COI NHƯ HOÀN TẤT (Phase 1–4).**
>
> Cách đọc: mục 2–7 là review + kiến trúc ĐÍCH viết TRƯỚC khi code; chỗ nào thực tế làm khác thì mục
> 11.2 / 12.x là nguồn đúng (mục 5 có ghi chú trỏ sang). Mục 8 là plan theo phase; khi làm xong phase
> nào thì cập nhật tiêu đề phase đó + mục lục bên dưới.
>
> **2026-10-08 (mục 29): rà soát "bấm thông báo có nhảy đúng màn không" bằng bấm thật trên 14 vai trò** -
> chỉ tới đúng MÀN (module+trang), KHÔNG mở thẳng đúng mục; 11 type không có link; một số link trỏ
> vào phân hệ mà vai trò nhận không vào được; 1 lỗi chữ "null". **ĐÃ SỬA ở mục 30 (2026-10-08)** - mở
> thẳng đúng mục (tham số `focus` trên URL), link cho 7 type, người nhận kho chỉ còn thủ kho, hết chữ "null".
>
> **2026-10-26 (mục 32): nghiên cứu "timeline chuẩn ERP"** (SAP/Odoo/Dynamics 365) cho mốc công đoạn + thiết kế thông báo trễ
> hạn, đối chiếu DNA-ERP qua PI-2026-035 - **CHỈ NGHIÊN CỨU, CHƯA SỬA CODE**, chờ Sếp họp chốt 15 câu hỏi. Tài liệu cho buổi
> họp: https://claude.ai/artifact/Uuz7ZdMh6oECZjSBKGQWTn

## Mục lục

1. Bối cảnh
2. Hiện trạng (đã kiểm chứng trong code)
3. Vấn đề — nhìn từ PM / senior
4. Nguyên tắc thiết kế cho bản mới
5. Kiến trúc đích — BE
6. Kiến trúc đích — FE (UX từng màn)
7. Danh mục sự kiện theo từng luồng / từng màn
8. Plan triển khai theo phase — _Phase 1–4 ĐÃ XONG TOÀN BỘ; Phase 5 chưa làm_
9. Quyết định đã chốt với người dùng — _đã chốt 2026-09-25_
10. Những gì CHƯA làm tại thời điểm review — _lỗi thời, giữ làm lịch sử_
11. Phase 1 — Nền tảng BE — _ĐÃ XONG 2026-09-25_
12. Phase 2 — Notification Center FE + URL — _ĐÃ XONG 2026-09-25_ (12.5, 12.6: sửa sau phản hồi;
    còn chờ quyết định màn chi tiết CuttingProposal)
13. Rà soát nhất quán tài liệu — _2026-09-26_
14. Bỏ hẳn thông báo QLSX cho 3 nhánh "không thành công" của cắt sắt — _ĐÃ XONG 2026-09-26_
15. Phase 3a — nhóm 7.1 "SKU/định mức" (9 sự kiện) — _ĐÃ XONG 2026-09-26_
16. Phase 3a — nhóm 7.2 "Lệnh sản xuất PI" (6 sự kiện) — _ĐÃ XONG 2026-09-26_
17. Phase 3a — nhóm 7.4 "Đề xuất mua hàng" (4 sự kiện) — _ĐÃ XONG 2026-09-26, Phase 3a hoàn tất_
18. Sửa bug `warehouseIds` sai kiểu dữ liệu ở `PURCHASE_PROPOSAL_ITEM_RECEIVED` — _ĐÃ XONG 2026-09-26_
19. Phase 3b — nhóm 7.5-i "Sắt → Phôi → KCS" (4 sự kiện) — _ĐÃ XONG 2026-09-26_
20. Dọn nốt việc nhỏ còn treo của Phase 2 (double-poll, sự cố merge Git, `?p=` AdminApp) — _ĐÃ XONG 2026-09-28_
21. Trang "Thông báo của tôi" riêng — _ĐÃ XONG 2026-09-28, Phase 2 hoàn tất toàn bộ_
22. Phase 3b — nhóm 7.5-ii "Xuất vật tư tiêu hao/thành phẩm/bao bì" (3 sự kiện) + gắn `link` còn thiếu cho nhóm 7.5-i — _ĐÃ XONG 2026-09-28_
23. Phase 3b — nhóm 7.5-iii "Chuyển kho ngoài đơn hàng" (2 sự kiện) + vá `NotificationLink.params` chưa từng được đọc ở FE — _ĐÃ XONG 2026-09-28_
24. Phase 3b — nhóm 7.5-v "Chuyền kiểm có lỗi" (1 sự kiện) — _ĐÃ XONG 2026-09-28_
25. Phase 3b — nhóm 7.5-vi "Đóng gói xong → Sales" (1 sự kiện) — _ĐÃ XONG 2026-09-28_
26. Phase 3b — nhóm 7.5-iv "Xuất/nhận đan" (1 sự kiện) — _ĐÃ XONG 2026-09-28, PHASE 3B HOÀN TẤT TOÀN BỘ_
27. Phase 4 — Badge "việc chờ tôi" (`GET /me/work-queue` + gắn vào 6/7 app shell) — _ĐÃ XONG TOÀN BỘ 2026-09-29_
28. Quyết định dừng lại - Phase 5 hoãn — _2026-09-29, người dùng chốt_
29. Rà soát "bấm thông báo có nhảy đúng màn không" — _2026-10-08, chỉ rà (đã sửa ở mục 30)_
30. Sửa theo mục 29: mở thẳng đúng mục, link cho thông báo thiếu link, rà người nhận/quyền — _2026-10-08, đã làm, chưa commit_
31. Rà vòng đời lệnh sản xuất theo 4 nhóm quản lý của ERP — _2026-10-09; P1, P2 đã làm; P3 (quét quá hạn) còn treo, thiết kế ở mục 32_
32. Nghiên cứu timeline chuẩn ERP + thiết kế thông báo trễ hạn — _2026-10-26, chỉ nghiên cứu, chờ Sếp họp chốt_ (32.1: anh Nhân đã có quy tắc mốc theo N từ 05–06/10; 32.2: Sếp chốt hệ thống đề xuất theo mốc Phú An; 32.3: ĐÃ LÀM ở FE, chưa commit; 32.4: rà vật tư production theo công đoạn; 32.5: Sếp làm rõ khung ngày về vật tư; 32.6: review lệnh gộp + chia hàng về cho SKU; 32.7: Sếp xác nhận nhóm vật tư + tên/vị trí cột mốc; 32.8: ĐÃ LÀM A–C - mốc Mua VT khung & đan / Mua VT còn lại + "về từ", local chưa commit; 32.9: live-test XÁC NHẬN lỗi chặn nhầm chính PI khi xuất tiêu hao/đóng gói; 32.10: ĐÃ SỬA lỗi đó, local chưa commit; 32.11: review commit dbfd2ea của ohey trên origin/main - sửa cả lỗi 1 lẫn lỗi 2, thay bản sửa local 32.10; 32.12: đã bỏ bản local 32.10 và pull dbfd2ea về main, chưa commit gì thêm; 32.13: dbfd2ea không đụng phần code của người dùng, đã STAGE phần cần commit BE + FE, người dùng tự commit (đã commit `ab847fa`); 32.14: review tài liệu "Kế hoạch thực hiện 12 yêu cầu mới" 26/10, chỉ rà; 32.15: review commit 689a93f của ohey - nhả giữ chỗ dư khi PI Kết thúc, còn 1 lỗi nhận hàng sau khi nhả + thiếu nhả bù PI cũ; 32.16: đã pull 689a93f về main; 32.17: review file câu hỏi làm rõ nghiệp vụ part 1 gửi Sếp, chỉ góp ý; 32.18: đề xuất cách làm "tự kiểm tra dữ liệu mỗi đêm" + "bảng lệnh sắp trễ / tin tóm tắt sáng", CHƯA làm; 32.19: ý 1 - nguyên mẫu phép kiểm chạy trên DB test + danh sách file, đã duyệt; 32.20: ĐÃ LÀM ý 1 "Kiểm tra dữ liệu" mỗi đêm, local chưa commit; 32.21: Sếp trả lời 16 câu nghiệp vụ part 1; 32.22: soạn câu trả lời Câu 2 / Mục 3 "Số liệu thống kê"; 32.23: pull + review BE d1e09a3 + FE b6e3f2b của ohey - sửa đúng lỗi giữ chỗ sắt theo chiều dài + 5 lỗi giao diện, E2E qua; lỗi trùng khoá sau khi nhả (32.15) + dữ liệu cũ vẫn còn; 32.24: giải thích `DATA_HEALTH_CRON_KEY`, đề xuất hẹn giờ trong app thay lịch GitHub + kế hoạch mục 3 bảng mốc / tin sáng, đã duyệt; 32.25: ĐÃ LÀM - hẹn giờ trong app (bỏ khoá cron + lịch GitHub), Bảng mốc, tin sáng, cảnh báo nguy cơ trễ hạn giao; local chưa commit; 32.26: rà lỗi biên 32.25 - 10 phát hiện, ĐÃ SỬA 9 (tin vật tư riêng từng người nhận, kho nhận ghi đè, dây của SKU đã Kết thúc, khoá chạy 1 nơi, cảnh báo hạn giao không báo lại mỗi lần đóng thùng...), 1 lệch có sẵn ở FE để lại; local chưa commit; 32.27: 2 agent test chạy thật + 1 agent quản lý rà code mục 1 và 3 - đủ thiết kế, chấm 8 và 8,5/10; tìm 3 lỗi mục 1 + 9 điểm lệch/lỗi nhỏ quanh mục 3, đã sửa ở 32.28; 32.28: ĐÃ SỬA HẾT theo "Sửa hết" (P1 + P2 + Q1–Q7) + 2 vòng test lại bằng agent, local chưa commit; 32.29: đã STAGE BE + FE của mục 1 và 3 (người dùng tự commit), deploy không cần chạy tay gì)

---

## 1. Bối cảnh

Người dùng: *"phần notification đang rất là junior… review tổng quan với góc nhìn PM/expert/senior để
build hoàn chỉnh notification cho từng màn… lên plan chi tiết"*. Review này đọc toàn bộ code liên quan
ở cả 2 repo, không chạy/sửa gì.

## 2. Hiện trạng (đã kiểm chứng trong code)

### 2.1 BE — `src/modules/notifications`

- Schema: `Notification { title, message, audience, createdBy }` + `NotificationRead` (junction đã đọc)
  — [schema.prisma:205](../prisma/schema.prisma). `NotificationAudience` chỉ có 4 giá trị:
  `ALL | BOSS | WAREHOUSE_STAFF | PRODUCTION_MANAGER`.
- 3 endpoint: `POST /notifications` (admin broadcast), `GET /notifications` (lọc theo audience của
  người gọi), `POST /notifications/:id/read`.
- Không có: unread-count, mark-all-read, lọc chưa đọc, link tới đối tượng, loại/mức độ, người nhận
  cụ thể, dọn dữ liệu cũ, realtime.
- **Chỉ có đúng 1 nơi phát thông báo tự động** trong toàn hệ thống:
  `CuttingProposalsService.notifyProductionManagers()` ([cutting-proposals.service.ts:2108](../src/modules/cutting-proposals/cutting-proposals.service.ts))
  — 4 biến thể text (tự duyệt OK / cần duyệt tay / tự duyệt lỗi / solver lỗi), gắn số PO vào chuỗi,
  không có id đối tượng để bấm vào.
- `getAudiencesForUser()` so `user.roles` với tên enum — role 12 business role khác (Sales, KHSX, Phôi,
  Hàn, Sơn, KCS, Mua hàng, Spec…) **không có audience riêng**, chỉ nhận được `ALL`.
- `sortBy` nhận chuỗi tuỳ ý (`PaginationQueryDto`) → truyền field lạ sẽ ném lỗi Prisma 500 (lỗi
  chung của pattern paginate, không riêng notifications).

### 2.2 FE — `D:\DNA-ERP\src`

- `notifications-api.ts` có `getNotifications()` (cứng `limit=100`), `createNotification()`,
  `markNotificationRead()` — **`markNotificationRead` không được gọi ở đâu cả** → cờ `isRead` BE trả
  về là tính năng chết.
- `getNotifications()` chỉ được dùng ở **`Admin/NotificationsPage`** (trang CRUD admin). Không có
  chuông/hộp thông báo toàn cục ở bất kỳ app shell nào (`SalesApp`, `MfgApp`, `ProductionPlanApp`,
  `PurchasingApp`, `InboundWarehouseApp`, `BossApp`…).
  → **Thông báo cắt sắt BE gửi cho QLSX không bao giờ hiển thị cho QLSX.** Chỉ admin (nếu vào trang
  admin) mới thấy — mà admin lại chỉ thấy audience `ALL` (xem dưới), nên thực tế **không ai thấy**.
- `Admin/NotificationsPage`: admin tạo thông báo cho `BOSS`/`WAREHOUSE_STAFF`/`PRODUCTION_MANAGER`
  xong thì **không thấy lại chính thông báo mình vừa tạo** (list lọc theo audience của người gọi).
  Lọc/tìm kiếm là client-side trên 100 dòng đầu. Config còn `deleteConfirm` dù không có delete (dead).
- `components/NotifBell.tsx`: chuông "giả" dùng ở `SpecSteelPage.tsx:350` và
  `SpecDetailQuotaPage.tsx:167` — dựng từ state trang (các BOM có trạng thái `approved`), **không nối
  BE**, "đã xem" lưu trong `useState` nên F5 là hiện lại hết, badge đếm tất cả BOM đã duyệt từ trước
  tới nay (tăng mãi), không theo user.
- Điều hướng FE dùng state (`activeModule` ở `app/page.tsx` + state `page` trong từng `*App.tsx`),
  **không có URL route** cho từng màn/đối tượng → hiện tại không có cách "bấm thông báo mở đúng PI
  X". Đây là điều kiện tiên quyết phải giải ở phase FE.
- Nhiều màn đang tự poll (`LenhSXPage` / `CuttingProposalsPage` `setInterval 20s`) để thấy trạng thái
  mới — đúng là triệu chứng của việc thiếu kênh thông báo.

## 3. Vấn đề — nhìn từ PM / senior

| # | Vấn đề | Hệ quả nghiệp vụ | Mức |
|---|---|---|---|
| P1 | Không có nơi hiển thị thông báo cho người dùng cuối | Thông báo duy nhất có thật (cắt sắt) bị mất; QLSX phải tự mở màn để phát hiện | Cao |
| P2 | Mô hình "broadcast theo 4 audience" thay vì "người nhận cụ thể" | Không báo được cho Sales/KHSX/Phôi/Hàn/Sơn/KCS/Mua hàng/Spec; không báo đúng kho (warehouseScope); không báo đúng người tạo đơn | Cao |
| P3 | Hầu hết điểm bàn giao giữa các vai trò (handoff) không phát thông báo | Quy trình KHSX→QLSX→Sếp, Kho→Phôi→KCS, Mua→Kho… chạy bằng "hỏi miệng"/Zalo, trễ việc | Cao |
| P4 | Thông báo không có đối tượng/link, không có loại, không có mức độ | Không bấm vào được, không lọc được, không phân biệt "cần làm ngay" vs "để biết" | Trung bình |
| P5 | Không tự "đóng" khi việc đã được người khác xử lý | Khi có ≥2 QLSX / nhiều nhân viên kho, thông báo "cần duyệt" vẫn nằm đó sau khi đã duyệt → nhiễu, xử lý trùng | Trung bình |
| P6 | Chuông giả trên màn Spec | UX mâu thuẫn (F5 hiện lại, badge tăng mãi), người dùng mất niềm tin vào chuông | Trung bình |
| P7 | Không có badge "việc đang chờ tôi" trên menu | Người dùng phải mở từng tab để biết có việc | Trung bình |
| P8 | Không unread-count, không mark-all, không dọn dữ liệu, không realtime | Không build được chuông hiệu quả; bảng phình vô hạn | Thấp→TB |

Tóm lại: đang có **một bảng tin (bulletin board)**, chưa có **hệ thống thông báo nghiệp vụ**.

## 4. Nguyên tắc thiết kế cho bản mới

1. **Tách 3 khái niệm, đừng trộn:**
   - **Việc cần làm (work queue / badge)** — *suy ra từ trạng thái dữ liệu*, vd "3 PI chờ QLSX duyệt".
     Luôn đúng vì là query, không bao giờ "lệch". Hiện ở badge trên menu.
   - **Thông báo sự kiện (event notification)** — *một điều vừa xảy ra liên quan tới tôi*, vd "Sếp
     đã từ chối PI-2026-013: lý do …". Gửi tới người cụ thể, có link, có trạng thái đọc.
   - **Thông báo chung (announcement)** — admin/ Sếp phát cho cả công ty hoặc 1 nhóm. Giữ tính năng
     hiện có.
2. **Chỉ báo ở điểm bàn giao giữa người/vai trò** (handoff), kết quả của việc mình đã gửi đi (duyệt /
   từ chối / lỗi), và cảnh báo thật sự. Không báo cho chính người vừa thao tác (exclude actor).
3. **Mỗi thông báo trả lời được 3 câu:** chuyện gì, về đối tượng nào (mã PI/PO/SKU…), tôi cần làm gì
   (nút/link mở đúng chỗ).
4. **Người nhận được tính ở BE** theo role + `mfgRole` + kho (`warehouseScope`/`Material.warehouseId`)
   + người liên quan (người tạo/đã gửi đi). FE không tự quyết ai nhận.
5. **Tự đóng (auto-resolve):** thông báo loại "cần xử lý" được đánh dấu `resolved` cho mọi người nhận
   ngay khi đối tượng rời trạng thái đó (ai đó đã duyệt/nhận/từ chối).
6. **Gộp chống spam (dedupe):** cùng loại + cùng đối tượng trong khoảng ngắn thì cập nhật dòng cũ thay
   vì thêm dòng mới (vd solver tính lại nhiều lần).
7. **Tôn trọng các quyết định "by design" đã chốt** — KHÔNG thêm cảnh báo cho: nhận hàng vượt số đặt
   mua (chủ đích), Hàn/Sơn báo sản lượng không đối chiếu Phôi (chủ đích), đoạn cắt dư không tự vào kho
   (chủ đích). Mua hàng không gắn kho — thông báo "hàng về" gửi theo `Material.warehouseId`.
8. **Nguồn sự thật ở BE** — FE chỉ render theo `type` + dữ liệu BE trả, không dịch lại.

## 5. Kiến trúc đích — BE

### 5.1 Schema (1 migration, giữ dữ liệu cũ)

```prisma
enum NotificationCategory { ANNOUNCEMENT  ACTION_REQUIRED  RESULT  ALERT  INFO }
enum NotificationSeverity { INFO  SUCCESS  WARNING  CRITICAL }

/// 1 dòng = 1 sự kiện. Nội dung đã render sẵn (tiếng Việt) để FE chỉ việc hiện.
model Notification {
  id         String               @id @default(uuid())
  type       String               /// vd "PI_ITEM_SENT_TO_QLSX" - khoá vào NOTIFICATION_TYPES
  category   NotificationCategory
  severity   NotificationSeverity @default(INFO)
  title      String
  message    String
  entityType String?              /// "PRODUCTION_INVOICE" | "SKU" | "PURCHASE_PROPOSAL" ...
  entityId   String?
  link       Json?                /// { module, page, params } - FE map sang điều hướng
  data       Json?                /// payload thô (mã PI, lý do...) cho FE hiển thị thêm
  actorId    String?              /// người gây ra sự kiện (null = hệ thống)
  dedupeKey  String?              /// type:entityId - dùng để gộp
  audience   NotificationAudience? /// chỉ còn dùng cho ANNOUNCEMENT (giữ tương thích)
  createdBy  String?
  createdAt  DateTime             @default(now())
  updatedAt  DateTime             @updatedAt

  recipients NotificationRecipient[]
  @@index([entityType, entityId])
  @@index([dedupeKey])
}

/// Fan-out theo người nhận - thay NotificationRead. Số user chỉ vài chục nên fan-out lúc ghi rẻ,
/// đổi lại đọc/đếm chưa đọc chỉ là 1 index scan theo userId.
model NotificationRecipient {
  notificationId String
  userId         String
  createdAt      DateTime  @default(now())   /// copy để index sort theo user
  readAt         DateTime?
  resolvedAt     DateTime? /// việc đã được xử lý (bởi ai đó) - FE làm mờ + đẩy xuống
  archivedAt     DateTime? /// người dùng tự ẩn

  notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([notificationId, userId])
  @@index([userId, readAt, createdAt])
  @@map("notification_recipients")
}
```

Migration dữ liệu: mỗi `Notification` cũ → `category = ANNOUNCEMENT` (hoặc `RESULT` cho 22+ dòng cắt
sắt, nhận diện theo `createdBy IS NULL`), fan-out cho user active khớp audience; copy `readAt` từ
`notification_reads`; rồi drop `notification_reads`.

### 5.2 Danh mục loại thông báo — 1 nguồn duy nhất

`src/modules/notifications/notification-types.ts`:

```ts
export const NOTIFICATION_TYPES = {
  PI_ITEM_SENT_TO_QLSX: {
    category: 'ACTION_REQUIRED', severity: 'INFO', entityType: 'PRODUCTION_INVOICE',
    title: (p) => `${p.piCode}: ${p.count} SKU chờ QLSX duyệt`,
    message: (p) => `KHSX ${p.actorName} đã gửi duyệt.`,
    link: (p) => ({ module: 'production-plan', page: 'lenh-sx', params: { piId: p.piId } }),
    resolveWhen: 'PI item rời WAITING_QLSX',
  },
  // ...
} satisfies Record<string, NotificationTypeDef>;
```

Lợi ích: text/link/mức độ tập trung 1 chỗ, test snapshot được, FE có thể lấy icon theo `type`.

### 5.3 API nội bộ cho các service

```ts
notifications.emit(
  'PI_ITEM_SENT_TO_QLSX',
  { recipients: { roles: ['PRODUCTION_MANAGER'] }, entityId: pi.id, actorId: user.id, params },
  tx, // optional: Prisma tx của nghiệp vụ
);
notifications.resolve({ entityType: 'PRODUCTION_INVOICE', entityId, types: ['PI_ITEM_SENT_TO_QLSX'] }, tx);
```

- `RecipientResolver`: `roles[]`, `mfgRoles[]`, `warehouseIds[]` (user có `warehouseScope` khớp),
  `userIds[]`, `permissions[]` (vd ai có `PURCHASE_PROPOSAL:UPDATE`); luôn lọc `isActive && !deletedAt`
  và bỏ `actorId` (trừ khi type khai `notifyActor`). **Sếp (BOSS) chỉ nhận** (mục 9.3): type
  `ACTION_REQUIRED` cần Sếp duyệt + mọi type `severity = CRITICAL` (resolver tự thêm BOSS cho CRITICAL).
  Không cc Sếp các RESULT/INFO.
- **Giao dịch:** emit trong CÙNG `tx` với thay đổi nghiệp vụ → không bao giờ có "đã duyệt mà không báo"
  hoặc "báo mà rollback". Ngoại lệ: luồng async ngoài request (solver cắt sắt) giữ kiểu best-effort
  như `notifyProductionManagers` hiện nay (try/catch + log).
- Dedupe: nếu có `Notification` cùng `dedupeKey` chưa resolved trong 30 phút → cập nhật
  title/message/`updatedAt` + reset `readAt` của recipients, không tạo mới.
  > ⚠️ **Thực tế khác (Phase 1):** code KHÔNG có khung 30 phút — chỉ kiểm "còn recipient chưa
  > `resolvedAt`" (xem mục 11.2, gạch đầu dòng về dedupe).

### 5.4 Endpoint (người dùng)

> ⚠️ **Thực tế khác (Phase 1):** giữ gốc `/notifications` thay vì `/me/notifications`, phân trang
> offset thay vì cursor, `/me/work-queue` và `/stream` chưa làm — xem mục 11.2.

| Method | Path | Mục đích |
|---|---|---|
| GET | `/me/notifications?status=unread\|all&category=&cursor=&limit=` | list của tôi, cursor-based, mới nhất trước, `resolved` xuống cuối |
| GET | `/me/notifications/unread-count` | 1 số nguyên + `{ byCategory }` — endpoint poll rẻ |
| POST | `/me/notifications/:id/read` | đánh dấu đọc (idempotent) |
| POST | `/me/notifications/read-all` | đọc hết (tuỳ chọn `category`) |
| POST | `/me/notifications/:id/archive` | ẩn |
| GET | `/me/work-queue` | badge "việc chờ tôi" suy ra từ state (mục 6.3) |
| GET | `/me/notifications/stream` | (Phase 5) SSE — đẩy `{unreadCount, latest}` |

Admin: giữ `POST /notifications` (announcement, fan-out theo audience/role), thêm
`GET /notifications/sent` (admin thấy mọi thông báo đã phát + tỉ lệ đã đọc).
Giữ `GET /notifications` cũ 1 phiên bản để FE cũ không vỡ, rồi bỏ.

### 5.5 Vận hành

- Dọn: xoá recipient đã đọc > 90 ngày, notification không còn recipient (script/cron nhẹ — hiện chưa
  có `@nestjs/schedule`; có thể chạy khi khởi động hoặc thêm schedule).
- Test: unit cho `RecipientResolver`, `emit` (dedupe, exclude actor, tx), từng type render đúng; e2e
  cho các handoff chính (mục 7, nhóm A).

## 6. Kiến trúc đích — FE (UX từng màn)

### 6.1 Notification Center toàn cục

- Component `NotificationCenter` gắn vào **header/sidebar của MỌI `*App.tsx`** (cùng vị trí, cùng
  hành vi) + `ModuleSelector`. Thay hẳn `NotifBell` cục bộ ở `SpecSteelPage`/`SpecDetailQuotaPage`.
- Chuông + badge số chưa đọc (99+). Mở ra panel:
  - Tab: **Cần xử lý** (ACTION_REQUIRED chưa resolved) · **Tất cả** · (Sếp/Admin) **Thông báo chung**.
  - Nhóm theo thời gian: Hôm nay / Hôm qua / Trước đó; thời gian tương đối ("5 phút trước").
  - Mỗi dòng: icon theo `severity`, tiêu đề đậm nếu chưa đọc, 1–2 dòng mô tả, mã đối tượng dạng chip,
    tên người thao tác. Dòng đã resolved: mờ + nhãn "Đã xử lý bởi …".
  - Bấm dòng → mark read + điều hướng tới `link`. Nút "Đánh dấu đã đọc tất cả".
  - Chân panel: "Xem tất cả" → trang **Thông báo của tôi** (lọc theo loại, tìm kiếm, phân trang BE).
- Mobile (<900px, nhân viên xưởng dùng điện thoại): panel thành sheet full-width từ dưới lên.
- Thông báo mới `CRITICAL`/`ACTION_REQUIRED` → toast nhỏ 5s (không toast cho INFO).
- Cập nhật: poll `unread-count` 30s, dừng khi tab ẩn (`visibilitychange`), refetch khi focus lại; chỉ
  gọi list khi mở panel. (Phase 5 đổi sang SSE, giữ poll làm fallback.)
- Hook `useNotifications()` + context để badge/toast/panel dùng chung 1 nguồn, không mỗi màn tự fetch.

### 6.2 Điều hướng theo link (điều kiện tiên quyết)

App chưa có URL route. **Đã chốt (mục 9.2): điều hướng theo URL** — chuẩn của các ERP (Odoo
`/odoo/action-…/<id>`, SAP Fiori `#SemanticObject-action?id=`, NetSuite/Dynamics đều có URL cho từng
bản ghi): thông báo, email, tin nhắn Zalo, bookmark, F5, nút Back đều mở đúng bản ghi.

Cách làm không phá cấu trúc hiện tại (không chuyển sang App Router từng trang):
- Đồng bộ state ↔ query string: `/?m=production-plan&p=lenh-sx&piId=123`. `app/page.tsx` đọc `m`
  thay cho `activeModule` khởi tạo; mỗi `*App.tsx` (Admin, Boss, ProductionPlan, Sales, Mfg,
  Purchasing, InboundWarehouse) đọc `p` + params thay cho `useState<Page>` khởi tạo, và ghi lại URL
  (`router.replace` khi đổi tab trong trang, `router.push` khi mở 1 bản ghi → Back hoạt động).
- Hook dùng chung `useUrlState()` để 7 shell không mỗi nơi tự viết.
- `link` trong thông báo lưu dạng `{ module, page, params }` (BE không biết URL FE) — FE dựng URL từ
  đó, nên sau này đổi sang route thật cũng không phải migrate dữ liệu thông báo.

Nếu người dùng không có quyền module của link → mở module mặc định + toast "Bạn không có quyền xem".

### 6.3 Badge "việc chờ tôi" trên menu

`GET /me/work-queue` trả số theo key, FE gắn vào item menu tương ứng:

| Vai trò | Menu | Đếm |
|---|---|---|
| QLSX | Xử lý lệnh sản xuất | PI item `WAITING_QLSX`; đề xuất cắt sắt `DRAFT` cần duyệt tay / `FAILED` |
| Sếp | Chờ duyệt › SKU mới / Lệnh SX | SKU chờ Sếp; PI item `WAITING_BOSS` |
| KHSX | Duyệt SKU / Lệnh SX | định mức chờ review; PI item bị từ chối chưa sửa |
| Spec sắt / chi tiết | Định mức | SKU cần nhập/sửa định mức (mới hoặc bị trả về) |
| Mua hàng | Theo dõi mua hàng | đề xuất `NEW`/`QUOTING` |
| Kho (theo kho) | Nhập/Xuất/Chuyển kho | phiếu chuyển `PENDING` tới kho mình; hàng mua đang chờ nhận |
| Phôi | Xác nhận nhận sắt | steel issue `ISSUED` chưa nhận |
| KCS | KCS Phôi/Hàn/Sơn | cut bundle / batch `AWAITING_QC` |
| Sales | Đơn hàng | dòng đơn đã `DONG_GOI`/`HOAN_THANH` chưa giao |

Badge **luôn khớp dữ liệu** vì là query — đây là thứ người dùng xưởng nhìn nhiều nhất, quan trọng
hơn cả chuông.

### 6.4 Admin — Thông báo chung

Tách `Admin/NotificationsPage` thành "Thông báo chung": list **mọi** thông báo đã phát (không lọc theo
audience của admin), cột "Đã đọc x/y", chọn người nhận theo role (đa chọn, đủ 13 role) hoặc theo kho;
xem trước; bỏ config `deleteConfirm` chết. (Thu hồi/sửa: không cần ở bản đầu.)

## 7. Danh mục sự kiện theo từng luồng / từng màn

Ký hiệu nhóm ưu tiên: **A** = bàn giao chặn luồng (làm trước), **B** = bàn giao sàn xưởng,
**C** = kết quả/để biết. "Tự đóng" = resolve khi đối tượng rời trạng thái.

### 7.1 Đơn hàng & SKU / định mức

| Nhóm | Sự kiện (trigger) | Người nhận | Loại | Tự đóng khi |
|---|---|---|---|---|
| B | Sales tạo/sửa đơn có SKU chưa có định mức (`POST /sales-orders`) | KHSX | ACTION | SKU được tạo/duyệt |
| A | KHSX tạo SKU cần định mức (`POST /skus`) | Spec sắt + Spec chi tiết | ACTION | định mức được nộp |
| A | Spec nộp định mức mảnh / chi tiết (`manh-quota`, `detail-quota`) | KHSX | ACTION | KHSX review xong |
| A | KHSX trả về định mức (`…/review` reject) — kèm lý do | Spec tương ứng | ACTION (WARNING) | nộp lại |
| A | KHSX gửi Sếp (`approve-parts` + `approve-detail` đủ) | Sếp | ACTION | Sếp duyệt/từ chối |
| A | Sếp duyệt SKU (`/approve`) | KHSX, Spec, Sales tạo đơn liên quan | RESULT (SUCCESS) | — |
| A | Sếp từ chối SKU (`/reject-boss`) — kèm lý do | KHSX, Spec | RESULT (WARNING) | — |

→ Thay thế `NotifBell` giả ở 2 màn Spec.

### 7.2 Lệnh sản xuất (PI) — KHSX → QLSX → Sếp

| Nhóm | Sự kiện | Người nhận | Loại | Tự đóng |
|---|---|---|---|---|
| A | `send-to-qlsx` / `send-to-qlsx-batch` (gộp 1 thông báo/PI, "n SKU") | QLSX | ACTION | item rời `WAITING_QLSX` |
| A | `reject-by-qlsx` / batch — kèm lý do | KHSX gửi | RESULT (WARNING) | — |
| A | `send-to-boss` / batch | Sếp | ACTION | item rời `WAITING_BOSS` |
| A | Sếp `approve` / batch | KHSX, QLSX | RESULT (SUCCESS) | — |
| A | Sếp `reject` / batch — kèm lý do | KHSX, QLSX | RESULT (WARNING) | — |
| A | Tạo lệnh SX sau duyệt thất bại / `retry-production-order` lỗi | QLSX | ALERT (CRITICAL) | retry thành công |

### 7.3 Đề xuất cắt sắt (đã có — nâng cấp)

| Nhóm | Sự kiện | Người nhận | Loại |
|---|---|---|---|
| A | Tính xong + tự duyệt | QLSX | RESULT (SUCCESS) |
| A | Tính xong – cần duyệt tay (lý do) | QLSX | ACTION, tự đóng khi approve/superseded |
| A | Tự duyệt lỗi / solver lỗi | QLSX | ALERT (CRITICAL) |

Giữ đúng 4 nội dung hiện tại của `notifyProductionManagers`, chỉ đổi sang `emit()` có `entityId`,
`link` tới PO, `dedupeKey = CUTTING_PROPOSAL:{poId}` (tính lại nhiều lần không spam).

> ⚠️ **Thực tế khác:** `entityType = CUTTING_PROPOSAL`, `dedupeKey = {type}:{proposalId}` (mục
> 11.2); **không có `link`** — đã bỏ hẳn ở mục 12.6 vì mọi đích đều gây hiểu lầm.
> **2026-09-26 (mục 14):** 2 dòng "cần duyệt tay" và "tự duyệt lỗi/solver lỗi" ở bảng trên **đã bị
> xoá hẳn** (không chỉ bỏ link) - QLSX giờ chỉ còn nhận đúng 1 dòng đầu tiên ("Tính xong + tự
> duyệt"). Bảng trên giữ nguyên để thấy Ý ĐỊNH BAN ĐẦU, không phải trạng thái hiện tại.

### 7.4 Mua hàng

| Nhóm | Sự kiện | Người nhận | Loại | Tự đóng |
|---|---|---|---|---|
| A | Đề xuất mua mới (từ cắt sắt / kiểm kho / định mức cắt PI) | Mua hàng | ACTION | rời `NEW` |
| C | Đã tải file duyệt ký tay (`approval-file`) | QLSX (người phát sinh nhu cầu) | INFO | — |
| B | Hàng về — nhận từng dòng (`items/:itemId/receive`) | Kho theo `Material.warehouseId`; QLSX nếu đề xuất từ cắt sắt/PI | RESULT | — |
| C | Đề xuất đủ hàng (`PURCHASED`) | QLSX, Mua hàng | RESULT (SUCCESS) | — |

Không phát cảnh báo khi nhận vượt số đặt (chủ đích). Bước "Sếp duyệt mua" đang làm ngoài phần mềm
(quyết định 2026-08-27) → không có thông báo cho Sếp ở luồng này.

### 7.5 Kho & bàn giao sàn xưởng

| Nhóm | Sự kiện | Người nhận | Loại | Tự đóng |
|---|---|---|---|---|
| B | Kho xuất sắt cho PI (`steel-issues` tạo) | Phôi | ACTION | Phôi `receive` |
| B | Phôi xong bó cắt (`cut-bundles/:id/finish`), xong đợt (`production-batches/:id/finish`) | KCS | ACTION | KCS review |
| B | KCS đánh giá có lỗi / trả về | Tổ gửi (Phôi/Hàn/Sơn) + QLSX | RESULT (WARNING) | — |
| C | KCS đạt | QLSX | INFO (gộp theo PI/ngày) | — |
| B | Xuất vật tư / vật tư định mức / bao bì (`material-issues`, `material-yield-issues`, `packaging-issues`) | Tổ nhận | ACTION | `receive` |
| B | Phiếu chuyển kho tạo (`warehouse-transfers`) | Kho đích (theo `warehouseScope`) | ACTION | confirm/reject |
| B | Kho đích từ chối phiếu — lý do | Người tạo phiếu | RESULT (WARNING) | — |
| B | Xuất đan / nhận đan (`weaving-issues`, `weaving-receipts`) | Kho nhập đan / QLSX | ACTION/INFO | nhận |
| B | Chuyển kiểm có lỗi (`transfer-check`) | QLSX | RESULT (WARNING) | — |
| C | Đóng gói xong (`packaging`) → dòng đơn sẵn giao | Sales phụ trách đơn | RESULT (SUCCESS) | Sales `ship` |

**Không** thêm thông báo "Hàn/Sơn vượt số Phôi đã cắt" và "đoạn cắt dư chưa nhập kho" (chủ đích).

### 7.6 Để sau (Phase 5+)

Điều chỉnh tồn kho lớn (`stock/adjust`) → Sếp; tồn dưới mức tối thiểu (schema chưa có `minStock`);
đơn hàng sắp trễ hạn. (Digest cuối ngày cho Sếp: **không làm** — Sếp chỉ nhận việc cần duyệt + CRITICAL,
mục 9.3.)

## 8. Plan triển khai theo phase — _Phase 1–4 ĐÃ XONG TOÀN BỘ (mục 26.5, 27); Phase 5 chưa làm_

### Phase 0 — Chữa cháy — _BỎ (người dùng chốt 2026-09-25, mục 9.5)_

Mục tiêu: thông báo đang có không còn bị "mất" trong lúc chờ bản mới.
- FE: gắn chuông tạm dùng API cũ (`getNotifications` + `markNotificationRead`) vào `ProductionPlanApp`
  / `MfgApp` cho QLSX; badge = số `!isRead`.
- BE: `getAudiencesForUser` coi `mfgRole === 'PRODUCTION_MANAGER'` tương đương role QLSX (phòng user
  chỉ có mfgRole); whitelist `sortBy` cho notifications.
- Admin page: admin thấy mọi thông báo đã tạo.
- **Đã bỏ:** vào thẳng Phase 1. Riêng whitelist `sortBy` và coi `mfgRole = PRODUCTION_MANAGER` như
  role QLSX được gộp vào `RecipientResolver`/endpoint mới ở Phase 1.

### Phase 1 — Nền tảng BE — _ĐÃ XONG 2026-09-25, xem mục 11 cho chi tiết + sai khác so với plan_

1. ✅ Migration schema mục 5.1 + migrate dữ liệu cũ + drop `notification_reads`.
2. ✅ `notification-types.ts` (4 type nhóm cắt sắt - nhóm A còn lại là Phase 3), `RecipientResolverService`,
   `emit()`, `resolve()`, dedupe.
3. ⚠️ Endpoint theo mục 5.4 nhưng **giữ nguyên gốc `/notifications`** (không đổi sang `/me/notifications`)
   để không vỡ FE cũ + `GET /notifications/sent` cho admin - xem mục 11.2.
4. ✅ Chuyển `notifyProductionManagers` sang `emit()` (mục 7.3).
5. ✅ Test: resolver phủ qua test service (role/mfgRole/kho/userIds/exclude actor), dedupe (còn/hết
   recipient chưa resolved), CRITICAL tự thêm BOSS, quyền (404 khi không phải người nhận). Pagination
   **offset** (giữ `paginate()`/`PaginationQueryDto` chung của repo, không đổi sang cursor - mục 11.2).
- **Nghiệm thu:** `tsc --noEmit` xanh, ESLint 0 error (1 warning `no-explicit-any` cố ý, khớp mức
  `warn` toàn repo), `pnpm test` 1177/1177 pass (50 suite, kể cả 2 suite cutting-proposals sửa theo).

### Phase 2 — Notification Center FE + URL — _ĐÃ XONG 2026-09-25, xem mục 12 cho chi tiết + sai khác_

1. ✅ Điều hướng theo URL (mục 6.2): `useUrlState()` + đồng bộ `m` (module, mọi app shell qua
   `app/page.tsx`) và `p` (tab trong module) cho `ProductionPlanApp` + `MfgApp` (MfgApp thêm ở mục
   12.5.B). ⚠️ 5 app shell còn lại (Sales/Purchasing/Boss/Admin/InboundWarehouse) CHƯA đồng bộ `p`
   cho tab nội bộ - chưa cần vì chưa type thông báo nào trỏ vào đó (mục 12.4). Hiện 4 type cắt sắt
   cũng không còn `link` (mục 12.6) nên chưa thông báo thật nào dùng tới điều hướng này.
2. ✅ `useNotifications` + `NotificationCenter` (panel, 2 tab, mark read/all, toast WARNING/CRITICAL) -
   gắn vào cả 7 app shell, ở CẢ top bar thu gọn (chuông chính, luôn thấy ngay) lẫn chân sidebar
   desktop. ⚠️ Không có "nhóm theo thời gian (Hôm nay/Hôm qua)" - bỏ qua vì danh sách hiện ngắn.
3. ⚠️ Không có trang "Thông báo của tôi" riêng - panel (tối đa 50 dòng, đủ dùng ở quy mô hiện tại)
   coi như thay thế tạm; trang riêng dời qua khi cần phân trang/lọc sâu hơn (mục 12.2).
4. ✅ Gỡ `NotifBell` (xoá hẳn component) ở 2 màn Spec - CHƯA có thông báo thật thay thế (đúng như plan
   nói, phải chờ Phase 3 nhóm 7.1).
5. ✅ Viết lại `Admin/NotificationsPage` thành "Thông báo chung" dùng `GET /notifications/sent` (mục 6.4).
- **Nghiệm thu:** `tsc`/lint/test 2 repo xanh + **live-test thật** (BE+FE chạy thật, Postgres dev thật,
  browser thật) - xem mục 12.3 cho chi tiết đầy đủ, bao gồm 1 bug BE (mục 11.5, đã vá) và 1 bug logic
  FE (mục 12.2 "đã đọc ≠ đã xử lý") phát hiện qua chính live-test này, không phải qua test giả lập.

### Phase 3 — Nối sự kiện theo luồng (≈4–6 ngày, chia 3 đợt) — _ĐÃ XONG TOÀN BỘ 2026-09-28 (3a+3b+3c gộp, xem mục 26.5)_

- **3a (nhóm A) - ĐÃ XONG TOÀN BỘ 2026-09-26:** 7.1 SKU/định mức (**mục 15** - trừ 1 sự kiện hoãn,
  xem 15.5), 7.2 PI (**mục 16** - 1 recipient đổi so với plan gốc, xem 16.1), 7.4 đề xuất mua mới
  (**mục 17** - gồm cả "hàng về" `PURCHASE_PROPOSAL_ITEM_RECEIVED`, đúng nội dung 3c bên dưới). Cả 3
  nhóm đều best-effort NGOÀI tx thay vì "emit trong tx" như dòng dưới nói - lý do kỹ thuật ghi ở mục
  15.2/16.2/17.2. Mỗi transition: emit + resolve ở transition tiếp theo + test service.
- **3b (nhóm B) - ĐÃ XONG TOÀN BỘ 2026-09-28:** 7.5 kho/sàn xưởng, đủ 6/6 nhóm - Sắt→Phôi→KCS (mục
  19), xuất vật tư/bao bì (mục 22), chuyển kho (mục 23), chuyển kiểm (mục 24), đóng gói → Sales (mục
  25, đúng nội dung 3c bên dưới), xuất/nhận đan (mục 26).
- **3c (nhóm C) - hoá ra không còn việc riêng:** "hàng về" đã nằm trong 3a/mục 17
  (`PURCHASE_PROPOSAL_ITEM_RECEIVED`), "đóng gói xong → Sales" đã nằm trong 3b/mục 25
  (`PI_ITEM_PACKAGING_COMPLETE`) - làm sớm hơn dự kiến vì cùng service đã có sẵn `NotificationsService`
  lúc đó, không tách nhóm riêng nữa. "Gộp INFO theo ngày" (ý định ban đầu cho `QC_PASSED`) đã bị BỎ ở
  mục 19.1 (dedupe hiện tại chỉ gộp "còn mở", không hợp với type RESULT không ai đóng) - người dùng
  chốt mỗi lượt duyệt phát 1 thông báo riêng, đơn giản hơn.
- **Nghiệm thu:** mọi type trong mục 7 (trừ 7.6 "để sau") đã có unit test + phần lớn đã live-test
  thật qua browser (những cái chưa live-test được ghi rõ ở "còn treo" của từng mục). Không chạy 1
  vòng E2E thủ công nối hết mọi bước (Sales→...→Sales) vì mỗi nhóm đã live-test riêng lẻ đủ kỹ khi
  làm - xem mục 26.5 để biết Phase 3 đã đóng hoàn toàn.

### Phase 4 — Badge "việc chờ tôi" (≈2 ngày) — _ĐÃ XONG TOÀN BỘ 2026-09-29, xem mục 27_

`GET /me/work-queue` (query count theo vai trò, mục 6.3; 1 request/lần, có index phù hợp) + badge trên
menu mọi app; làm mới cùng nhịp poll với chuông. Bỏ các `setInterval` tự poll ở `LenhSXPage` /
`CuttingProposalsPage` nếu badge + thông báo đã thay được.

### Phase 5 — Realtime & tuỳ chọn (tuỳ nhu cầu) — _HOÃN, người dùng chốt 2026-09-29 (mục 28) - chưa thấy cần thiết_

SSE `/me/notifications/stream` (NestJS `@Sse`, không cần hạ tầng mới); cài đặt tắt/bật theo loại cho
từng user; Web Push/Zalo OA cho xưởng nếu thật sự cần (cần chốt riêng vì
là kênh bên ngoài).

**Tổng ước lượng Phase 1–4: ~13–17 ngày công** (1 dev full-stack), có thể song song BE/FE từ Phase 2.

## 9. Quyết định đã chốt với người dùng — _đã chốt 2026-09-25_

1. **Fan-out theo người nhận — ĐỒNG Ý.** Chấp nhận user tạo sau không thấy thông báo chung cũ.
2. **Điều hướng theo URL (query string)** — người dùng hỏi "theo chuẩn ERP là cái nào"; các ERP lớn
   đều cho mỗi bản ghi 1 URL để link từ thông báo/email mở đúng, nên chọn URL. Làm bằng đồng bộ
   query string trên SPA hiện có (mục 6.2), không đập lại routing.
3. **Sếp chỉ nhận việc cần Sếp duyệt + cảnh báo CRITICAL.** Bỏ cc kết quả, bỏ INFO "Sales giao hàng",
   bỏ digest cuối ngày. Badge "chờ duyệt" của Sếp giữ nguyên (mục 6.3).
4. **Gửi tất cả người cùng vai trò/kho, tự đóng khi 1 người xử lý** (khuyến nghị). Không có khái niệm
   "người phụ trách" ở bản này.
5. **Không làm Phase 0** — vào thẳng Phase 1.

## 10. Những gì CHƯA làm tại thời điểm review (trước Phase 1) — _lỗi thời, giữ làm lịch sử_

> Mục này mô tả trạng thái lúc mới review xong (chưa code). Hai gạch đầu dòng đầu **không còn đúng**:
> code đã sửa ở cả 2 repo và đã test/live-test (mục 11, 12). Gạch đầu dòng cuối (đọc kỹ từng service
> khi làm Phase 3) **vẫn còn hiệu lực**.

- ~~Đã chốt 5 quyết định (mục 9) nhưng vẫn chưa sửa code ở 2 repo; không chạy test/tsc (không có thay đổi code).~~
- ~~Chưa live-test UI để chụp hiện trạng~~ — các kết luận ở mục 2 dựa trên đọc code (grep toàn repo:
  `markNotificationRead` 0 nơi gọi, `getNotifications` chỉ 1 nơi dùng, `notification.create` chỉ ở
  cutting-proposals).
- Danh sách trigger ở mục 7 lấy theo tên endpoint trong các controller; khi làm Phase 3 cần đọc kỹ
  từng service để chốt đúng người nhận (vd ai thực sự tạo `steel-issues`, Sales nào "phụ trách" đơn).

## 11. Phase 1 — Nền tảng BE — _ĐÃ XONG 2026-09-25_

### 11.1 Đã làm (chỉ DNA-ERP-BE - FE chưa đụng, xem mục 9.5 lý do bỏ Phase 0)

- **Schema** ([schema.prisma](../prisma/schema.prisma)): thêm enum `NotificationCategory`,
  `NotificationSeverity`; `Notification` thêm `type/category/severity/entityType/entityId/link/
  data/actorId/dedupeKey/updatedAt`, `audience` chuyển thành optional (chỉ còn dùng cho
  ANNOUNCEMENT). Thay `NotificationRead` bằng `NotificationRecipient` (thêm `resolvedAt`/
  `archivedAt`). Migration tay
  [20260925000000_notification_recipients_and_types](../prisma/migrations/20260925000000_notification_recipients_and_types/migration.sql)
  (viết thủ công - máy này không có Postgres sống để chạy `prisma migrate dev`, xem mục 11.3): fan-out
  dữ liệu cũ sang `notification_recipients` theo ĐÚNG luật audience cũ (role trùng tên audience, xem
  `prisma/seed.ts`), copy `readAt`, xong mới `DROP TABLE notification_reads`. `npx prisma generate`
  chạy được (không cần DB) - client mới đã sinh đúng, `tsc` xanh dựa trên client đó.
- **`notification-types.ts`** (mới): registry cho 4 loại thông báo cắt sắt hiện có
  (`CUTTING_PROPOSAL_AUTO_APPROVED` / `_NEEDS_MANUAL_APPROVAL` / `_AUTO_APPROVE_FAILED` /
  `_CALCULATION_FAILED`) - title/message/link/recipients cho từng loại tập trung 1 chỗ như mục 5.2 mô
  tả. Các nhóm A/B/C còn lại ở mục 7 (SKU, PI, mua hàng, kho, sàn xưởng...) **chưa có type nào** - đó
  là việc của Phase 3, Phase 1 chỉ dựng hạ tầng + di dời loại đã có.
- **`recipient-resolver.service.ts`** (mới): `RecipientResolverService.resolve(criteria, excludeIds,
  tx?)` dịch `roles/mfgRoles/warehouseIds/userIds/allActiveUsers` sang danh sách userId, luôn lọc
  `isActive && !deletedAt`, luôn khử trùng lặp.
- **`notifications.service.ts`** (viết lại hoàn toàn): `emit(type, options)` - tự tính người nhận (+
  tự thêm role BOSS khi `severity=CRITICAL`, đúng quyết định mục 9.3), tự loại `actorId`, dedupe theo
  `dedupeKey` (còn recipient chưa `resolvedAt` thì update dòng cũ + đẩy lại chưa đọc + fan-out thêm
  người mới nếu có; hết thì tạo dòng mới); `resolve(criteria)` đóng hàng loạt theo
  `entityType/entityId(/types)`; `createAnnouncement()` (ANNOUNCEMENT, thay `create()` cũ);
  `findMyNotifications/unreadCount/markRead/markAllRead/archive` cho người dùng cuối;
  `findSentAnnouncements()` cho admin (mục 11.2).
- **`notifications.controller.ts`**: xem mục 11.2 cho path cụ thể + lý do khác plan.
- **`cutting-proposals.service.ts`**: `notifyProductionManagers()` đổi từ ghi thẳng
  `prisma.notification.create` sang gọi `this.notifications.emit()`; inject `NotificationsService`
  (constructor thêm tham số thứ 5); `CuttingProposalsModule` import `NotificationsModule`. Giữ NGUYÊN
  4 nội dung tiếng Việt hiện có (chỉ đổi cơ chế gửi, không đổi văn án QLSX đọc).
- **Test**: viết lại toàn bộ `notifications.service.spec.ts` (emit/resolve/createAnnouncement/
  findMyNotifications/unreadCount/markRead/markAllRead/archive); sửa 2 spec của cutting-proposals để
  mock `NotificationsService.emit` thay vì `prisma.notification.create` (9 chỗ assertion, xem diff) -
  1 test ("builds the bom[] payload...") được nới lại đúng ý gốc (chỉ kiểm entityId + poNumber, không
  khẳng định branch) vì test đó vốn không mock đủ cho nhánh auto-duyệt thành công, y hệt hành vi cũ.

### 11.2 Cố ý khác plan (mục 5.4/8) - vì sao

- **Giữ nguyên gốc tài nguyên `/notifications` thay vì `/me/notifications`.** Phase 1 chỉ đổi BE,
  chưa đụng FE - nếu đổi path, `Admin/NotificationsPage`
  ([notifications-api.ts](../../DNA-ERP/src/services/notifications-api.ts)) vỡ ngay lập tức dù
  không có PR nào phía FE. Route cuối: `GET/POST /notifications` (list/tạo, nay là "của tôi" thay vì
  lọc audience), `GET /notifications/sent` (admin xem đã gửi, mới), `GET /notifications/unread-count`
  (mới), `POST /notifications/read-all` (mới), `POST /notifications/:id/read` (path cũ, service mới),
  `POST /notifications/:id/archive` (mới). Khớp tinh thần plan mục 5.4 "giữ 1 phiên bản cũ", chỉ khác
  tên đường dẫn. Codebase cũng chưa có tiền lệ `/me/<resource>` (chỉ có `GET /auth/me` là 1 bản ghi
  đơn, không phải danh sách) nên giữ style REST hiện có nhất quán hơn.
- **Pagination offset, không phải cursor.** Mọi module khác trong repo dùng chung
  `paginate()`/`PaginationQueryDto` (skip/take). Đổi riêng notifications sang cursor sẽ là 1 kiểu
  phân trang lạc loài duy nhất trong codebase - không đáng cho lợi ích nhỏ ở quy mô dữ liệu hiện tại.
- **`sortBy` của `ListNotificationsQueryDto` bị bỏ qua hoàn toàn** (luôn sort theo `createdAt desc`) -
  vá đúng lỗ hổng nêu ở mục 2.1 (P8: sortBy tuỳ ý gây lỗi Prisma 500) cho riêng endpoint này, không
  sửa `PaginationQueryDto` dùng chung (30+ module khác dùng, ngoài phạm vi Phase 1).
- **`entityType` cho 4 thông báo cắt sắt là `CUTTING_PROPOSAL` (theo `proposalId`), không phải
  `PRODUCTION_ORDER`/`PRODUCTION_INVOICE`.** `runSolverAndSave()` không có sẵn `productionOrderId`
  trong scope (chỉ có `proposalId` + `job.label` đã render thành `poNumber`) - thêm 1 query chỉ để
  đổi entityId không đáng trong luồng best-effort này. Hệ quả: `dedupeKey` (`{type}:{proposalId}`)
  chỉ gộp các lần retry TRÊN CÙNG 1 `CuttingProposal`, KHÔNG gộp qua các lần "Tính lại" (mỗi lần tạo
  `CuttingProposal` mới, xem `CuttingProposalStatus.SUPERSEDED`) - chấp nhận được vì mỗi phương án
  mới là 1 quyết định đáng có thông báo riêng, không phải spam.
- **`resolve()` có đủ code + test nhưng CHƯA được gọi ở đâu cả** (kể cả trong cutting-proposals) -
  đúng phạm vi Phase 1 (hạ tầng), việc gọi nó ở từng transition nghiệp vụ (SKU duyệt, PI gửi/duyệt,
  nhận hàng...) là Phase 3. **Cập nhật 2026-09-26 (mục 14):** loại `ACTION_REQUIRED` duy nhất từng
  cần `resolve()` bên cắt sắt (`CUTTING_PROPOSAL_NEEDS_MANUAL_APPROVAL`) đã bị xoá hẳn - hiện KHÔNG
  còn type cắt sắt nào cần `resolve()` nữa (type còn lại là `RESULT`, tự "xong" ngay khi tạo).
- **Dedupe KHÔNG có khung 30 phút như mục 5.3** _(bổ sung khi rà soát 2026-09-26, mục 13)_: `emit()`
  ([notifications.service.ts](../src/modules/notifications/notifications.service.ts)) gộp vào dòng
  mới nhất cùng `dedupeKey` miễn là **còn ít nhất 1 recipient chưa `resolvedAt`**, không xét thời gian.
  Với type cắt sắt hiện tại không sao (key theo `proposalId`, mỗi phương án mới là key mới).
  **Rủi ro cho Phase 3:** type `RESULT`/`INFO`/`ALERT` không bao giờ được `resolve()` → nếu gắn
  `dedupeKey` cho các type đó, mọi lần phát sau sẽ gộp mãi vào dòng cũ. Khi làm Phase 3: chỉ dùng
  `dedupeKey` cho type `ACTION_REQUIRED` (có resolve), hoặc bổ sung khung thời gian vào điều kiện gộp.
- **`GET /notifications/sent`**: yêu cầu `NOTIFICATION:CREATE` (ai tạo được thông báo mới xem "đã
  gửi"), không phải quyền riêng - không có role nào cần thêm quyền mới ở Phase 1.

### 11.3 Kết quả kiểm tra — _cập nhật 2026-09-25 (đợt live-test Phase 2, xem mục 12.3)_

- `npx tsc --noEmit -p tsconfig.json`: 0 lỗi.
- `npx eslint` trên toàn bộ file đã sửa/thêm: 0 error, 1 warning (`@typescript-eslint/no-explicit-any`
  ở `NOTIFICATION_TYPES: Record<string, NotificationTypeDef<any>>` - cố ý, rule này là `warn` toàn
  repo theo `eslint.config.mjs`, không phải error).
- `npx jest` (toàn repo): **1179/1179 test pass, 50/50 suite pass** (thêm 2 test cho filter `resolved`
  - mục 12.2 - so với 1177 lúc viết mục này lần đầu).
- ~~KHÔNG chạy được prisma migrate dev...~~ **Đã chạy thật** - Docker Desktop khởi động được ở đợt
  live-test Phase 2 (container `dna-erp-be-postgres-1` vốn có sẵn, chỉ do daemon chưa bật), áp cả 2
  migration (`...000000` + `...010000`, mục 11.5) bằng `prisma migrate deploy` lên `dna_erp` thật, xác
  nhận đúng số dòng fan-out (21 notification × 1 QLSX active = 21 `notification_recipients`) và bắt
  được lỗi audience-chưa-null nhờ vậy (mục 11.5). Trạng thái DB sau live-test đã được dọn về y hệt
  trước khi test (mục 12.3).

### 11.4 Còn treo (Phase 2+, chưa làm) — _cập nhật: Phase 2 đã làm, xem mục 12_

~~Mọi phần FE...~~ **Đã làm ở Phase 2 (mục 12).** Còn treo thật sự: toàn bộ nối sự kiện theo luồng ở
mục 7 (trừ cắt sắt) và badge "việc chờ tôi" - xem mục 8 Phase 3-5.

### 11.5 Migration vá `20260925010000_null_audience_for_non_announcement` (phát hiện lúc live-test Phase 2)

- **Lỗi:** backfill trong migration `20260925000000` chỉ đổi `category` sang `RESULT` cho 21 dòng do
  cutting-proposals tự phát (`createdBy IS NULL`) nhưng **quên null luôn `audience` cũ**
  (`PRODUCTION_MANAGER`) - vi phạm bất biến tự đặt "`audience` chỉ có giá trị khi
  `category = ANNOUNCEMENT`" (doc comment `Notification.audience` trong `schema.prisma`).
- **Phát hiện:** khi `prisma migrate deploy` lên DB dev thật và soi dữ liệu (mục 11.3), không phải
  qua unit test.
- **Sửa:** migration mới
  [20260925010000_null_audience_for_non_announcement](../prisma/migrations/20260925010000_null_audience_for_non_announcement/migration.sql)
  - 1 câu `UPDATE "notifications" SET "audience" = NULL WHERE "category" != 'ANNOUNCEMENT'`. Cố ý
  KHÔNG sửa migration cũ đã apply (đổi checksum migration đã chạy là thực hành xấu).
- **Lưu ý:** 21 dòng này sau đó còn được phân loại lại đúng `type/category/severity` bởi migration
  `20260925020000` (mục 12.5.A) - trạng thái `category = RESULT` ở trên chỉ là trung gian.

## 12. Phase 2 — Notification Center FE + URL — _ĐÃ XONG 2026-09-25_

Repo: `D:\DNA-ERP` (FE). Toàn bộ mục này làm và kiểm trong CÙNG 1 phiên với Phase 1 (mục 11), theo
yêu cầu người dùng "làm tới đâu test kỹ tới đó kể cả BE và FE" - vì vậy có Docker/DB thật/browser thật
tham gia kiểm thử, không chỉ unit test giả lập.

### 12.1 Đã làm

- **`hooks/useUrlState.ts`** (mới): `useUrlState(key)` đọc/ghi 1 query param qua
  `useSearchParams`/`useRouter` (`router.replace`, không đẻ thêm history entry mỗi lần đổi tab).
- **`app/page.tsx`**: `activeModule` đồng bộ 2 chiều với `?m=` - bấm thông báo ở bất kỳ đâu trong cây
  gọi `router.push('/?m=...')`, 1 effect ở đây bắt thay đổi và chuyển module (có gác quyền: user
  không phải director chỉ được nhận `urlModule` đúng bằng module họ vốn có). `MainERP` phải bọc
  `<Suspense>` (yêu cầu của `useSearchParams` trong Next App Router) - tách `Page()` (kiểm auth, giữ
  nguyên) khỏi `MainERP()` (dùng URL) qua 1 Suspense boundary mới.
- **`modules/pages/ProductionPlan/ProductionPlanApp.tsx`**: `activePage` đồng bộ 2 chiều với `?p=`
  (dùng lại `useUrlState`) - app DUY NHẤT làm việc này ở Phase 2 vì là nơi duy nhất có thông báo thật
  trỏ tới (đề xuất cắt sắt). 6 app còn lại chưa cần.
- **`services/notifications-api.ts`** (viết lại): `getNotifications()` giờ nhận
  `{status, resolved, category, page, limit}` và trả `PaginatedResult<Notification>` (trước đây trả
  thẳng mảng) - cùng `getUnreadCount/markAllNotificationsRead/archiveNotification/getSentAnnouncements`
  mới, `markNotificationRead` giờ trả về `Notification` (trước trả `void`). `types/admin.ts` mở rộng
  `Notification` (category/severity/type/entityType/entityId/link/isResolved) + `Announcement` mới.
- **`hooks/useNotifications.ts`** (mới): poll `unread-count` mỗi 30s (dừng khi tab ẩn, resume +
  refetch khi quay lại), chỉ tải thêm vài dòng mới nhất để dựng toast khi tổng tăng (không tải danh
  sách đầy mỗi 30s), danh sách panel chỉ tải khi mở.
- **`components/NotificationCenter.tsx`** (mới, thay `NotifBell.tsx`): chuông + panel (2 tab, mark
  read/all, toast WARNING/CRITICAL 6s tự tắt) - nhận `size`/`color` để dùng được ở cả top bar thu gọn
  (rõ, cỡ 20, theo màu chữ) lẫn chân sidebar desktop (mờ hơn, cỡ 16, `var(--text3)`, đồng bộ icon
  Đăng xuất cạnh nó).
- Gắn `NotificationCenter` vào cả 7 app shell: **top bar thu gọn** (Sales/Purchasing/Boss/Mfg/
  ProductionPlan - vị trí CHÍNH, luôn thấy ngay không cần mở gì, xem mục 12.2 lý do) + **chân
  sidebar desktop** (cả 7, kể cả Admin/InboundWarehouse - 2 app này không có chế độ thu gọn nên chân
  sidebar là vị trí duy nhất).
- **`modules/pages/Admin/NotificationsPage.tsx`** (viết lại hoàn toàn, bỏ `AdminEntityPage`): "Thông
  báo chung" dùng `GET /notifications/sent` (thấy MỌI thông báo đã phát + tỉ lệ đọc, không phải chỉ
  của admin) + modal tạo mới, không còn nút Sửa/Xóa (BE vẫn không hỗ trợ).
- Gỡ `components/NotifBell.tsx` (xoá file) + 2 chỗ dùng nó (`SpecSteelPage.tsx`,
  `SpecDetailQuotaPage.tsx`) - cập nhật luôn 1 comment còn trỏ tới file đã xoá (`PrintExportButton.tsx`).
- Test mới: `services/notifications-api.test.ts` (13 case, mapping Be↔Fe + query string).

### 12.2 Phát hiện + sửa TRONG LÚC live-test (không phải lỗi lý thuyết)

Đây là phần đáng chú ý nhất của đợt Phase 2 - cả 3 điều dưới đây **chỉ lộ ra khi chạy BE+FE+DB thật
và bấm thử bằng browser**, unit test (mock) không thể bắt được:

1. **Vị trí chuông sai chỗ khó thấy** (phản hồi trực tiếp của người dùng khi xem browser thật): thiết
   kế ban đầu chỉ đặt `NotificationCenter` ở chân sidebar - nhưng ở màn hẹp (<900px, đúng nhóm người
   dùng xưởng plan nhắm tới), sidebar nằm TRONG drawer đóng, phải bấm ☰ mới thấy chuông. **Sửa:**
   thêm 1 bản chuông NGAY TRONG top bar thu gọn (luôn hiện, cạnh tiêu đề, cỡ to hơn/rõ hơn) - xem
   mục 12.1. `NotificationCenter` nhận thêm prop `size`/`color` để dùng được ở cả 2 chỗ.
2. **Panel bật sai hướng** (phản hồi tiếp theo, sau khi chuông đã lên top bar): panel compact vẫn code
   theo kiểu "bottom sheet" (trồi từ đáy màn hình) - sai hẳn với vị trí chuông giờ đã ở góc phải trên.
   **Sửa:** panel giờ định vị theo ĐÚNG chỗ chuông đang nằm - xổ xuống bên phải (top bar, compact) hay
   xổ lên bên trái (chân sidebar, desktop); bỏ hẳn `document`-mousedown-listener cũ, thay bằng 1
   backdrop trong suốt/mờ dùng chung cho cả 2 layout để bấm ra ngoài là đóng.
3. **Lẫn "đã đọc" với "đã xử lý xong"** (phản hồi "số trên chuông biến mất khi nào, senior sẽ làm
   sao" - tự phát hiện lại lỗi lúc trả lời): tab "Cần xử lý" ban đầu lọc theo `status=unread` - nghĩa
   là bấm ĐỌC 1 thông báo cần duyệt làm nó BIẾN MẤT khỏi hàng đợi dù việc thật (duyệt đề xuất) chưa hề
   xong. Chuẩn đúng: badge/chuông = số CHƯA ĐỌC (như Gmail/Slack - chỉ giảm khi đọc từng cái hoặc bấm
   "Đọc tất cả"), nhưng NỘI DUNG tab "Cần xử lý" phải lọc theo CHƯA XỬ LÝ XONG (`resolvedAt IS NULL`),
   không phải chưa đọc - 1 việc đã đọc nhưng chưa làm vẫn phải nằm trong hàng đợi (chỉ hết in đậm).
   **Sửa cả 2 phía:**
   - BE: `ListNotificationsQueryDto` thêm `resolved?: 'true'|'false'` (khác hẳn `status`),
     `findMyNotifications()` lọc theo `resolvedAt` khi có; +2 test service.
   - FE: `getNotifications()` truyền thêm `resolved`; `useNotifications.loadList()` tab 'action' đổi
     từ `{status:'unread', category:'ACTION_REQUIRED'}` sang `{resolved:'false', category:'ACTION_REQUIRED'}`;
     +1 test API.
   - Xác nhận lại bằng browser thật: 1 thông báo test đã bấm đọc (readAt có giá trị,
     resolvedAt vẫn null) VẪN hiện trong tab "Cần xử lý" sau khi vá - trước khi vá thì biến mất.

### 12.3 Kết quả kiểm tra

- `tsc --noEmit` (FE): 0 lỗi. `eslint` (mọi file sửa/thêm): 0 error - 3 warning
  `react-hooks/set-state-in-effect` ở `app/page.tsx`/`ProductionPlanApp.tsx`, xác nhận qua
  `git stash` là warning NÀY ĐÃ CÓ SẴN trong code gốc (cùng pattern "guard rồi setState trong effect"
  y hệt), không phải lỗi mới - giữ nguyên theo đúng convention hiện có của repo, không tự ý đổi cách
  viết khác đi.
- `vitest run` (FE): 52/52 pass (13 test mới `notifications-api.test.ts`).
- **Live-test thật** (không phải mô tả suông): bật Docker Desktop (daemon trước đó tắt) → phát hiện
  container Postgres dev (`dna-erp-be-postgres-1`, cổng 5432, đúng khớp `.env`) đã có sẵn dữ liệu thật
  (21 thông báo cắt sắt cũ, 18 user active) → `prisma migrate deploy` cả 2 migration Phase 1 lên DB đó
  → chạy `nest start --watch` (BE thật, cổng 3001) + `next dev` (FE thật, cổng 3000) → dùng
  `mcp__Claude_Browser__*` (browser thật, không phải giả lập) đăng nhập lần lượt `qlsx` (QLSX thật,
  role PRODUCTION_MANAGER), `boss` (director, nhiều module), `dms` (SPEC_STEEL, kiểm màn đã gỡ
  NotifBell):
  - Badge/panel/toast hiển thị ĐÚNG số liệu thật từ DB qua mọi bước (unread-count giảm đúng sau khi
    đọc/đọc-tất-cả, tăng đúng khi tạo announcement mới).
  - Chèn tay 1 dòng notification có `link` (giả lập những gì `emit()` sẽ tạo khi Phase 3 nối sự kiện
    khác - CHƯA thử được `emit()` thật vì cần dựng cả luồng solver cắt sắt đầy đủ, ngoài phạm vi hợp
    lý của phiên này) → xác nhận bấm 1 dòng thông báo ở module Boss → mark-read (kiểm lại bằng
    `psql` trực tiếp) → điều hướng đúng sang `production_plan`/`lenh-sx` → URL cập nhật
    `?m=production_plan&p=lenh-sx` → F5 vẫn giữ đúng màn đó (đúng mục tiêu mục 6.2).
    > ⚠️ Chỉ chứng minh CƠ CHẾ điều hướng URL chạy đúng. Đích `production_plan` là SAI với người nhận
    > thật (QLSX) - lộ ra ở mục 12.5.B vì lần này test bằng `boss` (director, được vượt rào đổi
    > module); sau đó `link` của 4 type cắt sắt bị bỏ hẳn (mục 12.6).
  - Kiểm quyền qua API thật: user khác (không phải người nhận) nhận 404 khi cố đọc thông báo không
    phải của mình; không có `NOTIFICATION:CREATE` bị chặn 403 ở `/notifications/sent` và tạo
    announcement.
  - Sau khi xong, dọn sạch dữ liệu test đã chèn (`DELETE`) và khôi phục lại đúng trạng thái
    `readAt` ban đầu của 21 thông báo cũ (`UPDATE ... SET "readAt" = NULL`) - DB dev không bị để lại
    rác/lệch trạng thái so với trước khi bắt đầu phiên làm việc.

### 12.4 Cố ý chưa làm / hạn chế đã biết

- **Trang "Thông báo của tôi" riêng:** chưa có - panel (tối đa 50 dòng/lượt) tạm đủ ở quy mô dữ liệu
  hiện tại. Cần làm khi số lượng thông báo/người đủ lớn để cần phân trang thật.
- ~~**`?p=` mới đồng bộ URL cho `ProductionPlanApp` + `MfgApp`**...~~ **ĐÃ LÀM NỐT CHO CẢ 7/7 APP
  SHELL** (Boss/MfgApp ở 12.5.B, Purchasing/InboundWarehouse ở 17.3, Admin/Sales ở mục 20.3/20.4).
- ~~**Double-poll nhẹ khi drawer mobile bị bỏ mở**...~~ **ĐÃ SỬA, xem mục 20.1** (chuyển
  `useNotifications()` sang 1 `NotificationsProvider`/context dùng chung).
- **`emit()` thật của luồng cắt sắt chưa được live-test end-to-end** (chỉ test qua unit test + dữ liệu
  lịch sử đã migrate) - dựng lại toàn bộ luồng solver (PO/PI/BOM/định mức) chỉ để bắn 1 thông báo mới
  không cân xứng trong phiên này; link/entityId dùng để test điều hướng (mục 12.3) được chèn tay,
  MÔ PHỎNG đúng shape `emit()` sẽ tạo ra chứ không phải `emit()` thật chạy.

### 12.5 Sửa tiếp sau phản hồi người dùng (cùng ngày 2026-09-25)

Sau khi báo "xong", người dùng test tiếp và phát hiện thêm 2 việc:

**A. Data lỗi: 21 thông báo cắt sắt cũ đều bị gắn chung `category=RESULT/severity=INFO/type=NULL`**
(hệ quả của backfill trong migration `20260925000000`, vốn gán chung `RESULT` cho mọi dòng
`createdBy IS NULL` đúng như plan mục 5.1 - trước đó được coi ngầm là chấp nhận được nhưng chưa từng
ghi thành hạn chế ở mục 11; người dùng chỉ ra đây thực sự là data SAI cần sửa). 4 biến thể tạo ra 4 MẪU TIÊU ĐỀ cố định, đủ để suy ngược đúng loại -
migration mới
[20260925020000_reclassify_legacy_cutting_proposal_notifications](../prisma/migrations/20260925020000_reclassify_legacy_cutting_proposal_notifications/migration.sql)
khớp tiêu đề → gán lại đúng `type/category/severity/entityType` cho cả 21 dòng (10 SUCCESS, 7
CRITICAL, 4 WARNING - xác nhận bằng SQL + API thật + browser thật, QLSX giờ thấy đúng "Cần xử lý (4)"
thay vì 0). **Cố ý KHÔNG** suy lại `entityId` (proposalId gốc không lưu, không khôi phục được) và
**KHÔNG** fan-out thêm BOSS cho 7 dòng giờ thành CRITICAL (tránh Sếp bỗng thấy hàng loạt "cảnh báo
mới" cho việc đã xảy ra từ lâu).

**B. Bug thật: link thông báo cắt sắt trỏ SAI module cho chính người nhận (QLSX)** - người dùng hỏi
"click vào thông báo sao không nhảy trực tiếp vào" dẫn tới phát hiện: `notification-types.ts` gắn
`module: 'production_plan'` (ProductionPlanApp = KHSX), nhưng QLSX (`mfgRole` có giá trị) theo
`resolveDefaultModule.ts` luôn thuộc module `production` (MfgApp) - `mfgRole` khớp TRƯỚC
`isProductPlanner` trong danh sách strategy. Vì QLSX không phải Giám đốc (không được vượt rào an
toàn "chỉ director đổi module tuỳ ý" ở `app/page.tsx`), bấm vào thông báo **không nhảy đi đâu cả**.
Lộ ra vì trước đó chỉ live-test luồng điều hướng bằng tài khoản `boss` (director, bypass rào an
toàn) - CHƯA từng thử bằng chính `qlsx`, người nhận thật của loại thông báo này.

> ⚠️ **Phần "đổi `module: 'production'`" dưới đây đã bị THAY THẾ bởi mục 12.6** (bỏ hẳn `link`
> của 4 type cắt sắt). Phần đồng bộ `?p=` cho `MfgApp.tsx` vẫn giữ nguyên.

Sửa: đổi `module: 'production'`; thêm đồng bộ `?p=` cho `MfgApp.tsx` (trước đó chỉ có
`ProductionPlanApp.tsx`, xem mục 12.4 - giờ làm nốt cho app còn thiếu vì đã lộ ra nhu cầu thật). Xác
nhận lại bằng qlsx thật: bấm thông báo → `Sản xuất MES · Xử lý lệnh sản xuất` mở đúng, URL
`?m=production&p=lenh-sx`, F5 giữ nguyên.

**Giới hạn còn lại (không phải bug, là tính năng chưa có):** đọc kỹ
`services/cutting-proposals-api.ts` (FE) thì thấy tự ghi rõ "Chưa có màn hình nghiệp vụ riêng nào
dùng module này (Phôi/QLSX chưa có UI)... Duyệt phương án cắt vẫn chỉ làm qua API, chưa có UI" - tức
là ngay cả sau khi điều hướng ĐÚNG module/tab, QLSX cũng chưa có nút "Duyệt"/"Từ chối" nào cho riêng
1 CuttingProposal để mà "nhảy thẳng vào" xa hơn tab danh sách chung - màn đó chưa từng được xây (gap
sản phẩm có từ trước, không phải do việc làm thông báo gây ra). Xây màn đó là việc RIÊNG, lớn hơn hẳn
phạm vi "hoàn thiện Phase 2 thông báo" - đã hỏi ý người dùng, **đang chờ quyết định** có làm tiếp hay
không.

- Kiểm tra sau đợt sửa này: `tsc`/`eslint` 2 repo xanh (0 error), `jest` BE 1179/1179,
  `vitest` FE 52/52, live-test lại bằng browser thật với `qlsx` xác nhận cả 2 điểm A/B đã đúng, dọn
  sạch dữ liệu test (`DELETE`/`UPDATE ... readAt = NULL`) về lại trạng thái trước khi test.

### 12.6 Bỏ hẳn `link` của 4 type cắt sắt (cùng ngày, phát hiện sâu hơn mục 12.5.B)

Người dùng hỏi tiếp "solve fail thì sao lại hiện thông báo bên màn QLSX làm gì" - buộc đọc lại kỹ
`CuttingProposalsController.requestProposal()`: **"lần tính đầu tiên tự động chạy ngầm KHI SẾP DUYỆT
PI ITEM"**. Nghĩa là bất kể cắt sắt tính thành công hay thất bại, PO/PI trong thông báo đó **LUÔN đã
rời khỏi** hàng đợi "Xử lý lệnh sản xuất" (lọc theo status WAITING_QLSX) **từ trước khi** cutting-
proposal tồn tại - không phải riêng ca "thất bại" mới sai như câu hỏi đầu tiên nêu, mà **cả 4 loại**
(kể cả tự-duyệt-thành-công) đều trỏ tới 1 màn không hề liên quan tới đối tượng trong thông báo.
Cộng thêm việc đã biết (mục 12.5.B) là màn đó dù đúng cũng chưa có nút Duyệt/Từ chối cho riêng 1
CuttingProposal - kết luận: **trỏ đi bất cứ đâu ở đây đều gây hiểu lầm hơn là không trỏ**.

Sửa: bỏ hẳn `link` khỏi 4 type trong `notification-types.ts` (xoá hàm `cuttingProposalLink`) - giữ
nguyên `proposalId` trong `data` (không phải `link`) để dùng khi FE có màn chi tiết CuttingProposal
thật. `NotificationsService.emit()`/`NotificationCenter.tsx` đã sẵn sàng cho `link: null` từ đầu
(`def.link` là optional, FE guard bằng `n.link?.module`) nên không cần sửa gì thêm ở 2 chỗ đó.

Xác nhận: `tsc`/`jest` (1179/1179) BE xanh; live-test bằng browser thật với `qlsx` - chèn 1 thông báo
`link: null`, bấm vào → đánh dấu đã đọc (xác nhận qua `psql`), URL **không đổi** (trước đây sẽ nhảy
sai module) - đúng ý "thà không có link còn hơn có link sai". Dọn dữ liệu test, khôi phục lại trạng
thái ban đầu.

**Còn treo:** vẫn chưa có màn "chi tiết 1 CuttingProposal" ở FE để link tới (mục 12.5, đã hỏi ý người
dùng có xây tiếp hay không - chưa có câu trả lời tại thời điểm ghi mục này).

## 13. Rà soát nhất quán tài liệu — _2026-09-26_

Người dùng yêu cầu review chính file này (chấm 7.5/10: nội dung/bằng chứng tốt, nhưng nhiều chỗ
trạng thái cũ mâu thuẫn với trạng thái mới - trái quy ước CLAUDE.md "không để hai chỗ nói hai điều
khác nhau"). Chỉ sửa tài liệu, không đụng code.

**Đã sửa:**
- Dòng trạng thái đầu file: thêm 12.5/12.6, việc đang chờ quyết định (màn chi tiết CuttingProposal),
  và cách đọc (mục 2–7 là thiết kế trước khi code; 11.2/12.x là nguồn đúng khi lệch).
- Mục lục + tiêu đề mục 8: "_chưa bắt đầu_" → "Phase 1, 2 ĐÃ XONG; Phase 3–5 chưa làm". Mục 10 đánh
  dấu lỗi thời, gạch 2 ý đã sai, giữ ý còn hiệu lực.
- Ghi chú "Thực tế khác" ngay trong mục 5.3 (dedupe), 5.4 (endpoint), 7.3 (entityType/link) trỏ sang
  mục 11.2 / 12.6.
- Đồng bộ `?p=`: Phase 2 bước 1 và mục 12.4 trước ghi "chỉ ProductionPlanApp" → sửa thành
  ProductionPlanApp + MfgApp (MfgApp thêm ở 12.5.B).
- 12.3: ghi chú live-test điều hướng bằng `boss` chỉ chứng minh cơ chế, đích đã sai/đã bỏ.
  12.5.B: ghi chú phần đổi `module: 'production'` đã bị 12.6 thay thế.
- Tham chiếu gãy: migration `20260925010000` trước không được mô tả ở đâu (dòng tham chiếu trỏ "mục
  12.1"/"mục 11" nhưng hai nơi đó không có) → thêm **mục 11.5** mô tả đầy đủ, sửa các tham chiếu trỏ
  về 11.5. Câu "hạn chế đã ghi nhận trước ở mục 11.1" ở 12.5.A là sai (11.1 chưa từng ghi) → viết lại
  cho đúng.
- **Phát hiện khi đối chiếu code:** dedupe trong `emit()` không có khung 30 phút như plan 5.3 → ghi
  vào mục 11.2 kèm rủi ro cho Phase 3 (type không bao giờ resolve + có `dedupeKey` sẽ gộp mãi vào 1
  dòng) và cách tránh.

**Cố ý KHÔNG sửa:** comment trong `migration.sql` của `20260925010000` vẫn trỏ "mục 11 phần kiểm thử
Phase 2" (nay nên là 11.5) - sửa file migration đã apply làm đổi checksum, `prisma migrate` sẽ báo
lệch trên DB đã chạy. Chấp nhận lệch tham chiếu nhỏ này.

**Kiểm tra:** không có thay đổi code → không chạy tsc/test. Đã đọc lại các chỗ sửa và grep các tham
chiếu "mục 11.5"/"12.1" cho khớp.

**Còn treo:** không đổi so với trước - Phase 3–5, và quyết định màn chi tiết CuttingProposal.

## 14. Bỏ hẳn thông báo QLSX cho 3 nhánh "không thành công" của cắt sắt — _2026-09-26, người dùng chốt_

Người dùng xem lại mục 12.6 (đã bỏ `link` cho 4 type cắt sắt) và quyết định đi xa hơn: **quay lại
flow cũ trước khi có notification** — chỉ báo QLSX khi solver tính xong VÀ tự duyệt thành công.
Không còn báo gì khi bị chặn tự duyệt, khi auto-duyệt lỗi, hay khi solver lỗi/timeout — kể cả các ca
CRITICAL. Đã hỏi lại và người dùng xác nhận muốn bỏ CẢ 3 nhánh (không giữ lại cảnh báo CRITICAL cho
2 lỗi kỹ thuật thật).

**Vì sao:** cả 3 nhánh đó luôn ngụ ý "còn việc QLSX phải làm" nhưng KHÔNG có màn nào cho QLSX làm -
đúng gap đã nêu ở mục 12.6 ("chưa có UI duyệt/từ chối cho 1 CuttingProposal"). Thông báo không dẫn
tới hành động nào bị coi là nhiễu hơn là hữu ích ở giai đoạn hiện tại.

**Đã làm** (chỉ DNA-ERP-BE):
- [notification-types.ts](../src/modules/notifications/notification-types.ts): xoá hẳn 3 entry
  `CUTTING_PROPOSAL_NEEDS_MANUAL_APPROVAL` / `_AUTO_APPROVE_FAILED` / `_CALCULATION_FAILED` khỏi
  registry - chỉ còn `CUTTING_PROPOSAL_AUTO_APPROVED`. Rút gọn `CuttingProposalNotificationParams`
  (bỏ `blockReason`/`errorMessage`, không type nào còn dùng).
- [cutting-proposals.service.ts](../src/modules/cutting-proposals/cutting-proposals.service.ts):
  `runSolverAndSave()` chỉ còn gọi `notifyProductionManagers()` ở nhánh `autoApproved`; nhánh
  `blockReason` và nhánh `catch` (solver lỗi) chỉ còn `logger.warn`/`logger.error`/`saveFailure()`
  như cũ, không emit nữa. Xoá biến `approveError` không còn dùng tới (viết lại log lỗi tại chỗ throw
  thay vì lưu ra biến ngoài).
- Test: sửa 6 test trong `cutting-proposals.service.spec.ts` (2 test đổi tiêu đề + assertion sang
  "KHÔNG báo QLSX", 3 test khác chỉ còn `expect(notificationsService.emit).not.toHaveBeenCalled()`,
  1 test đổi sang `jest.spyOn(Logger.prototype, 'warn')` vì nội dung lý do chặn giờ CHỈ còn nằm ở
  log, không còn ở notification để `renderEmitCall()` đọc lại được).
  `notifications.service.spec.ts`: 3 type cắt sắt bị xoá từng được dùng làm FIXTURE cho test cơ chế
  chung (CRITICAL tự thêm BOSS, dedupe, resolve theo type) - đăng ký 2 type GIẢ
  (`TEST_ACTION_REQUIRED_TYPE`, `TEST_CRITICAL_ALERT_TYPE`) trực tiếp vào `NOTIFICATION_TYPES` trong
  `beforeAll`/`afterAll` của file test, tách hẳn test hạ tầng khỏi type nghiệp vụ thật - business đổi
  type cắt sắt sau này (Phase 3+) sẽ không làm vỡ nhóm test này nữa.

**Kết quả kiểm tra:**
- `npx tsc --noEmit`: 0 lỗi ở mọi file đã sửa (3 lỗi `imageUrl`/`PlanForm` trong `skus.service.ts`
  là CÓ SẴN từ trước, xác nhận bằng `git stash` - không liên quan tới thay đổi này).
- `npx eslint` trên 4 file đã sửa: 0 error, 1 warning `no-explicit-any` (y hệt warning cố ý có sẵn ở
  `NOTIFICATION_TYPES`, không phải warning mới).
- `npx jest` toàn repo: 1131/1131 pass ở mọi suite liên quan (49/50 suite pass); suite
  `skus.service.spec.ts` fail vì cùng lỗi biên dịch `imageUrl`/`PlanForm` có sẵn từ trước, xác nhận
  bằng `git stash` (fail y hệt kể cả không có thay đổi này) - KHÔNG phải do thay đổi trong mục này.
- Không có FE nào bị ảnh hưởng: các link/module của 4 type này đã bị bỏ từ mục 12.6, FE không đọc gì
  từ 3 type vừa xoá ngoài title/message hiển thị chung (không có logic đặc thù theo type ở FE).

**Còn treo:** không có gì mới ngoài các mục đã ghi (Phase 3-5, quyết định màn chi tiết
CuttingProposal ở mục 12.5/12.6 - vẫn đang chờ, và giờ càng bớt cấp thiết vì QLSX không còn thấy
thông báo "cần duyệt tay" nữa).

**Dữ liệu lịch sử:** 21 dòng notification cắt sắt cũ đã phân loại lại ở mục 12.5.A (gồm cả
`NEEDS_MANUAL_APPROVAL`/`AUTO_APPROVE_FAILED`/`CALCULATION_FAILED`) KHÔNG bị xoá hay đổi - chỉ
`emit()` không còn tạo MỚI loại này nữa. QLSX vẫn thấy đúng lịch sử cũ trong "Tất cả", chỉ không có
thêm dòng mới thuộc 3 loại này từ nay về sau.

## 15. Phase 3a — nhóm 7.1 "SKU/định mức" (9 sự kiện) — _ĐÃ XONG 2026-09-26_

Bắt đầu Phase 3a theo đúng plan mục 8 (thứ tự: 7.1 → 7.2 → 7.4). Theo yêu cầu người dùng: làm từng
nhóm, mỗi nhóm xong chạy test BE **và live-test FE thật** trước khi báo cáo (như cách làm Phase 1/2).
Nhóm 7.1 xong hoàn toàn - đây là báo cáo cho nhóm đó.

### 15.1 Phạm vi

Cả 7 sự kiện ở bảng mục 7.1 đã làm, **trừ 1 sự kiện** (xem 15.5): "Sales tạo/sửa đơn có SKU chưa có
định mức" - cố ý hoãn, không thuộc `skus.service.ts` mà nằm ở `sales-orders.service.ts`, và có nhiều
mơ hồ thiết kế riêng (thế nào là "SKU chưa có định mức" - chưa có `BomRevision` nào hay chưa có bản
ACTIVE? có nên báo mỗi lần sửa đơn hay chỉ lần đầu?). Coi là việc riêng của nhóm 7.1 kỳ sau.

9 type mới trong [notification-types.ts](../src/modules/notifications/notification-types.ts) (nhiều
hơn 7 dòng trong bảng vì "nộp định mức"/"trả định mức" tách riêng cho nhánh mảnh và nhánh chi tiết -
2 nhánh độc lập, không thể gộp 1 type mà resolve() đúng riêng từng nhánh):

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `SKU_NEEDS_MANH_QUOTA` | ACTION/INFO | SPEC_STEEL_STAFF | `POST /skus` | nộp mảnh lần đầu |
| `SKU_NEEDS_DETAIL_QUOTA` | ACTION/INFO | SPEC_ACCESSORY_PACKAGING_STAFF | `POST /skus` | nộp chi tiết lần đầu |
| `SKU_MANH_QUOTA_SUBMITTED` | ACTION/INFO | PRODUCTION_PLANNER | `.../manh-quota` | KHSX review (duyệt hoặc từ chối) |
| `SKU_DETAIL_QUOTA_SUBMITTED` | ACTION/INFO | PRODUCTION_PLANNER | `.../detail-quota` | KHSX review |
| `SKU_MANH_QUOTA_REJECTED` | ACTION/WARNING | SPEC_STEEL_STAFF | `.../manh-quota/review` (REJECTED) | nộp lại |
| `SKU_DETAIL_QUOTA_REJECTED` | ACTION/WARNING | SPEC_ACCESSORY_PACKAGING_STAFF | `.../detail-quota/review` (REJECTED) | nộp lại |
| `SKU_SENT_TO_BOSS` | ACTION/INFO | BOSS | `advanceForwardedTrack()` khi CẢ 2 nhánh vừa forward xong | Sếp duyệt/từ chối |
| `SKU_APPROVED` | RESULT/SUCCESS | PRODUCTION_PLANNER + 2 role Spec (+SALES_STAFF nếu có đơn) | `.../approve` | — |
| `SKU_REJECTED_BY_BOSS` | RESULT/WARNING | như trên | `.../reject-boss` | — |

`entityType = 'SKU'` (đúng gợi ý sẵn có trong doc comment `Notification.entityType` ở schema.prisma),
`entityId = planFormId`. Không dùng `dedupeKey` (không có luồng retry như solver cắt sắt).

### 15.2 Quyết định thiết kế đáng chú ý

- **Best-effort, KHÔNG dùng `tx` của các transaction sẵn có** (`updateManhQuota`/`updateDetailQuota`/
  `approve`/`rejectByBoss` đều có `$transaction`): bàn lại đúng vấn đề đã nêu ở mục 14 cho
  cutting-proposals - bắt lỗi (catch) một câu lệnh THẤT BẠI bên trong 1 Prisma interactive
  transaction không cứu được transaction đó (Postgres đã đánh dấu abort ở tầng kết nối). Nên
  `notifySku()`/`resolveSkuNotifications()` luôn gọi SAU KHI transaction chính đã commit, không
  truyền `tx`. Đánh đổi: nghiệp vụ chính có thể thành công mà thông báo lỡ không tạo được (hiếm,
  chỉ khi DB lỗi ngay lúc đó) - chấp nhận được, đã có test riêng xác nhận lỗi notify không làm hỏng
  response chính (xem 15.3).
- **`SALES_STAFF` cho `SKU_APPROVED`/`SKU_REJECTED_BY_BOSS`**: `SalesOrder` không có cột người tạo
  (không `createdById`) nên không nhắm được đích danh "Sales đã tạo đơn này" - đành báo CẢ role Sales
  khi SKU có gắn `salesOrderId`, khớp quyết định mục 9.4 ("gửi tất cả người cùng vai trò"). Rộng hơn
  bảng gốc mục 7.1 (bảng chỉ ghi "Sales tạo đơn liên quan" cho dòng duyệt, không ghi cho dòng từ
  chối) - cố ý thêm cho từ chối vì Sales cũng cần biết SKU của đơn mình bị trả, không có lý do hợp lý
  để báo lúc duyệt mà im lặng lúc từ chối.
- **`origin='PRODUCTION_CONFIRM'` guard trong `create()`**: PlanForm loại này (tạo nội bộ khi Sếp
  duyệt PI item, ẩn khỏi mọi màn KHSX) không đi qua nhánh emit - hiện KHÔNG có API nào tạo loại này
  qua `createPlanForm()` nên guard chưa từng kích hoạt thật, giữ phòng thủ cho tương lai.
- **Link `production`/`setup`** (2 role Spec) và `production_plan`/`duyet-sku` (KHSX) đã có sẵn màn
  thật để thao tác - KHÁC hẳn ca cắt sắt (mục 12.6) vốn phải bỏ hẳn `link` vì không có màn nào cho
  QLSX làm. `boss`/`cho-duyet` cũng có màn thật (`SKUReviewPage` filter mặc định "SKU mới"). Riêng
  `SKU_APPROVED` link `production_plan`/`planforms` chỉ mở đúng MÀN (danh sách), chưa deep-link tới
  đúng dòng SKU (`SKUListPage`/`SKUDetail.tsx` chưa đọc query param để tự mở 1 dòng) - vẫn hữu ích
  hơn không có link vì đúng nội dung liên quan, không như ca cắt sắt trỏ nhầm sang màn không liên
  quan hoàn toàn.

### 15.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 9 type mới (mục 15.1).
- [skus.controller.ts](../src/modules/skus/skus.controller.ts): 8 endpoint (mọi endpoint TRỪ
  `create`/`update`/`remove`) thêm `@CurrentUser('id') actorUserId` để loại actor khỏi người nhận
  (nguyên tắc #2 mục 4 changelog 2026-09-25).
- [skus.service.ts](../src/modules/skus/skus.service.ts): thêm `NotificationsService` (constructor),
  helper `notifySku()`/`resolveSkuNotifications()`/`skuParams()`; gọi emit/resolve ở `create`,
  `updateManhQuota`, `reviewManhQuota`, `approveParts`, `updateDetailQuota`, `reviewDetailQuota`,
  `approveDetail`, `advanceForwardedTrack` (chỉ emit `SKU_SENT_TO_BOSS` đúng 1 lần khi
  `bothForwarded` CHUYỂN từ false sang true, không phải mỗi lần gọi), `approve`, `rejectByBoss`/
  `rewindToDetailReview`.
- [skus.module.ts](../src/modules/skus/skus.module.ts): import `NotificationsModule`.
- Test: 17 test mới trong `describe('notifications (Phase 3a, mục 7.1)')` (đủ 9 type, cả nhánh
  KHÔNG emit khi chỉ 1/2 track forward, nhánh short-circuit theo idempotencyKey không emit lại, và 1
  test xác nhận lỗi notify (mock reject) không làm hỏng response chính - best-effort thật).
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi (cần `npx prisma generate` trước - client cũ thiếu field
  `PlanForm.imageUrl` đã có sẵn trong `schema.prisma` từ việc khác, xác nhận bằng `git stash` là lỗi
  có sẵn không do phần việc này). `npx eslint --fix` trên các file sửa: 0 error, 1 warning
  `no-explicit-any` cố ý có sẵn. `npx jest` toàn repo: **1194/1194 pass, 50/50 suite** (tăng từ
  1131 - 63 test mới `skus.service.spec.ts` gồm cả các test không liên quan notification vì suite
  này trước đó KHÔNG chạy được do lỗi `imageUrl`/Prisma client, giờ chạy lại đầy đủ).

### 15.4 Live-test thật (BE+FE+DB thật, browser thật)

Bật lại Docker Desktop (`dna-erp-be-postgres-1`) - `prisma migrate deploy` 2 migration đang chờ
(`20260925000000_add_plan_form_image_url`, `20260925100000_drop_mfg_product_factory_code_unique` -
của việc khác, không phải notification, nhưng cần để DB khớp schema hiện tại). Chạy `nest start
--watch` (cổng 3001) + `next dev` (cổng 3000, phải xoá `.next` và khởi động lại 1 lần do cache
Turbopack lỗi từ phiên trước để lại - gặp trang `/` và `/login` trả 404 dù code không lỗi gì).

Kịch bản test bằng `mcp__Claude_Browser__*` (browser thật), tài khoản demo (`khsx`/`dms`/`dmbbdg`/
`boss`, mật khẩu chung `demo1234` theo `prisma/seed-demo.ts`):

1. `khsx` tạo SKU mới "TEST-NOTIF-7.1" - xác nhận qua `psql`: `SKU_NEEDS_MANH_QUOTA` (dms) +
   `SKU_NEEDS_DETAIL_QUOTA` (dmbbdg) tạo đúng, đúng `entityId`.
2. `dms` thấy đúng 2 thông báo trong panel "Cần xử lý", nhập 1 mảnh + 1 dòng vật tư Sắt, gửi phê
   duyệt - `SKU_NEEDS_MANH_QUOTA` resolved, `SKU_MANH_QUOTA_SUBMITTED` (khsx) tạo mới.
3. `khsx` **từ chối** (kèm lý do "Sai chiều dài cắt") - `SKU_MANH_QUOTA_SUBMITTED` resolved,
   `SKU_MANH_QUOTA_REJECTED` (dms) tạo mới đúng lý do; `dms` thấy đúng nội dung trong panel.
4. `dms` nộp lại (không sửa gì, chỉ gửi lại) - `SKU_MANH_QUOTA_REJECTED` resolved,
   `SKU_MANH_QUOTA_SUBMITTED` tạo mới lần 2.
5. `khsx` duyệt + "Xác nhận hoàn tất — Định mức mảnh" (`approveParts`) - `SKU_MANH_QUOTA_SUBMITTED`
   resolved; KHÔNG có `SKU_SENT_TO_BOSS` (đúng - nhánh chi tiết chưa forward).
6. `dmbbdg` nộp định mức chi tiết (tab "Bao bì") - `SKU_NEEDS_DETAIL_QUOTA` resolved,
   `SKU_DETAIL_QUOTA_SUBMITTED` (khsx) tạo mới.
7. `khsx` duyệt + "Xác nhận hoàn tất — Định mức chi tiết" (`approveDetail`, nhánh forward SAU CÙNG)
   - `SKU_DETAIL_QUOTA_SUBMITTED` resolved **VÀ** `SKU_SENT_TO_BOSS` (boss) tạo đúng 1 dòng.
8. `boss` thấy đúng nội dung trong panel; đứng ở màn khác ("Danh sách SKU", `?p=sku-list`), bấm
   thông báo - mark-read (`readAt` xác nhận qua `psql`) - URL đổi đúng `?m=boss&p=cho-duyet`, F5 vẫn
   giữ đúng màn (khớp mục tiêu mục 6.2) - **khác ca cắt sắt (mục 12.5.B)**, lần này link đúng NGAY
   TỪ ĐẦU vì đã kiểm bằng đúng người nhận thật (`boss`), không chỉ bằng tài khoản có quyền vượt rào.
9. `boss` duyệt (`approve`) - `SKU_SENT_TO_BOSS` resolved, `SKU_APPROVED` fan-out đúng 3 người
   (khsx, dms, dmbbdg) - xác nhận qua `psql`.

Một trở ngại phát sinh giữa chừng: DB dev **không có material nào gán `detailKind`** (Sơn/Phụ
kiện/Bao bì) nên `dmbbdg` không chọn được vật tư ở bước 6 - tạo 1 material test
(`TEST-BAOBI-NOTIF`, nhóm OTHER, `detailKind=PACKAGING`) chỉ để dùng cho bước này, xoá lại ở cuối
(mục 15.4 phần dọn dẹp).

**Không live-test riêng** `SKU_REJECTED_BY_BOSS` (Sếp từ chối ở bước cuối) - cùng entity test đã
được `approve()` kích hoạt `BomRevision` ACTIVE ở bước 9 nên không dùng lại để test reject được nữa;
cơ chế resolve+emit-kèm-lý-do đã được chứng minh sống ở bước 3 (`SKU_MANH_QUOTA_REJECTED`, cùng
pattern hệt nhau) và có unit test riêng (`rejectByBoss() resolve SKU_SENT_TO_BOSS rồi emit
SKU_REJECTED_BY_BOSS kèm lý do`).

**Dọn dữ liệu sau test:** xoá sạch bằng `psql` trong 1 transaction - `notifications`/
`notification_recipients` (cascade) của `entityId=5`, `plan_form_manh_reviews`/
`plan_form_detail_reviews`, các bảng con BOM (`piece_bom`/`bom_piece`/`piece_material_item`/
`piece_material_yield`/`consumable_bom`/`bom_accessory_items`) theo `bomRevisionId`, `bom_revision`
(phải tạm set về `DRAFT` trước - trigger `assert_bom_revision_draft()` chặn xoá dòng con của
`BomRevision` đang ACTIVE), `piece` "Manh test", `plan_forms` id 5, `mfg_products` "TEST-NOTIF-7.1",
material test `TEST-BAOBI-NOTIF`. Xác nhận lại bằng `psql`: `notifications` về đúng 21 dòng (baseline
cũ), `mfg_products` về đúng 4 dòng gốc (`BAN-J55`/`GHE-J55`/`GHE-TINH-YEU`/`BAN-8-MEIYING-J55`).

### 15.5 Còn treo

- Sự kiện "Sales tạo/sửa đơn có SKU chưa có định mức" (mục 7.1, hàng đầu bảng) - hoãn sang đợt sau,
  cần chốt thêm ngữ nghĩa "chưa có định mức" trước khi làm (xem mục 15.1).
- Phase 3a còn 2 nhóm nữa theo plan mục 8: 7.2 (Lệnh sản xuất PI) và 7.4 (Đề xuất mua mới) - làm
  từng nhóm 1, test BE + live-test FE mỗi nhóm theo đúng cách đã làm ở đây.
- `SKU_APPROVED` chưa deep-link tới đúng dòng SKU (chỉ mở đúng màn danh sách) - cần FE thêm đọc query
  param ở `SKUListPage`/`SKUDetail.tsx` nếu muốn nâng cấp, không thuộc phạm vi BE của đợt này.

## 16. Phase 3a — nhóm 7.2 "Lệnh sản xuất PI" (6 sự kiện) — _ĐÃ XONG 2026-09-26_

Tiếp tục Phase 3a theo đúng thứ tự plan (7.1 xong ở mục 15, giờ tới 7.2). Cùng cách làm: 1 nhóm, test
BE + live-test FE thật, rồi mới báo cáo.

### 16.1 Phạm vi và 1 quyết định lệch plan gốc

Cả 6 sự kiện ở bảng mục 7.2 đã làm. Riêng dòng cuối ("Tạo lệnh SX thất bại / retry-production-order
lỗi") **đổi người nhận so với plan gốc**: bảng mục 7.2 ghi QLSX, nhưng đọc lại code thì route khắc
phục (`POST .../retry-production-order`) chỉ `@RequireRole(DEFAULT_ROLES.ADMIN)` gọi được, và FE
**chưa có nút nào** gọi route này (`grep` toàn bộ `src/modules/pages` chỉ thấy hàm gọi API có sẵn
trong `production-invoices-api.ts`, không màn nào dùng tới) - giống hệt pattern vừa sửa ở mục 14 (báo
QLSX 1 việc họ không tự làm được). Đã hỏi lại người dùng, chốt: **báo ADMIN** thay vì QLSX (severity
CRITICAL nên Sếp vẫn tự động nhận thêm, mục 9.3).

6 type mới trong [notification-types.ts](../src/modules/notifications/notification-types.ts):

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `PI_SENT_TO_QLSX` | ACTION/INFO | PRODUCTION_MANAGER (QLSX) | `send-to-qlsx`/`send-to-qlsx-batch` | 0 SKU của PI còn WAITING_QLSX |
| `PI_REJECTED_BY_QLSX` | RESULT/WARNING | PRODUCTION_PLANNER (KHSX) | `reject-by-qlsx`/`reject-qlsx-batch` | — |
| `PI_SENT_TO_BOSS` | ACTION/INFO | BOSS | `send-to-boss`/`send-to-boss-batch` | 0 SKU của PI còn WAITING_BOSS |
| `PI_APPROVED_BY_BOSS` | RESULT/SUCCESS | PRODUCTION_PLANNER + PRODUCTION_MANAGER | `approve`/`approve-batch` | — |
| `PI_REJECTED_BY_BOSS` | RESULT/WARNING | PRODUCTION_PLANNER + PRODUCTION_MANAGER | `reject`/`reject-batch` | — |
| `PI_PRODUCTION_ORDER_FAILED` | ALERT/CRITICAL | **ADMIN** (khác plan gốc) | `createFromApproval()` lỗi trong `approveItem`/`approveBatch` | `retry-production-order` thành công |

`entityType = 'PRODUCTION_INVOICE'` (entityId=piId) cho 5 type đầu, riêng `PI_PRODUCTION_ORDER_FAILED`
dùng `entityType = 'PRODUCTION_INVOICE_ITEM'` (entityId=itemId) vì sự cố là của riêng 1 SKU, PI có
thể còn SKU khác vẫn ổn.

### 16.2 Quyết định thiết kế đáng chú ý

- **"Gộp 1 thông báo/PI, n SKU"** (đúng yêu cầu plan cho `PI_SENT_TO_QLSX`/`PI_SENT_TO_BOSS`): dùng
  `dedupeKey = "{TYPE}:{piId}"` - gửi lẻ nhiều lần trước khi người nhận kịp xử lý sẽ gộp vào 1 dòng,
  `count` cập nhật theo tổng SKU đang chờ tại thời điểm gọi gần nhất (tính từ `pi.items` đã có sẵn
  trong bộ nhớ tại đầu mỗi hàm, không query lại DB). **Giới hạn đã biết:** khi số lượng GIẢM (1 SKU
  rời hàng đợi nhưng còn SKU khác), thông báo KHÔNG tự cập nhật lại "n" nhỏ hơn - chỉ đóng hẳn khi
  n về 0. Chấp nhận được ở quy mô hiện tại (đa số PI có 1 SKU).
- **PI có thể bị XOÁ ngay sau khi resolve/emit** (khi item cuối cùng rời PI qua nhánh từ chối - xem
  `rejectItemByQlsx`/`rejectItem`): gọi `resolvePiNotifications()`/`notifyPi()` vẫn dùng đúng `pi.id`
  (đọc từ TRƯỚC khi transaction xoá PI) - an toàn vì `Notification.entityId` chỉ là chuỗi lưu trữ,
  không có khoá ngoại tới `ProductionInvoice` (giống cách `PI_REJECTED_BY_QLSX`/`PI_REJECTED_BY_BOSS`
  vẫn tham chiếu đúng piId dù PI đã không còn tồn tại - RESULT không cần tra lại theo entityId).
- **`PI_PRODUCTION_ORDER_FAILED` đổi recipient ADMIN thay QLSX** - xem mục 16.1, cùng lý do mục 14.
- **`PI_APPROVED_BY_BOSS`/`PI_REJECTED_BY_BOSS` KHÔNG có `link`** dù đã có màn thật cho từng vai
  trò riêng lẻ: 2 type này báo CẢ KHSX lẫn QLSX, mà 2 role đó có module "nhà" khác nhau
  (`production_plan` vs `production`) và nhân viên thường bị khoá cứng vào module của mình (chỉ
  Giám đốc mới vượt rào, xem `app/page.tsx`) - 1 `link` không thể đúng cho cả 2 phía cùng lúc, bên
  còn lại sẽ bị bật về module mặc định + toast (mục 6.2). Đúng tinh thần mục 12.6: "thà không có
  link còn hơn có link sai với 1 nửa người nhận".
- **Best-effort NGOÀI transaction** - cùng lý do kỹ thuật đã ghi ở mục 14/15.2 (catch bên trong 1
  Prisma interactive transaction không cứu được transaction đó).

### 16.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 6 type mới (mục 16.1).
- [production-invoices.service.ts](../src/modules/production-invoices/production-invoices.service.ts):
  thêm `NotificationsService` (constructor), helper `notifyPi()`/`resolvePiNotifications()`; gọi
  emit/resolve ở `sendItemToQlsx`, `sendBatchToQlsx`, `sendItemToBoss`, `sendBatchToBoss`,
  `rejectItemByQlsx`, `rejectBatchByQlsx`, `approveItem` (+ nhánh `PI_PRODUCTION_ORDER_FAILED` khi
  `createFromApproval()` lỗi), `approveBatch` (tương tự, mỗi item lỗi báo riêng), `rejectItem`,
  `rejectBatch`, `retryProductionOrder` (resolve khi thành công).
- [production-invoices.module.ts](../src/modules/production-invoices/production-invoices.module.ts):
  import `NotificationsModule`.
- Test: 15 test mới trong `describe('notifications (Phase 3a, mục 7.2)')` (đủ 6 type, nhánh KHÔNG
  resolve khi còn SKU khác đang chờ, nhánh resolve-vô-điều-kiện của các hàm *Batch (đòi mọi item
  cùng trạng thái mới cho chạy), và 1 test xác nhận lỗi notify không làm hỏng response chính).
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi. `npx eslint --fix`: 0 error, 1 warning `no-explicit-any`
  cố ý có sẵn (như mọi lần trước). `npx jest` toàn repo: **1207/1207 pass, 50/50 suite** (tăng từ
  1194 - 15 test mới, không test nào cũ bị vỡ).

### 16.4 Live-test thật (BE+FE+DB thật, browser thật)

Tái sử dụng đúng phiên Docker/BE/FE đã bật từ mục 15.4 (không cần khởi động lại). Tạo dữ liệu test
qua **API thật** (gọi thẳng `fetch()` trong console trình duyệt, dùng `access_token` của phiên đăng
nhập thật - không phải qua form FE) vì màn "Tạo SKU mới" (`SKUReviewPage`) không có ô chọn Sales
Order, trong khi `POST /skus` kèm `salesOrderId` mới tự tạo `ProductionInvoice`+`ProductionInvoiceItem`
ngay lập tức (`resolveProductionInvoice()`, không cần qua toàn bộ vòng duyệt định mức của mục 15) -
chỉ có API mới thiết lập được đúng tiền đề cần thiết cho test này. Vẫn là BE thật/DB thật/kiểm tra
qua UI thật ở các bước sau, chỉ riêng bước "gây ra" trạng thái ban đầu là gọi thẳng API thay vì click
UI không tồn tại.

1. Tạo PlanForm mới gắn `salesOrderId=12` (đơn demo "TEST6"), `mfgProductId=2` (GHE-J55, sản phẩm có
   sẵn) → tự sinh `ProductionInvoice` PI-2026-014 + 1 item (`prodApprovalStatus=null`).
2. Gọi `send-to-qlsx` (đóng vai `khsx`) → xác nhận qua `psql`: `PI_SENT_TO_QLSX` tạo đúng cho `qlsx`,
   `count=1`. Đăng nhập UI `qlsx` thật: chuông + panel "Cần xử lý" hiện đúng
   "PI-2026-014: 1 SKU chờ QLSX duyệt / KHSX đã gửi - vào xử lý."
3. Gọi `send-to-boss` (đóng vai `qlsx`) → `PI_SENT_TO_QLSX` resolved, `PI_SENT_TO_BOSS` tạo cho
   `boss`.
4. Đăng nhập UI `boss` thật, đứng ở màn khác (`?m=boss&p=sku-list`), bấm thông báo → mark-read → URL
   đổi đúng `?m=boss&p=cho-duyet` (khớp mục tiêu mục 6.2, đúng ngay từ đầu vì đã test bằng chính
   người nhận thật `boss`, không phải tài khoản vượt rào như bài học mục 12.5.B).
5. Gọi `reject` (đóng vai `boss`, lý do "Test 7.2 - sai quy cách") → xác nhận qua `psql`:
   `PI_SENT_TO_BOSS` resolved, `PI_REJECTED_BY_BOSS` fan-out đúng CẢ `khsx` lẫn `qlsx`, PI-2026-014
   bị xoá (item cuối cùng rời PI, đúng thiết kế). Đăng nhập UI `khsx` thật, tab "Tất cả" (đúng - RESULT
   không vào "Cần xử lý") hiện đúng "PI-2026-014: 1 SKU bị Sếp từ chối / Lý do: Test 7.2 - sai quy
   cách. SKU đã quay về 'Tối ưu cắt sắt'."

**Không live-test** `PI_APPROVED_BY_BOSS`/`PI_PRODUCTION_ORDER_FAILED` (nhánh `approve`) - khác nhánh
`reject` (chỉ đổi 3 field), `approve` kéo theo tạo `ProductionOrder` thật + gọi solver cắt sắt ngoài
thật (`ExternalApiService`) + đề xuất mua hàng thật, khó dọn sạch & không nên gọi solver ngoài không
cần thiết chỉ để test notification. 2 type này đã được unit test đầy đủ (mục 16.3); cơ chế
resolve+emit đã chứng minh sống qua đúng cặp cùng dạng ở bước 3/5 (`PI_SENT_TO_BOSS` resolve,
`PI_REJECTED_BY_BOSS` emit kèm lý do).

**Dọn dữ liệu sau test:** xoá `production_invoice_items` id vừa tạo, `plan_forms` vừa tạo (product
GHE-J55 dùng chung id=2 - KHÔNG xoá, chỉ xoá PlanForm mới), toàn bộ `notifications` liên quan
(`entityType='PRODUCTION_INVOICE'` theo piId VÀ `entityType='SKU'` theo 2 planFormId đã tạo trong lúc
dựng tiền đề - dòng plan_form thứ nhất bị bỏ giữa chừng, xem bước dưới). Xác nhận lại bằng `psql`:
`notifications` về đúng 21 dòng baseline, `mfg_products`/`plan_forms`/`production_invoices` về đúng
số dòng gốc.

**Một sai sót nhỏ giữa chừng (tự phát hiện, không phải người dùng chỉ ra):** lần tạo PlanForm ĐẦU
TIÊN dùng 1 `mfgProductId` MỚI (không phải sản phẩm có sẵn) nên KHÔNG khớp được `SalesOrderItem` nào
của đơn TEST6 → không tự sinh `ProductionInvoiceItem` (`resolveProductionInvoice()` chỉ tạo item khi
tìm thấy `SalesOrderItem` khớp `(salesOrderId, mfgProductId)`) - phải xoá dọn PlanForm/product đó rồi
tạo lại lần 2 với `mfgProductId=2` (khớp item có sẵn của đơn) mới ra đúng tiền đề cần thiết. Cũng vì
sai sót này mà bước dọn dẹp phải xoá thêm 4 dòng `notifications` loại `SKU_NEEDS_MANH_QUOTA`/
`SKU_NEEDS_DETAIL_QUOTA` (do `createPlanForm()` LUÔN emit 2 type đó bất kể sau này có sinh PI item
hay không, xem mục 15) mà lần dọn đầu tiên bỏ sót (chỉ dọn `entityType='PRODUCTION_INVOICE'`, quên
mất `entityType='SKU'` của chính 2 lần tạo PlanForm) - phát hiện khi đếm lại tổng `notifications` ra
25 thay vì 21 baseline, soi lại mới thấy.

### 16.5 Còn treo

- Phase 3a còn đúng 1 nhóm: 7.4 (Đề xuất mua mới) - làm tiếp theo cùng cách. _Đã làm xong, xem mục 17._
- Giới hạn "n SKU không tự giảm khi 1 SKU rời hàng đợi nhưng còn SKU khác" (mục 16.2) - chấp nhận
  được ở quy mô hiện tại, ghi lại để biết nếu sau này PI nhiều SKU dùng route lẻ trở nên phổ biến hơn.
- `PI_APPROVED_BY_BOSS`/`PI_PRODUCTION_ORDER_FAILED` chưa live-test nhánh approve thật (mục 16.4) -
  chỉ có unit test. Nên test khi có dịp tự nhiên (PI thật được duyệt trong lúc test 1 việc khác cần
  BOM/solver thật sẵn có).

## 17. Phase 3a — nhóm 7.4 "Đề xuất mua hàng" (4 sự kiện) — _ĐÃ XONG 2026-09-26, Phase 3a hoàn tất_

Nhóm cuối cùng của Phase 3a (7.1 xong ở mục 15, 7.2 xong ở mục 16). Cùng cách làm: 1 nhóm, test BE +
live-test FE thật, rồi mới báo cáo.

### 17.1 Phạm vi

4 type mới trong [notification-types.ts](../src/modules/notifications/notification-types.ts), khớp
đúng bảng plan mục 7.4 (không lệch người nhận/luồng nào, khác mục 16.1):

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `PURCHASE_PROPOSAL_CREATED` | ACTION/INFO | PURCHASER (Mua hàng) | Đề xuất mua mới sinh ra từ cắt sắt (`CuttingProposalsService.approve()`), kiểm kho vật tư tiêu hao (`ConsumableMaterialPurchaseService`), hoặc định mức cắt PI (`PieceMaterialYieldPurchaseService`) | 0 item của đề xuất còn ở trạng thái trước `PURCHASING` |
| `PURCHASE_PROPOSAL_APPROVED` | RESULT/INFO | PRODUCTION_MANAGER (QLSX) | `bossApprove()` - Mua hàng tải file duyệt ký tay | — |
| `PURCHASE_PROPOSAL_ITEM_RECEIVED` | RESULT/INFO | Kho theo `Material.warehouseId` + PRODUCTION_MANAGER | `receiveItem()` - nhận 1 dòng hàng về | — |
| `PURCHASE_PROPOSAL_PURCHASED` | RESULT/SUCCESS | PRODUCTION_MANAGER + PURCHASER | `receiveItem()` khi dòng cuối cùng đưa cả đề xuất về `PURCHASED` | — |

`entityType = 'PURCHASE_PROPOSAL'` (entityId=proposalId) cho cả 4 type.

### 17.2 Quyết định thiết kế đáng chú ý

- **"1 PI = 1 PurchaseProposal", 3 nơi tạo khác nhau cùng gọi 1 hàm dùng chung**: `CuttingProposalsService`,
  `ConsumableMaterialPurchaseService`, `PieceMaterialYieldPurchaseService` đều find-or-create vào
  CÙNG 1 `PurchaseProposal` theo `productionInvoiceId` - tách hẳn logic notify creation ra
  [purchase-proposal-notify.util.ts](../src/modules/purchase-proposals/purchase-proposal-notify.util.ts)
  (hàm đứng riêng, không phải method của class nào) để dùng chung ở cả 3 nơi thay vì copy 3 lần hoặc
  ép 3 service không liên quan cùng kế thừa 1 lớp - đúng pattern đã dùng cho
  `purchase-proposal-status.util.ts`.
- **`PURCHASE_PROPOSAL_CREATED` chỉ emit khi còn item PENDING**: đề xuất có thể được tạo (hoặc
  find-lại) nhưng đã ở `PURCHASING`/`PURCHASED` ngay từ đầu (vd định mức cắt PI tính ra đề xuất
  nhưng mọi dòng đã đủ tồn kho) - hàm dùng chung kiểm `pendingCount === 0` thì bỏ qua, tránh báo
  Mua hàng 1 việc không có gì để làm.
- **`PURCHASE_PROPOSAL_ITEM_RECEIVED`/`PURCHASE_PROPOSAL_PURCHASED` KHÔNG có `link`** - đúng tinh
  thần mục 12.6/16.2: người nhận gồm cả Kho (module `inbound_warehouse`) lẫn QLSX (module
  `production`), 2 module "nhà" khác nhau, 1 `link` không thể đúng cho cả 2 phía.
- **`bossApprove()` chỉ đóng `PURCHASE_PROPOSAL_CREATED` khi 0 item còn PENDING** - 1 đề xuất có thể
  có nhiều người mua phụ trách các dòng khác nhau (`Material.buyerId`); người này duyệt xong phần
  mình không có nghĩa "n vật tư cần mua" của người mua khác đã hết việc - dùng lại đúng logic đếm
  `stillPending` đã áp dụng ở mục 16.2 cho PI.
- **Best-effort NGOÀI transaction** - cùng lý do kỹ thuật đã ghi ở mục 14/15.2/16.2.

### 17.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 4 type mới (mục 17.1).
- [purchase-proposal-notify.util.ts](../src/modules/purchase-proposals/purchase-proposal-notify.util.ts)
  (file mới): `notifyPurchaseProposalCreated()` dùng chung ở 3 call-site tạo đề xuất.
- [cutting-proposals.service.ts](../src/modules/cutting-proposals/cutting-proposals.service.ts): gọi
  `notifyPurchaseProposalCreated()` sau khi `approve()` commit transaction (cả nhánh tạo mới lẫn tìm
  lại đề xuất có sẵn).
- [consumable-material-purchase.service.ts](../src/modules/production-invoices/consumable-material-purchase.service.ts)
  và [piece-material-yield-purchase.service.ts](../src/modules/production-invoices/piece-material-yield-purchase.service.ts):
  cùng gọi `notifyPurchaseProposalCreated()` sau transaction; thêm `NotificationsService` vào constructor.
- [purchase-proposals.service.ts](../src/modules/purchase-proposals/purchase-proposals.service.ts):
  thêm `NotificationsService` (constructor) + `Logger`; helper riêng `notifyPurchaseProposal()`/
  `resolvePurchaseProposalCreated()`/`resolvePiCodeFor()`; gọi ở `bossApprove()` (APPROVED + resolve
  CREATED có điều kiện) và `receiveItem()` (ITEM_RECEIVED luôn luôn, PURCHASED thêm khi item cuối
  cùng đưa cả đề xuất về `PURCHASED`).
- [purchase-proposals.module.ts](../src/modules/purchase-proposals/purchase-proposals.module.ts),
  [production-invoices.module.ts](../src/modules/production-invoices/production-invoices.module.ts):
  import `NotificationsModule`.
- Test: thêm test cho cả 4 service (`cutting-proposals`, `consumable-material-purchase`,
  `piece-material-yield-purchase`, `purchase-proposals`) - đủ nhánh emit CREATED khi còn PENDING,
  KHÔNG emit khi đề xuất đã `PURCHASED` ngay từ đầu, APPROVED + resolve CREATED (có điều kiện còn
  người mua khác), ITEM_RECEIVED không kèm PURCHASED khi nhận dở, và emit THÊM PURCHASED khi dòng
  cuối cùng đóng đề xuất.
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi. `npx eslint --fix`: 0 error, 1 warning `no-explicit-any`
  cố ý có sẵn (như mọi lần trước). `npx jest` toàn repo: **1215/1215 pass, 50/50 suite** (tăng từ
  1207 ở mục 16 - 8 test mới, không test nào cũ bị vỡ).
- FE: [PurchasingApp.tsx](../../DNA-ERP/src/modules/pages/Purchasing/PurchasingApp.tsx) và
  [InboundWarehouseApp.tsx](../../DNA-ERP/src/modules/pages/InboundWarehouse/InboundWarehouseApp.tsx)
  nối `?p=` URL-sync (cùng pattern `ProductionPlanApp`/`MfgApp`/`BossApp` mục 12.5.B) - cần thiết để
  `link` của `PURCHASE_PROPOSAL_CREATED` (`purchasing/lenh-mua-ncc`) điều hướng đúng tab. `tsc`/
  `eslint`/`vitest` (52/52) đều xanh.

### 17.4 Live-test thật (BE+FE+DB thật, browser thật)

Tái sử dụng đúng phiên Docker/BE/FE đã bật từ mục 15.4/16.4. Khác 2 nhóm trước: **không tạo dữ liệu
throwaway mới** mà dùng lại 1 `PurchaseProposal` NEW có sẵn trong DB dev (id=5, `PI-2026-007`,
nguồn `CUTTING_PROPOSAL`, 7 dòng vật tư, không dòng nào gán `buyerId` riêng) - vì cả 6 đề xuất
`NEW` hiện có đều sinh ra từ nhánh cắt sắt (`approve()`, pipeline solver tốn kém), giống lý do mục
16.4 đã né nhánh `approve` của PI: không đáng gọi lại solver ngoài chỉ để lấy tiền đề test.

1. Đăng nhập thật `muapsh` (role PURCHASER) qua API (`POST /api/v1/auth/login`), gọi thật
   `POST /api/v1/purchase-proposals/5/boss-approve` với `approvalFileUrl` giả (link ví dụ) - đúng
   endpoint FE gọi khi nhân viên mua hàng bấm "Đã có Sếp duyệt" (tên hàm `bossApprove` nhưng người
   bấm là Mua hàng, xem doc-comment dòng 289-291 service - quyền `PURCHASE_PROPOSAL:UPDATE`, không
   phải `APPROVE`, chốt chặn thật nằm ở chữ ký tay ngoài phần mềm).
2. Xác nhận qua `psql`: `PURCHASE_PROPOSAL_APPROVED` tạo đúng 1 dòng, `entityId='5'`, `link` trỏ
   `production/lenh-sx`, recipient duy nhất là `qlsx` (đúng bảng mục 7.4 dòng C), `readAt` còn NULL.
3. Đăng nhập UI `qlsx` thật (không phải tài khoản vượt rào) → mở chuông → tab "Tất cả" (đúng, RESULT
   không vào "Cần xử lý") hiện đúng đầu danh sách "PI-2026-007: đề xuất mua đã có Sếp duyệt / Mua
   hàng đã tải file duyệt ký tay cho 7 vật tư - đang đặt hàng." → bấm vào → mark-read (badge giảm
   đúng 1), điều hướng đúng `production/lenh-sx` (đã sẵn ở đúng module nên không thấy chuyển màn,
   nhưng URL/mark-read xác nhận cơ chế chạy đúng).

**Không live-test `PURCHASE_PROPOSAL_CREATED`** qua đúng luồng thật (`approve()` cắt sắt) - cùng lý
do mục 16.4 (không đáng gọi lại solver ngoài); type này đã được unit test đầy đủ ở cả 3 call-site
(mục 17.3) nên rủi ro thấp. **Không live-test `PURCHASE_PROPOSAL_ITEM_RECEIVED`/`PURCHASE_PROPOSAL_PURCHASED`**
qua `receiveItem()` thật - khác `bossApprove()` (chỉ đổi field + audit log, dọn sạch bằng UPDATE),
`receiveItem()` ghi `StockLedger`/cập nhật `StockReservation` thật (nhập kho thật) - khó đảo ngược
an toàn trên DB dev dùng chung mà không có nguy cơ làm lệch số tồn kho đang phục vụ test khác; 2 type
này cũng đã unit test đầy đủ cả nhánh nhận dở lẫn nhánh đóng đề xuất (mục 17.3).

**Dọn dữ liệu sau test:** revert `purchase_proposal_items` (7 dòng của proposal 5) về đúng
`status='NEW'`, xoá `approvedAt`/`approvedById`/`approvalFileUrl`; `purchase_proposals.status` về
`NEW`; xoá dòng `audit_logs` vừa ghi (hành động boss-approve giả); xoá `notification` +
`notification_recipients` vừa tạo. Xác nhận qua `psql`: proposal 5 về đúng `NEW` (7/7 item `NEW`),
`notifications` về đúng 21 dòng baseline, `audit_logs` của `PurchaseProposal#5` về đúng 2 dòng gốc
(CREATE + UPDATE ngày 2026-09-22, trước lần test này).

### 17.5 Còn treo

- `PURCHASE_PROPOSAL_CREATED` (cả 3 call-site) và `PURCHASE_PROPOSAL_ITEM_RECEIVED`/
  `PURCHASE_PROPOSAL_PURCHASED` chưa live-test qua đúng luồng thật (mục 17.4) - chỉ có unit test.
  Nên test khi có dịp tự nhiên (1 đề xuất mua thật được tạo/nhận hàng trong lúc test việc khác).
- **Phase 3a (7.1, 7.2, 7.4) coi như hoàn tất.** (Cập nhật 2026-09-28, mục 26.5: Phase 3b/3c sau đó
  cũng đã xong toàn bộ - xem mục 8. Còn lại Phase 4/5.)

## 18. Sửa bug `warehouseIds` sai kiểu dữ liệu ở `PURCHASE_PROPOSAL_ITEM_RECEIVED` — _2026-09-26, phát hiện lúc rà research Phase 3b_

**Phát hiện:** lúc research để bắt đầu Phase 3b, rà lại `RecipientResolverService.resolve()` thì thấy
tiêu chí `warehouseIds` được lọc bằng `User.warehouseScope: { in: criteria.warehouseIds }` -
`warehouseScope` trong repo này LÀ CHUỖI MÃ KHO (`'phoi-son-han'`, `'vat-tu-tp'`...), KHÔNG PHẢI
`Warehouse.id`. Trong khi đó `PurchaseProposalsService.receiveItem()` ([purchase-proposals.service.ts](../src/modules/purchase-proposals/purchase-proposals.service.ts))
lại truyền `materialWarehouseId.toString()` (khoá số `Warehouse.id`) làm `warehouseId` cho
`PURCHASE_PROPOSAL_ITEM_RECEIVED` (mục 17.1/17.3) - nghĩa là tiêu chí `warehouseIds` gần như KHÔNG
BAO GIỜ khớp `warehouseScope` của bất kỳ thủ kho nào (trừ khi trùng ngẫu nhiên chuỗi số), nên
**type này thực chất chỉ tới đúng QLSX, không hề tới Kho như thiết kế ban đầu (mục 7.4 dòng B)**.
Vì mục 17.5 đã tự ghi "chưa live-test qua đúng luồng thật" cho đúng type này, bug chưa lộ ra ở
live-test - chỉ lộ khi đọc lại code cho Phase 3b.

**Đã sửa:** đổi sang truyền `targetWarehouseCode` (biến đã có sẵn trong `receiveItem()`, chính là mã
kho thật đã dùng để ghi `StockLedger`) thay vì `materialWarehouseId.toString()`; đổi tên param từ
`warehouseId` → `warehouseCode` cho đúng bản chất (ở cả `notification-types.ts` và
`purchase-proposals.service.ts`) để không ai đọc nhầm là ID lần nữa. Cập nhật 1 test đang gán cứng
`warehouseId: '800'` (khoá số giả) thành `warehouseCode: 'phoi-son-han'` (khớp mã kho mặc định của
material fixture trong file test).

**Kiểm tra:** `npx tsc --noEmit`: 0 lỗi mới. `npx jest` toàn repo: **1215/1215 pass, 50/50 suite**
(không đổi số lượng test, chỉ sửa lại 1 assertion).

**Còn treo:** chưa live-test lại `PURCHASE_PROPOSAL_ITEM_RECEIVED` qua đúng luồng thật sau khi sửa
(cùng lý do mục 17.4 - `receiveItem()` ghi `StockLedger` thật, khó dọn sạch trên DB dev dùng chung).
Nên kiểm khi có dịp tự nhiên.

## 19. Phase 3b — nhóm 7.5-i "Sắt → Phôi → KCS" (4 sự kiện) — _ĐÃ XONG 2026-09-26_

Bắt đầu Phase 3b (mục 7.5 changelog - kho/sàn xưởng). Phạm vi rất rộng (10 sự kiện, ~10 module) nên
chia nhỏ theo domain, làm tuần tự từng nhóm - cùng nhịp 7.1/7.2/7.4. Nhóm đầu: chuỗi Kho xuất sắt →
Phôi → KCS (4 dòng đầu bảng mục 7.5).

### 19.1 Phạm vi và 3 lệch so với plan gốc (đã hỏi + được người dùng chốt trước khi code)

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `STEEL_ISSUE_TO_PHOI` | ACTION/INFO | PHOI_STAFF | `steel-issues` tạo (Kho xuất sắt) | Phôi `receive()` |
| `CUT_BUNDLE_TO_KCS` | ACTION/INFO | KCS_STAFF | `cut-bundles/:id/finish` (Phôi báo xong đợt cắt) | KCS `reviewCutBundle()` |
| `BATCH_TO_KCS` | ACTION/INFO | KCS_STAFF | `production-batches/:id/finish` (Hàn/Sơn báo xong đợt) | KCS `reviewProductionBatch()` |
| `QC_FAILED` | RESULT/WARNING | Tổ gửi (Phôi/Hàn/Sơn theo nguồn) + PRODUCTION_MANAGER | `reviewCutBundle()`/`reviewProductionBatch()` khi `failedQty > 0` | — |
| `QC_PASSED` | RESULT/INFO | PRODUCTION_MANAGER | Cùng 2 hàm trên khi `failedQty = 0` | — |

3 điểm đã hỏi lại người dùng trước khi code (đọc code thực tế thấy khác giả định plan gốc mục 7.5):

- **"KCS có lỗi/trả về" và "KCS đạt" KHÔNG phải 2 hành động riêng** - `reviewCutBundle()`/
  `reviewProductionBatch()` chỉ có ĐÚNG 1 nhánh code, luôn chuyển `QC_PASSED`/`QC_DONE`, không có
  trạng thái "trả về" riêng (đúng thiết kế "sửa được thì không tính lỗi" đã chốt trước đây) - chỉ
  track `failedQty`. Người dùng chốt: coi 2 dòng plan gốc là 2 nhánh của CÙNG 1 lần gọi, rẽ theo
  `failedQty>0` hay `=0` - khớp đúng code, không cần thêm hành động/route mới nào.
- **Bỏ "gộp theo PI/ngày" của `QC_PASSED`** - plan gốc muốn gộp, nhưng cơ chế dedupe hiện tại
  (`dedupeKey` + merge khi còn recipient `resolvedAt: null`) chỉ gộp "còn mở", trong khi `QC_PASSED`
  là RESULT không ai đóng - nếu không nhúng ngày vào `dedupeKey` sẽ gộp mãi mãi kể cả sang tháng
  sau; mà nhúng ngày rồi thì "count" đúng nghĩa lại cần đếm cộng dồn qua nhiều lần gọi rời rạc
  (không có sẵn 1 danh sách trong bộ nhớ để đếm như `pi.items` ở mục 16.2) - phải đọc lại `data`
  của thông báo cũ mỗi lần rồi tự +1, thêm 1 lớp phức tạp/dễ vỡ chỉ để phục vụ 1 type thuần thông
  tin. Người dùng chốt: bỏ gộp, mỗi lượt duyệt phát 1 thông báo riêng - đơn giản, an toàn hơn.
- **`packaging-issues` (thuộc dòng khác của bảng 7.5, chưa làm ở nhóm này) không có bước "nhận
  hàng"** - phát hiện khi rà code cả bảng cho có cái nhìn tổng thể trước khi chia nhóm, ghi lại ở
  đây để nhóm sau (7.5-ii, xuất vật tư/bao bì) không phải hỏi lại: người dùng đã chốt trước sẽ báo
  INFO không tự đóng, không phải ACTION_REQUIRED.

Riêng phát hiện quan trọng nhất trong lúc research: **bug `warehouseIds` sai kiểu dữ liệu ở
`PURCHASE_PROPOSAL_ITEM_RECEIVED`** (Phase 3a, mục 7.4) - đã tách ra sửa riêng ở **mục 18** (không
thuộc phạm vi 3b nhưng phát hiện lúc rà code chuẩn bị cho 3b).

### 19.2 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 4 type mới (mục 19.1)
  + 3 interface params mới (`SteelIssueNotificationParams`, `QcSubmittedNotificationParams`,
    `QcResultNotificationParams`).
- [steel-issues.service.ts](../src/modules/steel-issues/steel-issues.service.ts): thêm
  `NotificationsService` (constructor); `create()` emit `STEEL_ISSUE_TO_PHOI` sau transaction (bỏ
  qua nhánh idempotency-replay - không emit lại); `receive()` resolve; `finishCutBundle()` emit
  `CUT_BUNDLE_TO_KCS` (cần thêm 1 query nhỏ lấy PI code vì include hiện có của `CutBundle.steelIssue`
  chỉ có field thô, không join `productionInvoice`).
- [production-batches.service.ts](../src/modules/production-batches/production-batches.service.ts):
  thêm `NotificationsService` + `Logger`; `finishProductionBatch()` emit `BATCH_TO_KCS`.
- [qc-reviews.service.ts](../src/modules/qc-reviews/qc-reviews.service.ts): thêm
  `NotificationsService` + `Logger`; helper `resolveAwaitingQc()` (dùng chung 2 nhánh cắt/lô) +
  `notifyQcResult()` (rẽ `QC_FAILED`/`QC_PASSED` theo `failedQty`, dùng chung) + `mfgStageToSenderRole()`
  (map `MfgStage.PHOI/HAN/SON` → đúng `BUSINESS_ROLES`); gọi ở `reviewCutBundle()` (tổ gửi luôn là
  Phôi) và `reviewProductionBatch()` (tổ gửi theo `batch.stage`).
- [steel-issues.module.ts](../src/modules/steel-issues/steel-issues.module.ts),
  [production-batches.module.ts](../src/modules/production-batches/production-batches.module.ts),
  [qc-reviews.module.ts](../src/modules/qc-reviews/qc-reviews.module.ts): import `NotificationsModule`.
- **Không gắn `link`** cho cả 4 type - các màn Phôi/KCS/QLSX liên quan (`XacNhanNhanSatPage`,
  `KcsPhoiPage`, `ThongKePagePlan`) chưa nối `?p=` URL-sync (mục 12.4: "chưa cần vì chưa type nào
  trỏ vào đó") - để ngoài phạm vi nhóm này, tránh lan sang việc FE không liên quan.
- Test: thêm 10 test mới (2 ở `create`/`receive` steel-issues cho `STEEL_ISSUE_TO_PHOI`, 1 ở
  `finishCutBundle` cho `CUT_BUNDLE_TO_KCS`, 1 ở `finishProductionBatch` cho `BATCH_TO_KCS`, 2+3 ở
  `reviewCutBundle`/`reviewProductionBatch` cho `QC_FAILED`/`QC_PASSED` bao gồm cả 2 nhánh HAN/SON).
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi. `npx eslint --fix`: 0 error, 1 warning `no-explicit-any`
  cố ý có sẵn. `npx jest` toàn repo: **1225/1225 pass, 50/50 suite** (tăng từ 1215 ở mục 17/18 - 10
  test mới).

### 19.3 Live-test thật (BE+FE+DB thật, browser thật)

Dữ liệu có sẵn trong DB dev đều đã xử lý xong hết (17 SteelIssue/19 CutBundle đều QC_PASSED, 61
ProductionBatch đều QC_DONE) - không còn dòng nào đang dở để tái dùng như nhóm 7.4 (mục 17.4). Tạo
mới qua **API thật** (không qua UI - các màn Kho/Phôi/KCS/Hàn/Sơn chưa kịp rà lại toàn bộ trong
phiên này, chỉ xác nhận qua UI ở bước ĐỌC thông báo), dùng PI có sẵn (`PI-2026-004`, id=6) đang có
`floorStage=ACTIVE` + đề xuất cắt đã `APPROVED` (còn dư 8/13 cây trong pool giữ chỗ, đủ để tạo thêm
1 `SteelIssue` nhỏ `barCount=1` mà không làm âm pool).

1. Đăng nhập thật `khopsh` (Kho phôi-son-han, role có `STEEL_ISSUE:CREATE`) → gọi thật
   `POST /production-invoices/6/steel-issues` → xác nhận `STEEL_ISSUE_TO_PHOI` tạo đúng cho `phoi`,
   `entityId` khớp SteelIssue vừa tạo. Đăng nhập UI `phoi` thật → chuông + tab "Cần xử lý" hiện đúng
   "PI-2026-004: sắt đã xuất - vào xác nhận nhận / SAT-HOP-50X50: 1 cây."
2. Gọi thật `POST /steel-issues/:id/receive` (đóng vai `phoi`) → xác nhận `resolvedAt` được set;
   UI `phoi` reload → "Cần xử lý" về rỗng.
3. Gọi thật `POST /steel-issues/:id/cut-batches` rồi `POST /cut-bundles/:id/finish` (đóng vai `phoi`)
   → xác nhận `CUT_BUNDLE_TO_KCS` tạo cho `kcs`. UI `kcs` thật (màn "Cắt sắt") hiện đúng PI có 1 đợt
   chờ kiểm + chuông hiện đúng nội dung.
4. Gọi thật `POST /cut-bundles/:id/qc-review` với `failedQty=1` (đóng vai `kcs`) → xác nhận
   `CUT_BUNDLE_TO_KCS` resolved, `QC_FAILED` fan-out đúng CẢ `phoi` (tổ gửi) lẫn `qlsx`. UI `phoi`
   thật, tab "Tất cả" (đúng - RESULT không vào "Cần xử lý") hiện đúng đầu danh sách
   "PI-2026-004: KCS chấm lỗi 1 / Kiểm tra lại, sửa hoặc báo bù đủ bằng đợt mới."; thông báo
   `STEEL_ISSUE_TO_PHOI` trước đó hiện đúng "Đã xử lý".
5. Lặp lại 1 đợt cắt mới, duyệt `failedQty=0` → xác nhận `QC_PASSED` tạo ĐÚNG 1 người nhận `qlsx`
   (không kèm `phoi`, đúng thiết kế mục 19.1).
6. Lặp lại toàn bộ chuỗi cho `ProductionBatch` (record → finish → review) ở CẢ 2 stage `HAN` (đóng
   vai `han`) và `SON` (đóng vai `son`) trên cùng PI - xác nhận `BATCH_TO_KCS` tạo đúng cho `kcs`,
   `QC_FAILED` (test ở nhánh HAN) fan-out đúng `han` + `qlsx` (`senderRole` map đúng theo
   `batch.stage`), `QC_PASSED` (test ở nhánh SON) chỉ tới `qlsx`.

**Dọn dữ liệu sau test:** xoá `qc_reviews`/`qc_review_segments`/`cut_pattern_segments`/`cut_bundles`/
`steel_issues`/`production_batches` vừa tạo; xoá `stock_ledger` (`SEGMENT_CONSUME` từ
`finishProductionBatch()` nhánh HAN có `PieceBom`) + `stock_quant` vừa phát sinh (2 dòng kho nguồn/
đích × 2 segmentSpec, đều là dòng MỚI hoàn toàn - xoá hẳn thay vì trừ ngược); trả `consumedQty` của
`StockReservation` (PI 6 + vật tư 1) về đúng `5.0000` (trước test). Xác nhận qua `psql`:
`notifications` về đúng 21 baseline, `steel_issues`/`cut_bundles`/`production_batches` về đúng
17 QC_PASSED / 19 QC_PASSED / 61 QC_DONE (y hệt trước test), `qc_reviews` về đúng 80 dòng gốc,
`stock_quant` không còn dòng nào ở (kho 3, kho 5) × (segmentSpec 1, 2).

### 19.4 Còn treo

- ~~Phase 3b còn 5 nhóm...~~ **7.5-ii ĐÃ XONG (mục 22), 7.5-iii ĐÃ XONG (mục 23).** Còn 3 nhóm:
  7.5-iv (xuất/nhận đan), 7.5-v (chuyển kiểm lỗi - thực ra tái dùng hạ tầng có sẵn của
  `production-invoices.service.ts`, không cần DI mới), 7.5-vi (đóng gói xong → Sales) - làm tiếp
  theo cùng cách.
- `weaving-issues`/`weaving-receipts` (7.5-iv) không có state machine hay FK liên kết trực tiếp giữa
  xuất và nhận (append-only, so khớp qua tổng aggregate) - "tự đóng khi nhận" sẽ cần thiết kế riêng
  (composite entityId hoặc bỏ tự đóng), chưa quyết định - để hỏi người dùng khi tới nhóm đó.
- "Đóng gói xong → Sales" (7.5-vi) không có cột "Sales phụ trách" trên `SalesOrder` (đã ghi nhận từ
  mục 15.2) - dự kiến lặp lại giải pháp cũ: báo cả role `SALES_STAFF`.
- ~~4 type nhóm này chưa có `link`...~~ **ĐÃ GẮN Ở MỤC 22.2** (nay `?p=` đã có ở `MfgApp.tsx`) -
  `STEEL_ISSUE_TO_PHOI`/`CUT_BUNDLE_TO_KCS`/`BATCH_TO_KCS` đều có `link` thật.

## 20. Dọn nốt việc nhỏ còn treo của Phase 2 — _ĐÃ XONG 2026-09-28_

Repo: `D:\DNA-ERP` (FE). Sau khi Phase 3a/3b (mục 15-19) đã đi khá xa, người dùng hỏi lại "giờ nên làm
gì tiếp" và chọn quay lại dọn nốt các việc nhỏ còn treo của Phase 2 (mục 12.4) trước khi làm tiếp
Phase 3b: sửa double-poll, và (phát sinh giữa chừng, ngoài kế hoạch) khôi phục sau 1 sự cố merge Git.

### 20.1 Sửa double-poll (mục 12.4, gạch đầu dòng 1)

- **`src/context/NotificationsContext.tsx`** (file mới): bọc hook `useNotifications()` (đổi tên nội
  bộ thành `useNotificationsState`, export type `NotificationsState = ReturnType<typeof
  useNotificationsState>`) vào 1 `NotificationsProvider` dùng `createContext`/`useContext` - mọi
  `<NotificationCenter>` (top bar + chân sidebar, kể cả khi cả 2 cùng tồn tại lúc drawer mobile bị bỏ
  mở) giờ đọc chung 1 state/1 vòng poll thay vì mỗi instance tự gọi hook riêng.
- **`src/app/layout.tsx`**: bọc `<NotificationsProvider>` quanh `children` (trong `AuditLogProvider`,
  ngoài `InspectionProvider`) - 1 nguồn poll cho toàn app, không phải riêng từng `*App.tsx`.
- **`src/components/NotificationCenter.tsx`**: đổi import từ gọi thẳng hook trong `hooks/
  useNotifications.ts` sang `useNotifications()` của context mới.
- **Kiểm tra:** `tsc --noEmit` 0 lỗi, `eslint` 0 error, `vitest run` 52/52 pass. Xác nhận bằng đọc lại
  network log lúc live-test trước đó (mục 12.4) không còn khả năng lặp lại vì chỉ còn 1 nơi gọi
  `setInterval` cho toàn cây, không phải theo từng `<NotificationCenter>` mount.

### 20.2 Sự cố merge Git làm mất lại 1 phần việc đã sửa (phát sinh ngoài kế hoạch)

Người dùng `git stash pop` trên Fork (Git GUI) để lấy lại các thay đổi đang dở, gặp conflict ở 3 file
(`AdminApp.tsx`, `SpecDetailQuotaPage.tsx`, `SpecSteelPage.tsx`) - nhánh "Updated upstream" (bản cũ,
trước khi có `NotificationCenter`/trước khi gỡ `NotifBell`) và "Stashed changes" (bản đã sửa trong
phiên làm việc). Người dùng hỏi kiểm tra giúp mức độ nghiêm trọng của 3 conflict trước khi hoàn tất
merge trong Fork.

**Phát hiện sau khi Fork hoàn tất merge:** cả 3 file bị chọn nhầm về phía "Updated upstream" (bản cũ)
thay vì giữ đúng phần đã sửa - hệ quả:
- `SpecDetailQuotaPage.tsx`/`SpecSteelPage.tsx`: `NotifBell` (đã xoá file `components/NotifBell.tsx`
  ở mục 12.1) bị import/dùng lại trong JSX → **lỗi build thật** (import trỏ tới file không tồn tại),
  không chỉ là mất công sức sửa.
- `AdminApp.tsx`: mất hẳn `NotificationCenter` (cả 2 chỗ gắn) - đồng thời file này ở nhánh upstream đã
  có thêm 1 thay đổi KHÔNG liên quan tới notification (layout compact/responsive mới, khớp 6 app shell
  còn lại) nên không thể phục hồi bằng cách lấy lại bản cũ đã sửa, phải làm lại việc gắn
  `NotificationCenter` + `?p=` URL-sync trên CHÍNH bản mới này (xem 20.3).

**Đã sửa** (phát hiện qua `grep -rn "NotifBell"` ra kết quả ngoài dự kiến, không phải người dùng chỉ
lại lần 2):
- Gỡ lại import + JSX `NotifBell` khỏi `SpecDetailQuotaPage.tsx`/`SpecSteelPage.tsx`, khôi phục đúng
  comment giải thích + cấu trúc header đơn giản như trước sự cố.
- Gắn lại `NotificationCenter` vào `AdminApp.tsx` (chi tiết ở 20.3, vì phải làm trên shape file mới).

**Kiểm tra:** `tsc --noEmit` 0 lỗi, `eslint` trên cả 7 file liên quan (3 file conflict +
`useNotifications.ts`/`NotificationsContext.tsx`/`NotificationCenter.tsx`/`layout.tsx`) 0 error - các
warning còn lại (`react-hooks/set-state-in-effect`/`exhaustive-deps` ở pattern URL-sync,
`react/no-unescaped-entities` ở `SpecSteelPage.tsx`, `onSubTabChange` unused) đều xác nhận có sẵn từ
trước (cùng lý do đã ghi ở mục 12.3/15.3), không phải lỗi mới. `vitest run` 52/52 pass (20.1).

**Bài học quy trình:** merge/stash-pop trong Git GUI vẫn cần soát lại kỹ (grep theo tên
component/file đã xoá) sau khi hoàn tất, đặc biệt khi 1 phía đã có thêm thay đổi không liên quan tới
phần đang conflict - chọn "theo cả file" dễ nuốt mất phần đã sửa dở lẫn phần mới không liên quan.

### 20.3 Thêm `?p=` URL-sync cho `AdminApp.tsx`

Nhân lúc phải làm lại `AdminApp.tsx` sau sự cố 20.2 (file đã có top bar compact mới, lần đầu tiên
AdminApp có top bar để đặt `NotificationCenter size={20}`), làm luôn phần còn thiếu theo đúng pattern
6 app shell kia (mục 12.5.B/17.3): `ADMIN_PAGE_VALUES`/`isAdminPage` type guard, `useUrlState('p')` +
`useState<AdminPage>` khởi tạo từ URL + `useEffect` đồng bộ ngược (điều hướng từ ngoài vào, vd
`NotificationCenter` gọi `router.push('/?m=admin&p=...')` trong tương lai). Gắn `NotificationCenter`
ở CẢ 2 chỗ: `color="var(--text3)"` chân sidebar (mọi màn) + `size={20}` top bar compact (màn hẹp).

Hiện **chưa có type thông báo nào trỏ tới module `admin`** (giống lý do 6 app shell kia làm trước khi
có nhu cầu thật - mục 12.4) nên phần `?p=` này là chuẩn bị hạ tầng, chưa được link nào dùng tới ngay -
nhất quán với cách làm đã chọn cho các app khác, không phải làm thừa riêng cho Admin.

**Kiểm tra:** `tsc --noEmit`/`eslint` như 20.2. Chưa live-test riêng bằng browser (không có server BE/
FE nào đang chạy sẵn ở phiên này) - độ rủi ro thấp vì cùng 1 pattern đã live-test kỹ ở
`ProductionPlanApp`/`MfgApp`/`PurchasingApp` (mục 12.3/16.4/17.4), chỉ khác tên biến/route.

### 20.4 Thêm nốt `?p=` URL-sync cho `SalesApp.tsx` (app shell cuối cùng)

Làm nốt ngay trong phiên này để cả 7/7 app shell đồng bộ URL cùng 1 pattern (trước đó 6/7 - thiếu
đúng Sales). Cùng idiom `TAB_VALUES`/`isTabId`/`useUrlState('p')`/`useEffect` đồng bộ ngược đã dùng ở
6 app kia - không có gì khác biệt vì `SalesApp.tsx` vốn đã dùng `TabId` đơn giản (3 giá trị, không
lồng nav như `AdminApp`/`ProductionPlanApp`).

**Kiểm tra:** `tsc --noEmit` 0 lỗi, `eslint` 0 error - 2 warning
`react-hooks/set-state-in-effect`/`exhaustive-deps` giống hệt pattern đã chấp nhận ở 6 app kia (không
phải lỗi mới). `vitest run` 52/52 pass.

**Live-test thật** (bật lại Docker Desktop + `dna-erp-be-postgres-1`, `nest start --watch` cổng 3001,
`next dev` cổng 3000, browser thật đăng nhập `sales`/`demo1234`): bấm "Quản lí khách hàng" trong
drawer (màn hẹp mặc định của Browser pane, đúng nhóm compact) → URL đổi đúng
`?m=sales&p=customers`; F5 (`navigate` lại đúng URL đó) → app mở thẳng đúng tab "Quản lí khách hàng"
(không rơi về "Quản lí đơn hàng" mặc định) - đúng mục tiêu mục 6.2. Console không còn lỗi (2-3 lỗi
`ERR_CONNECTION_REFUSED` thấy lúc đầu là do bấm đăng nhập trước khi BE compile xong, không liên quan
đến thay đổi này). Nhân tiện xác nhận luôn double-poll (mục 20.1) đã hết: network log chỉ thấy đúng 1
request `unread-count` mỗi lần, không lặp. Dọn dẹp: dừng cả 2 server sau khi test, không có dữ liệu
DB nào bị thay đổi (chỉ đọc, không tạo/sửa gì trong lúc test này).

### 20.5 Còn treo

- **Trang "Thông báo của tôi" riêng** (mục 12.4) - vẫn chưa làm, panel 50 dòng vẫn đang là giải pháp
  tạm. Đây là việc còn lại DUY NHẤT của Phase 2 sau mục này.
- `AdminApp.tsx` (mục 20.3) chưa live-test riêng bằng browser thật lúc viết mục đó - **đã tiện thể
  live-test được ở đợt 20.4** (đăng nhập `sales` không qua Admin, nhưng cơ chế `useUrlState` dùng
  chung 100% code với `SalesApp` nên coi như đã xác nhận gián tiếp; nếu cần chắc chắn tuyệt đối nên
  test riêng bằng tài khoản admin khi có dịp).

## 21. Trang "Thông báo của tôi" riêng — _ĐÃ XONG 2026-09-28, Phase 2 hoàn tất toàn bộ_

Việc treo cuối cùng của Phase 2 (mục 6.1, 12.4, 20.5): panel chuông giới hạn 50 dòng, không phân
trang/lọc/tìm kiếm thật. User yêu cầu "hãy thực hiện phase 2" - làm nốt đúng phần này.

### 21.1 BE: thêm lọc `search` vào `findMyNotifications()`

`ListNotificationsQueryDto` kế thừa `PaginationQueryDto` (đã sẵn field `search?: string` dùng chung
toàn repo) nhưng `findMyNotifications()` trước đó bỏ qua field này hoàn toàn - không cần thêm field
DTO mới, chỉ cần DÙNG field đã có.
[notifications.service.ts](../src/modules/notifications/notifications.service.ts): gộp điều kiện
`category` và `search` vào 1 object `notificationFilter: Prisma.NotificationWhereInput` (trước đó
`category` tự đứng 1 mình dạng `...(cond ? {notification: {...}} : {})` - nếu thêm `search` theo
đúng khuôn đó bằng 1 dòng `...(cond2 ? {notification: {...}} : {})` NỮA thì object sau ghi đè mất
object trước, chỉ còn lọc được 1 trong 2 cùng lúc). `search` lọc `title`/`message` kiểu
`contains, mode: insensitive`, tự `.trim()` và bỏ qua khi rỗng/toàn khoảng trắng.

**Test:** 3 test mới trong `findMyNotifications` (search đơn lẻ, search+category gộp đúng 1 object
không đè nhau, search toàn khoảng trắng bị bỏ qua) - `notifications.service.spec.ts` 27/27 pass.
`tsc --noEmit` 0 lỗi (2 lỗi `factoryCode`/`MfgProductWhereUniqueInput` ở 2 file `seed-*.ts` xác nhận
có sẵn từ trước bằng `git stash`, không liên quan). `eslint` trên file sửa: 0 error, 0 warning. `jest`
toàn repo: **1228/1228 pass, 50/50 suite**.

### 21.2 FE: `MyNotificationsPage.tsx` - overlay toàn màn hình, không thuộc module nào

Trang này KHÔNG phải 1 tab trong `*App.tsx` nào (mọi role, mọi module đều cần xem "thông báo của
tôi", không riêng 1 phân hệ) - làm dạng **overlay toàn màn hình mở qua query `?notif=all`**, tương
tự cách `?m=`/`?p=` đã làm nhưng KHÔNG cần đồng bộ 2 chiều (không có state cục bộ nào phải nhớ, chỉ
cần đọc trực tiếp từ URL mỗi lần render):

- **`app/page.tsx`**: `const [notifPage, setNotifPage] = useUrlState('notif')`; render
  `{notifPage === 'all' && <MyNotificationsPage onClose={() => setNotifPage(null)} />}` CHỒNG LÊN
  TRÊN `content` (không thay thế trong switch activeModule) - đóng lại (xoá `notif`) không mất
  `m`/`p` đang xem dở bên dưới; `content` vẫn mounted (giữ nguyên state/scroll của app shell) vì
  overlay chỉ che bằng CSS (`position: fixed, inset: 0, background` đặc), không unmount cây bên dưới.
- **`components/NotificationCenter.tsx`**: thêm nút "Xem tất cả" ở chân panel, gọi `router.push`
  (KHÔNG dùng `useUrlState`'s setter, luôn `replace`) để thêm `notif=all` - cố ý dùng `push` để có 1
  nấc lịch sử, nút Back đóng lại được đúng chỗ đang xem (đúng mục tiêu mục 6.2, và đúng khuyến nghị
  ghi sẵn trong doc comment `useUrlState.ts`: "nơi cần push thật... tự gọi router.push riêng").
- **`components/MyNotificationsPage.tsx`** (file mới): header (nút Back/đóng, tiêu đề, "Đọc tất cả"
  khi còn thông báo chưa đọc) + thanh lọc (tìm kiếm debounce 400ms - cùng idiom
  `GomDotCatPage.tsx`, chọn loại/category, đã đọc hay chưa, đã xử lý xong hay chưa) + danh sách +
  `Pagination` (component dùng chung, đã có sẵn trong repo) - **phân trang THẬT từ BE** (khác
  `Admin/NotificationsPage` tải hết 200 dòng rồi cắt ở FE), 20 dòng/trang. Đổi bất kỳ bộ lọc nào tự
  quay về trang 1.
- Bấm 1 dòng: đánh dấu đã đọc qua **context dùng chung** (`useNotifications()` của
  `NotificationsContext`, KHÔNG gọi thẳng service) - để badge/chuông cập nhật NGAY, không phải chờ
  tới lượt poll 30s kế tiếp (xác nhận bằng live-test bên dưới). Có `link` → điều hướng `router.push`
  (rời khỏi trang này luôn, giống panel). Không có `link` → chỉ tải lại danh sách tại chỗ (khác panel
  - panel luôn tự đóng sau khi bấm vì là dropdown thoáng qua, còn đây là 1 trang duyệt danh sách nên
  hợp lý hơn khi cho ở lại xem tiếp thay vì tự đóng).
- `services/notifications-api.ts`: `ListNotificationsParams` thêm `search?: string`, tự `.trim()` +
  bỏ qua nếu rỗng trước khi gắn vào query string (khớp hành vi BE ở 21.1).
- Đặt `zIndex: 1400` (cao hơn cả panel chuông `1200` lẫn toast `1300`) - chắc chắn phủ kín màn hình
  mọi trường hợp (vd mở lại bằng URL/bookmark khi có modal khác đang mở dở).

### 21.3 Cố ý không làm

- **Không thêm nút "Ẩn" (archive)** vào trang này dù `NotificationsState.archive()` đã có sẵn từ
  Phase 2 (mục 12.1) và chưa từng được dùng ở đâu - không nằm trong yêu cầu ban đầu (mục 6.1 chỉ nói
  "lọc theo loại, tìm kiếm, phân trang"), thêm sẽ vượt phạm vi "làm nốt Phase 2".
- **Không thêm `search` vào `NotificationCenter` panel** (vẫn giữ 50 dòng, không lọc/tìm) - đúng
  phân công vai trò 2 nơi: panel = xem nhanh việc mới/gần đây, trang riêng = tra cứu sâu/lịch sử.

### 21.4 Kết quả kiểm tra

- `tsc --noEmit` (FE): 0 lỗi. `eslint` trên `MyNotificationsPage.tsx`/`NotificationCenter.tsx`/
  `notifications-api.ts`: 0 error, 0 warning; `app/page.tsx` có 2 warning
  `react-hooks/set-state-in-effect`/`exhaustive-deps` xác nhận CÓ SẴN từ trước (không phải do thay
  đổi mục này - cùng 2 dòng đã ghi nhận từ mục 12.3).
- `vitest run`: **53/53 pass** (thêm 1 test `search` cho `getNotifications()`).
- **Live-test thật** (Docker + `nest start --watch` (3001) + `next dev` (3000), browser thật):
  - `boss`: bấm chuông → "Xem tất cả" → URL đổi đúng `?notif=all`, trang mở đúng, hiện "Chưa có
    thông báo nào" (boss hiện không có notification nào trong DB dev - đúng thực tế, không phải lỗi).
  - `qlsx` (21 notification lịch sử): trang hiện đủ 21 dòng, phân trang 2 trang (20+1) đúng theo
    `meta.total`/`meta.totalPages` từ BE. Gõ "GHEJ55" vào ô tìm - sau 400ms gọi đúng
    `search=GHEJ55`, lọc còn ĐÚNG 6 dòng có "GHEJ55" trong tiêu đề (xác nhận qua response thật, không
    phải đếm bằng mắt). Chọn "Cảnh báo" (category=ALERT) + "Chưa xử lý xong" (resolved=false) cùng
    lúc - request gộp đúng cả 2 param, không cái nào đè cái nào (xác nhận trực tiếp lỗ hổng đã sửa ở
    21.1 không tái diễn ở phía gọi thật).
  - Bấm 1 dòng chưa đọc (không có `link`) → gọi đúng `POST .../read`, dòng đó hết đậm/hết chấm xanh
    NGAY LẬP TỨC, KHÔNG điều hướng đi đâu (đúng thiết kế 21.2). Đóng trang lại (nút Back) → chuông ở
    `MfgApp` giảm đúng 19→18 (badge cập nhật NGAY, không cần đợi poll - xác nhận cơ chế dùng chung
    context hoạt động đúng).
  - Bấm "Đọc tất cả" → toàn bộ 21 dòng hết đậm, nút "Đọc tất cả" tự ẩn (hết `hasUnread`); đóng trang -
    chuông hết số đỏ (0 chưa đọc).
  - Dọn dữ liệu: `UPDATE notification_recipients SET "readAt" = NULL` cho 21 dòng vừa đánh dấu đọc,
    xác nhận lại bằng `psql` (0 dòng còn `readAt` khác NULL) VÀ bằng browser (F5 lại, bell trở về
    đúng badge "21" + toast cảnh báo bật lại đúng như lúc đầu phiên) - khôi phục đúng trạng thái
    trước khi test, không để lại rác.
- **Quan sát phụ (không phải bug):** `useFetch` bắn 2 request giống hệt nhau khi trang vừa mount -
  do `next.config.mjs` bật `reactStrictMode: true` (double-invoke effect ở dev để lộ side-effect
  không sạch), chỉ xảy ra trong dev, không xảy ra ở production build. Không phải lỗi riêng của trang
  này - poll của `NotificationsContext`/panel cũng chịu ảnh hưởng tương tự trong dev.

### 21.5 Còn treo

Không còn gì của Phase 2. Việc kế tiếp theo plan mục 8 là Phase 3b (5 nhóm còn lại của mục 7.5: xuất
vật tư/bao bì, chuyển kho, đan, chuyển kiểm, đóng gói→Sales), Phase 3c, Phase 4 (badge "việc chờ
tôi"), Phase 5 (realtime) - xem mục 19.4 cho chi tiết từng nhóm.

## 22. Phase 3b — nhóm 7.5-ii "Xuất vật tư tiêu hao/thành phẩm/bao bì" (3 sự kiện) — _ĐÃ XONG 2026-09-28_

Người dùng: *"tiếp tục từng bước phase 3, cứ hoàn thành mỗi bước là thực hiện test BE và live-test
kỹ càng... tối ưu UI UX cho người dùng chuẩn của một hệ thống ERP"*. Tiếp tục Phase 3b (7.5-i xong ở
mục 19) - nhóm kế tiếp theo bảng mục 7.5: dòng B "Xuất vật tư / vật tư định mức / bao bì" (3 service
`material-issues`, `material-yield-issues`, `packaging-issues`).

### 22.1 Phạm vi - 3 type mới

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `MATERIAL_ISSUE_TO_TEAM` | ACTION/INFO | HAN_STAFF hoặc SON_STAFF (theo `stage`) | `MaterialIssuesService.create()` | tổ nhận `receive()` |
| `MATERIAL_YIELD_ISSUE_TO_PHOI` | ACTION/INFO | PHOI_STAFF | `MaterialYieldIssuesService.create()` | Phôi `receive()` |
| `PACKAGING_ISSUE_CREATED` | INFO/INFO | PRODUCTION_MANAGER | `PackagingIssuesService.create()` | KHÔNG tự đóng |

`entityType` = `MATERIAL_ISSUE`/`MATERIAL_YIELD_ISSUE`/`PACKAGING_ISSUE` tương ứng, `entityId` = id
bản ghi. Cả 3 dùng chung 1 params interface `MaterialIssueNotificationParams { piCode, materialCode,
qty, unit, stage? }` - `unit` đọc thật từ `Material.unit` (khác `SteelIssueNotificationParams` hard
-code "cây" vì sắt luôn tính theo cây, các vật tư khác thì không).

### 22.2 Nhân tiện: gắn `link` còn thiếu cho nhóm 7.5-i (mục 19)

Lúc làm mục 19, `MfgApp.tsx` CHƯA có `?p=` URL-sync nên `STEEL_ISSUE_TO_PHOI`/`CUT_BUNDLE_TO_KCS`/
`BATCH_TO_KCS` cố ý bỏ trống `link` (mục 19.2). Nay `?p=` đã có ở mọi app shell (mục 20) - nối luôn
vào 3 type cũ đó, đúng tinh thần "tối ưu UI UX" người dùng vừa yêu cầu, không đợi thêm 1 đợt riêng:

- `STEEL_ISSUE_TO_PHOI` → `{module:'production', page:'phoi-xac-nhan-nhan-sat'}` (an toàn nối vì
  recipient CHỈ 1 role PHOI_STAFF).
- `CUT_BUNDLE_TO_KCS` → `{module:'production', page:'kcs-phoi'}` (recipient chỉ KCS_STAFF, luôn 1
  page cố định vì CutBundle luôn là Phôi).
- `BATCH_TO_KCS` → PHẢI rẽ nhánh theo `stage` (`kcs-phoi`/`kcs-han`/`kcs-son`) vì KCS xem Phôi/Hàn/Sơn
  ở 3 TAB RIÊNG trong `MfgApp.tsx` - khác `CUT_BUNDLE_TO_KCS`. Phát hiện lúc code: `ProductionBatch`
  không chỉ có stage HAN/SON như tên gọi "Hàn/Sơn báo xong 1 đợt sản xuất" ở mục 19 mô tả - **PHÔI
  cũng tạo được `ProductionBatch`** (piece tự báo qua `PieceMaterialYield`, không qua `CutBundle`/
  bin-packing, xem `ProductionBatchesService.assertMfgRoleMatchesStage()`) - nếu chỉ rẽ 2 nhánh
  HAN/SON như dự định ban đầu, batch stage=PHOI sẽ bị điều hướng NHẦM sang tab `kcs-han`. Sửa:
  `ProductionBatchesService.finishProductionBatch()` truyền thêm `stage: updated.stage` vào params;
  `notification-types.ts` rẽ đủ 3 nhánh, mặc định `kcs-phoi` khi không phải HAN/SON.
- **Vẫn KHÔNG gắn `link`** cho `QC_FAILED`/`QC_PASSED` (mục 7.3) dù kỹ thuật làm được (đọc thêm
  1-2 dòng comment mới trong `notification-types.ts` giải thích rõ) - 2 role nhận (tổ gửi + QLSX)
  cần 2 tab hành động khác nhau trong CÙNG module `production` (tổ gửi cần `phoi-lenh-sx`, QLSX
  không nằm trong điều kiện hiện tab đó ở `MfgApp.tsx` nên sẽ thấy màn trống) - đúng lớp vấn đề đã
  né ở `PI_APPROVED_BY_BOSS` (mục 16.2), chỉ khác là cùng module thay vì khác module.

### 22.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 3 type mới (22.1),
  `link` cho 3 type cũ (22.2), mở rộng `QcSubmittedNotificationParams` thêm `stage?: 'PHOI'|'HAN'|'SON'`.
- [material-issues.service.ts](../src/modules/material-issues/material-issues.service.ts): thêm
  `NotificationsService`, include thêm `productionInvoiceItem.productionInvoice.code` (lấy piCode);
  `create()` emit sau transaction, `receive()` resolve.
- [material-yield-issues.service.ts](../src/modules/material-yield-issues/material-yield-issues.service.ts):
  tương tự - `create()` emit, `receive()` resolve.
- [packaging-issues.service.ts](../src/modules/packaging-issues/packaging-issues.service.ts):
  `create()` emit - KHÔNG có `resolve()` cặp đôi (không có bước nhận hàng, đã chốt trước ở mục 19.1).
- [production-batches.service.ts](../src/modules/production-batches/production-batches.service.ts):
  `finishProductionBatch()` truyền thêm `stage` vào params `BATCH_TO_KCS` (22.2).
- 3 `*.module.ts` (material-issues, material-yield-issues, packaging-issues): import `NotificationsModule`.
- Test: material-issues (+3: emit, không emit lại khi idempotency-replay, resolve), material-yield-issues
  (+2: emit, resolve), packaging-issues (+1: emit), production-batches (+2: `it.each` cho SON/PHOI,
  sửa lại test HAN có sẵn thêm field `stage`).
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi (2 lỗi `factoryCode` ở `seed-*.ts` xác nhận có sẵn từ
  trước bằng `git stash`). `npx eslint --fix` trên mọi file sửa: 0 error, 1 warning `no-explicit-any`
  cố ý có sẵn (như mọi lần trước). `npx jest` toàn repo: **1236/1236 pass, 50/50 suite** (tăng từ
  1228 ở mục 21 - 8 test mới).

### 22.4 Live-test thật (BE+FE+DB thật, browser thật) - đủ cả 3 type mới lẫn 3 link cũ

Docker + `nest start --watch` (3001) + `next dev` (3000). Dữ liệu BOM cho 3 loại vật tư này KHÔNG hề
tồn tại trong DB dev (`consumable_bom`/`piece_material_yield`/`bom_accessory_items` rỗng toàn bộ,
xác nhận bằng `psql` trước khi bắt đầu) - phải tự tạo 3 material test (`TEST-CO2-NOTIF`,
`TEST-VTTP-NOTIF`, `TEST-BAOBI-NOTIF2`) + dòng BOM tương ứng trên `bomRevisionId=1` (PO-TEST-REJECT-001-1,
PI-2026-004, order id=5, floorStage ACTIVE có sẵn từ mục 19.3) qua `psql` trực tiếp, cùng cách mục
15.4 đã làm cho vật tư bao bì trước đây (tạm chuyển `bom_revision.status='DRAFT'` để qua trigger
`assert_bom_revision_draft()`, insert xong trả về `ACTIVE`).

**Phát hiện giữa chừng (tự phát hiện, không phải lỗi thiết kế nhưng đáng ghi lại):** ban đầu gán cả
3 material test vào kho `vat-tu-tp` (id=2) theo đúng docstring BE ("đọc động từ Material.warehouseId"),
nhưng UI FE cho "Xuất vật tư hàn"/"Xuất vật tư TP" (`PhanPhoiNoiBoPage.tsx`, tab "Phân phối nội bộ")
chỉ hiện cho user có `warehouseScope` thuộc gia đình `phoi-son-han` - té ra nghiệp vụ THẬT của kho
này là "Kho Phôi-Sơn-Hàn cấp cả sắt LẪN vật tư tiêu hao/thành phẩm cho các tổ", không phải kho
`vat-tu-tp` như suy đoán ban đầu (kho đó chỉ dùng cho **bao bì**, đúng màn `WarehouseXuatPage.tsx`/
"Xuất theo đơn hàng"). Sửa: chuyển 2 material CO2/VTTP sang `warehouseId=3` (phoi-son-han), giữ
material bao bì ở `warehouseId=2` (vat-tu-tp) - khớp đúng 2 màn FE khác nhau đang thật sự tồn tại.

1. `khovttp` (WAREHOUSE_STAFF, scope vat-tu-tp) → "Xuất theo đơn hàng" → xuất 1 cuộn bao bì cho
   PO-TEST-REJECT-001 → xác nhận `PACKAGING_ISSUE_CREATED` tạo đúng cho `qlsx`, `link: null`,
   message "TEST-BAOBI-NOTIF2: 1 cuộn." (xác nhận qua `psql`).
2. `khopsh` (scope phoi-son-han) → "Phân phối nội bộ" → "Xuất vật tư hàn" xuất 3 bình CO2 cho HAN,
   "Xuất vật tư TP" xuất 2 thanh VTTP cho Phôi, "Xuất vật tư sơn" xuất 2 bình CO2 cho SON → xác nhận
   3 notification tạo đúng người nhận (`han`/`phoi`/`son`) qua `psql` - đặc biệt xác nhận
   `MATERIAL_ISSUE_TO_TEAM` chọn ĐÚNG role theo `stage` (HAN→`han`, SON→`son`, không lẫn).
3. `han` thật: chuông hiện đúng "PI-2026-004: vật tư đã xuất - vào xác nhận nhận / TEST-CO2-NOTIF: 3
   bình." → bấm → URL đổi đúng `?m=production&p=han-son-xac-nhan-vat-tu` → màn "Xác nhận sản lượng"
   hiện đúng dòng chờ → "Xác nhận đã nhận" → xác nhận `resolvedAt` set (qua `psql`).
4. `son` thật: lặp lại y hệt bước 3, xác nhận riêng cả 2 role đều tự resolve đúng, không lẫn
   notification của nhau.
5. `phoi` thật: chuông hiện đúng, bấm → URL đổi đúng `?m=production&p=phoi-xac-nhan-nhan-sat` → màn
   "Xác nhận nhận sắt" hiện CHUNG 1 danh sách gồm cả sắt lẫn "Vật tư TP test notif" → "Xác nhận đã
   nhận" → resolve đúng. Xác nhận GIÁN TIẾP `STEEL_ISSUE_TO_PHOI`'s `link` mới (22.2) cũng đúng vì
   CÙNG 1 trang/1 danh sách (không cần dựng riêng 1 luồng xuất sắt chỉ để test lại cơ chế điều hướng
   đã dùng chung).
6. `qlsx` thật: `PACKAGING_ISSUE_CREATED` hiện đúng ở tab "Tất cả" (KHÔNG ở "Cần xử lý" - đúng
   category INFO), bấm vào → mark-read (qua `psql`) → **URL KHÔNG đổi** (đúng vì `link: null`, đúng
   tinh thần "thà không link còn hơn link sai" - QLSX chỉ cần biết, không có việc gì để làm tiếp).
7. `BATCH_TO_KCS` (kiểm riêng, vì `create()` "báo sản lượng" đơn giản tạo thẳng `AWAITING_QC` không
   qua `finishProductionBatch()` - phải dùng đúng luồng "Lưu đợt" 2 bước `POST .../production-batches/record`
   rồi `POST .../production-batches/:id/finish`, gọi thẳng qua `fetch()` trong console với
   `access_token` thật của `han`, cùng idiom "gọi API thật" mục 16.4): tạo 1 batch HAN cho piece
   "chân bàn" → `finish()` → xác nhận qua `psql`: `link: {"page":"kcs-han","module":"production"}`
   (ĐÚNG rẽ nhánh, không lẫn `kcs-phoi`/`kcs-son`). `kcs` thật: bấm thông báo → URL đổi đúng
   `?m=production&p=kcs-han` (KHÁC tab mặc định `kcs-phoi` của KCS - xác nhận cơ chế điều hướng THẬT
   SỰ đổi tab, không phải tình cờ trùng tab đang mở) → duyệt đạt → `BATCH_TO_KCS` resolved, `QC_PASSED`
   tạo mới cho `qlsx`.

**Không live-test riêng** `CUT_BUNDLE_TO_KCS`'s `link` mới qua đúng luồng cắt sắt thật (dựng lại đủ
tiền đề bin-packing + duyệt phương án chỉ để test lại CƠ CHẾ ĐIỀU HƯỚNG đã proven đúng ở bước 3/4/7
không cân xứng) - type này dùng `link` HẰNG SỐ giống hệt `STEEL_ISSUE_TO_PHOI` (không rẽ nhánh), rủi
ro thấp.

**Dọn dữ liệu sau test:** xoá toàn bộ theo đúng thứ tự FK - `qc_reviews`/`production_batches` (2 đợt
test HAN), 6 dòng `notifications` mới (`MATERIAL_ISSUE_TO_TEAM`×2, `MATERIAL_YIELD_ISSUE_TO_PHOI`,
`PACKAGING_ISSUE_CREATED`, `BATCH_TO_KCS`, `QC_PASSED` - xác nhận trước đó cả 5 type này baseline = 0
dòng nên xoá theo `type` an toàn, không lẫn dữ liệu thật), `material_issues`/`material_yield_issues`/
`packaging_issues`, 5 dòng `transfer_check_results` vừa chèn, 3 dòng BOM test (tạm `DRAFT` lại
`bom_revision` để xoá), 8 dòng `stock_ledger` vừa phát sinh, `stock_quant` của 3 material test (xoá
hẳn vì hoàn toàn mới) + **khôi phục CỘNG/TRỪ NGƯỢC lại đúng 2 đơn vị** cho `stock_quant` của
`segmentSpecId` 1/2 (kho 3 và 5 - đây là tồn ĐOẠN SẮT THẬT, không phải test-only, bị 2 đợt
`ProductionBatch` test trừ qua `SEGMENT_CONSUME`, không thể xoá thẳng như các dòng vật tư test), 3
material test. Xác nhận lại bằng `psql`: `notifications` về đúng 21 dòng baseline, `stock_quant` của
2 segmentSpec về đúng 0/0 (baseline trước test), `bom_revision` 1 về `ACTIVE`, không còn
`transfer_check_results` nào cho item 5. Phát hiện thêm 1 dòng lệch nhỏ giữa chừng (1 notification cũ
`CUTTING_PROPOSAL_CALCULATION_FAILED` bị đánh dấu đọc ngoài ý muốn lúc thao tác trên `qlsx`) - sửa
nốt bằng `UPDATE ... readAt = NULL`, xác nhận `notification_recipients` không còn dòng nào `readAt`
khác NULL.

### 22.5 Còn treo

- ~~Phase 3b còn 4 nhóm: 7.5-iii...~~ **7.5-iii ĐÃ XONG, xem mục 23.** Còn 3 nhóm: 7.5-iv (xuất/nhận
  đan - vướng thiết kế "tự đóng" đã ghi ở mục 19.4, cần hỏi người dùng), 7.5-v (chuyển kiểm lỗi),
  7.5-vi (đóng gói xong → Sales).
- `CUT_BUNDLE_TO_KCS`'s `link` mới (22.2) chưa live-test qua đúng luồng cắt sắt thật - chỉ suy luận
  từ cùng cơ chế đã proven (mục 22.4). Nên test khi có dịp tự nhiên (1 lô cắt sắt thật đi qua Phôi→KCS
  trong lúc test việc khác).
- `BATCH_TO_KCS` stage=PHOI (piece tự báo qua `PieceMaterialYield`, không qua `CutBundle`) chưa
  live-test link `kcs-phoi` qua đúng dữ liệu PHÔI thật - chỉ có unit test (`it.each` mục 22.3) xác
  nhận `stage` truyền đúng qua `emit()`, chưa xác nhận bằng browser thật cho riêng nhánh này (đã xác
  nhận nhánh HAN/SON qua browser thật ở mục 22.4).

## 23. Phase 3b — nhóm 7.5-iii "Chuyển kho ngoài đơn hàng" (2 sự kiện) — _ĐÃ XONG 2026-09-28_

Tiếp tục Phase 3b (7.5-ii xong ở mục 22) - nhóm kế tiếp theo bảng mục 7.5: "Phiếu chuyển kho tạo" +
"Kho đích từ chối phiếu" (`warehouse-transfers.service.ts`).

### 23.1 Phạm vi - 2 type mới

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `WAREHOUSE_TRANSFER_CREATED` | ACTION/INFO | Kho ĐÍCH (`warehouseIds:[toWarehouseCode]`) | `create()` (vật tư) hoặc `createPieceTransfer()` (mảnh) | kho đích `confirm()` HOẶC `reject()` |
| `WAREHOUSE_TRANSFER_REJECTED` | RESULT/WARNING | Người TẠO phiếu (`userIds:[createdById]`) | `reject()`, kèm lý do | — |

`entityType='WAREHOUSE_TRANSFER'`, `entityId` = transferId cho cả 2. 1 params interface dùng chung
`WarehouseTransferNotificationParams { code, fromWarehouseName, itemCount, reason? }` - `itemCount`
đếm `items.length + pieceItems.length` (2 loại phiếu loại trừ nhau, 1 phiếu chỉ toàn 1 trong 2 mảng).

### 23.2 Phát hiện quan trọng nhất: `NotificationLink.params` chưa từng được đọc ở FE

`WAREHOUSE_TRANSFER_CREATED` cần trỏ vào đúng sub-tab "Nhập nội bộ" của `NhapKhoPage.tsx` - trang
này có 2 sub-tab (`nhap`/`noi-bo`) chọn bằng `useState` cục bộ, KHÔNG có URL riêng, và 2 sub-tab này
là 2 CHỨC NĂNG HOÀN TOÀN KHÁC NHAU ("Nhập kho" = nhận hàng mua về, "Nhập nội bộ" = xác nhận phiếu
chuyển kho). Chỉ trỏ `page:'nhap-kho'` sẽ luôn rơi đúng vào sub-tab MẶC ĐỊNH SAI ("Nhập kho") - đúng
lớp "gây hiểu lầm hơn không link" đã né nhiều lần trước (mục 12.6).

Đi tìm cách gắn thêm 1 tham số thì phát hiện: `NotificationLink.params?: Record<string, string |
number | null>` đã được khai báo trong type TỪ ĐẦU (mục 5.1 changelog, dùng cho mọi type suốt từ
Phase 1) nhưng **`NotificationCenter.tsx` và `MyNotificationsPage.tsx` chưa bao giờ đọc field này** -
`openNotification()` ở cả 2 nơi chỉ dựng URL từ `link.module`/`link.page`, bỏ qua hẳn `link.params`.
Không phải bug (không type nào TỪNG cần tới `params` để hoạt động đúng - mọi `link` trước giờ chỉ cần
`module`/`page`), nhưng là hạ tầng "có khai báo mà chưa ai dùng tới" - lộ ra đúng lúc cần.

**Đã sửa:**
- [utils/notificationLink.ts](../../DNA-ERP/src/utils/notificationLink.ts) (file mới): hàm thuần
  `buildNotificationLinkUrl(link)` dựng `/?m=...&p=...&<params thêm>` - gộp logic dựng URL vốn bị
  COPY-PASTE giống hệt nhau ở `NotificationCenter.tsx` và `MyNotificationsPage.tsx` thành 1 chỗ, kèm
  xử lý `params` (bỏ qua giá trị `null`, quy đổi số sang chuỗi). Có test riêng
  ([notificationLink.test.ts](../../DNA-ERP/src/utils/notificationLink.test.ts), 5 case).
- `NotificationCenter.tsx`/`MyNotificationsPage.tsx`: `openNotification()` đổi sang gọi
  `buildNotificationLinkUrl()` thay vì tự dựng `URLSearchParams` tay.
- [NhapKhoPage.tsx](../../DNA-ERP/src/modules/pages/Manufacturing/NhapKhoPage.tsx): thêm
  `useUrlState('sub')` cho sub-tab `nhap`/`noi-bo` - cùng idiom `p` ở cấp app shell, chỉ khác đây là
  sub-tab lồng bên trong 1 page đã có `p='nhap-kho'` nên phải dùng tên tham số KHÁC (`sub`, không
  phải `p`) để 2 tầng cùng tồn tại trong query string.
- `notification-types.ts`: `WAREHOUSE_TRANSFER_CREATED.link` = `{module:'inbound_warehouse',
  page:'nhap-kho', params:{sub:'noi-bo'}}` - type ĐẦU TIÊN thực sự dùng `params`.

`WAREHOUSE_TRANSFER_REJECTED` KHÔNG cần `params` - trỏ thẳng `lich-su-kho` (nơi duy nhất xem lại
phiếu REJECTED, vì "Nhập nội bộ" chỉ hiện phiếu PENDING) - tab này tự động scope theo kho của người
xem, an toàn nối vì mọi kho (vat-tu-tp/phoi-son-han/thanh-pham) đều thấy tab này.

### 23.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 2 type mới, 1 params
  interface `WarehouseTransferNotificationParams`.
- [warehouse-transfers.service.ts](../src/modules/warehouse-transfers/warehouse-transfers.service.ts):
  thêm `NotificationsService`; `notifyTransferCreated()` gọi ở CUỐI CẢ `create()` LẪN
  `createPieceTransfer()` (2 nhánh tạo phiếu độc lập, cùng chung 1 loại thông báo);
  `resolveTransferCreated()` gọi ở `confirm()` VÀ ở đầu `reject()` (cả 2 đều đưa phiếu rời PENDING);
  `notifyTransferRejected()` gọi thêm ở `reject()` sau khi resolve.
- [warehouse-transfers.module.ts](../src/modules/warehouse-transfers/warehouse-transfers.module.ts):
  import `NotificationsModule`.
- Test: +7 (`create`: emit đúng params + không emit lại khi idempotency-replay; `createPieceTransfer`:
  emit đúng itemCount từ `pieceItems`; `confirm`: resolve; `reject`: resolve + emit kèm lý do đúng
  người tạo).
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi (2 lỗi `factoryCode` ở `seed-*.ts` xác nhận có sẵn từ
  trước). `npx eslint --fix`: 0 error, 1 warning `no-explicit-any` cố ý có sẵn. `npx jest` toàn repo:
  **1241/1241 pass, 50/50 suite** (tăng từ 1236 ở mục 22 - đúng 5 test service mới, KHÔNG phải 7 vì 2
  test ban đầu viết dạng `expect.objectContaining` lồng nhau bị ESLint chặn `no-unsafe-assignment` -
  viết lại 1 test bằng cách đọc thẳng `mock.calls[0]` thay vì lồng matcher, giảm còn 1 assertion gọn
  hơn cho case đó).
- FE: `tsc --noEmit` 0 lỗi, `eslint --fix` trên mọi file sửa 0 error (2 warning
  `react-hooks/set-state-in-effect`/`exhaustive-deps` ở `NhapKhoPage.tsx` - cùng pattern đã chấp nhận
  ở mọi nơi khác dùng `useUrlState` cho sub-tab). `vitest run`: **58/58 pass** (+5 test
  `notificationLink.test.ts`).

### 23.4 Live-test thật (BE+FE+DB thật, browser thật)

Dữ liệu thật trong DB dev không dùng được: vật tư sắt duy nhất còn tồn ở kho Phôi Sơn Hàn
(`SAT-HOP-50X50`) nằm ở bucket chiều dài 6000mm ≠ 0, mà `create()` CHẶN CỨNG chuyển kho tự do cho vật
tư có tồn ở bucket khác 0 ("chuyển kho nội bộ chưa hỗ trợ chọn cỡ cây") - phải tạo 1 material test
(`TEST-CHUYENKHO-NOTIF`) + `stock_quant` bucket 0 qua `psql`, cùng cách các nhóm trước.

**Phát hiện giữa chừng (tự phát hiện):** định gán material test vào kho Phôi Sơn Hàn rồi test
`khopsh` tạo phiếu - té ra tab "Chuyển kho ngoài đơn hàng" (`ChuyenKhoTuDoPage.tsx`) CHỈ hiện cho
scope `vat-tu-tp`/`thanh-pham` trong `InboundWarehouseApp.tsx` (`ALL_TABS.filter`), KHÔNG hiện cho
`phoi-son-han` - nghiệp vụ thật là Phôi Sơn Hàn chỉ phân phối ra ngoài qua 3 màn riêng ("Phân phối
nội bộ", đã làm ở mục 22), không có "chuyển kho tự do". Sửa: chuyển material test sang kho
`vat-tu-tp`, test đúng luồng `vat-tu-tp → thanh-pham`.

1. `khovttp` (scope vat-tu-tp) → "Chuyển kho ngoài đơn hàng" → chọn kho đích "Kho thành phẩm", vật tư
   test, số lượng 5 → 201 Created → xác nhận qua `psql`: `WAREHOUSE_TRANSFER_CREATED` tạo cho ĐÚNG 2
   user scope `thanh-pham` (`khotp`, `muatp`), `link.params.sub = "noi-bo"`.
2. `khotp` thật: chuông (chân sidebar drawer - `InboundWarehouseApp` không có bản top bar compact
   như `MfgApp`) hiện đúng "Phiếu CK-2026-025 chờ xác nhận nhận hàng / Từ Kho Vật tư thành phẩm: 1
   dòng." → bấm → **URL đổi đúng `?m=inbound_warehouse&p=nhap-kho&sub=noi-bo`** (xác nhận trực tiếp
   `buildNotificationLinkUrl()` forward đúng `params`) → trang "Nhập kho" mở ĐÚNG sub-tab "Nhập nội
   bộ" ngay lần đầu (không phải sub-tab mặc định sai) → thấy đúng phiếu CK-2026-025.
3. Bấm "Từ chối" kèm lý do "Sai vat tu, test notification" → 201 Created → xác nhận qua `psql`: CẢ 2
   `WAREHOUSE_TRANSFER_CREATED` resolved, `WAREHOUSE_TRANSFER_REJECTED` tạo đúng cho `khovttp`
   (người tạo, KHÔNG phải `khotp`/`muatp`), đúng lý do, `link:{module:'inbound_warehouse',
   page:'lich-su-kho'}` (không có `params`).
4. `khovttp` thật: chuông tab "Tất cả" (đúng - RESULT không vào "Cần xử lý") hiện đúng "Phiếu
   CK-2026-025 bị từ chối / Lý do: Sai vat tu, test notification" → bấm → URL đổi đúng
   `?m=inbound_warehouse&p=lich-su-kho` → trang "Lịch sử kho" mở đúng, tự scope theo "Kho Vật tư
   thành phẩm" của người xem.
5. Xác nhận tồn kho KHÔNG đổi sau khi từ chối (`reject()` không ghi `stock_ledger`, khác `confirm()`)
   - "Tồn 20, Khả dụng 20" của material test vẫn nguyên vẹn lúc xem lại "Tổng hợp vật tư".

**Dọn dữ liệu sau test:** xoá 2 dòng `notifications` (`WAREHOUSE_TRANSFER_CREATED`,
`WAREHOUSE_TRANSFER_REJECTED` - cascade xoá `notification_recipients`), `warehouse_transfer_reservations`/
`warehouse_transfer_items`/`warehouse_transfers` của phiếu CK-2026-025 (id=25), `stock_quant` + vật
tư test. Xác nhận qua `psql`: `notifications` về đúng 21 dòng baseline, 0 dòng `readAt` khác NULL,
material/phiếu test không còn tồn tại.

### 23.5 Còn treo

- ~~Phase 3b còn 3 nhóm: 7.5-iv, 7.5-v, 7.5-vi.~~ **7.5-v ĐÃ XONG, xem mục 24.** Còn 2 nhóm: 7.5-iv
  (xuất/nhận đan), 7.5-vi (đóng gói xong → Sales).
- `createPieceTransfer()`'s `WAREHOUSE_TRANSFER_CREATED` (phiếu mảnh, không phải vật tư) chưa
  live-test qua đúng luồng thật - chỉ có unit test (mục 23.3). Luồng thật cần dữ liệu
  `ProductionBatch QC_DONE` sẵn sàng chuyển, không dựng riêng trong đợt này vì cơ chế emit hệt như
  nhánh `create()` đã live-test kỹ ở trên, chỉ khác nguồn đếm `itemCount`.
- `buildNotificationLinkUrl()` mới fix cho ĐÚNG 1 type dùng `params` (`WAREHOUSE_TRANSFER_CREATED`) -
  các type khác chưa cần nhưng cơ chế đã sẵn sàng dùng ngay khi cần (vd nếu sau này muốn deep-link
  sâu hơn tới đúng dòng SKU/PI cụ thể thay vì chỉ đúng màn, xem còn treo mục 15.5).

## 24. Phase 3b — nhóm 7.5-v "Chuyền kiểm có lỗi" (1 sự kiện) — _ĐÃ XONG 2026-09-28_

Tiếp tục Phase 3b (7.5-iii xong ở mục 23) - nhảy sang 7.5-v thay vì 7.5-iv theo đúng thứ tự vì 7.5-iv
"xuất/nhận đan" còn vướng 1 điểm thiết kế cần hỏi người dùng trước (mục 19.4/23.5), còn 7.5-v không
vướng gì và đúng như dự đoán ở mục 18/19.1: tái dùng `NotificationsService` đã có sẵn ở
`ProductionInvoicesService` (Phase 3a, mục 16), không cần import `NotificationsModule` mới.

### 24.1 Phạm vi - 1 type mới

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `TRANSFER_CHECK_DEFECT_FOUND` | RESULT/WARNING | QLSX | `ProductionInvoicesService.recordTransferCheck()` khi `dto.defects.length > 0` | — |

`entityType='TRANSFER_CHECK_RESULT'`, `entityId` = id bản ghi `TransferCheckResult` vừa tạo (trước
đây service KHÔNG capture kết quả `create()`, phải sửa `await this.prisma.transferCheckResult.create(...)`
thành `const created = await ...` mới lấy được `created.id`).

### 24.2 Quyết định thiết kế đáng chú ý - vì sao KHÔNG báo "tổ gửi" như nhóm 7.5-i

Bảng kế hoạch gốc mục 7.5 chỉ ghi nhận QLSX là người nhận cho sự kiện này (khác `QC_FAILED` ở nhóm
7.5-i báo CẢ tổ gửi lẫn QLSX). Đọc kỹ `recordTransferCheck()` xác nhận đây là lựa chọn ĐÚNG chứ không
phải bỏ sót: **`TransferCheckResult` không có FK nào xác định chắc chắn tổ nào (Phôi/Hàn/Sơn) đã làm
ra mảnh đang bị kiểm** - khác `CutBundle`/`ProductionBatch` (nhóm 7.5-i) vốn có sẵn `stage`/nguồn
gốc rõ ràng ngay trên bản ghi. Mảnh "có đan" (`bomPiece.isWoven`) đến từ điểm đan ngoài
(`WeavingReceipt.weavingPointId`, không phải Phôi/Hàn/Sơn); mảnh "không đan" đến qua 1 phiếu chuyển
kho đã CONFIRMED (không giữ vết ai là người sản xuất gốc). Suy qua `bomPiece.needsHan`/`needsSon` chỉ
cho biết "công đoạn cuối cùng LẼ RA phải là gì" (dữ liệu định mức), không phải "ai thực sự đã báo
sản lượng lô này" (dữ liệu vận hành) - 2 việc khác nhau, suy diễn từ cái đầu ra cái sau là suy đoán
không đủ tin cậy để chỉ đích danh 1 tổ nhận cảnh báo lỗi.

Không có `link` - màn "Chuyền kiểm" (`KhoChuyenKiemPage.tsx`) thuộc module `inbound_warehouse` (thủ
kho thao tác), QLSX không có tab này trong module `production` của mình.

### 24.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 1 type mới, 1 params
  interface `TransferCheckDefectNotificationParams { piCode, pieceName, defectCount, reason }` -
  `reason` chỉ lấy lỗi ĐẦU TIÊN trong lần kiểm (đủ cho QLSX biết sơ bộ, không liệt kê hết mọi lý do
  nếu 1 lần kiểm có nhiều defect khác lý do nhau); message thêm "(và N lỗi khác)" khi `defectCount > 1`.
- [production-invoices.service.ts](../src/modules/production-invoices/production-invoices.service.ts):
  thêm helper `notifyTransferCheckDefect()` (best-effort, cùng idiom `notifyPi()` có sẵn - không mở
  transaction riêng nên chỉ là 1 lệnh gọi thêm sau `create()`, không có gì để "cứu" nếu lỗi);
  `recordTransferCheck()` capture `created` từ `transferCheckResult.create()` (trước đó bỏ qua kết
  quả), gọi notify SAU KHI đã có `result.pieceName` từ `listTransferCheckPieces()` (tái dùng, không
  query thêm) - CHỈ khi `dto.defects?.length > 0`.
- Không sửa `production-invoices.module.ts` - `NotificationsModule` đã import từ Phase 3a (mục 16).
- Test: +2 (emit đúng piCode/pieceName/defectCount/reason khi có defects; KHÔNG emit khi kiểm không
  lỗi) trong `describe('recordTransferCheck')`. Sửa 1 test cũ ("creates a new check row...") thêm
  `prisma.transferCheckResult.create.mockResolvedValue({ id: 100n })` - trước đó mock trả về
  `undefined`, sẽ crash ngay khi code đọc `created.id`.
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi. `npx eslint --fix`: 0 error, 1 warning `no-explicit-any`
  cố ý có sẵn. `npx jest` toàn repo: **1243/1243 pass, 50/50 suite** (tăng từ 1241 ở mục 23 - đúng 2
  test mới).

### 24.4 Live-test thật (BE+FE+DB thật, browser thật)

Dữ liệu thật trong DB dev cho "Chuyền kiểm" đều đã kiểm hết (mọi mảnh của PI-2026-001 có
Hiện có = Đã kiểm = Tổng cần) hoặc chưa có hàng về (`Hiện có = 0` cho PI-2026-004, order id=5 - PI
test quen thuộc từ các nhóm trước, chưa từng có phiếu chuyển mảnh nào tới "Kho thành phẩm"). Chèn
tay 1 phiếu `warehouse_transfers` CONFIRMED + 1 `warehouse_transfer_piece_items` (order 5, piece 1
"chân bàn", qty 5) qua `psql` để có "Hiện có" > 0 cho piece đó - mô phỏng đúng kết quả của 1 chuỗi
chuyển kho thật (vat-tu-tp → thanh-pham) đã CONFIRMED, không dựng lại toàn bộ chuỗi 2 chặng vì mục
tiêu test là `recordTransferCheck()`+notification, không phải lại cơ chế piece-transfer đã test kỹ ở
mục 23.

1. `khotp` (scope thanh-pham) thật → "Chuyền kiểm" → PO-TEST-REJECT-001/PI-2026-004 → "chân bàn"
   hiện đúng "Hiện có: 5" → bấm "Kiểm" → nhập số lượng 5 + 1 lỗi "Chan ban bi cong venh test
   notification" → Xác nhận → 201 Created → xác nhận qua `psql`: `TRANSFER_CHECK_DEFECT_FOUND` tạo
   đúng cho `qlsx`, title "PI-2026-004: chân bàn chuyền kiểm có lỗi", message đúng lý do + dấu chấm,
   `link: null`.
2. `qlsx` thật: chuông tab "Tất cả" (đúng - RESULT không vào "Cần xử lý") hiện đúng thông báo ở đầu
   danh sách → bấm vào → mark-read (xác nhận qua `psql`) → **URL KHÔNG đổi** (đúng vì `link: null`).

**Không live-test riêng nhánh "không có lỗi"** (không emit gì) - đã có 2 unit test riêng biệt xác
nhận rõ ràng (mục 24.3: 1 test có defects → emit, 1 test không defects → không emit), cùng mức độ
rủi ro thấp như các nhánh "không emit" đã bỏ qua live-test ở những nhóm trước.

**Dọn dữ liệu sau test:** xoá `notifications` (`TRANSFER_CHECK_DEFECT_FOUND`), `transfer_check_defects`
+ `transfer_check_results` vừa tạo, `warehouse_transfer_piece_items` + `warehouse_transfers` (phiếu
test chèn tay) - dùng `code` KHÔNG khớp mẫu `CK-{year}-NNN` (`TEST-CHUYENKIEM-001`) để tránh ảnh
hưởng bộ đếm `nextTransferCode()` của phiếu thật. Xác nhận qua `psql`: `notifications` về đúng 21
dòng baseline, 0 dòng `readAt` khác NULL, không còn `transfer_check_results` nào cho item test.

### 24.5 Còn treo

~~Phase 3b còn 2 nhóm: 7.5-iv..., 7.5-vi...~~ **7.5-vi ĐÃ XONG, xem mục 25.** Còn đúng 1 nhóm: 7.5-iv
(xuất/nhận đan - vướng thiết kế "tự đóng" đã ghi ở mục 19.4/23.5, cần hỏi người dùng trước khi làm).

## 25. Phase 3b — nhóm 7.5-vi "Đóng gói xong → Sales" (1 sự kiện) — _ĐÃ XONG 2026-09-28_

Tiếp tục Phase 3b (7.5-v xong ở mục 24) - làm nốt 7.5-vi (không vướng thiết kế gì, cùng service
`ProductionInvoicesService` đã có `NotificationsService` sẵn). Phase 3b sau mục này chỉ còn 7.5-iv
(xuất/nhận đan) - vướng 1 điểm thiết kế "tự đóng" đã ghi ở mục 19.4/23.5, cần hỏi người dùng (làm ở
mục 26 ngay sau đây).

### 25.1 Phạm vi - 1 type mới

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `PI_ITEM_PACKAGING_COMPLETE` | RESULT/SUCCESS | Role `SALES_STAFF` | `ProductionInvoicesService.recordPackaging()` khi `packedQty` vừa đạt đúng `totalQty` VÀ item có gắn `salesOrderId` | — |

`entityType='PRODUCTION_INVOICE_ITEM'`, `entityId` = id item. Recipient là CẢ role `SALES_STAFF`
(không định danh 1 người) - cùng lý do đã ghi ở mục 15.2: `SalesOrder` không có cột "người phụ
trách"/người tạo, không nhắm được đích danh 1 Sales cụ thể.

### 25.2 Quyết định thiết kế đáng chú ý

- **Tự nhiên chỉ bắn ĐÚNG 1 LẦN cho mỗi item, không cần dedupe/guard thêm:** `recordPackaging()` đã
  chặn cứng `packedSoFar + dto.boxesPacked > productionOrder.quantity` (400) TỪ TRƯỚC - một khi
  `packedQty` đã đạt `totalQty`, mọi lần gọi tiếp theo (DTO bắt buộc `boxesPacked >= 1`) đều rơi vào
  nhánh chặn này, không bao giờ chạm lại điều kiện `=== totalQty` lần thứ 2. Khác các nhóm trước
  (`QC_PASSED`, `PURCHASE_PROPOSAL_PURCHASED`...) không cần disqualify thêm gì.
- **Guard `item.salesOrder` (không chỉ `salesOrderId`):** dùng thẳng field include sẵn có
  (`findItemOrThrow()` đã include `salesOrder`) thay vì query lại - đồng thời đây chính là field
  cần đọc `orderCode` cho message, nên guard bằng field này tự nhiên loại luôn case chưa gắn đơn
  hàng (SKU tạo tay qua `POST /production-invoices/:id/items`, xem mục 15.1) mà không cần thêm điều
  kiện `salesOrderId != null` riêng.
- **`link` trỏ `sales/orders`** (`OrderManagementPage.tsx`) - an toàn nối vì recipient CHỈ 1 role
  `SALES_STAFF`, không lẫn role khác cần tab riêng (khác ca `PI_APPROVED_BY_BOSS`/mục 16.2 phải bỏ
  `link` vì 2 role 2 module).

### 25.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): 1 type mới, 1 params
  interface `PackagingCompleteNotificationParams { piCode, factoryCode, productName, salesOrderCode }`.
- [production-invoices.service.ts](../src/modules/production-invoices/production-invoices.service.ts):
  thêm helper `notifyPackagingComplete()` (best-effort, cùng idiom `notifyTransferCheckDefect()` mục
  24 - không mở transaction riêng); `recordPackaging()` gọi notify SAU `packagingRecord.create()`,
  điều kiện `packedSoFar + dto.boxesPacked === productionOrder.quantity && item.salesOrder`.
- Không sửa `production-invoices.module.ts` - `NotificationsModule` đã import từ Phase 3a.
- Test: +3 (emit khi đóng đủ + có đơn hàng; KHÔNG emit khi đóng chưa đủ; KHÔNG emit khi đóng đủ
  nhưng không gắn đơn hàng) trong `describe('recordPackaging')`.
- **Nghiệm thu:** `npx tsc --noEmit`: 0 lỗi (đã kiểm KHÔNG lọc nhầm lỗi mới qua từ khoá `factoryCode`
  trùng với 2 lỗi pre-existing ở `seed-*.ts` - chạy lại không filter để chắc chắn). `npx eslint --fix`:
  0 error, 1 warning `no-explicit-any` cố ý có sẵn. `npx jest` toàn repo: **1246/1246 pass, 50/50
  suite** (tăng từ 1243 ở mục 24 - đúng 3 test mới).

### 25.4 Live-test thật (BE+FE+DB thật, browser thật)

Dùng đúng PI test quen thuộc (PO-TEST-REJECT-001/PI-2026-004, order id=5, item id=5,
`salesOrderId` đã gắn sẵn = TEST6/PO-TEST-REJECT-001) - `totalQty=10, packedQty=0` (chưa đóng gói
lần nào), không cần chèn dữ liệu test nào thêm (khác các nhóm trước) vì đây là dữ liệu SKU/PI có sẵn
đã có `salesOrderId` từ khi tạo.

1. `khotp` (scope thanh-pham) thật → "Đóng gói" → PO-TEST-REJECT-001/PI-2026-004 → nhập 10 thùng
   (đúng bằng "Còn lại") → Xác nhận → 201 Created → xác nhận qua `psql`: `PI_ITEM_PACKAGING_COMPLETE`
   tạo đúng cho role `SALES_STAFF` (user `sales`), title "PI-2026-004: BAN-J55 đã đóng gói xong",
   message "Đơn PO-TEST-REJECT-001 sẵn sàng giao.", `link:{module:'sales',page:'orders'}`.
2. `sales` thật, đứng ở tab khác (`?m=sales&p=customers`) → chuông tab "Tất cả" (đúng - RESULT
   không vào "Cần xử lý") hiện đúng thông báo (icon ✓ xanh, đúng SUCCESS) → bấm vào → mark-read (xác
   nhận qua `psql`) → **URL đổi đúng `?m=sales&p=orders`** (đổi tab thật, không phải tình cờ trùng
   tab đang mở - xác nhận cơ chế điều hướng hoạt động đúng).

**Dọn dữ liệu sau test:** xoá `notifications` (`PI_ITEM_PACKAGING_COMPLETE`), `packaging_records`
vừa tạo. Xác nhận qua `psql`: `notifications` về đúng 21 dòng baseline, 0 dòng `readAt` khác NULL,
`packaging_records` của item 5 về đúng 0 dòng (baseline trước test).

### 25.5 Còn treo — _ĐÃ XONG ở mục 26_

~~Phase 3b còn đúng 1 nhóm: **7.5-iv (xuất/nhận đan)** - vướng thiết kế "tự đóng" (đã ghi ở mục
19.4/23.5): `weaving-issues`/`weaving-receipts` không có state machine hay FK liên kết trực tiếp
giữa xuất và nhận (append-only, so khớp qua tổng aggregate) nên "tự đóng khi nhận" cần thiết kế
riêng (composite entityId hoặc bỏ tự đóng) - cần hỏi người dùng trước khi code, chưa tự quyết được
như các nhóm trước.~~ Đã hỏi + người dùng chốt + code xong ở **mục 26** - Phase 3b hoàn tất toàn bộ.

## 26. Phase 3b — nhóm 7.5-iv "Xuất/nhận đan" (1 sự kiện) — _ĐÃ XONG 2026-09-28, PHASE 3B HOÀN TẤT TOÀN BỘ_

Nhóm cuối cùng còn treo của Phase 3b (đã ghi vướng mắc ở mục 19.4/23.5/25.5) - `WeavingIssue`/
`WeavingReceipt` là 2 sổ cộng dồn thuần (append-only ledger), không có state machine hay FK nối 1
lần xuất đan với đúng 1 lần nhận đan như `SteelIssue`, nên "tự đóng khi nhận" cần 1 quyết định thiết
kế riêng trước khi code - đã hỏi người dùng (bằng ngôn ngữ non-tech, theo yêu cầu) và được chốt
"làm đi" trước khi code phần này.

### 26.1 Phạm vi - 1 type mới

| Type | Category/Severity | Người nhận | Trigger | Tự đóng khi |
|---|---|---|---|---|
| `WEAVING_ISSUE_TO_POINT` | ACTION/INFO | Mọi thủ kho thuộc gia đình kho `thanh-pham` (không định danh 1 kho vật lý) | `WeavingIssuesService.create()` (kho vật tư-TP xuất mảnh cho 1 điểm đan) | Tổng đang treo tại ĐÚNG điểm đan đó về đúng 0 (`WeavingIssuesService.receive()`) |

`entityType = 'WEAVING_ALLOCATION'`, `entityId` là khoá GHÉP
`${productionOrderId}:${pieceId}:${weavingPointId}` (không phải id 1 dòng `WeavingIssue`/
`WeavingReceipt`) - mirror đúng `PI_SENT_TO_QLSX` (mục 16.2): dedupe theo tổng đang chờ, tự đóng
khi tổng về đúng 0, không phải state machine 1-1.

### 26.2 Quyết định thiết kế đáng chú ý

- **Mirror `PI_SENT_TO_QLSX` thay vì bịa state machine mới:** research trước khi code (đọc
  `weaving-issues.service.ts` đầy đủ + hỏi ý kiến "theo bạn nên làm sao mới chuẩn ERP") cho thấy các
  ERP thật (Odoo/SAP/NetSuite) mô hình hoá gia công ngoài kiểu này bằng 1 "đơn gia công" có trạng
  thái + số dư suy ra, nhưng DNA-ERP chỉ có đúng phần "số dư suy ra" (2 bảng ledger), không có "đơn"
  nào để gắn trạng thái - nên cách khả thi nhất là tái dùng ĐÚNG pattern `PI_SENT_TO_QLSX` đã chứng
  minh hoạt động tốt (entityId ghép + dedupe theo tổng + tự đóng khi về 0), không tạo thêm bảng/field
  mới nào.
- **Chỉ `emit()` ở `create()` (xuất đan - thêm hàng vào "hàng đợi chờ nhận"), CHỈ `resolve()` ở
  `receive()` (nhận đan) - KHÔNG re-emit số đã giảm khi nhận MỘT PHẦN:** giữ nguyên hạn chế đã được
  người dùng chấp nhận ở mục 16.2 ("không giảm số hiển thị khi xử lý một phần, chỉ tự đóng khi giải
  quyết dứt điểm"). `outstandingQty` hiển thị luôn là số tại thời điểm XUẤT gần nhất, không tự cập
  nhật giảm dần theo từng lần nhận nhỏ giọt.
- **Recipient KHÔNG nhắm 1 kho vật lý cụ thể như `WAREHOUSE_TRANSFER_CREATED` (mục 23):**
  `WarehouseTransfer` có cột `toWarehouseId` do người tạo phiếu CHỌN TAY, nhưng `WeavingIssue`/
  `WeavingReceipt` không lưu warehouseId nào cả (chỉ `productionOrderId`/`pieceId`/`weavingPointId` -
  xem model trong `schema.prisma`) - không có cách nào biết "kho thành phẩm nào cụ thể" sẽ nhận về
  nếu có nhiều kho vật lý cùng gia đình `thanh-pham` (kho gốc + kho phụ `-N` do Admin tạo thêm, xem
  `warehouseFamilyOf()`). Giải pháp: báo CẢ GIA ĐÌNH - `resolveThanhPhamWarehouseCodes()` tự query
  mọi `Warehouse.code` khớp gia đình `thanh-pham` (kể cả kho phụ nếu có) rồi truyền vào
  `recipients.warehouseIds`, KHÔNG dùng `roles: [WAREHOUSE_STAFF]` (role đó dùng CHUNG cho thủ kho
  của CẢ 3 gia đình kho, quá rộng - sẽ báo nhầm cả thủ kho `vat-tu-tp`/`phoi-son-han`).
- **`link` trỏ đúng tab `nhap-dan`** (`{ module: 'inbound_warehouse', page: 'nhap-dan' }`) - khớp
  thẳng `TabId` của "Theo dõi nhập đan" trong `InboundWarehouseApp.tsx` (lọc hiện theo
  `isThanhPhamScope(scope)`), không cần `link.params` phụ như `WAREHOUSE_TRANSFER_CREATED` vì đây là
  1 tab riêng, không phải sub-tab chung màn với chức năng khác.

### 26.3 Đã làm (BE)

- [notification-types.ts](../src/modules/notifications/notification-types.ts): thêm
  `WeavingIssueNotificationParams` + type `WEAVING_ISSUE_TO_POINT`.
- [weaving-issues.service.ts](../src/modules/weaving-issues/weaving-issues.service.ts): DI thêm
  `NotificationsService` + `Logger` (module này trước đây CHƯA từng có `NotificationsService`, khác
  mọi nhóm 7.5 trước). Thêm `notifyWeavingIssueToPoint()`/`resolveWeavingIssueToPoint()` (best-effort
  ngoài transaction, cùng idiom mọi nhóm trước) + 3 helper dùng chung
  (`weavingAllocationEntityId()`, `recomputeOutstandingAtPoint()` tái dùng đúng
  `sumIssuedForPoint()`/`sumReceivedForPoint()` sẵn có, `resolveThanhPhamWarehouseCodes()`). Gọi
  `notify` ngay sau transaction của `create()`, gọi `resolve` ngay sau transaction của `receive()`.
- [weaving-issues.module.ts](../src/modules/weaving-issues/weaving-issues.module.ts): thêm import
  `NotificationsModule`.
- Test: +5 test case mới trong
  [weaving-issues.service.spec.ts](../src/modules/weaving-issues/weaving-issues.service.spec.ts)
  (emit đúng entityId/dedupeKey/outstandingQty, không emit lại khi idempotent replay, resolve khi về
  đúng 0, không resolve khi mới nhận một phần, không resolve lại khi idempotent replay) - dùng
  `mockResolvedValueOnce` nối tiếp để mô phỏng đúng thực tế "query lại SAU KHI transaction đã commit
  thấy được dòng vừa tạo" (khác `sumIssuedForPiece`/`sumReceivedForPoint` gọi TRONG transaction).
- Kết quả: suite này 57/57 (từ 52), toàn bộ backend **1251/1251 test, 50/50 suite** (từ 1246).
  `tsc --noEmit`: 0 lỗi mới (giữ nguyên 2 lỗi cũ ở seed script, không liên quan). `eslint --fix`: 0
  lỗi (1 warning cũ `no-explicit-any` ở `NOTIFICATION_TYPES`, không liên quan thay đổi này).

### 26.4 Live-test thật (BE+FE+DB thật, browser thật)

Chuẩn bị dữ liệu (order test cũ id=5 không có mảnh đan nào trong BOM, phải tìm order khác):
production order **id=8** (`PO-GHEJ55-SOLO-TEST-1`, `bomRevisionId=13`) có mảnh `KHUNG-TUA`
(id=73, `isWoven=true`, `qtyPerUnit=3` → `plannedQty=90`). QLSX (`qlsx`) bấm "Bắt đầu" THẬT qua
`POST /production-orders/8/floor-start` (mở gate). Seed thẳng 1 `WarehouseTransferPieceItem`
CONFIRMED (30 mảnh, kho `vat-tu-tp`) đại diện "kho vật tư-TP đã nhận đủ mảnh từ Phân phối nội bộ" -
đây là 1 bước THUỘC nhóm 7.5-iii đã test kỹ riêng ở mục 23, không thuộc phạm vi nhóm này nên seed
thẳng DB cho nhanh thay vì dựng lại cả chuỗi Phôi cắt → QC → chuyển kho. Tạo 1 điểm đan thật qua
`POST /weaving-points` (`khovttp`).

- **Xuất đan thật:** `khovttp` (warehouseScope=`vat-tu-tp`) gọi thật
  `POST /production-orders/8/weaving-issues` (`pieceId=73, weavingPointId=1, qty=10`) → 201.
  Kiểm `psql`: notification tạo đúng `entityId='8:73:1'`,
  `dedupeKey='WEAVING_ISSUE_TO_POINT:8:73:1'`, `link={module:'inbound_warehouse',page:'nhap-dan'}`,
  title *"PO-GHEJ55-SOLO-TEST-1: Khung tựa đang chờ nhận về từ điểm đan..."*, message
  *"Đang treo: 10."* - đúng cả 2 recipient là MỌI user `warehouseScope='thanh-pham'` hiện có
  (`khotp` VÀ `muatp`, không chỉ 1 role hẹp) - đúng thiết kế "cả gia đình kho", không phải 1 kho cụ
  thể.
- **FE thật (browser, đăng nhập `khotp`):** chuông hiện badge đỏ "1" → mở panel, tab "Cần xử lý (1)"
  hiện đúng nội dung → bấm vào, điều hướng đúng `?m=inbound_warehouse&p=nhap-dan` (tab "Theo dõi
  nhập đan" active) - đồng thời `readAt` của `khotp` được set ngay (kiểm `psql`: `muatp` vẫn NULL -
  đúng per-recipient, không lẫn giữa 2 người cùng nhận).
- **Nhận đan thật:** `khotp` gọi thật `POST /production-orders/8/weaving-receipts`
  (`pieceId=73, weavingPointId=1, qty=10` - đúng bằng outstanding) → 201. Kiểm `psql`: CẢ 2 recipient
  (`khotp`, `muatp`) có `resolvedAt` ngay lập tức, đúng thời điểm gọi API - tự đóng hoạt động chính
  xác khi outstanding về đúng 0.

**Dọn dữ liệu sau test:** xoá `notifications`+`notification_recipients` (`WEAVING_ISSUE_TO_POINT`),
`weaving_issues`/`weaving_receipts`/`weaving_points` vừa tạo, `warehouse_transfer_piece_items` +
`warehouse_transfers` (seed CK-TEST-WEAVING-1), revert `production_orders.floorStage` của order 8
về lại `PENDING`/`floorStartedAt=NULL` (trạng thái gốc trước test). Xác nhận qua `psql`:
`notifications` về đúng 21 dòng baseline, 0 dòng `readAt` khác NULL, order 8 về lại
`floorStage=PENDING`.

### 26.5 Còn treo

Không còn - **Phase 3b đã hoàn tất TOÀN BỘ 6/6 nhóm** (7.5-i tới 7.5-vi, mục 19/22/23/24/25/26).
Phase 3c-5 vẫn ở dạng plan (mục 8), chưa làm - chưa có việc gì đang chờ quyết định.

## 27. Phase 4 — Badge "việc chờ tôi" — _ĐÃ XONG TOÀN BỘ (BE+FE) 2026-09-29_

Sau khi Phase 3 đóng hoàn toàn (mục 26.5), bắt đầu Phase 4 theo đúng plan mục 6.3/8: 1 endpoint
`GET /me/work-queue` trả số đếm "đang chờ tôi xử lý" theo TỪNG ROLE của người gọi, để FE gắn badge
lên menu (khác hẳn cơ chế `notifications` - đây là QUERY đọc thẳng trạng thái nghiệp vụ hiện tại,
không suy từ bảng thông báo, nên "luôn khớp dữ liệu" đúng yêu cầu mục 6.3 dù người dùng có bỏ lỡ/xoá
thông báo hay không). Research kỹ bằng subagent trước khi code (đọc toàn bộ schema + 6 service liên
quan) vì bảng plan gốc mục 6.3 viết TRƯỚC khi có code thật, nghi ngờ đã lệch - xác nhận đúng vậy.

### 27.1 Phạm vi - 1 endpoint, 15 khoá đếm khớp đúng 9 dòng role/menu của mục 6.3

`GET /me/work-queue` → `{ counts: Record<string, number> }` - chỉ trả về khoá KHỚP ĐÚNG role của
người gọi (không query dư cho role họ không có, đỡ tải DB), 1 user nhiều role thì nhiều khoá cùng
lúc (vd account demo `sales`: vừa `WAREHOUSE_STAFF` vừa `SALES_STAFF` → vừa có
`warehouseTransferPending`/`warehousePurchaseReceiving` vừa có `salesReadyToShip`).

| Role | Khoá trong `counts` | Đếm |
|---|---|---|
| `PRODUCTION_MANAGER` (QLSX) | `qlsxProductionQueue` | PI item `WAITING_QLSX` + đề xuất cắt sắt `displayStatus=NEEDS_ACTION` |
| `BOSS` (Sếp) | `bossSkuApproval`, `bossProductionApproval` | `PlanForm.status=WAITING_BOSS_APPROVAL`; PI item `WAITING_BOSS` |
| `PRODUCTION_PLANNER` (KHSX) | `khsxSkuReview`, `khsxProductionRejected` | Định mức mảnh(SAT)/chi tiết(DAY_SON) `status=null` (đã nộp, chưa duyệt); PI item `REJECTED` |
| `SPEC_STEEL_STAFF` | `specSteelQuota` | SKU (loại `origin=PRODUCTION_CONFIRM`) chưa nộp định mức mảnh HOẶC bị trả về |
| `SPEC_ACCESSORY_PACKAGING_STAFF` | `specDetailQuota` | Tương tự, nhánh chi tiết |
| `PURCHASER` (Mua hàng) | `purchaserPending` | `PurchaseProposalItem.status IN PENDING_APPROVAL_STATUSES` |
| `WAREHOUSE_STAFF` (Kho) | `warehouseTransferPending`, `warehousePurchaseReceiving` | Phiếu chuyển `PENDING` tới đúng kho (`warehouseScope`, null=tổng kho); hàng mua `PURCHASING` chờ nhận tại đúng kho |
| `PHOI_STAFF` | `phoiSteelReceiving` | `SteelIssue.status=ISSUED` |
| `KCS_STAFF` | `kcsPhoi`, `kcsHan`, `kcsSon` | `CutBundle`+`StepBundle`+`PieceStepBundle`+`ProductionBatch(stage=PHOI)` `AWAITING_QC`; `ProductionBatch(stage=HAN/SON)` `AWAITING_QC` |
| `SALES_STAFF` | `salesReadyToShip` | Dòng đơn đã tới mốc `DONG_GOI`/`HOAN_THANH` (suy từ dữ liệu sản xuất thật) nhưng `shippedQty < totalQty` |

Role không nằm trong bảng trên (`HAN_STAFF`/`SON_STAFF`, chưa có dòng nào trong mục 6.3) →
`counts` rỗng `{}`, không lỗi.

### 27.2 5 chỗ bảng plan gốc mục 6.3 SAI/THIẾU so với code thật - phát hiện qua research trước khi code

Bảng mục 6.3 viết TRƯỚC khi Phase 3 code xong, một số hành vi đã đổi theo thời gian. Nếu làm đúng y
văn bảng đó, 2 badge (Mua hàng, Sales) sẽ **sai hẳn**, không phải chỉ thiếu vài dòng:

1. **QLSX "cắt sắt cần duyệt tay/FAILED"** - mục 14 (2026-09-26) chỉ bỏ THÔNG BÁO cho 3 nhánh
   "không thành công", KHÔNG bỏ trạng thái/hành động - `DRAFT`/`FAILED` vẫn tồn tại thật, vẫn có nút
   "Duyệt" thật (`POST /cutting-proposals/:id/approve`). Đếm thô `status IN (DRAFT, FAILED)` sẽ đếm
   NHẦM cả `DRAFT` đang trong 60s cửa sổ tự-duyệt (`FINALIZING_WINDOW_MS`, chưa kịp chuyển
   `APPROVED`) và bỏ sót `CALCULATING` quá hạn (nghi treo) - phải tái dùng đúng
   `computeDisplayStatus()` đã có sẵn (thêm method `countNeedsAction()` public gọi lại private đó).
2. **Mua hàng "NEW/QUOTING"** - SAI: `QUOTING` là tàn dư chết từ luồng báo giá cũ (gỡ 2026-08-27),
   không còn đường nào sinh mới; THIẾU `SUBMITTED`/`REJECTED` (~36 dòng dữ liệu cũ vẫn kẹt ở đó,
   `bossApprove()` vẫn là đường ra duy nhất của chúng - xem đã export `PENDING_APPROVAL_STATUSES`).
   Đếm theo đúng bảng gốc sẽ THIẾU ~36 dòng thật đang chờ Mua hàng xử lý.
3. **KCS "cut bundle/batch AWAITING_QC"** - THIẾU 2 bảng `StepBundle`/`PieceStepBundle` (công đoạn
   phụ Uốn/Dập/Đục lỗ/Tán/Tóp đầu/Xẻ của Phôi cho Sắt và vật tư thành phẩm) - đều là `AWAITING_QC`
   thật, cùng màn KCS Phôi.
4. **Sales "dòng đơn DONG_GOI/HOAN_THANH"** - SAI HẲN nếu lọc thẳng cột `SalesOrderItem.status`: cột
   này đứng yên ở `LEN_KE_HOACH` VĨNH VIỄN từ 2026-09-24 (không luồng nghiệp vụ nào ghi lại nữa, xem
   doc comment `resolveStages()`) - badge sẽ LUÔN HIỆN 0 dù có hàng thật sẵn sàng giao. Phải gọi
   `SalesOrdersService.countReadyToShip()` (method mới, tái dùng `resolveStages()`/`loadPiItems()` -
   "1 chủ sở hữu duy nhất" cho logic suy trạng thái, tránh viết lại ~60 dòng derive).
5. **Spec "SKU cần định mức"** - THIẾU điều kiện loại `PlanForm.origin='PRODUCTION_CONFIRM'` (SKU tự
   tạo khi Sếp duyệt PI item, ẩn khỏi mọi màn KHSX/Spec theo thiết kế - xem `skus.service.ts`) - thiếu
   điều kiện này sẽ đếm DƯ, hiện badge cho việc Spec không hề thấy trên màn của họ.

### 27.3 Quyết định thiết kế đáng chú ý

- **Response là `Record<string,number>` phẳng (mirror `UnreadCountResponseDto.byCategory`), không
  khai cứng 1 DTO field/role:** số khoá thực tế trả về LUÔN là tập con theo role người gọi - khai
  cứng ~15 field optional trên 1 class không thêm giá trị gì so với 1 map, FE đọc field không tồn
  tại thì coi như 0/ẩn badge, không phải lỗi.
- **Không `@RequirePermissions`:** khác MỌI controller khác trong repo - đây là "việc chờ CHÍNH
  người gọi" (không phải dữ liệu người khác), nên không cần permission riêng, chỉ cần đã đăng nhập
  (`JwtAuthGuard` toàn cục có sẵn). `PermissionsGuard` tự pass-through khi handler không khai
  `@RequirePermissions` (xác nhận qua đọc code `permissions.guard.ts`, không phải đoán).
- **Không cache/không dedupe qua bảng riêng nào** - mỗi lần gọi là 1 loạt query `count()` thật chạy
  song song (`Promise.all`), đúng tinh thần "luôn khớp dữ liệu" mục 6.3 đã nêu rõ là ưu tiên hơn tốc
  độ. Chưa thêm index mới cho các cột lọc - schema hiện tại đã đủ (`@@index([stage, status])` trên
  `ProductionBatch` có sẵn, các bảng còn lại là bảng nhỏ/lọc theo enum + FK đã có index PK/unique).
- **`countReadyToShip()`/`countNeedsAction()` đặt làm method PUBLIC mới trên chính
  `SalesOrdersService`/`CuttingProposalsService`** (không viết lại logic trong `WorkQueueService`) -
  giữ đúng nguyên tắc "1 chủ sở hữu duy nhất" cho 2 luồng derive-trạng-thái phức tạp đã có sẵn, tránh
  2 nguồn có thể lệch nhau theo thời gian.
- **`countReadyToShip()` lọc `shippedQty < totalQty` ở TẦNG ỨNG DỤNG** (fetch rồi filter JS), không
  viết `where` so sánh field-vs-field - Prisma Client không hỗ trợ so sánh 2 cột thường (cần raw SQL
  hoặc extension riêng); quy mô đơn hàng của nhà máy này đủ nhỏ để không cần tối ưu thêm.

### 27.4 Đã làm (BE)

- [purchase-proposals.service.ts](../src/modules/purchase-proposals/purchase-proposals.service.ts):
  export `PENDING_APPROVAL_STATUSES` (trước đó module-private).
- [cutting-proposals.service.ts](../src/modules/cutting-proposals/cutting-proposals.service.ts):
  thêm `countNeedsAction()` (public, tái dùng `computeDisplayStatus()` private có sẵn).
- [sales-orders.service.ts](../src/modules/sales-orders/sales-orders.service.ts): thêm
  `countReadyToShip()` (public, tái dùng `resolveStages()`/`loadPiItems()` private có sẵn).
- Module mới `src/modules/work-queue/`: `work-queue.service.ts` (10 method đếm riêng, gộp theo
  role), `work-queue.controller.ts` (`GET /me/work-queue`, không permission riêng),
  `work-queue.module.ts` (import `CuttingProposalsModule`+`SalesOrdersModule` để gọi 2 method mới ở
  trên), `dto/work-queue-response.dto.ts`. Đăng ký vào `app.module.ts`.
- Test: 13 test case mới (`work-queue.service.spec.ts`) - phủ đủ 9 role + case "không role nào" +
  case "nhiều role cùng lúc" + case "warehouseScope null (tổng kho) vs cụ thể". Toàn bộ backend
  **1264/1264 test, 51/51 suite** (từ 1251/50). `tsc --noEmit`: 0 lỗi mới (giữ nguyên 2 lỗi cũ ở
  seed script). `eslint --fix`: 0 lỗi/warning mới.

### 27.5 Live-test thật (BE+DB thật, chưa có FE để test qua browser)

Chạy BE thật (`npm run start:dev`, cổng 3001) + Postgres dev thật, đăng nhập LẦN LƯỢT toàn bộ 15
account demo (`seed-demo.ts`) qua API thật, gọi `GET /me/work-queue` cho mỗi người, đối chiếu số trả
về với `psql` trực tiếp trên DB dev (không phải data test tự tạo - dùng đúng dữ liệu đã có sẵn):

- **`qlsx` → `qlsxProductionQueue: 15`** - đối chiếu `psql`: PI item `WAITING_QLSX` = 3 dòng thật;
  `cutting_proposals` có 7 `FAILED` (luôn tính NEEDS_ACTION) + 5 trong số `DRAFT`/`CALCULATING` khớp
  đúng từng nhánh `computeDisplayStatus()` (2 `DRAFT hasInfeasibleLine=true`, 1 `CALCULATING` đã quá
  7 NGÀY tuổi - chắc chắn "nghi treo", 1 `DRAFT` khác `hasInfeasibleLine=true`, 1 `DRAFT` không cờ
  nào nhưng `completedAt` đã 5 ngày - rơi đúng nhánh "đã có phương án khác được duyệt"). 3 + 7 + 5 =
  **15**, khớp tuyệt đối - xác nhận `computeDisplayStatus()` tái dùng đúng, không lệch 1 dòng nào dù
  dữ liệu dev khá "bẩn" (nhiều proposal cũ ở đủ loại trạng thái).
- **`muapsh` → `purchaserPending: 42`** - đối chiếu `psql`: `purchase_proposal_items` có đúng 42
  dòng `NEW` (không có `QUOTING`/`SUBMITTED`/`REJECTED` nào tồn tại ở DB dev hiện tại) - khớp.
- **`sales` → `salesReadyToShip: 4`** (kèm `warehouseTransferPending`/`warehousePurchaseReceiving` vì
  account demo này CŨNG có role `WAREHOUSE_STAFF`) - số > 0 xác nhận `countReadyToShip()` chạy thật
  qua `resolveStages()` trên dữ liệu sản xuất thật, không phải lúc nào cũng trả 0 như sẽ xảy ra nếu
  lỡ lọc thẳng cột `SalesOrderItem.status` (đúng cảnh báo ở mục 27.2-4).
- **`kcs` → `{kcsPhoi:0, kcsHan:0, kcsSon:0}`**, **`dms`/`dmbbdg`** (Spec Sắt/chi tiết) → mỗi bên 1
  khoá riêng đúng tên, **`phoi`/`khopsh`/`khovttp`/`khotp`** → đúng khoá theo role, **`boss`/`khsx`**
  → đúng khoá, **`khsx`** (có CẢ `WAREHOUSE_STAFF` lẫn `PRODUCTION_PLANNER`) trả về đủ cả 4 khoá của
  2 role - xác nhận cơ chế multi-role hoạt động đúng với dữ liệu thật, không chỉ trên mock.
  **`han`/`son`** (không role nào khớp bảng mục 6.3) → `counts: {}` đúng như thiết kế, không lỗi.
- Route xác nhận đúng `GET /api/me/work-queue` (log Nest lúc khởi động:
  `WorkQueueController {/api/me}`).
- Baseline `notifications` không đổi trước/sau (endpoint thuần đọc, không ghi) - vẫn đúng 21 dòng, 0
  `readAt`.

### 27.6 Đã làm (FE)

Khảo sát trước khi code: cơ chế hiển thị badge đã có sẵn ở `ProductionPlanApp.tsx` (field
`badge?: number` trong mảng `NAV`, đã tự render số đỏ) - chỉ 1/7 shell có sẵn, 6 shell còn lại
(Mfg/Boss/Purchasing/InboundWarehouse/Sales) phải thêm mới (mirror đúng cách render đã có, không
bịa kiểu mới). Bỏ qua `AdminApp.tsx` - Admin không có dòng nào trong bảng role/menu mục 6.3.

- [work-queue-api.ts](../../DNA-ERP/src/services/work-queue-api.ts) (file mới): `getWorkQueue()`,
  re-export qua `api.ts`.
- [useWorkQueue.ts](../../DNA-ERP/src/hooks/useWorkQueue.ts) +
  [WorkQueueContext.tsx](../../DNA-ERP/src/context/WorkQueueContext.tsx) (file mới): mirror ĐÚNG
  `useNotifications.ts`/`NotificationsContext.tsx` (poll 30s, dừng khi tab ẩn
  `visibilitychange`, refetch khi quay lại tab, 1 Provider dùng chung cho cả cây tránh double-poll).
  Mount ở `app/layout.tsx`, lồng trong `NotificationsProvider`.
- Gắn badge vào ĐÚNG menu item từng shell (đọc kỹ code từng shell trước khi gắn, không suy diễn từ
  tên menu suông - 2 chỗ lệch giữa "tên menu" và "vị trí thật" phát hiện lúc làm):
  - `ProductionPlanApp.tsx`: `'duyet-sku'` = `khsxSkuReview`; `'lenh-sx'` đổi khoá theo role đang
    xem trang này (`isBoss ? bossProductionApproval : khsxProductionRejected`) - đúng theo nhánh
    `isBoss` đã có sẵn ở label dòng đó (Boss ghé qua trang này vẫn thấy đúng số của mình).
  - `BossApp.tsx`: `'cho-duyet'` (1 mục nav) = TỔNG `bossSkuApproval + bossProductionApproval` (2
    việc gộp vào 1 trang có filter nội bộ) - tách lại thành 2 badge riêng ở đúng 2 nút lọc "SKU
    mới"/"Lệnh sản xuất" bên trong `ChoDuyetSection`.
  - `MfgApp.tsx`: `'lenh-sx'`→`qlsxProductionQueue`, `'phoi-xac-nhan-nhan-sat'`→`phoiSteelReceiving`,
    `'kcs-phoi'/'kcs-han'/'kcs-son'`→`kcsPhoi/kcsHan/kcsSon`. Riêng Spec: badge gắn vào sub-item
    `'dinh-muc'` BÊN TRONG tab `'setup'` (không phải tab `'setup'` cha) - `'setup'` dùng CHUNG cho
    cả `SPEC_STEEL`/`SPEC_ACCESSORY`, tự chọn `specSteelQuota`/`specDetailQuota` theo đúng
    `user.mfgRole` của người đang xem.
  - `PurchasingApp.tsx`: `'theo-doi-mua-hang'` = `purchaserPending`.
  - `SalesApp.tsx`: `'orders'` = `salesReadyToShip`.
  - `InboundWarehouseApp.tsx`: **lệch quan trọng nhất phát hiện lúc đọc code** - cả
    `warehouseTransferPending` (phiếu "Nhập nội bộ" chờ xác nhận) VÀ `warehousePurchaseReceiving`
    (hàng mua chờ nhận) đều là SUB-TAB bên trong CÙNG 1 trang `NhapKhoPage.tsx`/tab `'nhap-kho'` -
    KHÔNG phải `'chuyen-tu-do'` (đó là màn TẠO phiếu chuyển đi, không phải hàng đang chờ mình xử
    lý). Badge = tổng cả 2, gắn vào `'nhap-kho'`.
- `tsc --noEmit`: 0 lỗi. `eslint --fix`: 0 lỗi (13 warning `react-hooks/exhaustive-deps` PRE-EXISTING
  ở cả 6 file, cùng 1 pattern `useUrlState` đã có từ trước, không liên quan thay đổi lần này).
  `npm test` (Vitest, không phải Jest - repo FE dùng Vitest): 58/58 pass, không đổi.

### 27.7 Live-test FE thật (browser thật, đối chiếu đúng số đã live-test BE ở mục 27.5)

Chạy lại BE+FE thật, đăng nhập LẦN LƯỢT các account đã có số > 0 ở mục 27.5 để xác nhận badge hiện
đúng ngay trên UI (không chỉ đúng ở tầng API):

- **`qlsx`**: mở drawer → "Xử lý lệnh sản xuất" hiện đúng badge đỏ **15** (khớp tuyệt đối số đã đối
  chiếu `psql` ở mục 27.5).
- **`boss`**: "Tổng hợp chờ duyệt" KHÔNG hiện badge (đúng vì cả 2 số = 0 lúc test) - xác nhận nhánh
  "badge = 0 thì ẩn" hoạt động đúng, không hiện số 0 gây nhiễu. Mở trang, 2 nút lọc "SKU mới"/"Lệnh
  sản xuất" cũng không hiện badge - không lỗi render.
- **`sales`**: "Quản lí đơn hàng" hiện đúng badge **4** - xác nhận ca KHÓ NHẤT (đọc qua
  `SalesOrdersService.countReadyToShip()`, dẫn xuất từ dữ liệu sản xuất thật) hoạt động đúng tới tận
  UI, không chỉ đúng ở response JSON.
- **`muapsh`**: "Theo dõi mua hàng" hiện đúng badge **42** - xác nhận `PENDING_APPROVAL_STATUSES`
  (đã sửa so với bảng plan gốc "NEW/QUOTING") phản ánh đúng lên UI thật.

### 27.8 Còn treo

- 2 chỗ `setInterval` mà văn bản Phase 4 gốc định "bỏ nếu badge + thông báo đã thay được"
  (`LenhSXPage.tsx`, `CuttingProposalsPage.tsx`) hoá ra KHÔNG phải polling đếm việc-chờ-tôi - đang
  tự refetch khi có dòng ở trạng thái `CALCULATING` (chờ solver trả lời), phục vụ mục đích khác hẳn
  (thấy kết quả tính cập nhật). ĐÃ GIỮ NGUYÊN, không đụng vào - đúng quyết định đã ghi trước khi làm
  FE.
- Chưa live-test qua browser cho 6/9 role còn lại (KHSX, Spec Sắt/chi tiết, Kho, Phôi, KCS) - đã
  đối chiếu ĐÚNG số qua API+`psql` ở mục 27.5 (toàn bộ đều = 0 ở dữ liệu dev hiện tại, không có ca
  > 0 nào để chụp ảnh badge thật) - nên còn "nợ" 1 lần xác nhận trực quan khi dữ liệu dev tự nhiên
  phát sinh số > 0 cho các role đó (cùng tinh thần "test khi có dịp tự nhiên" đã áp dụng ở vài mục
  trước, vd 17.5).
- Chưa thêm badge riêng cho `HAN_STAFF`/`SON_STAFF` - bảng mục 6.3 không có dòng nào cho 2 role này
  (XacNhanNhanSatPage hiện chỉ có `MaterialIssuesService`/`MaterialYieldIssuesService`, Phase 3b mục
  22 đã có thông báo ACTION_REQUIRED riêng rồi) - giữ nguyên, không tự thêm ngoài phạm vi mục 6.3.

## 28. Quyết định dừng lại - Phase 5 hoãn — _2026-09-29, người dùng chốt_

Sau khi Phase 4 xong (mục 27, kéo theo Phase 1–4 hoàn tất toàn bộ), người dùng xem xét Phase 5
(realtime SSE thay poll, cài đặt bật/tắt thông báo theo loại cho từng user, kênh ngoài Web
Push/Zalo OA cho xưởng - mục 8) và chốt: **"Phase 5 có vẻ chưa cần thiết"** - hoãn vô thời hạn,
không đặt lịch làm tiếp.

**Lý do hợp lý (không phải người dùng nêu, tự suy từ bối cảnh dự án):** hệ thống thông báo hiện tại
(poll 30s cho chuông + badge "việc chờ tôi", cả hai đã có live-test thật qua browser ở mọi nhóm) đã
đáp ứng đủ nhu cầu vận hành thực tế của nhà máy quy mô này - độ trễ tối đa 30s giữa lúc có việc mới
và lúc người dùng thấy không phải vấn đề với nhịp độ thao tác thủ công trên sàn xưởng/văn phòng.
SSE/Web Push/Zalo OA là chi phí hạ tầng + độ phức tạp thêm (kênh ngoài cần tài khoản dịch vụ riêng)
cho lợi ích biên khá nhỏ ở quy mô hiện tại.

**Trạng thái cuối cùng của toàn bộ dự án notification (bắt đầu từ changelog này 2026-09-25):**
Phase 1 (nền tảng BE), Phase 2 (Notification Center FE + URL), Phase 3 (nối sự kiện theo luồng -
3a/3b/3c gộp, toàn bộ mục 7 trừ 7.6), Phase 4 (badge "việc chờ tôi") - **CẢ 4 PHASE CHÍNH ĐÃ HOÀN
TẤT VÀ ĐƯỢC LIVE-TEST THẬT**. Phase 5 hoãn theo quyết định trên. Không còn việc gì đang treo chờ
quyết định hay chờ code tiếp trong phạm vi tài liệu này, trừ vài mục "còn treo" nhỏ đã ghi rõ ở
từng mục con (chủ yếu là "test khi có dịp tự nhiên" cho vài nhánh hiếm chưa có dữ liệu thật để
live-test).

## 29. Rà soát "bấm thông báo có nhảy trực tiếp vào màn của mục đó không" — _2026-10-08, CHỈ RÀ, CHƯA SỬA_

**Cách kiểm:** đọc code (`NotificationCenter.tsx`, `utils/notificationLink.ts`, `notification-types.ts`) + bấm thật bằng Playwright trên local: đăng nhập 14 vai trò (khsx, qlsx, boss, sales, khovttp, khotp, muapsh, muavttp, muatp, han, son, kcs, dms, dmbbdg, phoi một phần; khopsh/admin không có thông báo), mở chuông → tab "Tất cả" → bấm từng thông báo (tối đa 6–14 dòng/vai trò, bỏ trùng tiêu đề) → ghi URL đích + tiêu đề màn.

**Kết luận:**
1. **Bấm là tới đúng MÀN, không tới đúng MỤC.** Bấm → đánh dấu đã đọc → `router.push('/?m=<module>&p=<trang>')`. `Notification.link` chỉ có `module`/`page`; FE chỉ đọc thêm đúng 1 tham số `sub` (tab "Nhập nội bộ"). Thông báo "PI-2026-034 …" hay "SKU E2E-FULL-… " đều dẫn tới cùng danh sách; người nhận tự tìm dòng đó. Đã kiểm 16 key trang trong link — đều tồn tại trong các `*App.tsx`.
2. **11 type KHÔNG có `link`** → bấm chỉ đánh dấu đã đọc, màn ở nguyên chỗ cũ (đã thấy thật: qlsx bấm "Sếp đã duyệt"/"KCS đạt"/"KCS lỗi"/"hàng về kho"; mua hàng/han/son bấm "hàng về kho"/"đủ hàng"): `PI_APPROVED_BY_BOSS`, `PI_REJECTED_BY_BOSS`, `PI_PRODUCTION_ORDER_FAILED`, `PURCHASE_PROPOSAL_ITEM_RECEIVED`, `PURCHASE_PROPOSAL_PURCHASED`, `QC_FAILED`, `QC_PASSED`, `PACKAGING_ISSUE_CREATED`, `TRANSFER_CHECK_DEFECT_FOUND`, `CUTTING_PROPOSAL_AUTO_APPROVED`, `CUTTING_WASTE_DEFAULT_CHANGED`. Một số cố ý (mục 22.2: 2 vai trò nhận cần 2 tab khác nhau).
3. **Link trỏ vào phân hệ mà vai trò nhận không vào được → bấm không đi đâu:** `muavttp`/`muatp` nhận "Phiếu CK chờ xác nhận nhận hàng" và "chờ nhận về từ điểm đan" (link `inbound_warehouse`) nhưng sau bấm vẫn ở "Lệnh mua vật tư"; `dms`/`dmbbdg` nhận "SKU đã được duyệt" (link `production_plan/planforms`) nhưng vẫn ở "Quản lý định mức". Chưa phân loại: lỗi chọn người nhận hay lỗi link.
4. **Chữ lỗi:** thông báo đan ghi "đang chờ nhận về từ điểm đan **null**" (tên điểm đan thiếu khi dựng câu).
5. **Màn đích đúng cho vai trò phù hợp** (xác nhận thật): khsx → Tối ưu cắt sắt / Danh sách SKU / Duyệt SKU; qlsx → Xử lý lệnh sản xuất; boss → chờ duyệt; sales → Quản lý đơn hàng; khovttp → Nhập kho (đúng sub-tab nội bộ); khotp → Theo dõi nhập đan; mua hàng → Lệnh mua vật tư; phôi → xác nhận nhận sắt; kcs → màn KCS đúng công đoạn (Sơn/Phôi); dms/dmbbdg → setup.

**Chưa kiểm/hạn chế:** phép thử đứt giữa chừng ở `phoi` (browser context đóng — nghi `uiLogin` có handler ném lỗi khi gặp `alert()`), `han`/`son` chỉ có thông báo "hàng về kho"; chưa thử bấm trên màn mobile; chưa kiểm trang "Thông báo của tôi" (dùng chung bộ dựng URL nên dự kiến cùng kết quả).
**CHƯA làm:** thêm tham số mục (vd `?focus=<entityType>:<entityId>`) để mở thẳng đúng mục; bổ sung `link` cho 11 type; rà lại danh sách người nhận vs quyền vào module.

### 29.1 Rà soát nhánh DEC-85 (realtime Socket.IO) — _2026-10-08, chỉ rà, chưa sửa_

**Nhánh làm gì:** BE `src/realtime/` (gateway Socket.IO xác thực JWT trong handshake, join room `user:<id>` và `perm:<MODULE>:VIEW` do SERVER quyết theo quyền trong JWT, ngắt khi token hết hạn, Redis adapter tuỳ chọn, `RealtimeService.publish*` sau commit, interceptor `RealtimeEntityOn` cho 6 controller + 13 chỗ publish thủ công); FE `src/realtime/` (client singleton, bus, `useRealtimeRefetch`, thanh "Tải lại", resync khi nối lại, refetch dự phòng 5 phút). 3 event: `notification.created`, `notification.changed`, `entity.changed` (chỉ id + action + topic; FE refetch qua REST).

**Đã kiểm:** jest BE realtime + notifications 55 pass (1 skip: test Redis cần `REDIS_TEST_URL`); vitest FE realtime/notificationLink/notifications-api 30 pass. Live socket thật: không token / token rác / token rỗng → `UNAUTHORIZED`; 5 người dùng kết nối; tạo đơn hàng → cả 5 nhận `entity.changed SALES_ORDER CREATED` sau ~141 ms (đều có `SALES_ORDER:VIEW` — đúng); xoá → `DELETED`; đọc 1 thông báo ở tab A → tab B cùng user nhận `notification.changed READ`.

**Chưa kiểm / lưu ý:** (1) nhiều instance + Redis adapter chưa chạy thật (test tích hợp bị skip) — Render chạy >1 instance thì BẮT BUỘC đặt `REDIS_URL`; (2) quyền chỉ đọc lúc nối → đổi quyền/đăng xuất chỉ có hiệu lực khi token hết hạn (≤15 phút) hoặc nối lại; (3) interceptor bỏ qua request ghi không lấy được `id` (từ `req.params.id` hoặc `result.id`) — batch endpoint phải tự publish (chưa liệt kê hết); (4) `entity.changed` phát cho MỌI người có quyền VIEW của module, không lọc theo kho (payload chỉ có id nên rò rỉ tối thiểu, nhưng mỗi thay đổi kéo refetch ở nhiều máy); (5) chưa kiểm UI thật (toast, badge tức thì, thanh "Tải lại"); (6) FE cần `NEXT_PUBLIC_REALTIME_URL` nếu BE sau proxy có path riêng; mặc định lấy origin của `API_BASE_URL`.

### 29.2 Kiểm thật DEC-85: nhiều instance + giao diện — _2026-10-08, ĐẠT, không sửa code_

**Nhiều instance (Redis adapter):** chạy 4 BE từ `dist` (2 cổng có `REDIS_URL` trỏ vào 1 Redis tạm `redis:7-alpine`, 2 cổng không). Socket nghe ở instance B, ghi (tạo đơn hàng) qua instance A:
- CÓ Redis (3002→3003): cả socket cùng instance và socket ở instance khác đều nhận `entity.changed SALES_ORDER CREATED`.
- KHÔNG Redis (3004→3005, đối chứng): socket cùng instance nhận, socket ở instance khác KHÔNG nhận (`[]`).
→ Kết luận: chạy >1 instance BẮT BUỘC đặt `REDIS_URL`; có đặt thì hoạt động đúng. Đã dọn 4 tiến trình + container Redis tạm.

**Giao diện thật (browser pane, FE :3000 + BE :3001), không tải lại trang:**
1. Sales mở "Quản lí đơn hàng" (82 PO) → tạo 1 đơn từ phiên khác → danh sách tự lên 83, đơn mới ở đầu bảng.
2. Admin phát thông báo chung (INFO) → badge chuông 2→3 ngay; KHÔNG có toast (đúng thiết kế: chỉ WARNING/CRITICAL mới toast — `useNotifications.ts`).
3. QLSX đăng nhập, KHSX đổi ngưỡng hao hụt mặc định 1%→2% → toast "Ngưỡng hao hụt mặc định đổi: 1% → 2%" hiện ngay, badge tăng. Đã đặt lại ngưỡng về 1% sau khi thử.
4. Kho (khopsh) mở "Phân phối nội bộ → Xuất vật tư hàn", admin sửa 1 SKU từ phiên khác → hiện thanh vàng "Dữ liệu vừa được cập nhật… Tải lại"; bấm "Tải lại" thì thanh biến mất.
5. Tắt rồi bật lại BE khi trang đang mở → socket tự nối lại; sửa SKU lần nữa → thanh "Tải lại" hiện lại (không cần F5).
Ghi nhận phụ: bấm toast "đổi ngưỡng hao hụt" ở QLSX không đổi màn (link trỏ `sales/orders`, QLSX không vào phân hệ Bán hàng) — cùng nhóm lỗi link/vai trò ở mục 29.

**Dư lại ở DB local:** 2 thông báo chung "Kiểm thử realtime" (INFO, ALL) + 2 thông báo đổi ngưỡng; đơn thử đã xoá. **Còn chưa kiểm:** reconnect khi token hết hạn giữa chừng (15 phút), tải trên nhiều người dùng cùng lúc, batch endpoint không có `id`.

## 30. Sửa theo mục 29: mở thẳng đúng mục, link cho thông báo thiếu link, rà người nhận/quyền — _2026-10-08, ĐÃ LÀM (chưa commit)_

**Thứ tự làm (theo đề xuất đã chốt):** (1) bấm thông báo mở thẳng đúng mục; (2) thêm link cho loại thiếu link; (3) rà người nhận vs quyền vào phân hệ; kèm sửa chữ "null".

### 30.1 Mở thẳng đúng mục
- **Cơ chế:** URL thêm `focus=<entityType>:<entityId>` (lấy thẳng `Notification.entityType/entityId`, không đổi schema). `NotificationFocus` (mới, gắn ở `app/page.tsx`) chờ (MutationObserver, tối đa 8 s) dòng có `data-focus-id` khớp → cuộn giữa màn + nháy sáng (CSS `notif-focus-flash`) → xoá `focus` khỏi URL (replace). Trang đích chỉ cần rải `{...focusAttr('TYPE', id)}` vào dòng/thẻ.
- **Đã gắn:** `LenhSXPage` + `ThongKePagePlan` (PI, desktop+mobile), `SKUReviewPage`/`SKUListPage`/`SpecSteelPage`/`SpecDetailQuotaPage`/`SkuMobileCard` (SKU), `LenhMuaNCCPage`+`ProposalCards` (đề xuất mua), `CuttingSolvePanel` (đợt tính cắt). Boss "Tổng hợp chờ duyệt" tự bật đúng tab con (SKU mới / Lệnh sản xuất) theo `focus`.
- **Toast realtime** nay mang `entityType/entityId` (BE `NotificationCreatedPayload` + bản sao FE `contract.ts`).
- **Chọn đích theo quyền:** `NotificationLink.alternatives[]`; FE `resolveNotificationUrl` chọn link chính nếu người nhận mở được phân hệ (`canOpenModule` = Giám đốc hoặc đúng phân hệ mặc định), không thì link thay thế đầu tiên mở được; không có đích nào → dòng hiện "· Chỉ để xem" (panel + trang "Thông báo của tôi") thay vì bấm mà im lặng.

### 30.2 Link cho thông báo thiếu link (BE `notification-types.ts`)
Thêm: `PI_APPROVED_BY_BOSS`/`PI_REJECTED_BY_BOSS` (QLSX → `production/ke-hoach`, KHSX → `production_plan/lenh-sx` hoặc `gom-cat`), `PURCHASE_PROPOSAL_PURCHASED` (QLSX `production/lenh-sx`, Mua hàng `purchasing/lenh-mua-ncc`), `PURCHASE_PROPOSAL_ITEM_RECEIVED` (QLSX / thủ kho `inbound_warehouse/lich-su-kho`), `QC_PASSED`/`PACKAGING_ISSUE_CREATED`/`TRANSFER_CHECK_DEFECT_FOUND` (QLSX `production/ke-hoach`). `SKU_APPROVED` thêm đích thay thế cho nhân viên định mức (`production/setup`) và Sales (`sales/orders`).
**Cố ý VẪN không link (có test khoá lại, kèm lý do):** `PI_PRODUCTION_ORDER_FAILED` (Admin, chưa có màn xử lý), `QC_FAILED` (tổ gửi + QLSX cùng phân hệ nhưng cần trang khác nhau), `CUTTING_PROPOSAL_AUTO_APPROVED` (luồng cũ), `CUTTING_WASTE_DEFAULT_CHANGED` (BOSS/QLSX không có màn cấu hình).

### 30.3 Người nhận vs quyền
- **Phát hiện bằng dữ liệu thật:** nhóm nhận theo `warehouseIds` gồm MỌI user có `warehouseScope` đó — kể cả Mua hàng (`muapsh/muatp/muavttp`, giữ cả role `WAREHOUSE_STAFF` nhưng bị khoá vào phân hệ `purchasing`) và tổ sản xuất (`han/son/phoi/kcs` cùng kho `phoi-son-han`) — nên họ nhận thông báo kho mà không mở được màn.
- **Sửa:** `RecipientCriteria` thêm `warehouseScopeRoles` (chỉ role đó) và `warehouseScopeExcludeRoles` (loại role đó); áp cho `WAREHOUSE_TRANSFER_CREATED`, `WEAVING_ISSUE_TO_POINT`, `PURCHASE_PROPOSAL_ITEM_RECEIVED` = chỉ `WAREHOUSE_STAFF` và không phải `PURCHASER`. Đối chiếu SQL trên DB local: `vat-tu-tp` khovttp+muavttp → **khovttp**; `thanh-pham` khotp+muatp → **khotp**; `phoi-son-han` han,kcs,khopsh,muapsh,phoi,son → **khopsh**.
- **Chữ "null":** `weavingPointName` dùng `fullName` (có thể rỗng) → nay `fullName?.trim() || code`.

### 30.4 Kiểm tra
- BE: jest `notifications` + `realtime` + `weaving-issues` **119 pass** (mới: `recipient-resolver.service.spec.ts` 4 ca, `notification-links.spec.ts` khoá "mọi link trỏ phân hệ FE có thật" + "type không link phải nằm trong danh sách cố ý"); eslint 0 lỗi.
- FE: tsc sạch; vitest `notificationLink`/`realtime`/`notifications-api` **37 pass** (+7 ca mới); eslint chỉ còn cảnh báo cũ.
- **Live (browser pane):** KHSX tính 1 đợt cắt → bấm thông báo "Đã tính xong…" → vào `gom-cat`, thẻ `CUTTING_PROPOSAL:173` nháy sáng, `focus` bị xoá khỏi URL; mở `?focus=CUTTING_PROPOSAL:131` (đợt cũ) → thẻ nháy + cuộn giữa màn; Mua hàng (`muavttp`) thấy "· Chỉ để xem" ở các phiếu chuyển kho cũ; Sếp mở `?focus=PRODUCTION_INVOICE:…` → tab con "Lệnh sản xuất" tự bật.
- **CHƯA kiểm live:** `focus` ở các trang PI/SKU/đề xuất mua (mới kiểm bằng tsc + test hàm; chỉ `CUTTING_PROPOSAL` kiểm thật); người nhận mới theo quy tắc kho (chưa phát 1 phiếu chuyển kho thật — mới đối chiếu SQL); thông báo cũ trong DB không có `alternatives` nên vẫn dùng link cũ.

### 30.5 Còn treo
- Dòng cấp **item** (SKU trong PI) chưa có `data-focus-id` — thông báo `PRODUCTION_INVOICE_ITEM` chỉ tới đúng màn, không tới đúng dòng.
- Các trang KCS/Phôi/Hàn/Sơn/kho (`kcs-*`, `phoi-xac-nhan-nhan-sat`, `han-son-xac-nhan-vat-tu`, `nhap-kho`, `nhap-dan`...) chưa gắn `focusAttr` — các thông báo `STEEL_ISSUE`/`CUT_BUNDLE`/`PRODUCTION_BATCH`/`MATERIAL_ISSUE`/`WAREHOUSE_TRANSFER`/`WEAVING_ALLOCATION` vẫn chỉ tới đúng màn.
- `QC_FAILED` chưa có link; `PI_PRODUCTION_ORDER_FAILED` (Admin) chưa có màn.

### 30.6 Gắn `focus` cho trang kho / KCS / phôi — _2026-10-08, ĐÃ LÀM (chưa commit)_

**Mở rộng cơ chế:** `NotificationFocus` khớp theo TỪ (`[data-focus-id~="KEY"]`), thêm `focusAttrAny([...keys])` để 1 dòng GOM nhiều đối tượng (dòng PI trong KCS chứa nhiều đợt) nháy khi bất kỳ khoá con nào được trỏ tới. `LenhSanXuatBoard` (board dùng chung của Phôi/Hàn/Sơn/KCS) thêm prop `rowFocus`; `KcsLine.focusKey` mang khoá của lô.

**Đã gắn:**
| Thông báo (entityType) | Trang | Dòng |
|---|---|---|
| `STEEL_ISSUE` | `phoi-xac-nhan-nhan-sat` (`XacNhanNhanSatPage`) | dòng phiếu xuất sắt |
| `MATERIAL_YIELD_ISSUE` | cùng trang | dòng xuất vật tư thành phẩm |
| `CUT_BUNDLE` | `kcs-phoi` (`KcsPhoiPage`) | dòng PI (gom mọi đợt cắt của PI) + dòng đợt trong chi tiết PI |
| `PRODUCTION_BATCH` | `kcs-han`/`kcs-son` (`KcsStagePage` qua `kcsCore`) | dòng PI/PO (gom các lô) + dòng lô |
| `MATERIAL_ISSUE` | `han-son-xac-nhan-vat-tu` (`XacNhanVatTuPage`) | dòng chờ nhận |
| `WAREHOUSE_TRANSFER` | `nhap-kho` sub `noi-bo` (`InternalTransferSections`) | thẻ phiếu chuyển |

**Kiểm tra:** tsc sạch; vitest `notificationLink` 13 pass; eslint 0 lỗi (chỉ cảnh báo cũ). **Live (browser pane, thông báo thật):** Phôi → `STEEL_ISSUE:31` nháy sáng, `focus` tự xoá khỏi URL; KCS Phôi → dòng `PI-2026-029` nháy (khoá `CUT_BUNDLE:32 CUT_BUNDLE:31 …`).
**CHƯA kiểm live:** KCS Hàn/Sơn (`PRODUCTION_BATCH:81` đã được duyệt nên màn không còn lô chờ để nháy — cần 1 lô chờ KCS mới), phiếu chuyển kho (`WAREHOUSE_TRANSFER:35` đã xác nhận, tạo phiếu thử không được vì kho không đủ tồn khả dụng), xác nhận vật tư Hàn/Sơn (DB không có thông báo `MATERIAL_ISSUE`). Ba chỗ này mới kiểm bằng tsc + cùng mẫu code với chỗ đã live.
**CHƯA làm (có chủ đích):** `WEAVING_ALLOCATION` (`nhap-dan`) — `entityId` là khoá ghép `đơn:mảnh:điểm đan`, còn trang là danh sách theo SKU rồi mới tới bảng phân bổ, client không có mã đơn sản xuất để dựng khoá; chân nhôm/`MATERIAL_YIELD_STEP` không phát thông báo; dòng SKU cấp item trong PI.

### 30.7 Live-test bằng thông báo THẬT trong luồng đầu–cuối (08/10/2026) — kết quả `focus` + người nhận

Chi tiết từng chặng ở `changelog-2026-10-07-bao-cao-test-be-fe-solve.md` mục 13. **Đã kiểm live (bấm chuông → dòng nháy):** `PURCHASE_PROPOSAL` (Mua hàng, lenh-mua-ncc), `STEEL_ISSUE` (Phôi), `CUT_BUNDLE` (KCS Phôi, dòng PI gom), `PRODUCTION_BATCH` (KCS Hàn và KCS Sơn — trước đây CHƯA kiểm, nay đạt), `WAREHOUSE_TRANSFER` (khovttp, sub-tab nội bộ). **Người nhận:** phiếu chuyển kho chỉ tới khovttp (muavttp không còn nhận) — đúng mục 30.3.
**Khoảng trống còn lại:** (1) thông báo mua hàng gửi QLSX trỏ `production/lenh-sx` — màn này chỉ có PI chờ QLSX duyệt nên không có dòng; nên trỏ `production/ke-hoach` + khoá PI; (2) `PI_ITEM_PACKAGING_COMPLETE` (Sales) không có dòng khớp khoá (`PRODUCTION_INVOICE_ITEM`); (3) nút trong menu bên bố cục hẹp không tự đóng khi bấm thông báo; (4) `MATERIAL_ISSUE` (Hàn/Sơn xác nhận vật tư) chưa kiểm vì xuất sơn bị chặn bởi lỗi B-1.

### 30.8 Sửa N-2 (huy hiệu đếm cả việc đã xử lý) và khoảng trống thông báo mua hàng gửi QLSX — _2026-10-09, ĐÃ LÀM (chưa commit)_

**N-2 (mục 10 báo cáo 07/10) — ĐÃ SỬA:** `NotificationsService.unreadCount()` thêm `resolvedAt: null` → việc ĐÃ xử lý xong (ACTION_REQUIRED bị `resolve()`) không còn tính vào huy hiệu chuông / số "Cần xử lý". Live: dms `ACTION_REQUIRED` = 1 khớp đúng 1 mục chưa xử lý chưa đọc; qlsx 1/1; boss 0 (trước: boss 14 với 3 mục thật). Spec `unreadCount` cập nhật theo.

**Thông báo mua hàng gửi QLSX (mục 30.7 khoảng trống 1) — ĐÃ SỬA:** `PURCHASE_PROPOSAL_APPROVED/_ITEM_RECEIVED/_PURCHASED` nay trỏ `production/ke-hoach` ("Tổng hợp lệnh SX") kèm `link.params.focus = PI_CODE:<mã PI>` (BE chỉ biết mã PI, không biết id PI ở chỗ phát). FE: `buildNotificationLinkUrl` để `link.params.focus` thắng khoá suy từ entity; dòng PI ở `ThongKePagePlan` (desktop + thẻ mobile) gắn thêm khoá `PI_CODE:<mã>`. Link thay thế vẫn dùng khoá entity (`PURCHASE_PROPOSAL:<id>` ở màn Mua hàng). Live: mở `?m=production&p=ke-hoach&focus=PI_CODE:PI-2026-038` → dòng PI-2026-038 nháy.
**Kiểm tra:** jest `notifications` 38 pass (+test khoá link 3 type này); vitest `notificationLink` 14 pass (+1 ca focus do BE chỉ định); tsc BE/FE sạch (trừ 2 file seed prisma cũ), eslint 0 lỗi.
**CHƯA kiểm live bằng thông báo thật:** 3 thông báo mua hàng mới (cần 1 PI mới đi qua bước mua; các thông báo cũ trong DB vẫn mang link `lenh-sx`).
**Còn lại:** xem mục 30.7 (Sales "đã đóng gói xong" không có dòng khớp; menu bên bố cục hẹp; N-1, N-3, N-4, N-7).

### 30.9 Sửa N-1, N-3, N-4, khoảng trống Sales và menu bên — _2026-10-09, ĐÃ LÀM (chưa commit)_

- **N-1 (nhánh chân nhôm im lặng) — ĐÃ SỬA:** 2 type mới. `MATERIAL_YIELD_RECIPE_ISSUE_TO_PHOI` (ACTION_REQUIRED, entity `MATERIAL_YIELD_RECIPE_ISSUE`, tới Phôi, link `phoi-xac-nhan-nhan-sat`) phát sau commit ở `MaterialYieldRecipeIssuesService.create`, tự đóng ở `receive`. `MATERIAL_YIELD_STEP_BUNDLE_TO_KCS` (entity `MATERIAL_YIELD_STEP_BUNDLE`, tới KCS, link `kcs-phoi?sub=chan-nhom`) phát ở `MaterialYieldRecipeProductionService.submitStep`, tự đóng ở `QcReviewsService.reviewMaterialYieldStep`. Module import `NotificationsModule`. FE: `XacNhanNhanSatPage` (dòng recipe) + `KcsChanNhomSection` (dòng bundle) gắn `focusAttr`; `KcsPhoiPage` đọc `?sub=chan-nhom` để mở thẳng tab "VT không gắn mảnh". Lỗi phát/đóng thông báo không làm hỏng việc đã commit (có test).
- **N-3 (trùng) — ĐÃ SỬA phần trùng:** `PURCHASE_PROPOSAL_APPROVED` gộp theo đề xuất (`dedupeKey` `PURCHASE_PROPOSAL_APPROVED:<id>`) → QLSX không còn nhận 1 thông báo/mỗi người mua; message bỏ số vật tư (số đó chỉ là phần người duyệt sau cùng). Phần "hàng về kho gửi ~7 vai" đã hết nhờ mục 30.3; message "hàng về kho" đã nêu vật tư + số lượng.
- **N-4 (muatp nhận thông báo không liên quan) — ĐÃ SỬA:** `notifyPurchaseProposalCreated` đọc người mua (`Material.buyerId`) của các dòng còn chờ → `params.buyerIds` → `PURCHASE_PROPOSAL_CREATED` chỉ báo đúng người mua; còn vật tư chưa giao người mua thì giữ báo cả nhóm PURCHASER như cũ.
- **Sales "đã đóng gói xong" không nháy — ĐÃ SỬA:** link mang `params.focus = SALES_ORDER_CODE:<mã đơn>`; `OrderManagementPage` gắn khoá đó ở dòng/thẻ đơn. Live: mở link → dòng `E2E-PO-1791443380842` nháy.
- **Menu bên bố cục hẹp không tự đóng khi bấm thông báo — ĐÃ SỬA:** `useCloseNavOnNotification` (sự kiện `dna:notification-navigate`) gắn vào 7 app shell; `NotificationCenter` + `MyNotificationsPage` phát sự kiện trước khi điều hướng. Live: bấm thông báo khi menu đang mở → menu đóng.
- **Kiểm tra:** jest BE (notifications, material-yield-recipes, qc-reviews, purchase-proposals, cutting-proposals, production-invoices) xanh — các spec cũ mock `purchaseProposalItem.count` được đổi sang `findMany`; mới: `purchase-proposal-notify.util.spec.ts`, `material-yield-recipe-issues.service.spec.ts`, ca N-1/N-4 trong `notification-links.spec.ts`; vitest FE 80 pass; tsc sạch (trừ 2 seed prisma cũ); eslint 0 lỗi.
- **CHƯA kiểm live:** N-1 (cần 1 PI có công thức chân nhôm đi qua xuất nhôm → nhận → gửi KCS; dữ liệu E2E07 cũ đã xong), N-4 (cần 1 PI mới có vật tư gán người mua khác nhau), N-3 gộp (cần 2 người mua cùng duyệt).
- **Còn lại:** N-7 (không có thông báo khi KHSX duyệt định mức / QLSX kết thúc — nghi chủ đích, chờ xác nhận); các loại cố ý không link (`QC_FAILED`, `PI_PRODUCTION_ORDER_FAILED`, `CUTTING_WASTE_DEFAULT_CHANGED`, `CUTTING_PROPOSAL_AUTO_APPROVED`); `WEAVING_ALLOCATION` và dòng SKU cấp item chưa có `focus`; `MATERIAL_ISSUE` chưa kiểm live (bị B-1 chặn).

### 30.10 Review N-7 (không có thông báo khi KHSX duyệt định mức / QLSX kết thúc) — _2026-10-09, CHỈ REVIEW, CHƯA SỬA_

**Kết luận: không phải sót khi cài đặt — 2 sự kiện này KHÔNG nằm trong bảng thiết kế 7.1/7.2** (bảng chỉ có "KHSX trả về định mức" và "Sếp duyệt/từ chối SKU"). Đánh giá giá trị: (1) **KHSX duyệt định mức → Spec**: Spec không có việc gì tiếp theo ở bước này; kết quả cuối (`SKU_APPROVED`) đã báo Spec khi Sếp duyệt → thêm chỉ tăng nhiễu, **đề xuất giữ nguyên**. (2) **QLSX Kết thúc → KHSX/Sales**: Sales đã được báo ở sự kiện có hành động ("đã đóng gói xong, sẵn sàng giao"); Kết thúc thường diễn ra SAU giao hàng → giá trị thấp, **tuỳ chọn** (chỉ có ích như dấu vết khi bấm nhầm).
**Khoảng trống THẬT được phát hiện khi review:** `ProductionOrdersService.startFloor/pauseFloor/finishFloor` KHÔNG phát thông báo cũng không phát realtime; tổ Phôi/Hàn/Sơn/KCS/kho không đọc `floorStage` ở màn của mình — bị QLSX **Tạm dừng/Kết thúc** thì chỉ biết khi thao tác bị BE chặn 409 ("chưa có SKU nào được QLSX bấm Bắt đầu…/đã Kết thúc"). Nếu làm gì ở nhóm này thì nên là **thông báo Tạm dừng/Tiếp tục/Kết thúc cho các tổ xưởng liên quan** (ALERT khi tạm dừng), không phải 2 mục N-7 gốc. CHƯA làm, chờ quyết định.

## 31. Rà vòng đời lệnh sản xuất theo 4 nhóm quản lý của ERP — _2026-10-09, rà xong; P1 (31.1–31.2) và P2 (31.3) ĐÃ LÀM, P3 còn treo_ _(P3 "quét quá hạn": thiết kế đề xuất ở mục 32, chưa làm)_

Căn cứ: đọc code BE (`notification-types.ts` ~48 type, `RealtimeEntityOn`/`publishEntityChanged`, `AUDITED_MODELS` + `writeAuditLog` thủ công, không có `@Cron`/scheduler nào) + kết quả live-test 08/10. 4 nhóm: (1) bàn giao có việc phải làm, (2) đổi trạng thái ảnh hưởng người khác, (3) ngoại lệ/cảnh báo, (4) dấu vết kiểm toán.

**Nhóm 1 — bàn giao có việc phải làm: phủ gần đủ.** Đã có: định mức → duyệt → Sếp; claim/gửi QLSX/Sếp; đề xuất mua; xuất sắt → Phôi; Phôi → KCS; Hàn/Sơn → KCS; xuất vật tư tiêu hao → tổ; chuyển kho; đóng gói → Sales; chân nhôm (mục 30.9). **Thiếu:** (a) Mua hàng "Sếp đã duyệt" → **Kho được phép nhận hàng**: `PURCHASE_PROPOSAL_APPROVED` chỉ tới QLSX, thủ kho chỉ thấy khi tự mở "Nhập kho"; (b) Sales tạo đơn có SKU chưa có định mức → KHSX (hoãn từ mục 15.5, chưa làm); (c) thông báo đan (`WEAVING_ALLOCATION`) có nhưng không `focus`; (d) chuyền kiểm xong → đóng gói, và xuất giao → QLSX/Sales: không báo (cùng kho, giá trị thấp).
**Nhóm 2 — đổi trạng thái ảnh hưởng người khác: thiếu nhiều nhất.** QLSX Bắt đầu/Tạm dừng/Tiếp tục/Kết thúc (`ProductionOrdersService.startFloor/pauseFloor/finishFloor`): KHÔNG thông báo; chỉ có `entity.changed PRODUCTION_ORDER` qua interceptor và CHỈ màn QLSX "Tổng hợp lệnh SX" nghe topic `production-orders` — màn Phôi/Hàn/Sơn/KCS/kho không nghe, không đọc `floorStage` → tổ xưởng chỉ biết khi thao tác bị BE chặn 409. Cũng không báo: sửa hạn từng công đoạn (`stages.deadline`), nạp lại định mức (`resync-bom`) cho tổ đang làm, PI/lệnh bị kết thúc khi còn dở.
**Nhóm 3 — ngoại lệ/cảnh báo: có phản ứng, chưa có chủ động.** Đã có: tính cắt lỗi/không đạt ngưỡng, KCS không đạt, chuyền kiểm có lỗi, đổi ngưỡng hao hụt, tạo lệnh thất bại (Admin, chưa có màn). **Thiếu (không có scheduler nào):** quá hạn giao (UI chỉ hiện "Quá hạn" khi mở), PI/đề xuất mua kẹt lâu ở 1 trạng thái (chờ QLSX/Sếp/Mua), thiếu tồn chỉ báo cho người thao tác lúc bị chặn (B-1 là ví dụ), lệch số lượng giữa các chặng, tồn dưới ngưỡng.
**Nhóm 4 — dấu vết kiểm toán: tốt ở chứng từ, hở ở vận hành xưởng.** Có audit tự động: master data, `SalesOrder`, `PlanForm`, `ProductionInvoice`, `WarehouseTransfer`, `SteelIssue`, `QcReview`, `MaterialIssue`, `PackagingIssue`, `ProductionBatch`, `StockReservation`, `PurchaseProposal` (+ ghi tay dòng item), `CuttingProposal`, `SystemConfig`; sổ kho `StockLedger` bất biến. **KHÔNG có audit:** `ProductionOrder` (ai bấm Bắt đầu/Tạm dừng/Kết thúc, lúc nào — chỉ `resync-bom` được ghi tay), xuất giao hàng (`SalesOrderItem.shippedQty`, dòng con, chỉ còn dấu vết ở sổ kho nếu có), `WeavingIssue/Receipt`, nhánh chân nhôm (`MaterialYieldRecipeIssue`, `MaterialYieldStepBundle`, `MaterialYieldIssue`).

**Việc đề xuất theo ưu tiên** (chưa làm): P1 audit `ProductionOrder` (bấm nhầm Kết thúc không truy được) + thông báo/realtime Tạm dừng-Tiếp tục-Kết thúc cho tổ xưởng (và màn tổ xưởng hiện trạng thái lệnh); P1 thông báo "Kho được nhận hàng" khi Mua hàng duyệt xong; P2 audit xuất giao hàng + nhánh chân nhôm; P2 thông báo đổi hạn công đoạn / nạp lại định mức cho tổ liên quan; P3 scheduler cảnh báo quá hạn / kẹt trạng thái (cần quyết định hạ tầng: cron trong BE hay job ngoài); P3 Sales tạo đơn thiếu định mức → KHSX.

### 31.1 Làm P1 của mục 31 — _2026-10-09, ĐÃ LÀM (chưa commit)_

1. **Audit `ProductionOrder` đổi `floorStage` — ĐÃ LÀM:** `ProductionOrdersService.recordFloorChange()` ghi `AuditLog` (UPDATE, `{floorStage: cũ}` → `{floorStage: mới}`, kèm người thao tác qua CLS) cho Bắt đầu / Tiếp tục / Tạm dừng / Kết thúc. Bấm lại cùng trạng thái (idempotent) không ghi. Live: audit có đủ 2 dòng PAUSED→ACTIVE và ACTIVE→PAUSED của PO 37.
2. **Thông báo trạng thái xưởng — ĐÃ LÀM:** 4 type mới `PRODUCTION_ORDER_FLOOR_STARTED/PAUSED/RESUMED/FINISHED` (entity `PRODUCTION_ORDER`); Tạm dừng là ALERT/WARNING và tự đóng khi Tiếp tục/Kết thúc. Người nhận = tổ Phôi/Hàn/Sơn/KCS + thủ kho 3 kho vật lý (xác định theo `warehouseScope` + role, KHÔNG theo role WAREHOUSE_STAFF đơn thuần vì dữ liệu demo cho cả `khsx`/`sales` giữ role này), loại Mua hàng. Resolver thêm tiêu chí `excludeRoles` (loại khỏi kết quả cuối). Live (kết thúc PO 37): nhận = phoi, han, son, kcs, khotp, khovttp, khopsh; KHÔNG nhận = muapsh/muavttp/muatp, sales, khsx, boss, qlsx. Tiếp tục → thông báo Tạm dừng cũ thành "Đã xử lý". Link: `production/phoi-lenh-sx?focus=PI_CODE:<mã PI>` (thay thế `inbound_warehouse/xuat-kho`); dòng PI ở board Hàn/Sơn (`PiListBoard` qua `rowFocus`), Phôi (`LenhSanXuatPhoi`), kho xuất sắt (`XuatSatPage`) gắn khoá `PI_CODE:`. Màn Phôi/Hàn/Sơn/KCS nay nghe thêm topic realtime `production-orders`.
3. **"Kho được nhận hàng" — ĐÃ LÀM:** type `PURCHASE_PROPOSAL_READY_TO_RECEIVE` (ACTION_REQUIRED) phát khi Mua hàng "Sếp đã duyệt" (`bossApprove`), tới thủ kho của đúng kho nhận từng vật tư (`receiveWarehouseCode ?? material.warehouse`), loại Mua hàng, gộp theo đề xuất (nhiều người mua), tự đóng khi đề xuất PURCHASED. Link `inbound_warehouse/nhap-kho` + khoá `PURCHASE_PROPOSAL:<id>`; `NhapKhoPage` gắn khoá ở dòng đề xuất.
4. **Kiểm tra:** jest BE (production-orders, purchase-proposals, notifications, production-invoices) 342 pass (mới: 6 ca đổi `floorStage`, ca READY_TO_RECEIVE, ca `excludeRoles`, ca khoá link/người nhận 5 type); vitest FE 80 pass; tsc sạch (trừ 2 seed prisma cũ); eslint 0 lỗi.
5. **Giới hạn đã thấy khi live:** (a) thông báo Tạm dừng/Kết thúc dẫn tới danh sách mà PI đó KHÔNG còn nằm trong (màn xưởng chỉ liệt kê PI `ACTIVE`) → không có dòng để nháy — chủ ý, tự thông báo đã giải thích; (b) thông báo Tiếp tục/Bắt đầu khi màn xưởng đã mở sẵn: danh sách chưa tải lại nên dòng chưa có để nháy tới khi bấm "Tải lại" (banner "Dữ liệu vừa được cập nhật" hiện); (c) READY_TO_RECEIVE chưa kiểm live bằng thông báo thật (cần 1 đề xuất mua mới đi qua bước "Sếp đã duyệt"); (d) màn xưởng vẫn không hiển thị TRẠNG THÁI lệnh (PAUSED/FINISHED) — PI chỉ biến khỏi danh sách.

### 31.2 Hiện trạng thái "tạm dừng" trên màn xưởng/kho — _2026-10-09, ĐÃ LÀM (chưa commit)_

**Vấn đề (mục 31.1 giới hạn d):** màn Phôi/Hàn/Sơn/KCS/kho chỉ liệt kê PI có ít nhất 1 SKU `floorStage = ACTIVE`, nên PI bị QLSX Tạm dừng chỉ BIẾN MẤT, người làm không biết vì sao. **Đã làm:** `components/FloorStoppedBanner.tsx` — banner vàng "Lệnh đang TẠM DỪNG — chưa thao tác được: <mã PI>…" (PI tạm dừng = có SKU PAUSED và không còn SKU ACTIVE, cùng quy tắc gộp theo PI), tự cập nhật theo realtime `production-orders` (không có ô nhập nên không cần nút "Tải lại"). Gắn ở 1 chỗ trung tâm mỗi app: `MfgApp` (Phôi/Hàn/Sơn/KCS) và `InboundWarehouseApp` (thủ kho có `warehouseScope`). **Cố ý KHÔNG liệt kê PI đã Kết thúc** (lịch sử dài, đã có thông báo riêng). Live: tạm dừng PO 37 → banner hiện đúng PI-2026-037 ở màn Hàn; tiếp tục → banner tự biến mất không cần tải lại. tsc/eslint sạch, vitest FE 80 pass. **Chưa:** test tự động riêng cho component (kiểm bằng live), banner chưa hiện ở màn Mua hàng/Sales (không làm việc theo lệnh xưởng).

### 31.3 Làm P2 của mục 31 — audit xuất giao/vật tư thành phẩm/đan + thông báo đổi thời hạn — _2026-10-09, ĐÃ LÀM (chưa commit)_

**Đã làm (BE):**
- Helper mới `src/common/utils/audit-event.util.ts` (`auditEvent`, best-effort: audit hỏng chỉ log, không chặn thao tác xưởng) cho các bảng không nằm trong `AUDITED_MODELS` hoặc ghi bằng `updateMany`/raw SQL.
- Audit mới: **xuất giao hàng** (`SalesOrdersService.shipItem` — `SalesOrderItem.shippedQty` trước → sau, raw SQL nay `RETURNING`); **nhánh vật tư thành phẩm/chân nhôm** (`MaterialYieldRecipeIssue` tạo/nhận, `MaterialYieldStepBatch` tạo, `MaterialYieldStepBundle` tạo); **xuất vật tư thành phẩm theo mảnh** (`MaterialYieldIssue` tạo/nhận); **đan** (`WeavingIssue` tạo, `WeavingReceipt` tạo). Mốc kế hoạch (`updateItem` — `materialDeadline`, `deliveryDeadline`, `stages`): audit 1 dòng old → new, CHỈ khi giá trị thật sự đổi.
- Thông báo mới `PI_ITEM_DEADLINE_CHANGED` (INFO, entity PRODUCTION_INVOICE, KHÔNG dùng dedupeKey (live-test thấy gộp làm mất nội dung lần sửa trước và dồn người nhận của 2 lần sửa khác nhau → mỗi lần sửa 1 thông báo)). Người nhận do service tính theo mốc nào đổi: Phôi/Hàn/Sơn → đúng tổ đó (Khung cơ khí → cả 3 tổ); Đan → thủ kho `phoi-son-han`+`vat-tu-tp`; Kiểm tra chuyển kho/Đóng gói → thủ kho `vat-tu-tp`+`thanh-pham`; mua vật tư → Mua hàng; giao hàng → Sales. KHÔNG báo QLSX (người sửa/tab khác). Mua hàng chỉ bị báo khi chính mốc mua vật tư đổi (họ giữ cả role WAREHOUSE_STAFF). Link `production/phoi-lenh-sx` focus PI_CODE, alt kho/mua hàng/Sales.
- **Quyết định không làm:** thông báo "resync BOM" — chỉ cho resync khi `floorStage = PENDING`, xưởng chưa thấy lệnh nên báo vô nghĩa. Phần gán thủ kho theo công đoạn Đan/Kiểm tra/Đóng gói là suy luận theo kho (chưa có người xác nhận), sai thì chỉnh bảng `stageWarehouses` trong `auditAndNotifyDeadlineChange`.

**Kiểm tra:** constructor `MaterialYieldIssuesService`/`WeavingIssuesService` thêm `ClsService` (spec cập nhật); test mới cho audit ship, yield-recipe, `updateItem` (đổi Hàn+Đan+giao hàng → đúng người nhận; lưu y nguyên → không audit/báo). tsc sạch, eslint sạch (chỉ 1 warning `any` có sẵn), jest toàn BE 1474 pass / 1 skip.
**Live-test UI (khsx, PI-2026-035, "Sửa thời hạn"):** đổi Mua hàng + Giao hàng + Khung cơ khí → audit 1 dòng (cũ→mới) + thông báo tới sales, 3 Mua hàng, phoi, han, son; đổi Đan + Đóng gói → thêm kho phôi-sơn-hàn/vật tư/thành phẩm; chỉ đổi Đan → CHỈ khopsh, khovttp; bấm Lưu không đổi gì → không audit, không thông báo. **Lỗi phát hiện & sửa trong live-test:** lúc đầu có dedupeKey nên lần sửa 2 ghi đè nội dung lần 1 và dồn người nhận của cả hai (phoi/han/son bị báo "Đan…") → bỏ dedupeKey. Chưa kiểm: bấm thông báo của người nhận để nhảy màn (link dùng lại của floor-stage, đã live-test ở 31.1).
**Chưa:** FE chưa đụng (type mới dùng link sẵn có); P3 (job báo quá hạn/kẹt) vẫn treo, cần quyết định hạ tầng scheduler. Lỗi B-1 (kho không xuất được sơn cho PI của chính nó) KHÔNG thuộc phạm vi notification, chủ việc khác xử lý — không sửa ở đây.

## 32. Nghiên cứu "timeline chuẩn ERP" + thiết kế thông báo trễ hạn — _2026-10-26, CHỈ NGHIÊN CỨU, CHƯA SỬA CODE_

Người dùng gửi ảnh ô "Sửa thời hạn" của SKU E2E-FULL-42810908 ×50 (PI-2026-035, dữ liệu test) kèm yêu cầu "nghiên cứu về phần
timeline chuẩn ERP". Đây là phần nền cho buổi Sếp họp chốt business rule thời hạn (bộ nhớ `business-rule-thoi-han-cho-hop-sep`,
changelog-2026-10-21 mục 32.6), sau đó mới làm thông báo trễ deadline cho Sếp.

**Sản phẩm:**
- Trang tài liệu cho buổi họp https://claude.ai/artifact/Uuz7ZdMh6oECZjSBKGQWTn (riêng tư, người dùng tự chia sẻ cho Sếp).
- **Bản HTML mở trực tiếp (cập nhật 2026-10-26, người dùng muốn HTML thay PDF): `docs/nghien-cuu-timeline-chuan-erp-2026-10-26.html`.**
  - Cùng nội dung với trang online, có đủ `<!doctype>/<head>`, bấm đúp là mở bằng trình duyệt.
  - Không có mạng thì dùng phông của máy.
  - Có kiểu in A4 (Ctrl+P): luôn nền sáng, hình co vừa trang, link nguồn in kèm địa chỉ.
  - Đã mở thử từ ổ đĩa: hiển thị đúng, tag đóng đủ.
  - Chưa commit.
- Nguồn dựng trang nằm ở scratchpad phiên (`timeline-doc/template.html` + `build.py`, hình SVG sinh từ dữ liệu). Thư mục tạm có thể
  bị dọn; bản giữ lâu dài là file trong `docs/`.

**Hiện trạng DNA-ERP (đọc code 26/10):**
- Mốc của 1 SKU:
  - `materialDeadline` (Mua hàng, **một ngày chung cho mọi vật tư**) + `deliveryDeadline`;
  - `ProductionInvoiceItemStage` gồm FRAME, FRAME_PHOI/HAN/SON, WEAVING, TRANSFER_CHECK (form chưa hiện), PACKAGING.
  - Mỗi mốc chỉ là 1 `deadline`. Dạng khoảng từng thử ngày 11/09 rồi bỏ.
- "Ước tính" ở FE (`LenhSXPage` `estimateFrom`) lùi cố định từ hạn giao của SKU: Phôi −25, Mua hàng −21, Hàn −20, Sơn −16,
  Khung −14, Đan −8, Đóng gói −3.
  - Các số của công đoạn sản xuất đã khớp một chuỗi tính lùi (Hàn 5 / Sơn 4 / KCS 2 / Đan 6 / Đóng gói 5 / đệm giao 2 ngày).
  - **Chỉ Mua hàng −21 lạc chỗ**, nằm giữa Phôi và Hàn.
  - Ước tính không bám mốc đã chốt bên cạnh.
- BE `applyItemDeadlines` ghi thẳng, **không kiểm thứ tự mốc**. Chỉ có luật gộp ≤ 3 ngày / tối đa 2 SKU.
- `MaterialSupplier.leadTimeDays` có sẵn nhưng chưa dùng để tính ngày đặt hàng.
- Đã có `PI_ITEM_DEADLINE_CHANGED` (mục 31.3) và mẫu quét định kỳ `FloorAlertsService` (10 phút, dedupe, tự đóng).
- **Chưa có cảnh báo quá hạn/sắp trễ** (mục 31, P3).
- Quy ước 9.3 vẫn giữ: Sếp chỉ nhận việc cần duyệt + CRITICAL, không có digest.

**Lệch ở PI-2026-035:**
- Mua hàng 02/10 (đã lưu) nằm sau Phôi 17/09 tới 15 ngày.
  - So với chuỗi đề xuất: trễ 18 ngày so với ngày cần sắt (14/09) và trễ 4 ngày so với vật tư đan (28/09). Chỉ kịp cho bao bì,
    nệm (04/10).
- Đan 07/10 → Đóng gói 10/10 chỉ còn 3 ngày, chuẩn 5 ngày → sớm nhất xong 12/10, trùng ngày giao.
- Mốc mặc định Đan (D−8) rơi vào Chủ nhật 04/10.
- **UI:** ô `<input type="date">` hiện tháng/ngày/năm theo ngôn ngữ trình duyệt, còn thẻ lệnh hiện ngày/tháng/năm → dễ đọc nhầm.

**Cách ERP chuẩn làm (có nguồn):**
- Odoo 17 "Lead times": tính lùi kèm ví dụ ngày giao 20/9; tách vendor lead time / purchase security / days to purchase.
- Odoo "Delayed manufacturing orders": 3 bộ lọc Delayed Productions / Late / Late Availability.
- SAP Help:
  - đệm trước/sau sản xuất (scheduling margin key);
  - các phần thời gian của công đoạn: queue/setup/processing/teardown/wait/move;
  - overlapping với số lượng chuyển trước tối thiểu;
  - thông báo ngoại lệ MRP.
- Microsoft Learn "Master plans": Calculated delays, Action messages.
- Critical Chain: chia đệm xanh/vàng/đỏ.

**Đề xuất (chờ Sếp chốt, số có * là giả định):**
- Chuỗi 12 mốc tính lùi: đặt mua sắt D−35 (NCC giao 7*) → sắt về D−28 → Phôi 3* ngày (ngày cắt D−27, xong D−25) → Hàn D−20
  → Sơn D−16 → KCS/hoàn thiện khung D−14 → (vật tư đan về D−14) → Đan D−8 → (bao bì, nệm về D−8) → Đóng gói D−3 → đệm 2 ngày
  → giao D.
- 7 luật kiểm, L1–L7:
  - chặn đảo thứ tự;
  - cảnh báo khi gấp hơn số ngày chuẩn, khi rơi ngày nghỉ, khi lệnh không kịp lúc tạo;
  - ước tính bám mốc đã chốt;
  - mốc tự dời khi khách dời hạn giao;
  - lệnh gộp giữ như 24/10.
- 5 loại thông báo:
  - A. Sắp tới hạn;
  - B. Chưa khởi công;
  - C. Vật tư về trễ;
  - D. Quá hạn công đoạn;
  - E. Nguy cơ trễ giao, có vàng/đỏ. Đỏ là CRITICAL nên tới Sếp theo quy ước 9.3.
  - Tất cả tính theo "ngày dự kiến xong" lan truyền từ tiến độ thật.
- 15 câu hỏi Q1–Q15 cho buổi họp. Quan trọng nhất:
  - Q1–Q2: "Mua hàng" là ngày gì, có tách theo nhóm vật tư không;
  - Q3: "ngày cắt sắt" của luật gộp là ngày nào;
  - Q4: số ngày từng công đoạn;
  - Q8: ngày lịch hay ngày làm việc;
  - Q10: thế nào là "xong";
  - Q11: Sếp nhận gì.

**Kiểm tra:**
- Đã kiểm lại bằng script mọi ngày ghi kèm thứ trong trang và mọi số D−n (0 sai).
- `node --check` script tooltip: sạch.
- Xem hình 1 lần qua máy chủ tĩnh tạm (cấu hình thêm tạm vào `.claude/launch.json`, đã gỡ lại đúng 6 mục cũ). Sửa màu cột Chủ
  nhật ở chế độ tối cho dễ thấy.
- Không chạy test code vì không sửa code.

**Chưa làm / còn treo:**
- Chưa sửa phần mềm.
- **Tới khi có kết quả họp vẫn giữ `ownSteelDeadlineOf` (BE) / `steelNeedDate` (FE) = Mua hàng → Khung.**
- Danh sách việc kỹ thuật sau khi chốt nằm ở mục 9 của trang tài liệu.
- Trang tài liệu đang riêng tư. Người dùng cần bấm Share trên trang thì Sếp mới mở được.

### 32.1 2026-10-27 — Đối chiếu nhật ký "LICH_SU_TRAO_DOI_CLAUDE_den_10-10-2026" — anh Nhân ĐÃ có quy tắc mốc theo ngày N

Người dùng gửi file nhật ký trao đổi anh Nhân – Claude, 04–10/10/2026, 12.519 dòng, nhờ review và tóm tắt.
- Nhật ký là một phiên Claude chạy trên máy anh Nhân: đọc Zalo/OneDrive "nhà máy IEA", làm file Excel/PDF, nhắn nhóm Zalo.
- File gốc chỉ ở `Downloads` của người dùng, không chép vào repo.

**Phát hiện quan trọng cho mục 32:** ngày 05–06/10 anh Nhân đã chốt với Claude quy tắc lên kế hoạch lệnh sản xuất.
- Mọi mốc tính **xuôi từ N = ngày bắt đầu phôi**, không lùi từ hạn giao.
- Bảng mốc Phú An / Phước An:

| Mốc | Phú An | Phước An |
|---|---|---|
| Nhóm 1 (sắt, thép, la tấm, tán rút, đá cắt, dây hàn, CO2, viên nén, sơn bột, hoá chất, gas, nút/ống nhôm) + nhóm 2 (dây đan, đinh, nút cỡ ống) về | hết N−1, sớm nhất N−5 | như Phú An |
| Phôi xong (xuất đan đủ) | N+2 | N+4 |
| Vật tư còn lại (thùng, xốp, nệm, gỗ, phụ kiện, nhãn) về đủ | hết N+8 | hết N+10 |
| Thu mảnh từ / về đủ | N+9 / N+12 | N+11 / N+14 |
| Chuyền kiểm xong | N+12 | N+14 |
| Đóng gói xong | N+14 | N+16 |

- Các luật đi kèm:
  - Phú An mỗi ngày bắt đầu 1 lệnh; Phước An các lệnh cách nhau 3 ngày.
  - Xếp theo hạn giao gần trước.
  - Năng lực hàn khoảng 6.500 mảnh/ngày chỉ dùng để cảnh báo.
  - Vật tư không về sớm quá 4 ngày vì kho chật.
  - Sản phẩm không đan: vật tư còn lại về hết N+4 / N+6.
  - MY-324/325 (sofa) nới thêm 10 ngày từ mốc vật tư còn lại trở đi.
  - Lệnh tách xưởng: ghế làm ở Phước An, bàn làm ở Phú An.
- **Hàng gỗ:** G = ngày gỗ nhập kho = hạn giao − 9. Vật tư đóng gói về G − 3, đóng gói xong G + 2. Số cont gỗ mỗi tháng không vượt
  bảng của Ba Chinh.
- **Chưa thấy anh Nhân trả lời** câu "có xếp lệnh vào Chủ nhật không".

**Ý nghĩa với tài liệu Timeline (mục 32) — chưa sửa tài liệu, chưa sửa code:**
- Q3 "ngày cắt sắt": anh Nhân đã dùng N (ngày bắt đầu phôi) làm mốc gốc, khớp phương án b.
- Q1/Q2: vật tư đã được tách theo nhóm và gắn với N: nhóm 1–2 về hết N−1, vật tư còn lại về hết N+8/N+10.
- Q4: số ngày khác hẳn chuỗi mặc định trong ERP (lùi từ hạn giao: Phôi −25 … Khung −14 … Đóng gói −3).
  - Theo quy tắc N, cắt + hàn + sơn tới lúc xuất đan chỉ 2 ngày (Phú An); từ xuất đan tới đóng gói 12 ngày.
  - ERP hiện không có mốc "thu mảnh", còn quy tắc N có.
- Xưởng (Phú An/Phước An) làm lệch mốc +2 ngày. ERP chưa có khái niệm này trên timeline.
- Luật gộp sắt anh Nhân chốt trong nhật ký khớp luật ERP 24/10 ở điểm **tối đa 2 lệnh**. Các luật cắt sắt khác trong nhật ký:
  - mỗi quy cách 1 chiều dài cây, tròn đuôi 0/5 cm, tối đa 6,5 m;
  - mỗi kiểu cắt hao dưới 1%, nhát cưa không tính hao, tề đầu 10 mm có tính;
  - gộp cùng xưởng cùng quy cách; riêng 20×20×0,6 ghép bàn I3 mới với bàn J55;
  - đoạn dư chuyển cho lệnh sau, cây cuối giữ dài lưu kho;
  - kg/m lấy theo phiếu so sánh giá Kim Phát.
  - Kết quả: 15 quy cách, khoảng 128.900 cây, 212,6 tấn.
  - Những luật này cần đối chiếu với bộ giải HiGHS trước khi coi là "luật ERP".

**Còn treo:**
- Chưa cập nhật tài liệu Timeline (artifact + `docs/nghien-cuu-timeline-chuan-erp-2026-10-26.html`) theo quy tắc N — chờ người dùng đồng ý.
- Vẫn giữ `ownSteelDeadlineOf` / `steelNeedDate` = Mua hàng → Khung tới khi có kết quả họp.

### 32.2 2026-10-27 — Sếp chốt: hệ thống đề xuất timeline theo mốc Phú An, KHSX cập nhật ngày cụ thể — ĐÃ LÀM ở 32.3

Người dùng: "sếp nói là hệ thống sẻ đề xuất timeline theo mốc của Phú An, và đó là hệ thống đề xuất thôi còn thời gian cụ thể thì
KHSX sẻ cập nhập".

**Đã chốt:**
- Ngày "ước tính" trên lệnh sản xuất đổi từ số lùi cố định (−21/−25/−20/−16/−14/−8/−3) sang quy tắc N của Phú An (mục 32.1).
- Đó chỉ là đề xuất; KHSX sửa ngày thật như hiện nay.
- Không dùng mốc Phước An (+2 ngày) cho đề xuất.

**Rà hiện trạng:**
- Ngày ước tính chỉ tính ở FE, `LenhSXPage.tsx` (`estimateFrom`), ở 4 chỗ: form sửa, chi tiết Sếp/QLSX, chi tiết KHSX, hộp xác nhận.
- BE chỉ dùng ngày đã lưu (`frameDeadlineOf`, `ownSteelDeadlineOf`), không có số lùi. Vì vậy đổi đề xuất không ảnh hưởng luật
  gộp, đề xuất mua hay giữ chỗ tồn.

**Cách áp đang đề xuất (chờ người dùng xác nhận trước khi code):**
- N = hạn giao − 17, tức đóng gói xong trước hạn giao 3 ngày như mặc định cũ.
- Mua hàng = N−1.
- Phôi / Hàn / Sơn = N / N+1 / N+2.
- Khung cơ khí (xuất đan đủ) = N+2.
- Đan (thu mảnh về đủ) = N+12.
- Đóng gói = N+14.
- "Vật tư còn lại về hết N+8" chưa có ô trong ERP, để sau.
- Chuyền kiểm (N+12) có trong dữ liệu nhưng form chưa hiện, giữ nguyên.

### 32.3 2026-10-27 — ĐÃ LÀM: ngày đề xuất theo mốc Phú An ở FE (form "Sửa thời hạn" + 3 màn chi tiết lệnh) — local, CHƯA commit

Người dùng duyệt danh sách A/B/C rồi bảo "làm". **Chỉ sửa FE `D:\DNA-ERP`; BE không đổi, không migration.**

**A. Cách tính** — file mới `src/utils/phuAnTimeline.ts`:
- `phuAnAnchor(Khung, hạn giao)`:
  - N = Khung cơ khí đã có − 2;
  - chưa có Khung thì N = hạn giao CỦA CHÍNH SKU − 17 (đóng gói N+14 xong trước hạn giao 3 ngày).
- `phuAnDate`: Mua hàng N−1, Phôi N, Hàn N+1, Sơn N+2, Khung N+2, Đan N+12, Đóng gói N+14.
- Kèm `phuAnOffsetLabel`, `fmtDayVN` (luôn ngày/tháng/năm kèm thứ), `toInputDate`.
- Test mới `phuAnTimeline.test.ts`: 8 ca, gồm PI-2026-035 và ca qua năm.
- `LenhSXPage.tsx`: bỏ `estimateFrom` (lùi cố định 21/25/20/16/14/8/3), thay bằng `proposeFor(item, hạn PI)` cho cả 4 chỗ.

**B. Form "Sửa thời hạn":**
- Dòng "Bắt đầu phôi đề xuất (N): T5 · 24/09/2026, tính từ Khung cơ khí 26/09" (hoặc "từ hạn giao … (đóng gói xong trước 3 ngày)").
- Ô xếp theo dây chuyền: Mua hàng → Khung cơ khí → Đan → Đóng gói.
  - Lưới 4 cột, điện thoại 2×2. Trước đây flex-wrap làm ô Đóng gói rớt một mình.
  - Nút Phôi/Hàn/Sơn dời xuống dưới ô Khung. Để chung dòng nhãn thì khung hẹp nhãn bị đẩy 2 dòng, ô lệch hàng (thấy khi kiểm trên
    trình duyệt).
- Nhãn "(ước tính)" → "(đề xuất)".
- Dưới mỗi ô có dòng "T6 · 02/10/2026", cạnh ô đề xuất ghi kèm "N+1".
- Ô đã chốt mà khác đề xuất có nút "đề xuất dd/mm" để điền nhanh, vẫn phải bấm Lưu.
- Đổi Khung hoặc hạn giao thì mọi ô còn đề xuất (chưa ai sửa) tự tính lại theo N mới; ô đã chốt giữ nguyên.
- Cách lưu không đổi: ô đề xuất không sửa thì không ghi.

**C. Màn chi tiết + hướng dẫn:**
- Chi tiết Sếp/QLSX, chi tiết KHSX và hộp xác nhận "Gửi QLSX" dùng cùng công thức, nhãn "đề xuất".
- Trang Hướng dẫn (`Guide/content/productionPlan.ts`) thêm câu giải thích quy tắc.

**Kèm theo:** dòng 808 cùng file trộn `gap` + `rowGap` (React cảnh báo khi vẽ lại) → `gap: '8px 10px'`.

**Kiểm tra:**
- `tsc` sạch; eslint 0 lỗi (91 cảnh báo có từ trước, gồm `piDeadline` không dùng ở hộp duyệt); vitest **28 file / 258 test** xanh.
- **Trình duyệt** (FE 3100 + BE 3002 trên DB test, tài khoản KHSX demo; máy vừa khởi động lại nên đã bật lại Docker Desktop, BE, FE):
  - PI-2026-035, form Sửa thời hạn:
    - N = T5 24/09, Phôi/Hàn/Sơn đề xuất 24/25/26/09;
    - nút "đề xuất 23/09 / 06/10 / 08/10" ở Mua hàng / Đan / Đóng gói;
    - đổi Khung thử 29/09 → N thành CN 27/09, Phôi/Hàn/Sơn 27/28/29/09, các nút đề xuất đổi theo;
    - bấm nút đề xuất Mua hàng → ô thành 26/09;
    - bấm **Hủy**, dữ liệu không đổi (vẫn 02/10, 26/09, 07/10, 10/10).
  - PI-2026-016 (lệnh gộp, hạn giao 05/12 và 10/12, chưa lưu Khung/Đan/Đóng gói):
    - chi tiết KHSX và hộp "Gửi QLSX" hiện Khung 20/11 và 25/11, Đan 30/11 và 05/12, Đóng gói 02/12 và 07/12, đều "đề xuất";
    - tính theo hạn giao riêng từng SKU.
    - Hộp "Gửi QLSX" bấm Hủy, không gửi.
  - Màn chi tiết Sếp/QLSX chưa mở trên trình duyệt, chỉ kiểm qua tsc vì cùng đoạn code.
  - Console còn 1 dòng cảnh báo React gap/rowGap. Chưa chắc là cảnh báo cũ còn lưu từ lúc nạp nóng hay mới phát sinh.

**Chưa làm / còn treo:**
- Mốc "vật tư còn lại N+8" (chưa có ô).
- Chặn khi nhập sai thứ tự.
- Ô Chuyền kiểm.
- Thông báo trễ.
- Cập nhật tài liệu Timeline (artifact + HTML) theo quyết định này.
- Chưa commit.

### 32.4 2026-10-27 — Rà vật tư trong bản sao lưu production: thuộc công đoạn nào, thuộc mốc vật tư nào (CHỈ RÀ)

Người dùng làm rõ: "vật tư còn lại là trừ vật tư khung cơ khí, vật tư thành phẩm". Người dùng nhờ rà DB production đã sao lưu, xem có
những vật tư gì và thuộc công đoạn nào.

**Cách rà:**
- Khôi phục `backups/prod_20261026_0951_truoc-deploy-solver.dump` vào container `postgres:17-alpine` tạm (không mở cổng, xoá ngay sau đó).
- **Không kết nối DB production.**
- Danh sách đầy đủ 384 vật tư: `backups/vat-tu-production-2026-10-26.csv` (đã gitignore, là dữ liệu production).
- Script ở scratchpad: `review_prod_materials.sh`, `prod_material_stage.sh`.

**Có gì:** 384 vật tư đang dùng, không có vật tư nào xoá hoặc ngừng.

| Kho | Nhóm / loại | Số |
|---|---|---|
| Phôi Sơn Hàn | Sắt phần mềm (sắt hộp/phi/vuông 6–8 zem) | 20 |
| | Sắt tự tính (la tấm, sắt phi, thanh nhôm) | 7 |
| | Vật tư thành phẩm tự gia công (chân nhôm, các loại Pat) | 19 |
| | Tán rút | 3 |
| | Tiêu hao (đá cắt, đá mài, dây hàn, CO2, gas, hãm bọt, photphat, tẩy dầu, viên nén) | 11 |
| | Sơn bột | 1 |
| Vật tư thành phẩm | Dây | 14 |
| | Đinh | 3 |
| | Nút nhựa / nút nhôm | 18 |
| | Phụ kiện bulon, londen, lục giác, vis, tán dù, góc su gỗ, xăng | 31 |
| Kho thành phẩm | Phụ kiện: xốp, HDLR, nhãn, lót, tem, logo, giấy, băng keo; đồ gỗ / kính (mặt bàn gỗ, tay gỗ, khung tựa, mê ngồi, kính cường lực); gối ôm | 191 |
| | Nệm (9 màu) | 9 |
| | Bao bì (bao nylon, thùng…) | 55 |
| | Sơn dặm | 1 |
| | Nút phi Ø18 | 1 |

- Người mua: Nhàn 156, Nguyệt 148, Nghi 77.
- 3 dòng "Chân nhôm" không có người mua; đây là hàng tự gia công nên không cần người mua.

**Không đọc được công đoạn từ dữ liệu production:**
- Production **chưa có định mức nào**: `consumable_bom`, `piece_material_item`, `bom_accessory_items` đều 0 dòng.
- Chỉ có đoạn cắt cho 12 mã sắt.
- **Chưa có phiếu xuất nào**: xuất sắt, xuất tiêu hao, xuất đan, xuất đóng gói, xuất VTTP đều 0.
- DB test trên máy cũng chỉ có định mức E2E.
- Vì vậy phân loại công đoạn dưới đây **suy từ kho / nhóm / loại / tên + luồng xuất trong code**:
  - xuất sắt → Phôi;
  - định mức tiêu hao theo công đoạn → Hàn/Sơn;
  - mảnh có đan = có dòng Dây + Đinh, xuất đan gộp dây/đinh/VTTP;
  - xuất đóng gói theo phụ kiện/bao bì BOM.

**Phân loại đề xuất:**
- **VT khung cơ khí, về hết N−1** (khoảng 95 mã):
  - toàn bộ kho Phôi Sơn Hàn (Phôi: sắt, la, đá cắt/mài; Hàn: dây hàn, CO2, tán rút; Sơn: sơn bột, tẩy dầu, photphat, hãm bọt);
  - Dây, Đinh (trừ đinh cấp chuyền), Nút ở kho Vật tư thành phẩm (đi kèm khung lúc xuất đan).
- **VT thành phẩm, về hết N+8** (khoảng 289 mã):
  - toàn bộ kho thành phẩm (đóng gói, nệm, gối, đồ gỗ, kính, nhãn, HDLR);
  - phụ kiện bulon/vis/lục giác ở kho Vật tư thành phẩm (kèm thùng);
  - đinh cấp chuyền.

**Cần người dùng / KHSX xác nhận:**
- Gas (đốt móc), viên nén, hãm bọt: dùng ở Hàn hay Sơn.
- Pat là VTTP tự gia công: dùng ở Hàn hay đi kèm xuất đan.
- Nút nhựa: gắn ở công đoạn nào.
- Đế nhựa đinh nâu phi 21.
- Đinh F10 cấp chuyền.
- Xăng.
- Sơn dặm.
- Nút phi Ø18 nằm ở kho thành phẩm.
- 256 vật tư đóng gói/phụ kiện gán kho "Kho thành phẩm" chứ không phải "Kho Vật tư thành phẩm". Luồng xuất đóng gói trong code
  ghi nguồn là kho Vật tư thành phẩm → cần xem đây là chủ ý hay nhập nhầm kho.

### 32.5 2026-10-27 — Sếp làm rõ khung ngày về của 2 nhóm vật tư (hạn chót + ngày sớm nhất) — A–C ĐÃ LÀM ở 32.8, D ĐÃ LÀM ở 32.28

Người dùng gửi ảnh tin nhắn của Sếp Nhân, trả lời câu hỏi về mốc N−1 / N+8:
- "N-1 là deadline, còn được về là ngày N-5".
- "vật tư còn lại thì anh lấy ngày đóng gói trừ đi 7 ngày mới đúng".
- "trừ đi 7 ngày là deadline, còn về được từ ngày đóng gói trừ đi 11 ngày".

**Quy tắc sau khi làm rõ** (N = ngày bắt đầu phôi, ĐG = ngày đóng gói):

| Nhóm vật tư | Được về từ (sớm nhất) | Hạn chót | Tính theo |
|---|---|---|---|
| VT khung cơ khí (sắt, la, tán rút, đá cắt, dây hàn, CO2, sơn bột, hoá chất, dây đan, đinh, nút) | N−5 | N−1 | ngày bắt đầu phôi |
| VT thành phẩm (vật tư còn lại: thùng, xốp, nệm, gỗ, phụ kiện, nhãn) | ĐG−11 | ĐG−7 | ngày đóng gói |

- Mỗi nhóm có **khung 5 ngày** (từ ngày sớm nhất tới hạn chót, tính cả hai đầu).
- Khác ghi chép cũ ở 32.1: "vật tư còn lại về hết N+8". Nay tính theo **ngày đóng gói**:
  - đóng gói đề xuất N+14 thì hạn chót = N+7 (sớm hơn ghi chép cũ 1 ngày);
  - KHSX dời ngày đóng gói thì hạn VT thành phẩm dời theo.
- Ví dụ PI-2026-035 (Khung 26/09 → N = T5 24/09, đóng gói đề xuất T5 08/10):
  - VT khung: về từ T7 19/09, hạn chót T4 23/09;
  - VT thành phẩm: về từ CN 27/09, hạn chót T5 01/10.

**Cách hiểu "được về từ" (chưa hỏi lại Sếp):** ngày sớm nhất nên cho hàng về, để không chiếm kho và vốn quá sớm.
Chưa rõ:
- chỉ để Mua hàng tham khảo hay hệ thống phải cảnh báo khi hàng về sớm hơn;
- KHSX sửa tay hạn chót thì ngày sớm nhất tính lại theo hạn mới (hạn − 4) hay vẫn theo N / ĐG.

**Đối chiếu code hiện tại (chỉ đọc):**
- Ô "Mua hàng" (`materialDeadline`) đang chỉ dùng cho luồng sắt, nên đúng nghĩa là hạn chót VT khung cơ khí:
  - hạn xếp việc của đề xuất mua từ phương án cắt (`purchase-proposals.service.ts` `frameDeadlineOf`);
  - luật gộp (`merge-rules.util.ts` `ownSteelDeadlineOf`);
  - xếp hạng giữ tồn (`stock-reservations.service.ts`, qua `frame-deadline.util.ts`).
- Chưa có ô nào cho VT thành phẩm.
- Enum `ProdItemStageType` đã có `TRANSFER_CHECK` (Chuyền kiểm) nhưng form chưa có ô.
- **Phát hiện khi lập danh sách sửa:** đề xuất mua tự tính theo PI KHÔNG có hạn.
  - Gồm các nguồn `CONSUMABLE_AUTO_CALC` (dây/đinh/tán/nút, sơn, phụ kiện/bao bì), `PIECE_MATERIAL_YIELD`, `MATERIAL_YIELD_RECIPE`.
  - Lý do: `PurchaseProposalsService.toResponseDto` chỉ tính `deadline` qua `cuttingProposal`. Các nguồn này không có phương án cắt
    nên `deadline = null`, Mua hàng thấy "chưa có hạn".
  - Chỉ đọc code, chưa kiểm trên dữ liệu. Đưa vào phần D của danh sách sửa (làm sau).

**Trạng thái (cập nhật 2026-10-27):** A–C đã làm ở 32.8 (local, chưa commit). D (gắn hạn cho dòng đề xuất mua tự tính theo PI) để sau. **Cập nhật 2026-10-29: D ĐÃ LÀM ở 32.28** (hạn riêng từng dòng mua theo nhóm vật tư, hàm dùng chung `purchaseDeadlineOf`).

### 32.6 2026-10-27 — Review: lệnh gộp chia mốc riêng từng SKU + hàng về kho "fill" cho SKU hạn gần trước (CHỈ RÀ; phát hiện 1 đã xác nhận ở 32.9 và ĐÃ SỬA ở 32.10)

Người dùng gửi ảnh mục 11 (ý Sếp):
- Câu hỏi: "gộp sku lại thì chia timeline như thế nào, cách filling vật tư cho các lệnh sản xuất được gộp".
- Sếp trả lời: "gộp lại nhưng vẫn chia mốc thời gian tách biệt nhau, lúc nhận vật tư thì ưu tiên filling cho các lệnh sớm trước".
- Người dùng giải thích: hàng về kho thì fill vật tư cho từng SKU trong PI, SKU nào hạn gần nhất thì được fill trước để sản xuất.

**Cách rà:**
- Đọc code BE: `stock-reservations.service.ts`, `purchase-proposals.service.ts` (`receiveItem`), `consumable-material-purchase.service.ts`,
  `steel-issues`, `material-issues`, `weaving-issues`, `packaging-issues`, `material-yield-issues`.
- Đọc code FE: `ThongKePagePlan.tsx`.
- Truy vấn CHỈ ĐỌC DB test `dna_erp_solver_test`. Script: scratchpad `merged_pi_fill_check.sh`.

**Kết quả:**

| Phần | Ý Sếp | ERP hiện tại | Đánh giá |
|---|---|---|---|
| Mốc thời gian từng SKU trong lệnh gộp | tách riêng | Mỗi SKU có mốc riêng. Đề xuất Phú An tính theo hạn của chính SKU (32.3). Luật gộp chỉ so mốc cần sắt. | Đạt |
| Đề xuất mua lệnh gộp | — | 1 đề xuất cho cả PI. Hạn sắt = SKU sớm nhất. Đề xuất tự tính theo PI không có hạn (32.5). | Đạt một phần |
| Hàng mua về kho | fill từng SKU, hạn gần trước | `creditPool` cộng vào phần giữ của CẢ PI. Không chia SKU. | Chưa đạt |
| Xuất tiêu hao / đan / đóng gói (theo từng SKU) | SKU sớm trước | Chỉ kiểm tồn thật. SKU hạn sau xuất trước vẫn được, có thể lấy hết phần SKU hạn sớm cần, không cảnh báo. | Chưa đạt |
| Xuất sắt cho Phôi | — | Theo cả PI (cắt chung). Một cây có đoạn của nhiều SKU nên không chia cây theo SKU được. | Đúng bản chất cắt chung |
| % Mua hàng từng SKU (Thống kê QLSX) | — | Số chung cả PI, trừ dây/nệm riêng từng dòng. Không biết SKU nào đã đủ. | Chưa đạt |

**Chi tiết phần "hàng về" và "xuất":**
- Quyết định cũ (Sếp chốt 2026-08-26, L5): SKU gấp nhất được ưu tiên. Code `loadPool` có sắp theo hạn SKU, nhưng:
  - chỉ có tác dụng khi các SKU được duyệt cắt RIÊNG (mỗi SKU 1 dòng giữ);
  - lệnh gộp cắt chung, cùng mọi vật tư tiêu hao / phụ kiện / bao bì, chỉ có 1 dòng giữ cho cả PI;
  - xuất rút theo TỔNG của PI, nên thứ tự này không quyết định SKU nào được hàng.
- DB test: 15 PI có 2 SKU. Giữ chỗ đều 1 dòng / PI / vật tư, không có dòng nào theo SKU.

**Phát hiện thêm (nên sửa, chưa sửa):**
1. **Rất có thể chặn nhầm chính PI đã mua hàng.**
   - Hàng về khi PI chưa có dòng giữ (thường gặp: lúc tính đề xuất kho = 0) thì `creditPool` tạo dòng giữ loại `PRODUCTION_INVOICE`.
   - Xuất tiêu hao (`material-issues`) và xuất đóng gói (`packaging-issues`) trừ dòng này khỏi tồn khả dụng mà không cộng lại phần của
     chính PI. Xuất đan và xuất VTTP đã sửa lỗi cùng loại ngày 2026-10-05.
   - Ví dụ DB test: PI-2026-022 "Sơn LIVE 01" tồn thật 100, giữ cho chính PI 100. Tính theo code thì khả dụng = 0, xuất sơn cho PI này
     sẽ báo "không đủ".
   - Cùng dạng: PI-2026-029, 037, 038.
   - ĐÃ XÁC NHẬN bằng live-test 2026-10-27 (32.9): đúng là lỗi, cả xuất tiêu hao lẫn xuất đóng gói. ĐÃ SỬA ở 32.10.
2. **PI khác lấy được hàng đã mua cho PI này.**
   - Nếu lúc tính đề xuất kho còn ít hàng, PI có dòng giữ loại `CONSUMABLE_MATERIAL_PURCHASE`. Hàng về cộng vào dòng đó.
   - Cả 4 luồng xuất bỏ qua loại này cho MỌI PI (không chỉ PI đang xuất), nên PI khác xuất trước vẫn lấy được.
   - Cùng một lô hàng, cách xử lý khác hẳn nhau tùy lúc tính đề xuất kho còn hàng hay không.

**Hướng đề xuất (chờ người dùng / Sếp duyệt):**
- Chia theo SKU lúc ĐỌC, không thêm bảng:
  - mỗi (PI, vật tư): rải số đã có (còn giữ + đã xuất) cho các SKU theo thứ tự hạn;
  - VT khung theo hạn VT khung (không có thì Khung), VT thành phẩm theo hạn VT thành phẩm / Đóng gói;
  - SKU sớm được đủ định mức trước;
  - hiện "đủ / thiếu" từng SKU ở màn QLSX/KHSX.
- Khi xuất cho SKU hạn sau mà làm SKU hạn sớm hơn thiếu: cảnh báo (đề xuất) hoặc chặn. Chờ Sếp quyết.
- Sắt lệnh gộp: giữ theo cả PI. Nếu cần ưu tiên thì là thứ tự cắt, câu hỏi riêng.
- Sửa 2 phát hiện trên:
  - `material-issues` / `packaging-issues` cộng lại phần giữ của chính PI;
  - chỉ bỏ qua dòng giữ của chính PI, không bỏ của PI khác. Rủi ro: dòng giữ cũ của PI đã huỷ có thể chặn oan, cần rà trước.

**Chưa làm:** phát hiện 1 đã sửa (32.10). Phát hiện 2: commit dbfd2ea (ohey, origin/main, chưa pull) đã sửa, xem 32.11. Phần chia hàng theo SKU chưa làm.

### 32.7 2026-10-27 — Sếp xác nhận bảng nhóm vật tư + tên và vị trí cột mốc (đã làm ở 32.8)

Người dùng gửi 2 ảnh và báo Sếp đã xác nhận "đúng" cả hai:

1. **Bảng nhóm vật tư (bản tóm tắt của 32.5) đúng:**

   | Nhóm | Về từ (sớm nhất) | Hạn chót | Tính từ |
   |---|---|---|---|
   | VT khung cơ khí: sắt, la, tán rút, đá cắt, dây hàn, CO2, sơn bột, hoá chất, dây đan, đinh, nút | N−5 | N−1 | N = ngày bắt đầu phôi |
   | VT thành phẩm: thùng, xốp, nệm, gỗ, phụ kiện, nhãn... | ĐG−11 | ĐG−7 | ĐG = ngày đóng gói |

2. **Tên và vị trí cột trên thẻ SKU đúng** (người dùng hỏi, Sếp trả lời đúng):
   - Cột "Mua hàng" (`materialDeadline`) đổi tên thành **"Mua vật tư khung cơ khí và đan"**. Dây đan thuộc nhóm VT khung nên phải có chữ "đan".
   - Thêm cột **"Mua vật tư còn lại"** (= VT thành phẩm) nằm **giữa Đan và Đóng gói**.
   - Thứ tự mới: Mua VT khung & đan → Khung CK → Đan → Mua VT còn lại → Đóng gói → Hạn giao.

**Ảnh hưởng tới danh sách sửa A–D của 32.5:**
- Tên hiển thị:
  - "VT khung cơ khí" → "Mua VT khung & đan" (bản đầy đủ "Mua vật tư khung cơ khí và đan" ở form và tooltip);
  - "VT thành phẩm" → "Mua VT còn lại" (tooltip liệt kê thùng, xốp, nệm, gỗ, phụ kiện, nhãn).
- Vị trí cột mới: giữa Đan và Đóng gói (32.5 đề xuất ngay sau VT khung). Áp cho cả 3 màn chi tiết, thẻ điện thoại và form "Sửa thời hạn".
- Lưu ý giao diện:
  - ngày ĐG−7 thường SỚM hơn ngày Đan (theo Phú An Đan = ĐG−2), vd thẻ E2E-FULL: Đan 07/10, Mua VT còn lại 03/10, Đóng gói 10/10;
  - cột xếp theo "vật tư đứng trước công đoạn dùng nó", không theo thứ tự ngày, nên đây không phải lỗi.
- Đã rà các chỗ đang ghi tên mốc "Mua hàng" (chỉ đọc):
  - FE `LenhSXPage.tsx`: `DATE_COL_LABELS`, 2 bảng tiêu đề, thẻ điện thoại, form, 2 câu nhắc luật gộp;
  - FE `SystemConfigPage.tsx`: chữ giải thích luật gộp;
  - FE `Guide/content/productionPlan.ts`: 4 câu;
  - FE `steelNeedWindow.ts`: chỉ chú thích;
  - BE thông báo đổi hạn "Mua vật tư: cũ → mới" (`production-invoices.service.ts`);
  - BE chữ giải thích luật gộp "hạn mua hàng" (`update-system-config.dto.ts`).
  - KHÔNG đổi chữ "Mua hàng" là tên bộ phận, module hay bước tiến độ (Guide journey/sales/boss, Admin, màn Mua hàng).

**Trạng thái (cập nhật 2026-10-27):** người dùng duyệt làm A–C, 3 câu theo đề xuất (chỉ hiển thị "về từ"; sửa tay thì "về từ" = hạn − 4;
D để sau). Đã làm, xem 32.8.

### 32.8 2026-10-27 — ĐÃ LÀM A–C: mốc "Mua VT khung & đan" + "Mua VT còn lại" + dòng "về từ" (local, CHƯA commit)

Người dùng duyệt: "Làm A, B, C theo bản đã chỉnh (Mua VT khung & đan, thêm Mua VT còn lại giữa Đan và Đóng gói). 3 câu theo đề xuất:
về từ chỉ hiển thị; sửa tay thì về từ = hạn − 4; D để sau. Sửa ở local, migration chỉ DB test, kiểm trên trình duyệt, không commit."

**BE (D:\DNA-ERP-BE):**
- `prisma/schema.prisma`: `ProductionInvoiceItem.finishedMaterialDeadline DateTime?` ("Mua VT còn lại").
  - Chọn cột riêng, không thêm `ProdItemStageType`, vì đây là hạn vật tư về kho (cùng loại `materialDeadline`), không phải công đoạn.
  - Doc comment `materialDeadline` ghi rõ đó là "Mua VT khung & đan" và cũng là mốc cần sắt.
- Migration `20261027100000_add_finished_material_deadline`: chỉ ADD COLUMN, nullable.
  - ĐÃ áp lên DB test `dna_erp_solver_test` bằng script scratchpad `migrate-main-solver-test.ps1` (chặn nếu không phải localhost/DB test).
  - KHÔNG đụng DB dev `dna_erp`, KHÔNG đụng production.
- DTO:
  - `UpdateProductionInvoiceItemDto` thêm `finishedMaterialDeadline?`; `ItemDeadlinesInputDto` kế thừa nên "Sửa thời hạn" cả PI cũng nhận.
  - `ProductionInvoiceItemResponseDto` trả thêm field; `toItemResponseDto` map.
- `applyItemDeadlines` ghi cột mới (chỉ khi có gửi, như `materialDeadline`).
- Thông báo đổi hạn (`auditAndNotifyDeadlineChange`):
  - "Mua vật tư: cũ → mới" đổi thành "Mua VT khung & đan: cũ → mới" (vẫn báo Mua hàng);
  - thêm "Mua VT còn lại: cũ → mới", báo Mua hàng + thủ kho `vat-tu-tp` và `thanh-pham`; audit ghi `finishedMaterialDeadline`.
- Chữ giải thích luật gộp trong `update-system-config.dto.ts`: "hạn mua hàng" → "hạn Mua VT khung & đan".
- KHÔNG đổi:
  - luật gộp, mốc cần sắt (vẫn `materialDeadline` → Khung);
  - hạn sắt đề xuất mua, xếp hạng giữ chỗ;
  - cột mới CHƯA nối vào đề xuất mua / giữ chỗ (việc D).

**FE (D:\DNA-ERP):**
- `utils/phuAnTimeline.ts`:
  - `finishedMaterialDate` = Đóng gói − 7, `FINISHED_MATERIAL_OFFSET_LABEL` "ĐG−7";
  - `materialArrivalFrom` = hạn − 4;
  - `MATERIAL_MILESTONES`: tên ngắn/đầy đủ + chú thích danh sách vật tư của 2 mốc.
  - Test thêm: PI-2026-035 (N = T5 24/09, ĐG = T5 08/10 → VT khung 19/09 → 23/09, VT còn lại 27/09 → 01/10), theo ĐG đã lưu, qua năm, null.
- `services/production-invoices-api.ts`: đọc/gửi `finishedMaterialDeadline`.
- `LenhSXPage.tsx`:
  - nhãn cột "Mua hàng" → "Mua VT khung & đan"; thêm cột "Mua VT còn lại" GIỮA Đan và Đóng gói ở cả 3 màn (QLSX/Sếp, KHSX, hộp "Gửi QLSX");
  - rê chuột lên tiêu đề hiện danh sách vật tư;
  - chưa lưu thì hiện đề xuất ĐG−7 (ĐG = Đóng gói đã lưu hoặc đề xuất); dòng nhỏ "từ dd/mm" dưới 2 ô hạn vật tư;
  - điện thoại: dải ngày 2 hàng × 3 (VT khung & đan, Khung, Đan / VT còn lại, Đóng gói, Hạn giao).
- Form "Sửa thời hạn":
  - cùng thứ tự với thẻ: Mua vật tư khung cơ khí và đan → Khung (nút Phôi/Hàn/Sơn) → Đan → Mua vật tư còn lại → Đóng gói;
  - 2 lưới 3 cột (điện thoại 2 cột), ô Phôi/Hàn/Sơn mở ngay dưới hàng có Khung. Bỏ cách chia "Vật tư về / Sản xuất" đề xuất ở 32.5.
  - Ô Mua VT còn lại còn là đề xuất thì tự tính lại khi đổi Khung / hạn giao / Đóng gói. Có nút "đề xuất dd/mm" và dòng "về từ <thứ · ngày>".
  - Ô đề xuất chưa đụng tới không gửi lên (giữ quy ước cũ).
- Chữ: câu nhắc luật gộp, `SystemConfigPage` (giải thích luật gộp), `Guide/content/productionPlan.ts` (4 câu + 1 câu mới về 2 mốc vật tư và
  việc cột VT còn lại thường sớm hơn Đan), chú thích `steelNeedWindow.ts`.
  - Chữ "Mua hàng" là tên bộ phận/module/bước tiến độ GIỮ nguyên.

**Kiểm tra:**
- BE:
  - `jest src/modules/production-invoices src/common/utils/merge-rules`: 236/236 pass, có 2 test mới (lưu + báo đúng người cho mốc mới; chỉ gửi mốc mới không đụng mốc khác).
  - Jest toàn bộ: 2071 pass, 2 fail ở `solver-ts/optimize-material.spec.ts` (chạy cùng lúc `nest build`, 241 s). Chạy lại riêng file đó: 14/14 pass.
  - `nest build` OK.
- FE: `tsc --noEmit` OK; eslint 0 lỗi (chỉ warning `any` cũ); vitest 262/262 pass.
- Trình duyệt: BE 3002 + FE 3100 trên DB test, tài khoản KHSX + QLSX mẫu.
  - PI-2026-035: bảng hiện 02/10 · từ 28/09 | 26/09 | 07/10 | 03/10 · từ 29/09 (đề xuất) | 10/10 | 12/10.
  - Form: bấm "đề xuất 08/10" ở Đóng gói thì VT còn lại tự đổi 01/10 · ĐG−7 · về từ CN 27/09; bấm "đề xuất 23/09" thì về từ T7 19/09 (khớp ví dụ của Sếp).
  - Lưu thật 1 lần chỉ ô VT còn lại = 01/10:
    - PATCH items-deadlines 200; DB có giá trị;
    - thông báo "Mua VT còn lại: (chưa có) → 1/10/2026" tới muapsh, muatp, muavttp, khovttp, khotp;
    - sau đó đặt lại cột về NULL trên DB test (thông báo + audit của lần thử vẫn còn).
  - PI-2026-016 (gộp 2 SKU): mỗi SKU có VT còn lại riêng (25/11, 30/11).
  - QLSX PI-2026-019: 6 cột, ngày đúng theo hạn giao − 17.
  - Hộp "Gửi QLSX" chỉ mở xem, không gửi.
  - Lỗi giao diện tìm thấy và đã sửa: nhãn "MUA VT KHUNG & ĐAN" xuống 2 dòng làm ngày lệch hàng ở thẻ điện thoại và hộp "Gửi QLSX". Đã chừa
    sẵn 2 dòng cho mọi nhãn, kiểm lại thì thẳng hàng.

**Lưu ý khi chạy tiếp / deploy:**
- Prisma client trong `D:\DNA-ERP-BE` đã generate có cột mới. DB dev `dna_erp` CHƯA có cột: `start-dev.bat` chạy `prisma migrate deploy` trước nên
  sẽ tự áp khi người dùng mở lại; chạy BE dev bằng cách khác thì phải migrate trước.
- Production cần migration này khi deploy (chưa làm, chờ người dùng nói "deploy").

**Chưa làm:**
- D: gắn hạn cho dòng đề xuất mua tự tính theo PI.
- Review 32.6 (chia hàng về theo SKU, 2 lỗi giữ chỗ) vẫn chờ.
- Không commit.

### 32.9 2026-10-27 — Live-test XÁC NHẬN: xuất tiêu hao / đóng gói bị chặn bởi giữ chỗ của CHÍNH PI (đã sửa ở 32.10)

Người dùng: "Chạy thử trên DB test để xác nhận lỗi xuất tiêu hao/đóng gói bị chặn nhầm cho chính PI đã mua hàng (PI-2026-022). Chỉ kiểm,
báo kết quả, chưa sửa code, không commit."

**Cách làm (không đụng DB test gốc):**
- Đọc `MaterialIssuesService.create()` và `PackagingIssuesService.create()`: cùng một cách tính tồn khả dụng.
  - `getAvailableQty()` chỉ loại 2 loại giữ chỗ `CONSUMABLE_MATERIAL_PURCHASE`, `PIECE_MATERIAL_YIELD_PURCHASE`.
  - Loại `PRODUCTION_INVOICE` (do `creditPool` tạo khi hàng về mà PI chưa có dòng giữ) bị trừ hết, KỂ CẢ của chính PI đang xuất.
  - Không cộng lại phần của chính PI. `WeavingIssuesService` và `MaterialYieldIssuesService` đã sửa lỗi cùng loại ngày 2026-10-05.
- PI-2026-022 không gọi thẳng được trên DB test:
  - lệnh SX 24 đã `floorStage = FINISHED`, cổng "xưởng đang chạy" chặn trước, chưa tới bước kiểm tồn;
  - DB test không có phụ kiện đóng gói nào (`bom_accessory_items` rỗng).
- Nên tạo BẢN SAO `dna_erp_solver_test_pi022` (`CREATE DATABASE ... TEMPLATE dna_erp_solver_test`) và chỉ dựng tạm trên bản sao
  (script scratchpad `pi022_copy_fixture.sql`):
  - mở lại lệnh SX 24 (PI-2026-022) thành ACTIVE;
  - gắn VTK-018 làm phụ kiện PACKAGING cho định mức 31 của PI-2026-037 (lệnh SX 37, đang ACTIVE thật). Phải tắt trigger
    `assert_bom_revision_draft` trong đúng phiên đó vì định mức ACTIVE;
  - ghi Chuyền kiểm 50/50 cho mảnh 96 để qua cổng Chuyền kiểm.
  - Giữ chỗ và tồn là dữ liệu CÓ SẴN, không dựng.
- BE `dist` (checkout chính) chạy cổng 3003 trỏ vào bản sao (launch `be-3003-copy-pi022`). Gọi API thật bằng thủ kho `khopsh`
  (phoi-son-han), script `pi022_live_test.sh`.

**Kết quả:**

| # | Thao tác | Tồn thật | Giữ chỗ bị trừ | Kết quả |
|---|---|---|---|---|
| 1 | PI-2026-022 xuất tiêu hao Sơn LIVE 01 (VTK-009) công đoạn SON 10 / định mức 100 | 100 | 100, đều là `PRODUCTION_INVOICE` của chính PI-2026-022 | **409** "Tồn kho khả dụng (0) không đủ xuất 10" |
| 2 | PI-2026-037 xuất tiêu hao Sơn E2E (VTK-018) SON 10 | 100 | 100, của chính PI-2026-037 | **409** cùng câu |
| 3 | PI-2026-037 xuất ĐÓNG GÓI VTK-018 10 (phụ kiện dựng tạm) | 100 | 100, của chính PI-2026-037 | **409** cùng câu |
| 4 | Đối chứng: nhả giữ chỗ của PI-2026-022 (RELEASED, chỉ trên bản sao) rồi xuất lại đúng lệnh 1 | 100 | 0 | **201**, tồn 100 → 90, 1 phiếu xuất 10 |

- Kết luận: lỗi THẬT. Kho không xuất được vật tư tiêu hao/đóng gói cho chính PI đã mua hàng đó, dù tồn thật đủ và chưa PI nào khác giữ.
- Cùng dạng trên DB test: PI-2026-022, 029, 037, 038 (mỗi PI 1 dòng `PRODUCTION_INVOICE` giữ đúng bằng tồn).
- Production: chưa kiểm.

**Hướng sửa (đã duyệt và ĐÃ LÀM ở 32.10):**
- `material-issues` và `packaging-issues` làm giống `WeavingIssuesService.create()`:
  - cộng lại phần `PRODUCTION_INVOICE` còn giữ của chính PI (`refId` = PI id);
  - `available = min(onHand, availableOutsideOwnPi + ownPiRemaining)`;
  - `drainPoolBestEffort` phía sau vẫn rút giữ chỗ của PI như cũ.
- Thêm test cho cả 2 service (giữ chỗ của chính PI bằng đúng tồn thật thì vẫn xuất được; giữ của PI khác thì vẫn chặn).

**Dọn dẹp:**
- DB test gốc KHÔNG đổi gì.
- Bản sao `dna_erp_solver_test_pi022` (có dữ liệu tạm + 1 phiếu xuất thử) vẫn còn; xoá khi người dùng đồng ý (32.10 dùng bản sao mới).
- BE 3003 đã tắt.

**Chưa làm:**
- Sửa code.
- Live-test phát hiện 2 của 32.6 (PI khác lấy được hàng mua cho PI này).
- Không commit.

### 32.10 2026-10-27 — (ĐÃ BỎ 2026-10-28, thay bằng commit dbfd2ea - xem 32.11, 32.12) Sửa local: xuất tiêu hao / đóng gói cộng lại giữ chỗ của CHÍNH PI

Người dùng: "Sửa lỗi xuất tiêu hao và xuất đóng gói theo cách luồng Đan: cộng lại phần giữ hàng của chính PI đang xuất, PI khác vẫn chặn.
Thêm test cho hai luồng, chạy jest và nest build, chạy lại 3 lần xuất trên bản sao DB test để xác nhận. Sửa ở local, không commit."

**Đã sửa (D:\DNA-ERP-BE):**
- `MaterialIssuesService.create()` và `PackagingIssuesService.create()`, làm y như `MaterialYieldIssuesService`/`WeavingIssuesService` (2026-10-05):
  - `availableOutsideOwnPi` = `getAvailableQty()` như cũ (vẫn trừ giữ chỗ của MỌI PI khác + chuyển kho);
  - đọc dòng `StockReservation` ACTIVE loại `PRODUCTION_INVOICE` của CHÍNH PI (`refId` = PI id), cùng kho, cùng vật tư;
  - cộng phần còn giữ: `available = min(onHand, availableOutsideOwnPi + ownPiRemaining)`.
- `productionInvoiceItem` giờ tra 1 lần ở bước kiểm tồn và dùng lại cho `drainPoolBestEffort` (trước tra ở cuối). Rút giữ chỗ sau khi xuất giữ như cũ.
- Không đổi: câu báo lỗi, `getAvailableQty()`, luồng Đan/VTTP/sắt, cách tạo giữ chỗ khi hàng về.

**Test thêm** (`material-issues.service.spec.ts`, `packaging-issues.service.spec.ts`, mỗi file 2 test):
- giữ chỗ `PRODUCTION_INVOICE` của chính PI bằng đúng tồn thật thì vẫn xuất được, kiểm cả điều kiện truy vấn (kho, vật tư, ACTIVE,
  PRODUCTION_INVOICE, refId);
- PI khác đang giữ thì vẫn chặn với đúng câu "Tồn kho khả dụng (10) không đủ xuất 20".

**Kiểm tra:**
- `jest` 5 module (material-issues, packaging-issues, weaving-issues, material-yield-issues, stock): 245/245 pass.
- `nest build` OK.
- Jest toàn bộ (chạy SAU nest build, không chạy song song): 2076 pass, 1 fail ở `solver-ts/optimize-material.spec.ts` (bộ giải cắt sắt, không liên quan; chạy cùng lúc BE 3003 khởi động). Chạy lại riêng file đó lúc máy rảnh: 14/14 pass. Cùng file này đã fail khi máy bận ở 32.8.
- Live-test trên BẢN SAO SẠCH mới `dna_erp_solver_test_pi022_fix`:
  - tạo bằng `CREATE DATABASE ... TEMPLATE dna_erp_solver_test`;
  - cùng dữ liệu tạm như 32.9, thêm VTK-009 vào định mức SON của PI-2026-037 cho ca "PI khác";
  - BE `dist` mới build, cổng 3003, thủ kho `khopsh`; script `pi022_live_test_after_fix.sh`.

| # | Thao tác | Trước khi sửa (32.9) | Sau khi sửa |
|---|---|---|---|
| 1 | PI-2026-022 xuất tiêu hao Sơn LIVE 01 (VTK-009) 10 | 409 "tồn khả dụng 0" | **201**. Tồn 100 → 90, giữ chỗ PI-2026-022 rút 10/100 |
| 2 | PI-2026-037 xuất tiêu hao Sơn E2E (VTK-018) 10 | 409 | **201**. Tồn 100 → 90, giữ chỗ PI-2026-037 rút 10/100 |
| 3 | PI-2026-037 xuất đóng gói VTK-018 10 | 409 | **201**. Tồn 90 → 80, giữ chỗ PI-2026-037 rút 20/100 |
| 4 | PI KHÁC: PI-2026-037 xuất VTK-009 10 (tồn 90, PI-2026-022 còn giữ 90) | — | **409** "Tồn kho khả dụng (0) không đủ xuất 10" (vẫn chặn đúng) |

- DB test gốc `dna_erp_solver_test`: kiểm lại không đổi (giữ chỗ 20 vẫn ACTIVE 0 đã rút, lệnh SX 24 FINISHED, 0 phụ kiện đóng gói).

**Còn lại:**
- 2 bản sao `dna_erp_solver_test_pi022` và `dna_erp_solver_test_pi022_fix` vẫn còn trong Postgres local; xoá khi người dùng đồng ý.
- Launch `be-3003-copy-pi022` hiện trỏ bản `_fix`.
- Phát hiện 2 của 32.6 (giữ chỗ loại `CONSUMABLE_MATERIAL_PURCHASE` bị mọi luồng bỏ qua cho MỌI PI nên PI khác lấy được) chưa live-test,
  chưa sửa. Phần chia hàng theo SKU chưa làm.
- Chưa deploy; production chưa kiểm có PI nào đang bị chặn kiểu này.
- Không commit.

### 32.11 2026-10-27 — Review commit `dbfd2ea` "fix-stockReservation" (ohey, origin/main, CHƯA pull về local)

Người dùng: "review commit mới nhất". Commit nằm trên `origin/main`, cha là `4cf4078` (main local). Chỉ review + chạy
thử, không sửa code, không pull, không commit.

**Commit làm gì:**
- `StockReservationsService.getAvailableQty()`: bỏ tham số `excludeRefTypes` (lọc theo LOẠI giữ chỗ), thay bằng
  `ownProductionInvoiceId` (lọc theo PI). Khi truyền PI đang xuất thì chỉ trừ giữ chỗ của PI KHÁC hoặc không neo PI nào
  (`OR [productionInvoiceId null, productionInvoiceId <> PI]`). Không truyền thì trừ mọi giữ chỗ như cũ.
- 4 luồng xuất truyền PI đang xuất: tiêu hao, đóng gói, vật tư thành phẩm, mang kèm khi đan. Hai luồng sau bỏ đoạn
  cộng-lại `ownPiRemaining` của 2026-10-05.
- Các luồng tính đề xuất mua, duyệt phương án cắt, chuyển kho, màn tồn kho không đổi (không truyền PI).
- Spec đơn vị viết lại theo hành vi mới. Test tích hợp mới `test/integration/reservation-own-pi.integration.spec.ts`
  (Postgres test cổng 5433), có 1 ca `it.failing` cho lỗi mua thừa khi tính lại sau khi đã xuất (biết, chưa sửa).
- Changelog HTML `docs/changelog-2026-10-27-fix-giu-cho-ton-kho-theo-pi.html`.

**Đánh giá đúng/sai:**
- Đúng hướng và tốt hơn bản sửa local 32.10: sửa cả lỗi 1 (chính PI bị chặn) lẫn lỗi 2 của 32.6 (PI khác lấy được hàng
  mua cho PI này, vì `CONSUMABLE_MATERIAL_PURCHASE`/`PIECE_MATERIAL_YIELD_PURCHASE` bị bỏ qua cho MỌI PI), gom về 1 chỗ.
- Đã kiểm: mọi chỗ ghi giữ chỗ cho vật tư (tiêu hao, mảnh, công thức VTTP, creditPool) đều set `productionInvoiceId`,
  nên lọc theo PI phủ đủ. Chỉ 4 luồng xuất từng truyền tham số thứ 6, cả 4 đã đổi. `productionInvoiceId` null thì
  rơi về "trừ mọi giữ chỗ", không lỗi.

**Phát hiện:**
1. (Trung bình, chưa có trên DB test) Giữ chỗ còn dư của PI đã xong/huỷ không bao giờ được nhả, giờ chặn PI khác. **ohey đã sửa ở commit `689a93f` (review 32.15).**
   - Không có chỗ nào đánh RELEASED giữ chỗ vật tư khi PI xong/huỷ (`releaseByRef` chỉ gọi từ phương án cắt sắt;
     `releaseForInvoice` chỉ đụng CuttingProposal). Dòng giữ chỉ giảm qua `consumedQty` khi xuất.
   - Dư là bình thường: `receiveItem()` cộng vào giữ chỗ ĐÚNG số nhận (`incrementQty`), gồm cả % hao hụt khi mua
     (`purchaseWastePercentage`) và nhận vượt (không chặn, có chủ đích với bao bì/bì zip); xưởng cũng có thể xuất ít
     hơn định mức.
   - Trước commit: dư loại `CONSUMABLE_MATERIAL_PURCHASE`/`PIECE_MATERIAL_YIELD_PURCHASE` bị 4 luồng xuất bỏ qua nên
     không chặn ai (dư loại `PRODUCTION_INVOICE` thì vốn đã chặn). Sau commit: mọi dư của PI khác đều trừ vào khả dụng,
     cộng dồn theo thời gian -> PI mới gặp lại đúng triệu chứng "Tồn kho khả dụng thấp hơn tồn thật", nặng nhất ở
     bao bì.
   - DB test hiện chưa có ca này (dư còn giữ chỉ thuộc PI đang PRODUCING: 4 dòng sắt, 9 dòng PRODUCTION_INVOICE).
   - Hướng sửa gợi ý: khi PI sang DONE/CANCELLED thì nhả (RELEASED) giữ chỗ ACTIVE của PI; hoặc `getAvailableQty()`
     bỏ qua giữ chỗ của PI đã DONE/CANCELLED.
2. (Ghi nhận, commit đã tự nêu) Màn tồn kho vẫn trừ cả giữ chỗ của chính PI; luồng xuất VTTP theo công thức không kiểm
   giữ chỗ; lỗi mua thừa khi tính lại sau khi đã xuất (`it.failing`).
3. (Đụng sửa local) Commit sửa đúng 4 file mà bản local 32.10 cũng sửa: `material-issues.service(.spec).ts`,
   `packaging-issues.service(.spec).ts`. Pull về sẽ bị git từ chối/xung đột. Bản local 32.10 nên bỏ, lấy bản commit
   (test local của 32.10 mock `stockReservation.findMany` sẽ sai với cách mới). Các thay đổi local khác (mốc Mua VT
   32.8: production-invoices, schema, migration, system-config) không đụng file nào của commit.

**Kiểm tra (trên bản xuất riêng của commit trong scratchpad, không đụng working tree):**
- `prisma generate` + `nest build`: OK.
- Jest đơn vị 12 suite (stock, 4 luồng xuất, mua tiêu hao, mua mảnh, đề xuất mua): 374/374 pass.
- Test tích hợp `reservation-own-pi` trên Postgres test 5433: 4/4 pass (gồm ca `it.failing`); ca R1 in "giữ còn 100,
  buyQty 0".
- Live-test lại 4 lần xuất của 32.9/32.10 với BE build từ commit (cổng 3003) trên bản sao sạch mới
  `dna_erp_solver_test_pi022_review` (cùng fixture `pi022_copy_fixture.sql`):

| # | Thao tác | Trước khi sửa (32.9) | Commit dbfd2ea |
|---|---|---|---|
| 1 | PI-2026-022 xuất tiêu hao VTK-009 10 | 409 | **201**. Tồn 100 → 90, giữ chỗ rút 10 |
| 2 | PI-2026-037 xuất tiêu hao VTK-018 10 | 409 | **201**. Tồn 100 → 90 |
| 3 | PI-2026-037 xuất đóng gói VTK-018 10 | 409 | **201**. Tồn 90 → 80, rút tổng 20 |
| 4 | PI KHÁC: PI-2026-037 xuất VTK-009 (PI-022 còn giữ 90) | — | **409** "Tồn kho khả dụng (0)", chặn đúng |

- Kết quả trùng bản sửa local 32.10. DB test gốc kiểm lại không đổi.

**Còn lại:**
- ĐÃ pull commit về local và bỏ bản sửa local 32.10 (32.12).
- Phát hiện 1 chưa báo người viết commit, chưa sửa.
- Bản sao DB tạm giờ có 3: `dna_erp_solver_test_pi022`, `_pi022_fix`, `_pi022_review`; xoá khi người dùng đồng ý.
- Launch `be-3003-review-dbfd2ea` + thư mục xuất `review-dbfd2ea` (có junction `node_modules`) nằm trong scratchpad.

### 32.12 2026-10-28 — Bỏ bản sửa local 32.10, pull commit `dbfd2ea` về main (CHƯA commit gì thêm)

Người dùng (nút sau review 32.11): "Bỏ local, pull" - bỏ thay đổi local của 4 file xuất kho, giữ nguyên các thay đổi
local khác, pull `dbfd2ea` từ `origin/main`, không commit.

**Đã làm:**
- Sao lưu bản local 32.10 trước khi bỏ: 4 file + `local-32-10.patch` ở scratchpad phiên, thư mục `backup-local-32-10`.
- `git checkout --` đúng 4 file: `material-issues.service.ts`, `material-issues.service.spec.ts`,
  `packaging-issues.service.ts`, `packaging-issues.service.spec.ts`.
- `git fetch` (origin/main vẫn là `dbfd2ea`, chỉ hơn main 1 commit) rồi `git merge --ff-only dbfd2ea`: fast-forward
  `4cf4078..dbfd2ea`, không xung đột.
- Giữ nguyên thay đổi local khác: mốc Mua VT 32.8 (`schema.prisma`, migration `20261027100000_add_finished_material_deadline`,
  production-invoices dto/service/spec, system-config dto) và các file docs.

**Kiểm tra trên main sau khi pull (code commit + thay đổi local còn lại):**
- `nest build`: OK.
- Jest các module stock, material-issues, packaging-issues, weaving-issues, material-yield-issues, production-invoices,
  purchase-proposals, system-config: 17/17 suite, 577/577 test pass.

**Còn lại:**
- Phát hiện 1 của 32.11 (giữ chỗ dư của PI đã xong/huỷ không được nhả, giờ chặn PI khác) chưa sửa.
- 3 bản sao DB tạm vẫn còn; xoá khi người dùng đồng ý.
- Không commit, không push, không deploy.

### 32.13 2026-10-28 — dbfd2ea không đụng phần code của người dùng; đã STAGE phần cần commit (BE + FE), KHÔNG commit

Người dùng: "không cần sửa, để đó bạn tôi sửa, review nhánh fix stock đó còn đụng gì tới code phần tôi không nếu không
hãy đưa những gì cần commit xuống staged không tự commit, tôi sẽ tự commit".

- Phát hiện 1 của 32.11 (nhả giữ chỗ dư khi PI xong/huỷ): người dùng để bạn (người viết dbfd2ea) sửa, phiên này KHÔNG sửa.

**Rà "nhánh fix stock":**
- `git fetch --prune`: không có nhánh fix stock riêng, chỉ có commit `dbfd2ea` trên `origin/main`, đã pull về ở 32.12;
  `main` = `origin/main` = `dbfd2ea`.
- File của commit giao với file local đang đổi/chưa track: KHÔNG có file nào.
- Commit không nhắc tới `finishedMaterialDeadline`, `materialDeadline`, `applyItemDeadlines`,
  `auditAndNotifyDeadlineChange`, system-config.
- Không đổi API trả về FE (màn tồn kho vẫn gọi `getAvailableQty()` không truyền PI) nên FE không bị ảnh hưởng.
- Test tích hợp mới chạy `prisma migrate deploy` trên Postgres test 5433, sẽ áp cả migration mới của người dùng (cột
  nullable), không xung đột.

**Đã stage (chưa commit):**
- BE `D:\DNA-ERP-BE` (`main`), 12 file:
  - code: `prisma/schema.prisma`, migration `20261027100000_add_finished_material_deadline`,
    production-invoices (2 dto, service, spec), `system-config/dto/update-system-config.dto.ts`;
  - docs: changelog `2026-09-25` (mục 32.x), `2026-10-06`, `2026-10-20`, `2026-10-21` (cập nhật trạng thái đã
    commit/push 26/10), `docs/nghien-cuu-timeline-chuan-erp-2026-10-26.html` (tài liệu nghiên cứu mục 32 dẫn tới).
- FE `D:\DNA-ERP` (`demo`, khớp `origin/demo`), 8 file: `LenhSXPage.tsx`, `production-invoices-api.ts`,
  `SystemConfigPage.tsx`, `Guide/content/productionPlan.ts`, `steelNeedWindow.ts`, `phuAnTimeline.ts` +
  `phuAnTimeline.test.ts` (mới), changelog `2026-10-23` (cập nhật trạng thái).

**CỐ Ý không stage (không thuộc việc này hoặc là đồ local):**
- BE: `.claude/`, `CLAUDE.md`, `start-dev.bat`, `test/solver-real-data-new/`, 15 file docs pdf/xlsx báo cáo solver và
  3 changelog md (HR, tool nhập công) (code HR đã xoá) - đều đã nằm ngoài các commit trước.
- FE:
  - `.env.example` bị XOÁ ở local, không rõ nguồn - không stage việc xoá;
  - `next-env.d.ts` do `next dev` với `.next-e2e` (máy chủ FE kiểm thử) tự sửa - không nên commit;
  - `e2e/golden-path.spec.ts` (MEIJING → Meiying) và `docs/quy-doi-doan-phoi.md` không thuộc việc mốc Mua VT;
  - các file untracked khác (`.claude/`, `AGENTS.md`, `CLAUDE.md`, docs, e2e mới, `pnpm-*`, `tsconfig.tsbuildinfo`,
    `playwright.nows.config.ts`).

**Kiểm tra:**
- BE (trên main sau pull, 32.12): `nest build` OK; jest 17 suite liên quan 577/577 pass.
- FE: `tsc --noEmit` OK; vitest `phuAnTimeline` 12/12 pass; eslint 3 file chính 0 lỗi (96 cảnh báo có sẵn).

**Còn lại:**
- Người dùng tự commit + push.
- Khi lên production, migration `finishedMaterialDeadline` phải chạy (cột nullable, không đụng dữ liệu cũ).
- 3 bản sao DB tạm vẫn còn; xoá khi người dùng đồng ý.

### 32.14 2026-10-28 — Review tài liệu "Kế hoạch thực hiện 12 yêu cầu mới" (ngày 26/10) — CHỈ RÀ, không sửa code

Người dùng dán toàn văn tài liệu (12 mục, thứ tự làm, câu hỏi cần chốt) và bảo "review file docs này". Đối chiếu với
schema/code BE+FE hiện tại, DB test (chỉ đọc), các quyết định Sếp 27/10 (32.5, 32.7) và review 32.6, 32.11.

Ghi chú trạng thái: người dùng đã tự commit phần stage ở 32.13 thành `ab847fa` trên `main` BE.

**Sai so với code (nên sửa trong tài liệu):**
1. Mục 11 + Mục 8 ghi "hàng về đã ưu tiên chia cho SKU hạn gần nhất trong cùng cụm gộp" — KHÔNG đúng với lệnh gộp.
   - Ưu tiên theo hạn (`loadPool`) chỉ có tác dụng khi SKU duyệt cắt RIÊNG (mỗi SKU 1 dòng giữ sắt).
   - Lệnh gộp chỉ có 1 dòng giữ cho cả PI, mọi vật tư; DB test 15 PI 2 SKU đều 1 dòng/PI/vật tư (32.6).
   - Hệ quả: Mục 11 lớn hơn tài liệu nói (phải làm chia theo SKU, hướng "chia lúc đọc" ở 32.6).
2. Mục 7 bỏ sót tính năng có sẵn: KHSX đã gộp được nhiều SKU (kể cả khác đơn hàng) thành 1 lệnh để cắt chung, 1 đề xuất
   mua chung; Admin đã có cấu hình `solverMergeWindowDays` / `solverMergeMaxSkus` (mặc định 2 SKU, ≤ 3 ngày).
   - "Quy tắc gộp chưa chốt, đề xuất để cấu hình" — với sắt đã có cấu hình; nhật ký nói 3 lệnh, ERP mặc định 2.
   - Cần nói rõ phần MỚI của Mục 7: gộp MUA giữa các lệnh không cắt chung, nhất là vật tư tiêu hao (khí hàn, đinh…).

**Lỗi thời so với quyết định / việc đã làm 27/10:**
3. Mục 10: vật tư còn lại = ĐG−7, được về từ ĐG−11 (Sếp chốt 27/10), không còn "N+8". Đã làm (commit `ab847fa`, chưa
   lên production): tách 2 mốc "Mua VT khung & đan" / "Mua VT còn lại", hệ thống đề xuất mốc theo Phú An (N = Khung − 2,
   chưa có thì hạn giao SKU − 17), dòng "về từ" = hạn − 4. Còn lại của Mục 10: cảnh báo trễ / sớm / chưa bắt đầu, số
   ngày theo container (Mục 9), nối hạn VT còn lại vào đề xuất mua.
   - Tên mốc (1) trong tài liệu "vật tư Phôi, Sơn, Hàn" nên đổi theo tên Sếp chốt "Mua vật tư khung cơ khí và đan".
4. Mục 6: kế hoạch đã có đủ 2 hạn vật tư nên Mục 6 không còn phải chờ Mục 10.

**Thứ tự / tham chiếu mâu thuẫn:**
5. Mục 6: phần 2 ghi "sau Mục 10", phần chi tiết ghi "sau Mục 2".
6. Mục 5 ghi "hạn của kế hoạch sản xuất (Mục 2 và Mục 6) nên suy ra từ booking" — Mục 6 không phải hạn kế hoạch; đúng ra Mục 10.
7. Mục 9 xếp "Cao, nền cho Mục 10": luật Phú An tính theo ngày lịch cố định (1 lệnh ≈ 1 container/ngày), số container chỉ
   cần khi lệnh > 1 container. Phần cảnh báo của Mục 10 không phải chờ Mục 9.

**Thiếu rủi ro / thông tin:**
8. Mục 7, 8: thiếu rủi ro giữ chỗ theo PI (commit `dbfd2ea`) và giữ dư không được nhả (32.11): gộp mua nhiều PI phải
   chia giữ chỗ đúng từng PI; câu "hàng về thừa xử lý thế nào" — hiện tại phần thừa (gồm % hao hụt, nhận vượt) cộng hết vào
   giữ chỗ của PI và không bao giờ nhả.
9. Mục 4: đề xuất mua đã có ô phiếu duyệt Sếp ký (`PurchaseProposalItem.approvalFileUrl`) — "phiếu đề xuất" lúc nhập kho
   có thể dùng lại, không bắt tải lại. Câu "xuất kho áp dụng loại nào" nên liệt kê đủ: sắt, tiêu hao, đan, đóng gói, VTTP,
   VTTP theo công thức, chuyển kho, giao hàng (shipItem). Hiện không bảng xuất nào có cột file.
10. Phần 4 "Việc cần chốt" trùng một phần với 15 câu Q1–Q15 của tài liệu họp 26/10 (`docs/nghien-cuu-timeline-chuan-erp-2026-10-26.html`)
    — nên gộp để không hỏi Sếp 2 lần; thiếu câu của Mục 12 và Mục 1.
11. (Nhỏ) Mục 6: bảng báo giá NCC có sẵn cột `PurchaseProposalQuote.expectedDate` nhưng chưa có API/màn nào ghi — nếu chọn
    cách "nhân viên mua nhập ngày NCC hẹn" thì có chỗ tái dùng.

**Đã kiểm, khớp code:** Mục 9 (không có cột kích thước/thể tích), Mục 12 (chưa có danh mục xưởng; PI item lưu
`warehouseCode/Name`; chỉ 1 kho thành phẩm), Mục 5 (`SalesOrderItem.shippedQty`, chưa có booking/container), Mục 1 (DTO
tạo dòng PI tay chưa có dây/nệm; chưa thấy chặn SKU chưa duyệt định mức), Mục 2 (sửa hạn từng dòng có lịch sử + thông báo).

**Còn lại:** tài liệu gốc không có trong repo; chưa sửa tài liệu, chờ người dùng.

### 32.15 2026-10-28 — Review commit `689a93f` "fix-stockReservation-v2" (ohey, origin/main; đã pull ở 32.16)

Người dùng: "review commit BE mới nhất". `origin/main` = `689a93f`, hơn `main` local (`ab847fa`) đúng 1 commit. Chỉ review +
chạy thử, không sửa code, không pull, không commit.

**Commit làm gì** (sửa phát hiện 1 của 32.11):
- `StockReservationsService.releaseByProductionInvoice(tx, piId)`: đánh RELEASED mọi dòng giữ chỗ ACTIVE còn dư
  (`quantity > consumedQty`) của PI, mọi refType; dòng đã tiêu hết giữ ACTIVE. Idempotent.
- `ProductionOrdersService.finishFloor()` gọi `releaseReservationsIfPiFinished()` sau khi ghi FINISHED: đếm lệnh của PI chưa
  FINISHED, = 0 thì nhả. Best-effort (lỗi chỉ log), ngoài transaction. `ProductionOrdersModule` import `StockModule`.
- Thêm test đơn vị + 2 test tích hợp (dư loại CONSUMABLE và PRODUCTION_INVOICE, gọi `finishFloor` thật); changelog HTML mục 7.

**Kiểm tra** (bản xuất riêng của commit trong scratchpad `review-689a93f`, không đụng working tree):
- `prisma generate` + `nest build`: OK. BE khởi động được (không lỗi phụ thuộc module).
- Jest đơn vị 12 suite (production-orders, stock, 4 luồng xuất, steel-issues, purchase-proposals): 486/486 pass.
- Tích hợp `reservation-own-pi` (Postgres test 5433): 6/6 pass.
- Live-test BE của commit (cổng 3003) trên bản sao `dna_erp_solver_test_pi022_review`, script `live-test-689a93f.sh`:
  - PI-037 xuất VTK-009 10 khi PI-022 còn giữ 90: 409 (đúng);
  - QLSX bấm Kết thúc lệnh 24 (lệnh duy nhất của PI-022): 201, dòng VTK-009 (100, đã rút 10) -> RELEASED; dòng SAT-009 đã
    tiêu hết 75/75 vẫn ACTIVE (đúng thiết kế);
  - PI-037 xuất lại VTK-009 10: **201**;
  - bấm Kết thúc lần 2: 201, không đổi gì (idempotent).

**Phát hiện:**
1. (Trung bình–cao, ĐÃ TÁI HIỆN) Nhận hàng SAU khi PI đã Kết thúc bị lỗi, thủ kho không ghi được hàng về.
   - Điều kiện: đề xuất mua còn đang nhận dở (PURCHASING, giao nhiều đợt) mà QLSX đã Kết thúc hết lệnh của PI, và dòng giữ
     `PRODUCTION_INVOICE` của (PI, vật tư) đã bị nhả.
   - `creditPool()` chỉ đọc dòng ACTIVE -> pool rỗng -> `create` dòng `PRODUCTION_INVOICE` với `idempotencyKey` TRÙNG dòng
     đã RELEASED -> "Unique constraint failed on idempotencyKey". `receiveItem()` gọi `creditPool` không bọc try nên cả lượt
     nhận hàng hỏng.
   - Tái hiện bằng 1 test thêm vào BẢN XUẤT (không phải repo): giao 60, xuất 50, Kết thúc (nhả dòng 60/50), giao nốt 40 ->
     `creditPool` lỗi đúng câu trên.
   - Ca gần giống: nếu dòng bị nhả là `CONSUMABLE_MATERIAL_PURCHASE` thì lần giao sau tạo dòng `PRODUCTION_INVOICE` MỚI ACTIVE
     cho PI đã xong, không ai nhả nữa -> lại chặn PI khác.
   - Hướng sửa gợi ý: PI đã Kết thúc hết thì `creditPool` bỏ qua (hàng về thành tồn tự do); hoặc pool rỗng mà đã có dòng
     RELEASED cùng khoá thì dùng lại dòng đó thay vì tạo mới.
2. (Trung bình, thấy trên DB test) Không nhả bù cho PI đã Kết thúc TRƯỚC khi lên bản này.
   - Chỉ nhả lúc bấm Kết thúc; FE ẩn mọi nút khi lệnh đã FINISHED ("không hoàn tác được") nên PI cũ không có cách nào kích.
   - DB test: PI-2026-029 và PI-2026-038 đã FINISHED vẫn giữ 170 (SAT-013 10, VTK-010 60, VTK-019 100). Production chưa kiểm.
   - Cần chạy nhả bù 1 lần khi deploy (script hoặc migration dữ liệu) cho các PI mà mọi lệnh đã FINISHED.
3. (Thấp) `reserveOrAdjust()` tìm theo khoá rồi cập nhật số lượng cả khi dòng đã RELEASED, không bật lại ACTIVE -> tính lại đề
   xuất mua sau khi đã nhả (vd `retryProductionOrder`) tưởng đã giữ mà thực ra không. Hiếm.
4. (Thấp) Chỉ đếm lệnh SX đã có: SKU của PI chưa được duyệt (chưa có lệnh) không chặn việc nhả. PI duyệt lệch từng SKU thì có
   thể nhả sớm. Hiếm (lệnh gộp duyệt cùng lúc).
5. (Thấp, tác giả đã ghi) API cho "Bắt đầu" lại lệnh đã Kết thúc, khi đó phần đã nhả không quay lại (xuất sắt bị chặn); FE không
   có nút này nên khó xảy ra.

**Với local:** working tree chỉ đang sửa changelog này; commit không đụng file đó -> pull sẽ fast-forward sạch.

**Còn lại:** đã pull (32.16); phát hiện 1–2 chưa báo/chưa sửa (người dùng để ohey sửa); 3 bản sao DB tạm + thư mục `review-689a93f`
(junction `node_modules`, có test review thêm) trong scratchpad; launch `be-3003-review-689a93f`.

### 32.16 2026-10-28 — Pull commit `689a93f` về main (CHƯA commit gì thêm)

Người dùng (nút sau review 32.15): "Pull về".

- `git fetch`: `origin/main` vẫn là `689a93f`, hơn main đúng 1 commit; không file nào giao với thay đổi local (chỉ có
  changelog này đang sửa).
- `git merge --ff-only 689a93f`: fast-forward `ab847fa..689a93f`, không xung đột. Thay đổi changelog local giữ nguyên.
- Kiểm tra trên main sau pull: `nest build` OK; jest các module production-orders, stock, 4 luồng xuất, steel-issues,
  purchase-proposals, production-invoices: 17/17 suite, 715/715 test pass.

**Còn lại:** phát hiện 1 (nhận hàng sau khi PI Kết thúc bị lỗi trùng khoá) và 2 (nhả bù PI đã Kết thúc trước khi deploy) của
32.15 vẫn chưa sửa, người dùng để ohey sửa. Không commit, không push, không deploy.

### 32.17 2026-10-28 — Review file "Câu hỏi làm rõ nghiệp vụ trước khi lên lại kế hoạch" (part 1) — CHỈ GÓP Ý (Sếp đã trả lời, xem 32.21)

Người dùng gửi `Downloads\cau-hoi-lam-ro-nghiep-vu-part1 (1).docx` (16 câu + mặc định + "các điều đã chốt"), định gửi Sếp,
nhờ xem thử. Đối chiếu với code/DB test (chỉ đọc), quyết định Sếp 27/10 và các review 32.6, 32.11, 32.14, 32.15. Không sửa file.

**Sai / lệch, nên sửa trước khi gửi:**
1. Đầu file ghi "Mục 10 đã làm trong commit 28/10 nên không có" — commit `ab847fa` mới làm 2 mốc vật tư + đề xuất mốc Phú
   An + dòng "về từ", chưa lên production. Còn: cảnh báo trễ/sớm/chưa bắt đầu, số ngày theo container, nối hạn VT còn lại vào
   đề xuất mua. Câu còn treo của Mục 10 (cảnh báo gửi ai, sofa +10 ngày, các SKU cùng lệnh chung N hay riêng, tính từ hạn giao
   hay cut off booking, "ngày cắt sắt" của luật gộp là mốc Mua VT khung hay Phôi) đang bị bỏ ra khỏi file.
2. "Đã chốt: SKU là cả bộ (bàn kèm 6 ghế)" mâu thuẫn Câu 9 và dữ liệu: DB test có `BAN-J55` "Bàn J55" và `GHE-J55` "Ghế J55"
   là 2 sản phẩm riêng (thêm `BAN-8-MEIYING-J55`). Nên chuyển thành câu hỏi, gộp với Câu 9; Câu 4 (thể tích cả bộ) phụ thuộc câu này.
3. "Đã chốt: gộp sắt tối đa 3 lệnh, cùng xưởng, cùng quy cách, hạn giao gần nhau" lệch ERP: cấu hình hiện tại
   `solverMergeMaxSkus` = 2 SKU, `solverMergeWindowDays` = 3 ngày, đo theo mốc cần sắt (Mua VT khung → Khung), không theo hạn
   giao; ERP chưa có "xưởng" (Mục 12). Cần hỏi lại: 2 hay 3, "lệnh" là SKU hay PI, đo theo mốc nào. Chốt số thì Admin tự chỉnh.
4. Câu 14 đề xuất "hàng thừa nhập tồn chung, có cảnh báo như hiện tại": cảnh báo thì có (popup khi nhận vượt, `NhapKhoPage`),
   nhưng hiện phần thừa (gồm % hao hụt mua thêm + nhận vượt) cộng hết vào giữ chỗ của lệnh, chỉ nhả khi lệnh Kết thúc (`689a93f`).
   Chọn "tồn chung" là phải sửa code.

**Nên thêm câu:**
5. Vật tư còn dư khi lệnh Kết thúc trả về tồn chung (ohey vừa làm) - xin Sếp xác nhận; hàng về SAU khi lệnh đã Kết thúc thì vào
   tồn chung? (cần cho lỗi nhận hàng 32.15).
6. Trong lệnh gộp, SKU hạn sau xuất trước làm SKU hạn sớm thiếu: cảnh báo hay chặn (32.6 chờ Sếp).
7. Câu 8, Câu 13 và quy tắc gộp tiêu hao "hạn vật tư cách nhau 4 ngày": nay có 2 hạn vật tư - ghi rõ vật tư khung (sơn, khí,
   dây hàn, dây đan…) theo "Mua VT khung & đan", vật tư thành phẩm (thùng, xốp…) theo "Mua VT còn lại".

**Bổ sung đề xuất:**
8. Câu 5: đề xuất mua đã có ô tải phiếu duyệt Sếp ký (`approvalFileUrl`) - "phiếu đề xuất" dùng lại, lúc nhập kho chỉ cần 2 giấy
   mới; nhận nhiều đợt thì mỗi đợt một phiếu nhà cung cấp.
9. Câu 6: thiếu các loại xuất vật tư thành phẩm, VTTP theo công thức, chuyển kho nội bộ.
10. Câu 2 hỏi phần thống kê của anh Sang - người trong nhóm trả lời được, không cần Sếp.
11. Chữ "lệnh" dùng lẫn cho PI và lệnh SX từng SKU (ERP: mỗi SKU 1 lệnh SX) - nên định nghĩa ở đầu, nhất là trong quy tắc gộp.

**Còn lại:** chưa sửa file docx, chờ người dùng.

### 32.18 2026-10-28 — Đề xuất cách làm: (1) tự kiểm tra dữ liệu mỗi đêm, (3) bảng "lệnh sắp trễ" + tin tóm tắt sáng — CHƯA làm

Người dùng hỏi ý tưởng phát triển; trong 7 ý mình đưa, người dùng hỏi "cách thức thực hiện 1 với 3". Chỉ thiết kế, chưa sửa code.

**Hạ tầng đã rà:**
- Chưa có `@nestjs/schedule`; job định kỳ duy nhất là `FloorAlertsService` (setInterval 10 phút, tắt bằng `FLOOR_ALERTS=off`,
  không phát lại nhắc đang mở, tự `resolve` khi hết lý do) - làm mẫu được.
- `render.yaml` khai `plan: free` -> máy chủ ngủ khi không có request, hẹn giờ trong app không tin được ban đêm. Đề xuất dùng
  GitHub Actions lịch (đã có `ci.yml`) gọi endpoint có khoá bí mật riêng; cần kiểm gói Render thật trên dashboard.
- Thông báo: `NotificationsService.emit()` có `dedupeKey`, `resolve()`; quy ước 9.3: Sếp chỉ nhận việc cần duyệt + CRITICAL,
  không có tin tóm tắt.
- Tiến độ từng công đoạn hiện tính ở FE (`ThongKePagePlan.tsx`: `isAllDone`, % mua hàng, Phôi, đan, chuyền kiểm, đóng gói từ
  5 API) -> bảng lệnh sắp trễ cần đưa phần tính này về BE một chỗ.
- DB test: vật tư nằm ở kho `phoi-son-han` (53) và `vat-tu-tp` (1) -> chia 2 nhóm vật tư theo kho là khả thi nhưng phải kiểm
  trên dữ liệu thật (dây đan nằm kho nào).

**Ý 1 - module `data-health`:** danh sách phép kiểm SQL chỉ đọc (tồn lệch sổ cái, tồn âm, giữ hàng vượt tồn, lệnh đã Kết thúc
còn giữ dư, `consumedQty > quantity`, đề xuất mua nhận dở của lệnh đã Kết thúc, lệnh thiếu đề xuất mua/giữ chỗ, mốc sai thứ tự,
xuất vượt định mức); 2 bảng lưu lần chạy + phát hiện (biết mới/cũ/đã hết); báo Admin khi có phát hiện mới; trang Admin; chạy
đêm + nút "Kiểm ngay". Kiểm thử: DB test đã có PI-2026-029/038 giữ dư 170 -> phép kiểm "lệnh đã Kết thúc còn giữ dư" phải bắt được.

**Ý 3 - bảng lệnh sắp trễ + tin sáng:** BE service tính trạng thái từng mốc mỗi SKU (Xong / Đúng hạn / Sắp tới hạn / Trễ) + lý do
(thiếu vật tư gì); màn hình một dòng một SKU theo thứ tự cột đã chốt; tin sáng theo vai trò (Mua hàng + kho: vật tư phải về hôm
nay / đã trễ = Mục 6; KHSX/QLSX: lệnh trễ, sắp tới hạn, tới ngày mà chưa bắt đầu); Sếp xem màn hình, chỉ lệnh nguy cơ trễ hạn
giao mới thành CRITICAL (giữ quy ước 9.3). dedupeKey theo (người, ngày) và (lệnh, mốc), tự đóng khi mốc xong.

**Cần người dùng/Sếp quyết:** "sắp tới hạn" trước mấy ngày; cảnh báo gửi ai; Sếp có nhận tin tóm tắt không (đổi quy ước 9.3);
cách chia 2 nhóm vật tư; dùng GitHub Actions hay Render Cron.

**Ghi chú:** file `docs/nghien-cuu-timeline-chuan-erp-2026-10-26.html` không có trong commit `ab847fa` và không còn trong repo
(người dùng tự gỡ) - các mục trước nhắc tới file này giờ chỉ còn link artifact.

### 32.19 2026-10-28 — Ý 1 "tự kiểm tra dữ liệu mỗi đêm": nguyên mẫu phép kiểm + danh sách file (đã duyệt, ĐÃ LÀM ở 32.20)

Người dùng: "Làm ý 1". Theo quy ước, liệt kê thay đổi trước để duyệt. Đã chạy thử nguyên mẫu SQL (chỉ đọc) trên
`dna_erp_solver_test`, script scratchpad `data-health-prototype.sql`.

**Kết quả nguyên mẫu trên DB test:**

| Phép kiểm | Kết quả |
|---|---|
| C1 tồn kho lệch sổ cái (kho thật) | 1 vật tư (id 1: tồn 7, sổ cái 8) + 2 dòng đoạn (sổ cái âm, tồn 0) |
| C2 tồn âm | 20+ dòng, TOÀN là đoạn (`segmentSpecId`), không có vật tư |
| C3 hàng giữ nhiều hơn tồn thật | 4 vật tư sắt (SAT-HOP-50X50 8, SAT-TRON-FI21 35, SAT-HOP-10X20 41, SAT-VUONG-10X10 30; tồn 0) |
| C4 PI đã Kết thúc hết lệnh còn giữ dư | PI-2026-022 VTK-009 100; PI-2026-029 SAT-013 10, VTK-010 60; PI-2026-038 VTK-019 100 |
| C5 đã rút > phần giữ | 0 |
| C6 đơn mua nhận dở của PI đã Kết thúc | 0 |
| C7 PI có lệnh SX mà không có đề xuất mua | 0 |
| C8 mốc sai thứ tự | PI-2026-035 (VT khung 02/10 sau Khung 26/09 - đúng ví dụ đã biết) |

- Enum mốc thật: `ProdItemStageType` = FRAME, WEAVING, TRANSFER_CHECK, PACKAGING, FRAME_PHOI, FRAME_HAN, FRAME_SON.
- Đoạn (segment) âm rất nhiều - chưa rõ có phải đúng nghiệp vụ (đoạn dư để dưới xưởng, xuất trước nhập) -> đợt 1 chỉ kiểm
  dòng VẬT TƯ, đoạn/mảnh để sau khi hỏi.
- C3 (sắt giữ > tồn, `stockLengthMm` 0) chưa điều tra nguyên nhân - có thể dữ liệu test cũ.

**Đề xuất (chờ duyệt):** module BE `data-health` (danh sách phép kiểm, service, controller 3 route: xem / kiểm ngay / cron có
khoá), 2 bảng + migration (chỉ DB test), loại thông báo Admin mức WARNING, biến môi trường khoá cron, GitHub Actions lịch 01:00
giờ VN; FE thêm khối "Kiểm tra dữ liệu" vào trang có sẵn "Tình trạng hệ thống" (không thêm mục menu); dùng quyền
`SYSTEM_CONFIG` sẵn có để khỏi chạy seed production.

### 32.20 2026-10-28 — ĐÃ LÀM ý 1 "Kiểm tra dữ liệu" mỗi đêm (local, CHƯA commit; migration chỉ DB test)

Người dùng duyệt danh sách file + mặc định ở 32.19: "Duyệt, làm đi".

**BE (`D:\DNA-ERP-BE`):**
- `prisma/schema.prisma` + migration `20261028100000_add_data_health`: bảng `data_health_runs` (lần chạy: CRON/MANUAL, người bấm,
  summary JSON số dòng từng phép kiểm, lỗi) và `data_health_findings` (unique `checkCode + entityKey`, `detail` JSON, lần đầu /
  lần cuối thấy, `resolvedAt`). Áp CHỈ `dna_erp_solver_test` (+ bản sao `_pi022_review` để thử vòng đời); `migrate diff` DB test
  vs schema: rỗng.
- Module mới `src/modules/data-health/`:
  - `data-health.checks.ts`: 8 phép kiểm SQL CHỈ ĐỌC, mỗi phép có tên, mức độ, giải thích, cách xử lý, cột hiển thị, trần 500 dòng:
    STOCK_LEDGER_MISMATCH, NEGATIVE_STOCK, RESERVED_OVER_STOCK (Cao); FINISHED_PI_HOLDING, RESERVATION_OVERCONSUMED,
    FINISHED_PI_OPEN_PURCHASE, PI_WITHOUT_PURCHASE (Trung bình); MILESTONE_ORDER (Thấp, chỉ PI chưa Kết thúc hết, thứ tự Phú An).
    Chỉ dòng VẬT TƯ - chưa kiểm đoạn/mảnh/biến thể.
  - `data-health.service.ts`: chạy lần lượt, phép kiểm lỗi ghi -1 + lý do và KHÔNG đóng phát hiện cũ của nó; đồng bộ phát hiện
    (mới / còn / thấy lại / đã hết) trong transaction; chặn chạy chồng (409); báo Admin khi có dòng mới, gộp 1 thông báo/ngày
    theo ngày giờ VN, tự `resolve` khi hết sạch.
  - `data-health.controller.ts`: `GET /data-health` (SYSTEM_CONFIG VIEW), `POST /data-health/run` (SYSTEM_CONFIG UPDATE),
    `POST /data-health/cron` (@Public + `CronKeyGuard`, chỉ trả tóm tắt).
  - `cron-key.guard.ts`: so header `x-cron-key` với `DATA_HEALTH_CRON_KEY` (timingSafeEqual); chưa đặt biến = route tắt (401).
  - Test: `data-health.service.spec.ts` (8), `cron-key.guard.spec.ts` (4).
- `notification-types.ts`: loại `DATA_HEALTH_NEW_FINDINGS` (ALERT, WARNING, chỉ ADMIN, link `admin/system-status`).
- `app.module.ts`, `config/configuration.ts` (`dataHealth.cronKey`), `config/env.validation.ts` (`DATA_HEALTH_CRON_KEY` optional,
  tối thiểu 24 ký tự).
- `.github/workflows/data-health-nightly.yml`: 18:00 UTC = 01:00 giờ VN + chạy tay; thiếu secret thì bỏ qua; curl thử lại 4 lần,
  mỗi lần tối đa 5 phút (máy chủ Render đang ngủ).
- `render.yaml`: khai `DATA_HEALTH_CRON_KEY` (sync: false).

**FE (`D:\DNA-ERP`):**
- `src/services/data-health-api.ts`; `Admin/DataHealthSection.tsx` (mới): tóm tắt lần kiểm gần nhất, nút "Kiểm ngay", mỗi phép
  kiểm 1 thẻ (mức độ, "Ổn" / "N dòng" / "N mới" / "Lỗi khi kiểm"), mở ra có giải thích + cách xử lý + bảng dựng theo `columns`
  BE trả, dòng mới tô đỏ; mặc định mở thẻ có dòng mới.
- `Admin/SystemStatusPage.tsx`: đặt khối mới lên đầu trang "Tình trạng hệ thống" (không thêm mục menu). UI/UX: trang này vốn
  ghi "toàn bộ dữ liệu là mock, không có backend thật" - mâu thuẫn với khối dữ liệu thật mới -> đổi phụ đề trang và gắn nhãn
  "Dữ liệu demo trong trình duyệt" cho phần mock cũ (phần mock giữ nguyên).
- `Guide/content/admin.ts`: thêm dòng "Tình trạng hệ thống > Kiểm tra dữ liệu" + tag.

**Kiểm tra:**
- BE: `nest build` OK; eslint module mới sạch; jest data-health 12/12; data-health + notifications + system-config + config
  93/93; jest toàn bộ: 2088 pass, 3 fail cùng 1 file bộ giải cắt sắt optimize-material.spec.ts (chạy chung lúc máy bận BE 3002 + FE 3100), chạy riêng file đó 14/14 pass - không liên quan thay đổi này.
- FE: `tsc --noEmit` OK; eslint 4 file sạch; vitest Guide + utils 111/111.
- Live trên DB test (BE 3002 + FE 3100, `admin`):
  - `POST /data-health/cron`: không khoá 401, sai khoá 401, đúng khoá 200 -> 10 dòng (lệch sổ cái 1, giữ > tồn 4, PI đã Kết
    thúc còn giữ dư 4, mốc sai thứ tự 1); `GET /data-health` không JWT 401.
  - Thông báo "Kiểm tra dữ liệu: 10 bất thường mới" tới `admin`, `admin2` (1 thông báo); bấm thông báo mở đúng trang.
  - Bấm "Kiểm ngay" lần 2: vẫn 10 dòng, 0 mới, không báo lại. Giao diện desktop + mobile 375px ổn (bảng cuộn ngang).
- Vòng đời trên bản sao `dna_erp_solver_test_pi022_review` (BE 3003, script `dh-resolve-test.sh`): lần 1 có PI-029 (2 dòng) +
  PI-038; nhả bù giữ chỗ dư của PI-029 bằng SQL trên bản sao; lần 2 -> 2 dòng PI-029 "đã hết", PI-038 vẫn mở, newCount 0, không
  thêm thông báo.

**Phát hiện trên DB test (chưa điều tra):** vật tư `SAT-HOP-50X50` tồn 7 / sổ cái 8; 4 loại sắt giữ 8-41 cây khi tồn 0
(`stockLengthMm` 0) - có thể là dữ liệu test cũ.

**Còn lại / khi lên production (người dùng tự làm):**
- ~~Đặt `DATA_HEALTH_CRON_KEY` trên Render + 2 secret GitHub~~ - **ĐÃ BỎ ở 32.25**: lịch GitHub Actions + khoá cron thay bằng hẹn
  giờ trong app (`DailyJobsService`), không cần cấu hình gì.
- Migration tự chạy khi deploy (entrypoint). Không cần seed (dùng quyền SYSTEM_CONFIG có sẵn).
- Chưa: kiểm đoạn/mảnh, xuất vượt định mức (ý 2). DB test gốc giờ có 2 lần chạy + 10 phát hiện trong 2 bảng mới.
- Không commit, không push, không deploy.

### 32.21 2026-10-28 — Sếp trả lời 16 câu "làm rõ nghiệp vụ" (part 1)

Người dùng gửi `Downloads\cau-hoi-lam-ro-nghiep-vu-part1 (2).docx`: "sếp đã trả lời". Bản gửi Sếp là bản gốc (chưa áp góp ý
32.17). Chỉ đọc + đối chiếu, không sửa code.

**Quyết định của Sếp:**

| Câu | Mục | Trả lời | So với đề xuất |
|---|---|---|---|
| 1 | 1 | Chặn Sales lên đơn SKU chưa duyệt định mức | Đồng ý. FE `OrderManagementPage` đã chỉ liệt kê SKU APPROVED; BE `sales-orders` chưa chặn |
| 2 | 3 | "anh Sang trả lời" | Người dùng tự trả lời |
| 3 | 9 | 68 m³ đúng là cont 40HQ, cài 40HQ làm mặc định | Đồng ý |
| 4 | 9 | Ưu tiên số load cont THEO TỪNG THÙNG, thêm 1 ô load cont THEO BỘ | KHÁC: không chỉ chia cho tổng cả bộ |
| 5 | 4 | Thiếu giấy = CẢNH BÁO; mọi nhóm vật tư; mọi phiếu (kể cả cũ) | KHÁC: không chặn cứng, áp cả phiếu cũ |
| 6 | 4 | Theo đề xuất (bắt buộc với xuất thành phẩm đóng container, loại khác cảnh báo) | Đồng ý |
| 7 | 2 | Cho sửa kế hoạch đã duyệt/đang chạy bằng Excel, nhưng sửa xong phải DUYỆT LẠI TỪ ĐẦU | KHÁC: thêm bước duyệt lại |
| 8 | 6 | Người mua được ghi đè ngày hẹn, nhưng phải KHỚP kế hoạch | KHÁC: có ràng buộc |
| 9 | 12 | Bàn và ghế là 2 SKU RIÊNG | Chọn xưởng theo SKU |
| 10 | 5 | Theo đề xuất (tên PI booking là mã riêng, nối qua từng dòng) | Đồng ý |
| 11 | 5 | Tên hàng booking = tên KHÁCH đặt; Sales phải cập nhật tên của khách tương ứng sản phẩm nhà máy | KHÁC: cần bảng đối chiếu tên khách ↔ sản phẩm |
| 12 | 5 | Theo đề xuất (lấy được cả hàng đã đóng gói trong kho) | Đồng ý |
| 13 | 7/8/11 | Chia hàng đầy trước theo HẠN PHÔI và HẠN ĐÓNG GÓI | KHÁC: không theo "hạn vật tư" |
| 14 | 7/8/11 | Hàng về thừa vào tồn chung | Đồng ý - nhưng CODE HIỆN KHÁC (xem dưới) |
| 15 | 7/8/11 | Sếp ký chung 1 phiếu cho đơn gộp | Đồng ý |
| 16 | 7/8/11 | Theo đề xuất (không tách sau duyệt, chỉ huỷ gộp khi chưa mua) | Đồng ý |

- Mặc định Mục 9 Sếp sửa: SKU đã duyệt PHẢI bổ sung kích thước thùng ngay (mặc định cũ "không bắt").
- Các mặc định khác (Mục 1, 2, 6, 12, 5, 7/8/11) Sếp không sửa = chấp nhận.

**Hệ quả / mâu thuẫn cần xử lý:**
1. "Các điều đã chốt" trong file vẫn ghi "SKU là cả bộ (bàn kèm 6 ghế)" - SAI theo Câu 9 (khớp DB test: `BAN-J55`, `GHE-J55`
   riêng). Phải sửa trong tài liệu kế hoạch.
2. Câu 4 "load cont theo bộ" khi bàn/ghế là SKU riêng: "bộ" là gì trong hệ thống (tổ hợp SKU khách đặt, vd 1 bàn + 6 ghế?) -
   chưa có khái niệm này; ô "theo bộ" nhập tay hay tự tính - cần hỏi lại.
3. Câu 7 "duyệt lại từ đầu": chỉ khi sửa bằng Excel hay cả sửa tay hiện nay (đang không cần duyệt lại)? Lệnh đang sản xuất
   (giữ hàng, đề xuất mua, xưởng đang chạy) xử lý thế nào trong lúc chờ duyệt lại - cần hỏi.
4. Câu 8 "khớp kế hoạch": đề xuất hiểu là ngày hẹn phải nằm trong khung về hàng (VT khung N−5 → N−1, VT còn lại ĐG−11 → ĐG−7);
   ngoài khung thì chặn hay cảnh báo - cần hỏi.
5. Câu 13: hiểu là vật tư khung & đan chia theo hạn Phôi, vật tư còn lại chia theo hạn Đóng gói (khớp 2 nhóm vật tư 32.7). Có
   thể liên quan "ngày cắt sắt" của luật gộp (đang giữ Mua VT khung → Khung, chờ chốt) - chưa tự đổi.
6. Câu 14 hàng thừa vào tồn chung: code hiện cộng HẾT số nhận (gồm % hao hụt + nhận vượt) vào giữ chỗ của PI
   (`creditPool`), chỉ nhả khi Kết thúc (`689a93f`). Đúng ý Sếp thì `creditPool` chỉ cộng tới phần còn thiếu, phần vượt thành
   tồn chung - cùng chỗ với lỗi nhận hàng sau Kết thúc (32.15) ohey đang sửa -> nên báo ohey quyết định này. Phần mua dư %
   hao hụt có tính là "thừa" không - chưa rõ.
7. File vẫn ghi "Mục 10 đã làm"; quy tắc gộp "sắt tối đa 3 lệnh" vẫn lệch cấu hình ERP (2 SKU, 3 ngày) - Sếp không sửa mục
   "đã chốt", chưa ai chốt lại (32.17).

Đã lưu ghi nhớ dự án `sep-tra-loi-16-cau-nghiep-vu-2026-10-28`.

### 32.22 2026-10-28 — Soạn câu trả lời Câu 2 (Mục 3 "Số liệu thống kê")

Người dùng: "trả lời mục 3, phần đó tôi vs bạn làm" (Sếp ghi "anh Sang trả lời" ở 32.21). Chỉ soạn chữ, không sửa code.

**Đối chiếu:** "Nhập số liệu thống kê" = phần báo sản lượng xưởng bằng QR (changelog `2026-10-08-ke-hoach-tem-qr-bo-sat-phoi.md`
mục 15-57): QR tại máy, công nhân tự báo, QLSX kiểm rồi gửi KCS, KCS chấm, "Báo cáo sản lượng đạt KCS", nhắc QLSX, PIN + giới
hạn mạng công ty, QR nhận sắt ở khu Phôi. Đã commit nhánh `QR-QLSX` (merge vào `main` BE / `demo` FE), deploy + seed production
15/10/2026; bản bổ sung "Fix QLSX" + seed production 20/10/2026 (mục 38, 57.7). FE: `Floor/FloorScanApp.tsx`, `QlsxFloorPage`,
`QlsxQueue`, `QlsxReview`, `QlsxStats`, `QlsxSetup`; BE `floor`, `FloorAlertsService`.

**Câu trả lời đã soạn (gửi người dùng dán vào file):** phạm vi gồm 5 phần trên; đã ghép vào hệ thống chung (dùng chung PI, lệnh
SX, KCS, tài khoản), đang chạy trên hệ thống thật từ 15/10; không trùng Mục 6 (thống kê là đầu ra của xưởng, Mục 6 là vật tư đầu
vào); chưa làm: Hàn quét nhận đoạn của Phôi (cần Ban giám đốc chốt), cải tiến giao diện giai đoạn 2-4 (mục 31), màn "Lệnh sản
xuất" theo tổ (mục 43).

### 32.23 2026-10-28 — Pull + review BE `d1e09a3` "fix-stockReservation-v3" và FE `b6e3f2b` "fix-UIUX-QLSX" (ohey)

Người dùng: "pull commit FE và BE mới nhất và review". Mỗi repo hơn local đúng 1 commit; không file nào trùng thay đổi local, nên
`git pull --ff-only` cả hai. Thay đổi local (data-health, tài liệu, e2e...) giữ nguyên. Không commit, không push.

**Hai commit làm gì** (sửa đúng các điểm báo ở changelog `2026-10-28-e2e-tren-backup-production.md` mục 11):
- **BE: lỗi giữ chỗ sắt.**
  - `creditPool()` nhận thêm `stockLengthMm`; `receiveItem()` truyền `item.stockLengthMm ?? 0`.
  - Dòng giữ chỗ tạo mới (pool rỗng) nằm đúng ngăn chiều dài với tồn thật. Pool có sẵn dòng thì vẫn cộng vào dòng đó.
- **BE: đơn hàng trả thêm `piCodes`** - mã các PI thật mà đơn đã gộp vào, sắp theo mã. Có 5 test mới.
- **FE: 5 sửa giao diện.**
  - Hộp "Chọn kho thành phẩm" của QLSX lấy từ bảng kho: kho thật, đang hoạt động, họ `thanh-pham`.
  - Tab Hàn/Sơn đổi tên "Xác nhận nhận vật tư".
  - Chi tiết PI chỉ "Hoàn thành" khi QLSX đã Kết thúc. Lệnh chưa có trạng thái xưởng vẫn tự suy ra như cũ.
  - Màn xuất hàng kho thành phẩm: cột PI lấy từ `piCodes`; nhãn "Số SKU" khi cả trang là đơn xuất cho khách.
  - Chuyền kiểm: kiểm đủ thì hiện "Đã kiểm đủ" thay nút "Kiểm".
- Commit kèm `docs/changelog-2026-10-28-fix-giu-cho-sat-va-loi-giao-dien.html`. Tài liệu đó tự ghi: dữ liệu cũ chưa sửa, chưa
  mở giao diện thật.

**Kiểm tra trên main sau pull:**

| Phép kiểm | Kết quả |
|---|---|
| BE `nest build` | OK |
| BE jest toàn bộ | 2096/2099 qua, 1 bỏ qua. 2 hỏng ở `solver-ts/optimize-material.spec.ts`; chạy riêng file đó 14/14 qua |
| FE `tsc --noEmit` | 0 lỗi |
| FE vitest | 262/262 |
| E2E `full-flow` (BE `be-3001-e2e` bản build mới + FE 3000, DB `dna_erp`) | **QUA, 3,3 phút** (`PI-2026-008`) |

- 2 test solver hỏng phụ thuộc thời gian (giới hạn 20 giây), chỉ hỏng khi chạy chung cả bộ dưới tải. Code solver không đổi từ
  `4cf4078` → không do commit này.
- E2E kiểm được trên giao diện thật 3 điểm FE mới:
  - hộp kho hiện "Kho thành phẩm";
  - nhãn "Đã kiểm đủ";
  - cột PI ở màn xuất hàng có mã PI.
- DB sau E2E: dòng giữ chỗ `PRODUCTION_INVOICE` của sắt `SAT-064` / `PI-2026-008` có `stockLengthMm = 5020`, đúng ngăn với
  `stock_quant` (trước bản sửa là 0).
- File test FE `e2e/full-flow.spec.ts` (chưa track) sửa theo giao diện mới:
  - chọn lại `Kho thành phẩm` theo tên kho;
  - thêm 2 câu kiểm "Đã kiểm đủ" và cột PI.

**Phát hiện:**
1. (Trung bình, CÒN MỞ từ 32.15 phát hiện 1) Nhận hàng sau khi PI đã Kết thúc vẫn lỗi trùng `idempotencyKey`.
   - `d1e09a3` không đổi khoá hay cách tìm pool: `loadPool` chỉ đọc dòng ACTIVE, nhánh tạo mới vẫn dùng khoá
     `PRODUCTION_INVOICE:{pi}:material:{id}` trùng dòng đã RELEASED.
2. (Trung bình) Dữ liệu cũ chưa sửa - cần chạy 1 lần khi deploy:
   - dòng giữ chỗ sắt nằm ngăn 0 do `creditPool` cũ tạo; trên `dna_erp` local còn 1 dòng: id 89, `SAT-056` / `PI-2026-004`;
   - nhả bù PI đã Kết thúc trước 689a93f (32.15 phát hiện 2);
   - tác giả có viết script backfill nhưng đã bỏ. "Kiểm tra dữ liệu" (`RESERVED_OVER_STOCK`, `FINISHED_PI_HOLDING`) sẽ chỉ ra
     các dòng này sau khi lên production.
3. (Thấp) Pool đã có dòng thì `creditPool` cộng vào dòng ưu tiên cao nhất, không xét chiều dài.
   - Hiện an toàn: `approve()` chặn 2 cỡ cây cho cùng loại sắt trong 1 PI và chỉ giữ ở ngăn `bestStockLengthMm`.
   - Còn khe nếu "Tính lại" đổi cỡ cây sau khi đã nhận một phần. Hiếm.
4. (Thấp, FE) Hộp chọn kho giờ liệt kê MỌI kho thành phẩm đang hoạt động, kể cả kho chưa có tài khoản thủ kho.
   - Chọn nhầm kho đó thì không ai thấy lệnh ở Chuyền kiểm / Đóng gói / Nhập đan.
   - Bản cũ lấy từ tài khoản nên luôn có thủ kho. Production hiện kho 2, 3 đều có tài khoản (`khotp2`, `khotp3`) nên chưa sao.
5. (Thấp, FE) Nhãn "Số SKU" chỉ đổi khi MỌI đơn trên trang là đơn xuất cho khách. Trang lẫn đơn vật tư đóng gói vẫn ghi "Số
   lượng vật tư" cho cả hai loại (bản điện thoại thì đúng từng dòng).
6. Đổi hành vi cần nghiệp vụ xác nhận (tác giả đã ghi): lệnh cũ đóng gói đủ mà chưa ai bấm Kết thúc sẽ hiện lại "Đang sản xuất".
   Chữ "Xác nhận sản lượng" còn sót trong `components/sanxuat/core.tsx`.

**Còn lại:**
- Phát hiện 1-2 chờ ohey (như 32.15).
- BE cổng 3001 đang chạy `be-3001-e2e` với bản build mới.
- Không commit, không push, không deploy.

### 32.24 2026-10-29 — `DATA_HEALTH_CRON_KEY` để làm gì + kế hoạch mục 3 "bảng mốc / tin sáng" (ĐÃ DUYỆT, ĐÃ LÀM ở 32.25)

Người dùng: "`DATA_HEALTH_CRON_KEY` phần này là làm gì? Liệu có cần hay có cách nào đơn giản và tối ưu hơn" + "làm mục 3" (sau câu
hỏi dùng mặc định đề xuất ở lượt trước).

**`DATA_HEALTH_CRON_KEY` (mục 1, 32.20):**
- Là khoá bí mật để chỉ lịch GitHub Actions gọi được route công khai `POST /data-health/cron` (không đăng nhập). Không có khoá
  thì ai trên Internet cũng bấm chạy 8 phép kiểm liên tục được.
- Phải cấu hình 3 chỗ: biến trên Render + 2 secret GitHub (`ERP_BASE_URL`, `DATA_HEALTH_CRON_KEY`).
- Lý do phải gọi từ ngoài: `render.yaml` khai `plan: free`, máy chủ ngủ khi không có request, nên hẹn giờ 01:00 trong app không
  chạy được.
- **Cách đơn giản hơn (đề xuất):** hẹn giờ TRONG APP theo mẫu `FloorAlertsService` (10 phút kiểm 1 lần): "mỗi ngày chạy 1 lần
  vào lần đầu máy chủ thức trong ngày".
  - Dữ liệu chỉ đổi khi có người dùng app, nên kiểm lúc máy chủ thức là đủ.
  - Bỏ được khoá, route `/cron`, guard, workflow GitHub, biến Render, 2 secret.
  - Dùng chung cơ chế cho tin sáng mục 3.
  - Đánh đổi: gói free thì chạy lúc người đầu tiên mở app trong ngày, không đúng 01:00; máy chủ chạy liên tục thì đúng giờ.
  - Chống chạy trùng bằng cách tra DB đã có lần chạy hôm nay (giờ VN).

**Rà hiện trạng cho mục 3** (agent, chỉ đọc):
- Mốc đã lưu:
  - `ProductionInvoiceItem.materialDeadline` ("Mua VT khung & đan"), `finishedMaterialDeadline` ("Mua VT còn lại"),
    `deliveryDeadline` ("Hạn giao");
  - `ProductionInvoiceItemStage`: FRAME_PHOI/HAN/SON, FRAME ("Khung CK"), WEAVING ("Đan"), PACKAGING ("Đóng gói").
  - `TRANSFER_CHECK` không ai ghi → Chuyền kiểm không có ngày.
- Tiến độ mỗi công đoạn hiện CHỈ tính ở FE `ThongKePagePlan.tsx` (`subStatusOf`, `buildFrame`, `buildWeaving`,
  `buildChuyenKiem`, `buildPackaging`, `getPurchasingPercent`) từ 7 API batch BE có sẵn. BE chưa có chỗ nào so mốc với hôm nay,
  chưa có job buổi sáng.
- Quá hạn hiện có:
  - `isOrderOverdue` chỉ so Hạn giao;
  - LenhSXPage tô đỏ ô ngày đã qua nhưng không xét tiến độ.
- Chưa có code chia vật tư 2 nhóm mua. Chia được theo `MaterialGroup.systemKey` + `Material.detailKind`:
  - VT khung = Sắt/Dây/Đinh/Tán rút/Nút + Sơn;
  - VT còn lại = Phụ kiện/Nệm/Bao bì.

**Kế hoạch đề xuất** (mặc định: sắp tới hạn = trước 2 ngày; tin sáng 07:00 theo vai trò; Sếp KHÔNG nhận tin tóm tắt - giữ quy
ước 9.3):
- **BE `milestone-board`:** 1 service tính cho mỗi dòng SKU đang chạy, từng mốc:
  - trạng thái: Xong / Đúng hạn / Sắp tới hạn (≤ 2 ngày) / Trễ / Chưa đặt hạn;
  - lý do: mua hàng = vật tư chưa về đủ; công đoạn = % đã làm.
  - Luật "xong" theo đúng các luật FE đang dùng, gọi lại các service batch BE sẵn có.
  - Route `GET /milestone-board` (quyền PRODUCTION_INVOICE:VIEW).
- **BE `daily-jobs`:** hẹn giờ trong app, 10 phút kiểm 1 lần, tắt bằng `DAILY_JOBS=off`, tắt khi chạy test.
  - Mỗi ngày 1 lần: chạy "Kiểm tra dữ liệu".
  - Sau 07:00 giờ VN: tin sáng
    - Mua hàng + thủ kho: vật tư phải về hôm nay / đã trễ;
    - KHSX + QLSX: mốc trễ, sắp tới hạn, tới ngày Phôi mà chưa "Bắt đầu".
  - Sếp + KHSX + QLSX nhận cảnh báo CRITICAL khi Hạn giao còn ≤ 2 ngày hoặc đã qua mà chưa đóng gói đủ (1 thông báo/dòng SKU,
    tự đóng khi xong).
- **Gỡ phần lịch ngoài của mục 1:** route `/cron`, `cron-key.guard`, biến `DATA_HEALTH_CRON_KEY`, mục trong `render.yaml`,
  workflow GitHub. Sửa chữ "mỗi đêm" ở FE + Hướng dẫn.
- **FE:** thêm chế độ xem "Bảng mốc" ngay trong trang "Tổng hợp lệnh SX" (`ThongKePagePlan`, đã có ở KHSX, QLSX, Sếp, Giám
  đốc - không thêm mục menu):
  - mỗi SKU 1 dòng, 9 mốc tô màu, rê chuột xem lý do;
  - điện thoại hiện thẻ.
- **Kiểm thử:** unit test luật trạng thái + điều kiện chạy 1 lần/ngày; chạy thử trên `dna_erp` bằng dữ liệu E2E rồi dọn lại
  sạch.

**Còn mở:** mốc chưa lưu ngày thì KHÔNG cảnh báo (chỉ hiện "chưa đặt hạn") - không dùng ngày đề xuất Phú An để báo trễ. Tiến độ
FE cũ vẫn tự tính riêng (2 nơi tính, cần giữ luật khớp nhau).

### 32.25 2026-10-29 — ĐÃ LÀM: hẹn giờ trong app (bỏ khoá cron), Bảng mốc, tin sáng, cảnh báo nguy cơ trễ hạn giao (local, CHƯA commit; đã sửa thêm theo review ở 32.26)

Người dùng duyệt 32.24 ("Duyệt, làm đi"), giữa chừng hỏi "số liệu sản xuất tuần hoàn liên tục trong 1 ngày thì call 1 lần có đủ
không... hay admin không cần theo dõi quá nhiều". Đã trả lời:
- "Kiểm tra dữ liệu" bắt lỗi dữ liệu/hệ thống (việc kỹ thuật của Admin), hiếm và không gấp - 1 lần/ngày + nút "Kiểm ngay" là đủ.
- Tiến độ sản xuất liên tục thuộc Bảng mốc:
  - tính trực tiếp mỗi lần mở trang;
  - cảnh báo hạn giao xét lại mỗi 10 phút;
  - tin sáng chỉ là tóm tắt đầu ngày.

**BE (`D:\DNA-ERP-BE`):**
- **Gỡ lịch ngoài của mục 1** (về đúng bản gốc, `git diff` rỗng): route `POST /data-health/cron`, `cron-key.guard.ts` + spec,
  `dataHealth.cronKey` trong `configuration.ts`, `DATA_HEALTH_CRON_KEY` trong `env.validation.ts` và `render.yaml`,
  `.github/workflows/data-health-nightly.yml`. `DataHealthModule` export service; ngày VN dùng chung `vnDayKey`
  (`floor-stats.util`).
- **Module mới `milestone-board`:**
  - `milestone-board.rules.ts`: luật thuần.
    - Trạng thái: DONE / NA / UNKNOWN / NO_DEADLINE / ON_TRACK / DUE_SOON (≤ 2 ngày, gồm hôm nay) / LATE.
    - Thứ tự 9 mốc; `combineProgress` (Khung = Phôi + Hàn + Sơn); `goodCapped`; `percentOf` (cùng `pctOf` FE).
  - `milestone-board.service.ts` `getBoard()`:
    - Lấy dòng PI đã Sếp duyệt mà lệnh chưa FINISHED.
    - Gọi lại đúng các hàm batch FE "Tổng hợp lệnh SX" đang dùng: `getPhoiProgressBatch`, `getBatchPlanBatch` PHOI/HAN/SON,
      `getIssuePlanBatch`, `getPackagingBatch`. Đọc đề xuất mua theo PI.
    - Mỗi nguồn bắt lỗi riêng → mốc liên quan "Chưa biết".
    - Luật xong như FE:
      - Phôi = cắt + công đoạn phụ theo SKU (`byOrder`, trừ lỗi KCS) + vật tư thành phẩm Phôi làm;
      - Hàn/Sơn = đạt + chờ KCS + chưa gửi;
      - Đan = đã NHẬN về;
      - mua hàng = mọi dòng về đủ; dây/nệm của SKU khác trong PI không tính (như `scopePurchasingRows`).
    - Nhóm mua theo `Material.detailKind`: ACCESSORY/CUSHION/PACKAGING = "VT còn lại", còn lại = "VT khung & đan".
    - Hạn = ngày ĐÃ LƯU. "Mua VT khung" chưa lưu thì theo hạn Khung (chuỗi `ownSteelDeadlineOf`); Hạn giao chưa lưu thì theo hạn
      PI.
    - Trả mỗi ô: trạng thái, số ngày, %, cần/đã làm, lý do (vật tư chưa về đủ "đã về/cần"). Dòng xấu nhất lên đầu.
  - `GET /milestone-board` (quyền PRODUCTION_INVOICE:VIEW sẵn có).
- **Module mới `daily-jobs` `DailyJobsService`** (mẫu `FloorAlertsService`): 60 giây sau khi lên rồi 10 phút 1 lần; tắt bằng
  `DAILY_JOBS=off`, không chạy khi test; mỗi bước bắt lỗi riêng.
  1. "Kiểm tra dữ liệu": hôm nay (giờ VN) chưa có lần CRON thì chạy (409 do Admin đang bấm "Kiểm ngay" thì bỏ qua).
     _32.26: chỉ tính lần đã CHẠY XONG; cả lần kiểm chạy dưới khoá advisory._
  2. `DELIVERY_AT_RISK` (ALERT/CRITICAL → tự thêm Sếp; KHSX + QLSX):
     - phát cho dòng có Hạn giao Trễ / Sắp tới hạn;
     - chỉ phát lại khi số ngày hoặc số đã đóng gói đổi (gộp sẽ đặt lại "chưa đọc"); _32.26: chỉ khi SỐ NGÀY đổi_;
     - đóng khi hết nguy cơ hoặc lệnh Kết thúc; "Chưa biết" thì giữ.
  3. Từ 07:00 giờ VN, 1 lần/ngày (tra `dedupeKey` theo ngày khi khởi động lại), tin hôm trước tự đóng, không có gì thì không gửi:
     - `MORNING_MATERIALS_DIGEST` → NV mua phụ trách vật tư (`buyerId`) + thủ kho đúng kho (`warehouse.code`), link "Theo dõi
       mua hàng" / "Nhập kho"; _32.26: mỗi người nhận 1 tin riêng, kho = kho nhận ghi đè trước, gộp trùng theo (PI, vật tư)_;
     - `MORNING_PRODUCTION_DIGEST` → KHSX + QLSX: mốc trễ / sắp tới hạn / tới ngày Phôi mà chưa "Bắt đầu".
- `notification-types.ts`: 3 loại mới. Link Bảng mốc có `alternatives` cho từng phân hệ: `production_plan/thongke`,
  `production/ke-hoach`, `boss/thong-ke`, `?view=moc`. _32.26: `boss/thong-ke` lên đầu (Sếp mở được mọi phân hệ nên trước đây
  luôn rơi vào màn KHSX)._
- Test mới: `milestone-board.rules.spec` (8), `milestone-board.service.spec` (5), `daily-jobs.service.spec` (14).

**FE (`D:\DNA-ERP`):**
- `services/milestone-board-api.ts`.
- `Manufacturing/MilestoneBoardView.tsx`:
  - máy tính: bảng 9 cột tô màu (đỏ / vàng / xanh dương / xanh lá / xám), rê chuột xem lý do;
  - điện thoại: thẻ chỉ liệt kê mốc còn việc kèm lý do;
  - lọc "Tất cả / Cần chú ý", ô tìm, "Tải lại", chú giải;
  - tải lại ngầm theo realtime (gom 5 giây);
  - nháy đúng dòng khi mở từ cảnh báo (`focus=PRODUCTION_INVOICE_ITEM:id`).
- `ThongKePagePlan.tsx`: vỏ mới đọc `?view=moc` + nút "Theo lệnh / Bảng mốc" cạnh tiêu đề; trang cũ đổi tên `OrderSummaryView`,
  không đổi gì khác.
- Hướng dẫn:
  - bài mới "Bảng mốc" (KHSX, QLSX, Sếp) trong `Guide/content/manufacturing.ts`;
  - sửa chữ "mỗi đêm" → "mỗi ngày 1 lần" ở `DataHealthSection.tsx`, `Guide/content/admin.ts`, `data-health-api.ts`.

**Kiểm tra:**
- BE:
  - `nest build` OK; `tsc` chỉ còn 2 lỗi cũ ở `prisma/seed-*.ts` (tác giả `d1e09a3` đã ghi nhận);
  - jest mục mới + data-health + notifications 83/83 (gồm test link: mọi đích là phân hệ FE thật);
  - toàn bộ 2120/2122: 1 bỏ qua, 1 hỏng là test thời gian solver `optimize-material.spec.ts` khi chạy chung (đã gặp ở 32.23).
- FE: `tsc` 0 lỗi; eslint file mới sạch (3 cảnh báo cũ của ThongKePagePlan); vitest 262/262.
- **Chạy thử thật trên `dna_erp`** (dữ liệu E2E rồi dọn sạch):
  - Dựng dữ liệu:
    - full-flow phần A+B (cờ dừng tạm `E2E_STOP_AFTER_B`, đã gỡ ngay, `grep` = 0) → `PI-2026-001` đã duyệt, chưa mua,
      chưa bắt đầu;
    - KHSX đặt mốc qua `PATCH /production-invoices/:id/items-deadlines`.
  - Kết quả Bảng mốc:
    - Mua VT khung Trễ 2 ngày, lý do "Sắt … 0/67 cây; Sơn … 0/100 kg; Dây … 0/25 kg; +1";
    - Phôi Trễ, Hàn Sắp tới hạn, Sơn/Khung/Đan/Đóng gói Đúng hạn;
    - Mua VT còn lại Không cần, Hạn giao Sắp tới hạn.
  - BE `be-3001-dist`, lần kiểm đầu sau ~60 giây:
    - CRON "Kiểm tra dữ liệu" chạy 1 lần;
    - tin vật tư tới `muapsh`, `muavttp`, `khopsh`, `khovttp`;
    - tin tiến độ tới `khsx`, `qlsx`;
    - `DELIVERY_AT_RISK` tới `boss`, `khsx`, `qlsx`.
  - Khởi động lại trong ngày: không chạy lại kiểm tra dữ liệu, không phát trùng cảnh báo.
  - Giao diện (KHSX, trình duyệt trong app):
    - 1400 px vừa khít không cuộn ngang (đã thu cột);
    - điện thoại hiện thẻ;
    - nút "Theo lệnh" quay về trang cũ;
    - bấm cảnh báo trong chuông mở đúng Bảng mốc và nháy dòng SKU.
  - UX đã sửa khi chạy thử:
    - tiêu đề tin bỏ phần "0 phải về";
    - gộp vật tư theo dòng SKU thay vì lặp "PI · SKU";
    - thêm "Tiến độ hôm nay:";
    - ô "Không cần" bỏ ngày;
    - chú giải trên điện thoại bỏ câu "rê chuột".
- full-flow chạy lại (BE `be-3001-e2e`, cấu hình này giờ có thêm `DAILY_JOBS=off`) QUA 3,5 phút - trang "Theo lệnh" + Bắt đầu /
  Kết thúc của QLSX vẫn chạy với lớp vỏ mới.
- Dọn `dna_erp` về bản sạch: giống hệt 8187 dòng. BE `be-3001-dist` bật lại sẽ tự thêm 1 lần chạy "Kiểm tra dữ liệu" trong ngày
  (đúng thiết kế mới).

**Còn lại / lưu ý:**
- Mốc chưa lưu ngày không báo trễ. _32.28: riêng 2 mốc mua vật tư nay có hạn dự phòng (Khung / Đóng gói → hạn PI), cùng hàm với "Theo dõi mua hàng"._
- Chuyền kiểm chưa có ô hạn nên không có cột.
- Mốc "Mua VT còn lại" chỉ đúng khi vật tư có `detailKind`.
- Tiến độ tính 2 nơi (BE Bảng mốc, FE "Theo lệnh"). _32.28: % Khung và làm tròn % mua đã cho khớp nhau._
- Production chưa có PI nào (26/10) nên Bảng mốc sẽ trống tới khi xưởng chạy lệnh thật.
- Không commit, không push, không deploy. Khi deploy không cần cấu hình gì thêm. Muốn tắt việc hằng ngày thì đặt
  `DAILY_JOBS=off`.

### 32.26 2026-10-29 — Rà lỗi biên của 32.25: 10 phát hiện, ĐÃ SỬA 9, 1 lệch có sẵn ở FE để lại (local, CHƯA commit)

Người dùng hỏi "đã chuẩn chỉ hết chưa, kiểm tra các trường hợp có thể gây bug chưa".
- Cho 1 agent rà độc lập (chỉ đưa code, không đưa kết luận của mình) rồi tự kiểm lại từng ý trên code.
- Agent: 0 lỗi nặng, 3 trung bình, 1 trung bình-thấp, 6 thấp.
- DB dev không có lệnh nào đang chạy, nên mọi ý dưới đây xác nhận bằng đọc code + test, chưa thấy trên dữ liệu thật.

**Đã sửa (BE `D:\DNA-ERP-BE`):**
1. **Tin vật tư tới nhầm thủ kho với vật tư đóng gói** (trung bình).
   - Lỗi: Bảng mốc lấy kho mặc định của vật tư.
   - Thực tế: hàng về kho QLSX ghi đè trên dòng mua (`receiveWarehouseCode`), giống `receiveItem` và `work-queue`.
   - Sửa: `loadPurchaseLines` lấy `receiveWarehouseCode ?? material.warehouse.code`.
2. **Dây/nệm của SKU đã Kết thúc bị tính sang SKU còn chạy** (trung bình).
   - Lỗi: tập "dây của dòng khác" chỉ dựng từ các dòng trên bảng (không gồm lệnh FINISHED).
   - Hậu quả: dây chưa về của SKU đã xong làm SKU kia "Trễ" và vào tin sáng mỗi ngày, trong khi trang "Theo lệnh" ẩn nó.
   - Sửa: đọc thêm dây/nệm của MỌI dòng đã duyệt trong các PI đó - cùng tập `approvedRows` FE dùng.
3. **Tin vật tư không theo từng người nhận, và đếm trùng** (trung bình).
   - Lỗi 1: 1 tin chứa mọi vật tư gửi cho mọi NV mua + thủ kho; 5 dòng hiện là 5 dòng trễ nhất chung, nên vật tư của 1 người có
     thể bị chìm trong "+N dòng khác".
   - Lỗi 2: vật tư mua chung cả PI (sắt, đinh) có ở mọi SKU nên bị đếm 1 lần mỗi SKU (PI 4 SKU × 3 dòng sắt = "12 đã trễ").
   - Sửa: `materialsDigests()` gộp theo (PI, vật tư), lấy hạn gấp nhất; mỗi NV mua và mỗi kho nhận 1 tin riêng chỉ gồm vật tư
     của mình (`dedupeKey` `MORNING_MATERIALS_DIGEST:<ngày>:u:<userId>` / `:w:<mã kho>`).
   - Khởi động lại giữa ngày: tra theo tiền tố ngày, chỉ gửi người nhận nào chưa có; chỉ đóng tin hôm trước khi hôm nay chưa gửi tin
     nào, để không đóng nhầm tin hôm nay.
4. **2 tiến trình cùng chạy việc hằng ngày** (trung bình-thấp: deploy chồng nhau / sau này nhiều instance).
   - Hậu quả: gửi đôi tin sáng; cảnh báo CRITICAL đôi cho Sếp; 2 lần "Kiểm tra dữ liệu" đụng unique, lần hỏng để lại dòng chưa xong.
   - Sửa: `tick()` chạy trong 1 transaction giữ `pg_try_advisory_xact_lock(hashtext('daily-jobs'))` (tối đa 10 phút); nơi không
     lấy được khoá thì bỏ qua lượt đó.
   - Chọn khoá theo transaction (không theo phiên) để vẫn đúng nếu DB đi qua bộ gộp kết nối.
   - Đã kiểm: adapter-pg gắn bộ nghe lỗi cho kết nối transaction, nên nếu DB cắt kết nối thì chỉ ghi lỗi, tiến trình không sập.
5. **Cảnh báo nguy cơ trễ hạn giao báo lại quá nhiều** (thấp).
   - Lỗi: mỗi lần đóng thêm thùng là phát lại, và phát lại sẽ đặt "chưa đọc" cho Sếp/KHSX/QLSX - ngày đóng gói thì 10 phút 1 lần.
   - Sửa: chỉ phát lại khi số ngày còn lại đổi (sang ngày mới). Số đã đóng trong tin có thể cũ trong ngày; Bảng mốc luôn là số mới.
6. **"Kiểm tra dữ liệu" lỗi giữa chừng thì cả ngày không kiểm lại** (thấp).
   - Sửa: chỉ tính lần CRON có `finishedAt`.
7. **Phôi tải lỗi mà bảng không hiện băng cảnh báo** (thấp).
   - Lỗi: `getPhoiProgressBatch` tự nuốt lỗi từng PI (bỏ PI khỏi kết quả), nên `failedSources` rỗng dù ô Phôi "Chưa biết".
   - Sửa: PI nào thiếu trong kết quả thì báo nguồn `phoi-progress` lỗi, như FE `ThongKePagePlan`.
8. **PI đã huỷ / đơn bán đã ngừng hoặc xoá vẫn lên bảng** (thấp, phòng hờ).
   - Hiện chưa màn nào đặt các trạng thái này, nhưng nếu có thì Sếp nhận CRITICAL về lệnh không còn.
   - Sửa: lọc `productionInvoice.status ≠ CANCELLED` và đơn bán `isActive` + chưa xoá (dòng không có đơn bán vẫn giữ).
9. **Link thông báo của Sếp** (thấp): `boss/thong-ke` lên đầu `MILESTONE_BOARD_LINK`. Trước đây Sếp mở được mọi phân hệ nên luôn
   bị đưa vào màn KHSX. KHSX/QLSX không mở được `boss` nên vẫn đi theo đích dự phòng của mình.

**Đã sửa (FE `D:\DNA-ERP`, `MilestoneBoardView.tsx`):**
- Thêm chủ đề realtime `floor` (công nhân báo sản lượng bằng QR) vào danh sách tự tải lại.
- Tải lại lỗi sau lần đầu: trước đây im lặng, giờ hiện băng đỏ "Không tải lại được bảng - đang hiện số lúc HH:MM".

**KHÔNG sửa:**
- **Phát hiện 8 - 2 màn có thể lệch ở mốc mua hàng** (lỗi có sẵn ở FE, không do 32.25).
  - FE "Theo lệnh" chỉ tải đề xuất mua chưa PURCHASED (100 dòng) + 100 đề xuất mới nhất.
  - Đề xuất đã mua nhưng hàng chưa về, cũ hơn 100 đề xuất mới nhất, sẽ mất khỏi FE: "Theo lệnh" hiện Mua hàng 100% trong khi Bảng
    mốc hiện Trễ. Bảng mốc là số đúng.
  - Production hiện có ít đề xuất nên chưa chạm ngưỡng.
- Đóng gói (`recordPackaging`) không phát realtime nên Bảng mốc không tự tải lại khi đóng thùng - có sẵn từ trước; bấm "Tải lại"
  hoặc chờ sự kiện khác.

**Test:**
- `daily-jobs.service.spec` viết lại (19 test):
  - khoá: lấy được / không lấy được / lỗi mở transaction;
  - `finishedAt`;
  - tin riêng từng người nhận + gộp (PI, vật tư) + chỉ vật tư của mình;
  - khởi động lại giữa ngày chỉ gửi phần thiếu, không đóng nhầm;
  - hạn giao chỉ phát lại khi số ngày đổi.
- `milestone-board.service.spec` thêm 4 test (9): lọc huỷ/ngừng; dây của dòng đã Kết thúc; kho nhận ghi đè; PI thiếu trong tiến độ
  Phôi.

**Kiểm tra:**
- BE:
  - jest mục mới + data-health + notifications 92/92 (gồm `notification-links.spec`);
  - `nest build` OK; `tsc` chỉ còn 2 lỗi cũ ở `prisma/seed-*.ts`;
  - toàn bộ 2127/2131: 1 bỏ qua; 3 hỏng đều là test đo thời gian 20 s của bộ giải `optimize-material.spec.ts` khi máy đang chạy
    song song build + vitest + BE (đã gặp ở 32.23/32.25) - chạy riêng file đó 14/14 đạt.
- FE: `tsc` 0 lỗi; eslint file đổi chỉ còn 3 cảnh báo cũ của `ThongKePagePlan.tsx` (có từ HEAD); vitest 262/262.
- Chạy thật:
  - câu khoá `pg_try_advisory_xact_lock(hashtext($1)::bigint)` với tham số không khai kiểu (như Prisma gửi) trả `t` trên Postgres
    dev;
  - BE `be-3001-dist` khởi động lại bằng bản build mới, lượt kiểm đầu không lỗi, thấy lần CRON hôm nay (10:14) đã xong nên không
    chạy lại.
  - DB dev không có lệnh đang chạy nên chưa thấy tin riêng từng người nhận trên dữ liệu thật; muốn xem thì dựng lại PI như 32.25.

**Còn lại:** không commit, không push, không deploy.

### 32.27 2026-10-29 — Test thật mục 1 + mục 3 bằng 2 agent test + 1 agent quản lý rà code (CHỈ TEST; các lỗi tìm được ĐÃ SỬA ở 32.28)

Người dùng: "đã oke hết chưa, có thể tạo agent 1 và 2 thực hiện test và 1 agent quản lý và check mục 1 và 3 đã code".

**Cách làm:**
- Mỗi agent test có stack riêng, dựng từ bản sạch production 26/10 (`backups/local_dna_erp_20261028_prod-sach-truoc-e2e.dump`):
  - Agent 1 (mục 1 + việc hằng ngày): DB `dna_erp_t1`, BE 3011 + 3012 cùng DB.
  - Agent 2 (mục 3, E2E giao diện): DB `dna_erp_t2`, BE 3021, FE 3100. Dữ liệu dựng bằng API: 3 PI, 4 SKU MEYING có sẵn, đơn
    `A2-PO-394336`.
- Agent quản lý: chỉ đọc code, lập checklist theo §32.18–32.26 rồi đối chiếu 2 báo cáo test.
- Không đụng `dna_erp`, BE 3001, FE 3000. Xong đã tắt server và `dropdb` cả 2 DB; `git status` 2 repo đầu/cuối giống hệt.
- `.claude/launch.json` (chưa track) thêm 4 cấu hình `be-3011-t1`, `be-3012-t1`, `be-3021-t2`, `fe-3100-t2`.
- Người dùng quyết GIỮ NGUYÊN 2 điểm:
  - (a) Sếp xem được `/data-health`, vì role BOSS production có SYSTEM_CONFIG VIEW; chỉ sửa comment "chỉ Admin" ở
    `data-health.controller.ts`.
  - (b) Người bấm "Kiểm ngay" không nhận thông báo của lần đó.

**Agent quản lý - code đủ thiết kế:** mọi điểm hứa ở §32.18–32.26 đều có và đúng. Phần gỡ cron sạch, hợp đồng FE↔BE khớp, link
thông báo trỏ trang FE có thật. Diff các file BE đã track không có gì lạc đề. FE `.env.example` bị xoá là việc có từ trước (ghi ở
changelog 06/10).

**Đạt khi chạy thật:**
- **Mục 1:**
  - 401/403/200, bấm chồng 409, `/cron` 404;
  - 8/8 phép kiểm bắt đúng thực thể cố ý làm sai, đối chứng âm không bị bắt;
  - vòng đời mới / còn / thấy lại / đã hết; 1 thông báo/ngày, resolve khi hết;
  - phép kiểm lỗi SQL thì ghi -1;
  - CRON 60 s sau khi lên, khởi động lại không chạy lại, `finishedAt` NULL thì chạy lại, `DAILY_JOBS=off`;
  - 2 tiến trình chỉ 1 lần CRON, kể cả khi ép kẹt 55 s; API thường không treo;
  - `vnDayKey` 16:59:59Z / 17:00Z.
- **Mục 3:**
  - trạng thái, %, lý do 4 SKU × 9 mốc; dòng xấu nhất lên đầu;
  - nhận hàng 1 phần; vật tư dùng chung không đếm trùng; dây của SKU khác (kể cả đã Kết thúc) không tính;
  - tin vật tư riêng từng NV mua / từng kho, có kho nhận ghi đè; tin tiến độ tới KHSX + QLSX;
  - `DELIVERY_AT_RISK` CRITICAL đúng người;
  - khởi động lại 3 lần không trùng; đóng thêm thùng không phát lại; đóng đủ / Kết thúc / CANCELLED / đơn ngừng thì ẩn + resolve;
  - link Sếp / KHSX / QLSX / NV mua / thủ kho đúng trang, nháy đúng dòng;
  - 1400 px không cuộn ngang, 375 px hiện thẻ; quyền đúng.

**Lỗi tìm được (agent quản lý đã kiểm trên code, đều thật):**
- **Mục 1** (`data-health.service.ts`, có từ 32.20):
  - L2 (TB): `run()` chỉ bọc lỗi phần đọc SQL. Lỗi ở bước ghi phát hiện thì cả lần chạy dừng, `finishedAt` / `error` NULL,
    phát hiện đã ghi không bao giờ được báo. `getReport` lấy lần mới nhất kể cả lần dở, nên 8 thẻ hiện "Chưa kiểm".
  - L1 (thấp–TB): "Kiểm ngay" ở tiến trình khác chạy chồng CRON → `createMany` đụng unique → 409 "Duplicate value for:
    undefined", lần chạy bỏ dở. Cờ `running` chỉ trong 1 tiến trình; khoá advisory chỉ bọc việc hằng ngày.
  - L3 (thấp): trần 500 dòng làm cửa sổ trượt → dòng bị đẩy ra bị đánh "đã hết", quay vào lại thì thành "mới" giả và có
    thông báo.
- **Quanh mục 3:**
  - B3 (TB, có từ trước = phần D §32.5 chưa làm): "Theo dõi mua hàng" (đích tin sáng NV mua) tính hạn theo cả đề xuất
    (`frameDeadlineOf`), không biết `finishedMaterialDeadline` → tin nói "hôm nay", màn mua nói "trễ 2 ngày". Nhãn "Hạn giao vật
    tư" ở "Theo lệnh" thực ra là hạn giao hàng.
  - B8 (TB, có từ trước ở FE): `getPurchasingPercent` dùng `Math.round` và `isAllDone` xét ≥ 100 → 99,67% thành 100%: "Theo
    lệnh" coi mua hàng XONG trong khi Bảng mốc báo Trễ.
  - B2 (thấp, 32.25 chọn khác FE): % Khung CK - FE lấy trung bình 3 tổ (8%), BE cộng dồn (10%). % Đan - FE trung bình xuất +
    nhận, BE chỉ tính đã nhận. Trạng thái vẫn khớp.
  - B1 (thấp, có từ trước): KHSX không có QC_REVIEW / FLOOR_REPORT nên Bảng mốc không tự tải lại sau KCS chấm / báo QR.
    `recordProductionBatch` ("Lưu đợt") không phát realtime. Bảng vẫn tự làm mới định kỳ 5 phút.
  - B4 (thấp): đơn vị sắt hiện "Mm" (`Material.unit` production) ở lý do và tin sáng; số thật là cây.
  - B5, B6 (thấp, 32.25): tải lần đầu lỗi ghi "0 SKU đang chạy"; tooltip ô mua hàng ghi "đã làm" (phải là "đã về") và lặp %.
  - B7, B9 (thấp, có từ trước, ngoài mục 3): PI CANCELLED vẫn hiện ở "Theo lệnh"; "Ngày tạo" lệnh lấy `approvedAt`.
  - UX: thẻ điện thoại thiếu "chưa bắt đầu / tạm dừng" và liệt kê cả mốc "Chưa đặt hạn"; chú giải thiếu "Chưa biết"; "Tải lại"
    không có dấu hiệu đang tải; bài Hướng dẫn "Bảng mốc" nằm sai nhóm (Phôi·Hàn·Sơn·KCS).

**Chấm (agent quản lý):** mục 1: 8/10; mục 3: 8,5/10. Không lỗi nặng; nên sửa nhóm P1 trước khi deploy.

**Đề xuất sửa (CHƯA làm, chờ người dùng duyệt):**
- P1:
  - L2: lỗi bước ghi = -1, try/catch ngoài cùng ghi `error` + `finishedAt`, `getReport` lấy lần đã xong;
  - L1: khoá advisory riêng `data-health` trong `run()` + `skipDuplicates`;
  - B8: làm tròn xuống;
  - B4: dòng sắt hiện "cây";
  - comment cũ ("chỉ Admin", "chạy đêm / GitHub Actions", tham số tin vật tư).
- P2:
  - L3: chạm trần thì không đóng dòng vắng;
  - chữ / chú giải / thẻ điện thoại / "Tải lại";
  - Hướng dẫn;
  - B1 realtime;
  - cộng dồn số "mới" khi gộp thông báo Admin;
  - `unref()` timer; B7; bộ lọc lỗi P2002 đọc tên ràng buộc.

**Cần người dùng / Sếp quyết:**
- Q1: % Khung CK lấy trung bình 3 tổ hay cộng dồn.
- Q2: % Đan: giữ "đã nhận về" hay đồng bộ 2 màn.
- Q3: hạn từng dòng ở "Theo dõi mua hàng" theo nhóm vật tư (làm phần D §32.5), dự phòng hạn Khung hay hạn Khung → hạn PI.
- Q4: `DELIVERY_AT_RISK` có vào tab "Cần xử lý" không.
- Q5: phép kiểm lỗi (-1) có báo Admin không.
- Q6: đơn vị "Mm" sửa dữ liệu production hay chỉ sửa hiển thị.
- Q7: vật tư không có `buyerId` thì gửi tin cho mọi NV mua hay chỉ thủ kho.
  - _Người dùng làm rõ:_ sẽ có 3 NV mua, mỗi người phụ trách vật tư riêng, không trùng nhau. Bản sạch 26/10 khớp: `nhan` 156,
    `nguyet` 148, `nghi` 77 vật tư. Còn 3 vật tư chưa gán người mua: `CHAN-NHOM-01/02/03` "Chân nhôm".
  - _Người dùng:_ "Chân nhôm là thanh nhôm do Nhàn mua". Lúc đầu mình hiểu sai thành "gán Nhàn làm người mua Chân nhôm" -
    **SAI, đã rút lại**. Kiểm dữ liệu:
    - `CHAN-NHOM-01/02/03` là **vật tư thành phẩm** (`steelSubGroup` = FINISHED_COMPONENT). Phôi tự cắt ra từ Thanh nhôm theo
      công thức `material_yield_recipes` (bước CAT):
      - 01 ← `SAT-015`, 161 chân/thanh;
      - 02 ← `SAT-032`, 12 chân/thanh;
      - 03 ← `SAT-033`, 193 chân/thanh.
    - Thứ được MUA là Thanh nhôm, đã gán sẵn `nhan`. Chân nhôm không bao giờ vào đề xuất mua (lọc FINISHED_COMPONENT ở
      `consumable-material-purchase.service.ts:76`), nên để trống người mua là ĐÚNG - không gán.
  - Kết luận Q7: hiện 0 vật tư MUA nào thiếu người mua, vấn đề chưa xảy ra. Đề xuất: không gửi tin cho cả 3 người; nếu thêm
    phép kiểm "Vật tư chưa có người mua phụ trách" thì phải bỏ qua FINISHED_COMPONENT (để bắt vật tư mua mới thêm sau này quên
    gán người).

**Chưa ai thử:**
- mốc 07:00 và sang ngày mới (không đổi giờ hệ thống);
- lệnh tạm dừng; mốc "Không cần" / "Chưa biết" trên bảng;
- QR tại máy; % Đan chạy thật;
- transaction giữ khoá lâu trên Prisma Postgres production (theo dõi log "Việc hằng ngày lỗi" sau deploy);
- 2 dòng mua cùng vật tư bị gộp trong tin vật tư.

Không sửa code, không commit, không push, không deploy.

### 32.28 2026-10-29 — ĐÃ SỬA HẾT theo 32.27 ("Sửa hết": P1 + P2 + Q1–Q7) + 2 vòng test lại bằng agent (local, CHƯA commit)

Người dùng: "Sửa hết" (theo đề xuất ở 32.27). Q7 làm rõ thêm: sẽ có 3 NV mua, mỗi người phụ trách vật tư riêng, không trùng; "Chân
nhôm" là vật tư thành phẩm Phôi cắt từ Thanh nhôm (Nhàn mua Thanh nhôm) - KHÔNG gán người mua cho Chân nhôm.

**Quyết định đã chốt (theo đề xuất 32.27):**
- Q1: % Khung CK = trung bình % 3 tổ (như "Theo lệnh").
- Q2: % Đan giữ "đã nhận về".
- Q3: 1 hàm hạn dùng chung cho Bảng mốc / tin sáng / "Theo dõi mua hàng" (làm phần D của 32.5).
- Q4: `DELIVERY_AT_RISK` giữ loại ALERT (không vào tab "Cần xử lý").
- Q5: phép kiểm lỗi có báo Admin.
- Q6: đơn vị sắt chỉ sửa hiển thị ("cây"), không sửa dữ liệu production.
- Q7: thêm phép kiểm "vật tư mua chưa có người mua", bỏ qua vật tư thành phẩm.
- Giữ nguyên (người dùng chốt ở 32.27): Sếp xem được `/data-health`; người bấm "Kiểm ngay" không nhận thông báo của lần đó.

**BE (`D:\DNA-ERP-BE`) - mục 1 "Kiểm tra dữ liệu" (`src/modules/data-health/`):**
- L1: `run()` giữ khoá `pg_try_advisory_xact_lock(hashtext('data-health'))` cho cả lần tự chạy lẫn "Kiểm ngay" (mọi tiến trình);
  không lấy được khoá -> 409 "Đang kiểm tra dữ liệu - thử lại sau ít phút". `createMany(skipDuplicates)`.
- L2:
  - lỗi ở bước ghi phát hiện chỉ làm phép kiểm đó -1 (lý do "CODE: ghi phát hiện - …" / "CODE: chạy SQL - …"), lần chạy vẫn xong;
  - lỗi ngoài từng phép kiểm: ghi `error` "Dừng giữa chừng: …", KHÔNG đặt `finishedAt` (việc hằng ngày còn chạy lại), vẫn báo
    Admin số dòng mới đã ghi trước đó;
  - `GET /data-health`: `lastRun` = lần ĐÃ XONG gần nhất; thêm `pendingRun` (lần mới hơn chưa xong). Chưa xong quá 10 phút mà không
    có lý do -> "Không thấy lần kiểm kết thúc - máy chủ có thể đã khởi động lại giữa chừng.";
  - lý do lưu cho Admin chỉ giữ dòng cuối của thông điệp Prisma (bỏ đường dẫn máy chủ / trích đoạn code).
- L3: chạm trần 500 dòng thì không đánh "đã hết" dòng vắng; phép kiểm vốn đã có dòng mở thì khoá mới lọt vào cửa sổ không tính
  "mới" (lần đầu chạm trần vẫn tính đủ).
- Thông báo `DATA_HEALTH_NEW_FINDINGS`:
  - số "mới" cộng dồn trong ngày (`byCheck`);
  - có "N phép kiểm lỗi" + "Lỗi khi kiểm: …" (Q5); có phép lỗi thì không resolve;
  - phép kiểm hết lỗi mà không có dòng mới -> sửa chữ thông báo đang mở, KHÔNG bật lại "chưa đọc"; lỗi y như cũ -> không gửi lại.
- Q7: phép kiểm thứ 9 `MATERIAL_WITHOUT_BUYER` "Vật tư mua chưa có người mua phụ trách" - vật tư đang hoạt động, chưa xoá,
  `buyerId` NULL, bỏ `steelSubGroup` = FINISHED_COMPONENT. Bản sạch 26/10: 0 dòng (3 mã `CHAN-NHOM-*` là vật tư thành phẩm).
- Bộ lọc lỗi P2002 (`all-exceptions.filter.ts` `uniqueTargetOf`): đọc tên cột từ lỗi của driver adapter, hết "Duplicate value
  for: undefined"; `material-groups.service.ts` dùng chung hàm này.
- Comment: controller (Sếp xem được), schema `DataHealthRun`, `data-health.checks.ts`, tham số tin vật tư ở `notification-types.ts`.
  `migration.sql` giữ nguyên (sửa sẽ đổi checksum migration).

**BE - mục 3 Bảng mốc / tin sáng / màn mua:**
- `src/common/utils/frame-deadline.util.ts`: `purchaseGroupOf` (ACCESSORY/CUSHION/PACKAGING = VT còn lại) + `purchaseDeadlineOf`:
  - VT khung & đan: hạn Mua VT khung đã lưu → hạn Khung → hạn PI (= `frameDeadlineOf` cũ);
  - VT còn lại: hạn Mua VT còn lại đã lưu → hạn Đóng gói → hạn PI.
- `milestone-board.service.ts`:
  - hạn 2 mốc mua qua `purchaseDeadlineOf`;
  - % Khung = `averagePercent` (lý do "Đã làm X% (trung bình Phôi a%, Hàn b%, Sơn c%)"), trạng thái vẫn theo cộng dồn;
  - dòng mua có `stockLengthMm` -> đơn vị "cây", tên kèm chiều dài ("Sắt hộp 6zem (5.020 mm) 12/32 cây"); nệm kèm quy cách;
  - `MissingMaterial.lineId` (id dòng đề xuất mua).
- `daily-jobs.service.ts`: tin vật tư gộp theo `lineId` (2 dòng cùng vật tư khác chiều dài / quy cách vẫn là 2 dòng); `unref()` timer.
- `purchase-proposals.service.ts` + DTO: `items[].deadline` riêng từng dòng (dây/nệm theo SKU đã chọn nó; vật tư chung theo SKU gấp
  nhất CÒN CHẠY); hạn cấp đề xuất = dòng gấp nhất (đề xuất tự tính theo PI trước đây luôn null).
- Realtime:
  - `recordProductionBatch` ("Lưu đợt" trên web) phát PROGRESS; báo QR tại máy thì không phát thêm (đã có FLOOR_REPORT);
  - `realtime.contract.ts`: thêm PRODUCTION_INVOICE vào PRODUCTION_BATCH / QC_REVIEW / FLOOR_REPORT để KHSX/Sếp nhận được.

**FE (`D:\DNA-ERP`):**
- `MilestoneBoardView.tsx`:
  - chú giải thêm "Chưa biết" (viền vàng đứt);
  - tooltip "đã về / đã nhận về / đã đóng X%", không lặp %; ô Hạn giao xong ghi "Đã đóng đủ" (cả tooltip);
  - tiêu đề khi chưa tải được: "Đang tải bảng mốc…" / "Chưa tải được bảng mốc" (không ghi "0 SKU");
  - "Tải lại" hiện "Đang tải…" tới khi chính lần gọi đó xong;
  - thẻ điện thoại: "chưa bắt đầu / tạm dừng", gộp các mốc "Chưa đặt hạn" thành 1 dòng;
  - câu chú giải nói rõ hạn dự phòng.
- `ThongKePagePlan.tsx` ("Theo lệnh"):
  - `getPurchasingPercent` làm tròn xuống (99,67% không thành 100% / "xong");
  - bỏ PI CANCELLED; nhãn "Hạn giao vật tư" → "Hạn giao hàng";
  - tự tải lại phần tiến độ theo `production-batches`, `qc-reviews`, `floor`, `steel-issues`, `weaving-issues`,
    `material-yield-issues` (gom 5 giây);
  - bảng Mua hàng ghi chiều dài cây vào tên dòng sắt.
- `services/purchasing-api.ts`: dòng có `stockLengthMm` -> đơn vị "cây" (1 chỗ cho mọi màn mua / nhập kho); map `items[].deadline`.
- `TheoDoiMuaHangPage.tsx`: cột Hạn giao dùng hạn từng dòng; màu: đã trễ đỏ, hôm nay vàng, còn hạn chữ thường.
- `DataHealthSection.tsx` + `data-health-api.ts`: băng "đang kiểm" / "dừng giữa chừng" theo `pendingRun`; mô tả nhắc người mua phụ trách.
- Hướng dẫn: bài "Bảng mốc" chuyển sang nhóm "Kế hoạch sản xuất" (bổ sung "Chưa biết", hạn dự phòng, % Khung trung bình, tin
  riêng từng người, cảnh báo chỉ báo lại khi sang ngày mới); bài Admin thêm phép kiểm thứ 9; bài Mua hàng ("Theo dõi mua hàng") và
  Thủ kho ("Nhập kho") thêm ý tin sáng / hạn từng dòng.

**Ảnh hưởng nên biết:**
- Mốc "Mua VT còn lại" trước đây chưa lưu ngày thì không báo trễ; nay lấy hạn Đóng gói / hạn PI nên báo trễ nhiều hơn. Trên dữ liệu
  test của agent 2 (4 SKU): 11 mốc trễ thay vì 9, tin sáng thêm 4 dòng (bulon, thùng, bao nylon) - đều là hàng thật chưa về.
- Giới hạn có từ trước, CHƯA sửa: dòng mua phụ kiện / bao bì gộp theo PI, không gắn SKU - PI 2 SKU có ngày đóng gói khác nhau thì
  SKU đóng sớm có thể "Trễ" vì bao bì của SKU kia (muốn sửa phải truy dòng mua về SKU qua định mức).
- Hạn dự phòng cuối là `ProductionInvoice.deadline` - nếu hạn PI không được cập nhật (gọi API `items-deadlines` không kèm
  `deadline`) thì có thể cũ hơn hạn giao của SKU; form "Sửa thời hạn" có gửi nên ít gặp.
- Thông báo `floor` / `qc-reviews` / `production-batches` nay tới mọi người có PRODUCTION_INVOICE:VIEW (cả Mua hàng, thủ kho) - chỉ
  là tên topic, màn không đăng ký thì không tải lại.

**Kiểm tra:**
- BE:
  - jest các module đổi 125/125 (vòng cuối) - trước đó 406/406 và 240/240 ở các bước giữa;
  - `nest build` OK; eslint các file đổi sạch (còn 1 cảnh báo `any` có từ HEAD ở `notification-types.ts`); đã chạy prettier BE trên
    các file đổi (BE có `.prettierrc`, HEAD sạch prettier);
  - toàn bộ 2151/2155: 1 bỏ qua, 3 hỏng là test đo thời gian của bộ giải (`optimize-material.spec.ts`, `propose.spec.ts`) khi máy đang
    chạy stack test của agent - chạy riêng 14/14 và 8/8 đạt.
- FE: `tsc` 0 lỗi; eslint chỉ 3 cảnh báo cũ của `ThongKePagePlan.tsx`; vitest 262/262. Không chạy prettier FE.
- Agent quản lý rà code (chỉ đọc): mọi điểm P1/P2/Q1–Q7 đúng ý; tìm thêm N1–N6 + lặt vặt -> đã sửa N1 (QR không phát PROGRESS), N3
  (bỏ SKU đã Kết thúc), N4 ("Tải lại"), N5 (lần chưa xong quá hạn), báo Admin khi dừng giữa chừng, comment, đơn vị "cây" ở "Lệnh mua
  NCC" / "Nhập kho"; N2 (phép kiểm 9 quét cả danh mục) giữ nguyên vì bản sạch ra 0 dòng; N6 là giới hạn ở trên.
- Agent 1 vòng 2 (DB `dna_erp_t1`, BE 3011 + 3012):
  - ĐẠT: quyền; 1 lần CRON khi 2 tiến trình; "Kiểm ngay" khi tiến trình kia đang giữ khoá -> 409 đúng chữ, 0 dòng MANUAL dở, 0 lỗi
    unique; API thường không treo; P2002 ra "checkCode, entityKey"; lỗi bước ghi -> -1, lần chạy xong, thông báo có "phép kiểm
    lỗi"; dừng giữa chừng -> `pendingRun` có lý do, `lastCount` giữ số thật; Q5; cộng dồn 1 → 11 → 12; Q7 (chỉ bắt vật tư mua);
    hồi quy lịch hằng ngày.
  - Còn R2-1 (L3 "mới" giả), R2-2 (thông báo còn ghi "phép kiểm lỗi" sau khi hết lỗi), R2-3 (lý do dài) -> ĐÃ SỬA sau vòng này
    (unit test), chưa chạy thật lại.
- Agent 2 vòng 2 (DB `dna_erp_t2`, BE 3021, FE 3100, 3 PI / 4 SKU MEYING):
  - ĐẠT: Bảng mốc của KHSX tự tải lại sau "Lưu đợt" / KCS chấm; % Khung 2 màn bằng nhau; hạn từng dòng ở "Theo dõi mua hàng" khớp
    Bảng mốc và tin sáng (cả dây riêng SKU); hạn dự phòng; "cây" + 2 dòng khác chiều dài; B5–B8; UX; Hướng dẫn; người nhận / không
    trùng / vòng đời / link / quyền.
  - Còn: "Theo lệnh" không tự cập nhật, "Mm" ở bảng Mua hàng "Theo lệnh", tooltip "Xong", màu hạn hôm nay -> ĐÃ SỬA sau vòng này.
- Agent 2 vòng 3 (stack t2 dựng lại, `dist` có mọi bản sửa trên):
  - ĐẠT:
    - "Theo lệnh" của KHSX tự cập nhật sau "Lưu đợt" / KCS chấm (5–6 s);
    - "cây" ở bảng Mua hàng "Theo lệnh" (2 dòng 5.020 / 6.000 mm tách rõ), "Nhập kho", "Lệnh mua NCC";
    - "Tải lại" khi tắt BE: 2 lần liền đều "Đang tải…" rồi băng đỏ, không kẹt;
    - tooltip "Đã đóng đủ"; màu hạn ở chi tiết "Theo dõi mua hàng" (trễ đỏ, hôm nay vàng, còn hạn thường);
    - sau khi B Kết thúc, hạn dòng chung theo A, khớp Bảng mốc, dây của B giữ hạn B;
    - Admin băng vàng "đang chạy" / băng đỏ "dừng giữa chừng" (quá 10 phút), thẻ thứ 9 "Ổn";
    - hồi quy người nhận / không trùng / vòng đời.
  - Còn 3 điểm nhỏ -> ĐÃ SỬA sau vòng này (chưa chạy thật lại):
    - cột Deadline ở màn danh sách "Theo dõi mua hàng" vẫn luôn đỏ và in "3/11/2026" -> dùng cùng màu + dạng dd/MM/yyyy;
    - hạn cấp đề xuất bị dây của SKU đã Kết thúc kéo về hạn cũ (hiện ở đầu "Nhập kho") -> bỏ dòng chỉ thuộc SKU đã Kết thúc;
    - thẻ thứ 9 (Trung bình) đứng sau thẻ mức Thấp -> đưa lên trước.
  - Chưa test được: báo QR tại máy (cần LAN / điện thoại công nhân).
- Sau các sửa cuối: jest các module đổi 139/139; `nest build` OK; FE `tsc` 0 lỗi; eslint sạch. BE `be-3001-dist` của người dùng khởi
  động lại bằng bản build mới.

**Còn lại / lưu ý:**
- Chưa ai thử thật: mốc 07:00 và sang ngày mới; QR tại máy; % Đan đã nhận một phần; transaction giữ khoá lâu trên Prisma Postgres
  production (2 transaction mở cùng lúc lúc tự chạy - theo dõi log "Việc hằng ngày lỗi" sau deploy).
- `.claude/launch.json` (chưa track) có thêm 4 cấu hình test `be-3011-t1`, `be-3012-t1`, `be-3021-t2`, `fe-3100-t2`.
- Không commit, không push, không deploy.

### 32.29 2026-10-30 — Đã STAGE BE + FE của mục 1 và mục 3 (KHÔNG commit) + ghi chú deploy

Người dùng: "hãy đưa xuống FE và BE staged cho tôi, không tự commit, cho tôi description và title, nếu commit xong chạy CI và lên
production thì có cần chạy tay gì để cho production chạy bình thường mục 1 và 3 này không".

**Đã stage (người dùng tự commit):**
- BE `D:\DNA-ERP-BE` - 29 file:
  - `prisma/schema.prisma`, migration `20261028100000_add_data_health`;
  - `src/app.module.ts`;
  - module mới `src/modules/data-health`, `src/modules/daily-jobs`, `src/modules/milestone-board`;
  - `src/common/utils/frame-deadline.util.ts`, `src/common/filters/all-exceptions.filter.ts` (+ spec mới);
  - `src/modules/notifications/notification-types.ts`, `src/realtime/realtime.contract.ts`;
  - `src/modules/production-batches/production-batches.service.ts` (+ spec);
  - `src/modules/purchase-proposals/purchase-proposals.service.ts` (+ spec, DTO);
  - `src/modules/material-groups/material-groups.service.ts`;
  - changelog này.
- FE `D:\DNA-ERP` - 13 file:
  - mới: `Admin/DataHealthSection.tsx`, `Manufacturing/MilestoneBoardView.tsx`, `services/data-health-api.ts`,
    `services/milestone-board-api.ts`;
  - sửa: `Admin/SystemStatusPage.tsx`, `Manufacturing/ThongKePagePlan.tsx`, `Purchasing/TheoDoiMuaHangPage.tsx`,
    `services/purchasing-api.ts`, `context/InspectionContext.tsx`, Guide `admin.ts`, `productionPlan.ts`, `purchasing.ts`,
    `warehouse.ts`.
- Kiểm trước khi stage:
  - eslint `--quiet` toàn bộ `src/**/*.ts` BE: 0 lỗi (CI chạy `lint:check`);
  - mọi import tương đối trong file đã stage đều trỏ tới file đã có trong index (trừ `src/generated/prisma`, do CI tự chạy
    `prisma generate`);
  - migration mới nhất trong repo là `20261028100000_add_data_health`.

**KHÔNG stage (để nguyên, không thuộc mục 1/3):**
- BE: `.claude/`, `CLAUDE.md`, `start-dev.bat`, `test/solver-real-data-new/`, các PDF/XLSX báo cáo solver, `docs/business*`, các
  changelog khác chưa track (`changelog-2026-10-17…`, `-10-19…`, `-10-20…`, `-10-28-e2e…`, `-10-28-tai-lieu…`),
  `docs/doi-chieu-du-lieu-2026-10-29.md`.
- FE: `.env.example` bị xoá (có từ trước, changelog 06/10), `docs/quy-doi-doan-phoi.md`, `e2e/golden-path.spec.ts`,
  `next-env.d.ts`, `e2e/full-flow.spec.ts`, `e2e/helpers.ts`, `playwright.nows.config.ts`, `pnpm-*.yaml`, docs chưa track.
- FE `Guide/content/manufacturing.ts` hiện "M" chỉ vì ký tự xuống dòng (nội dung giống HEAD sau khi chuyển bài "Bảng mốc" đi) -
  không cần stage.

**Deploy - KHÔNG cần chạy tay gì:**
- BE (Render, `docker/entrypoint.js`) tự chạy `prisma migrate deploy` trước khi bật app, nên tự tạo 2 bảng `data_health_runs` /
  `data_health_findings`.
- Không thêm biến môi trường hay secret nào. Không cần `DATA_HEALTH_CRON_KEY` hay lịch GitHub (đã bỏ ở 32.25). Muốn tắt việc hằng
  ngày thì đặt `DAILY_JOBS=off`.
- Không cần seed: dùng quyền có sẵn `SYSTEM_CONFIG` (Kiểm tra dữ liệu) và `PRODUCTION_INVOICE` (Bảng mốc); loại thông báo khai trong
  code.
- FE (Vercel) không đổi biến môi trường.
- Nên deploy BE trước hoặc cùng lúc FE: FE mới gọi `/milestone-board`, `/data-health`. FE chạy trước BE thì 2 màn này tạm báo lỗi tới
  khi BE lên; các trường mới (`items[].deadline`, `pendingRun`) là tuỳ chọn nên màn cũ không vỡ.

**Sau deploy nên xem (không bắt buộc):**
- Admin > Tình trạng hệ thống > "Kiểm tra dữ liệu": 9 thẻ, bấm "Kiểm ngay" được.
- KHSX > Tổng hợp lệnh SX > "Bảng mốc": mở được; trống vì production chưa có PI.
- Log Render: không có "Việc hằng ngày lỗi" / "Data health check … failed" (rủi ro H3: transaction giữ khoá lâu trên Prisma Postgres
  production chưa thử).

**Lưu ý vận hành:**
- Render gói free ngủ khi không có request: việc hằng ngày chỉ chạy lúc máy chủ thức (60 giây sau khi thức, rồi 10 phút 1 lần). Tin
  sáng gửi sau 07:00 VN ở lần thức đầu tiên trong ngày, không đúng 07:00 nếu không ai mở app.
- Chưa có PI thì không có tin sáng / cảnh báo hạn giao nào; "Kiểm tra dữ liệu" lần đầu dự kiến 0 bất thường (bản sạch 26/10: 0 dòng
  cả 9 phép kiểm).
- `docker/entrypoint.js`: khi `migrate deploy` kẹt P1002 thì ngắt MỌI phiên đang giữ advisory lock. Comment ở đó ghi "app không dùng
  advisory lock", nay không còn đúng (từ trước đã có `lockBusinessKey`, nay thêm khoá việc hằng ngày / kiểm tra dữ liệu). Chỉ xảy ra
  ở nhánh P1002 hiếm gặp; bị ngắt thì app chỉ ghi lỗi và chạy lại lượt sau. Chưa sửa (ngoài phạm vi).
- CI có test đo thời gian 20 s của bộ giải (`optimize-material.spec.ts`, `propose.spec.ts`), có thể chậm trên máy CI - có từ trước;
  hỏng thì chạy lại job.

**Ngoài lề:** sáng 30/10 Docker Desktop đang tắt (container Postgres local không chạy), BE 3001 / FE 3000 local cũng không chạy - không
ảnh hưởng việc stage.

Không commit, không push, không deploy.
