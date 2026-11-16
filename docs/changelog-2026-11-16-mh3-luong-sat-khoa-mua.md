# 16/11/2026 - MH3 luồng sắt: duyệt phương án cắt khoá đề xuất mua trước khoá tồn

Sửa nốt mục MH3 của rà soát Mua hàng + Kho 14/11 (nhóm A). Nhóm A đã sửa 3 nguồn mua ngoài sắt; luồng sắt nằm ở mục "Chưa làm" của `changelog-2026-11-14-nhom-a-tinh-lai-mua.md`.

## Vì sao

- `CuttingProposalsService.approve()` tính lại dòng mua sắt dưới khoá `purchase-proposal-merge:<pi>`, nhưng không giữ `purchase-proposal-mutate:<đề xuất>`. Khoá mutate là khoá chung của:
  - Giám đốc ký đơn;
  - đơn đặt hàng;
  - nhận hàng;
  - đóng phần thiếu.
- Lượt duyệt đọc dòng mua khi chưa khoá rồi mới ghi. Dòng được ký xen vào giữa hai bước đó vẫn bị coi là chưa ký, nên bị ghi đè `buyQty` và xoá `orderQty`.
- Không thể thêm khoá mutate ngay chỗ khoá merge cũ. Chỗ đó nằm SAU khoá `stock_quant`, còn nhận hàng lấy mutate trước rồi mới khoá `stock_quant`, nên hai bên sẽ khoá chéo.

## Thay đổi (`cutting-proposals.service.ts`)

- Hàm mới `lockOpenPurchaseProposal(tx, pi)`:
  - khoá merge theo PI;
  - gọi `findOpenProposalForRecompute()` để khoá mutate đề xuất còn mở và đọc lại các dòng sau khoá.
- `approve()` gọi hàm này ngay ĐẦU transaction, khi phương án có dòng phải mua và có PI. Bước này chạy trước:
  - khoá dòng phương án;
  - nhả giữ chỗ của phương án cũ;
  - khoá `stock_quant`.
- Bước gộp dòng mua dùng đúng đề xuất đã đọc sau khoá. Đoạn khoá merge và tìm đề xuất cũ đã bỏ.
- Thứ tự khoá nay giống 3 nguồn mua ngoài sắt: merge → mutate → `stock_quant` → giữ chỗ.
- Nếu đề xuất vừa đóng hẳn (PURCHASED) trong khoảng giữa lúc tìm và lúc khoá, lượt duyệt coi như PI không có đề xuất mở và tạo đề xuất mới như trước, không ghi dòng mới vào đề xuất đã đóng.
  - Kiểm tra này chỉ nằm ở luồng sắt; hàm dùng chung `purchase-proposal-lock.util.ts` giữ nguyên.
- Hệ quả phụ: 2 lượt duyệt cùng PI (cùng có dòng phải mua) nay xếp hàng ngay từ khoá merge. Vì vậy không còn trường hợp hai lượt khoá dòng phương án của nhau ở bước đánh SUPERSEDED.

## Kiểm tra

- `cutting-proposals.service.spec.ts`: 194 test đạt.
  - 9 test gộp vào đề xuất có sẵn chuyển sang giả lập 2 lần đọc (lấy id, rồi đọc lại sau khoá) qua helper `mockOpenPurchaseProposal`.
  - Test mới 1: khoá merge rồi mới tới mutate, cả hai đều trước câu khoá `cutting_proposals` và `stock_quant`. Lần đọc trước khoá thấy dòng còn NEW, đọc lại sau khoá thì dòng đã ký. Kết quả: dòng đã ký giữ nguyên, phần chênh thành dòng kế hoạch mới.
  - Test mới 2: đề xuất vừa đóng trước khi kịp khoá thì tạo đề xuất mới.
  - Đã thử tạm bỏ bước kiểm đề xuất đã đóng: test mới 2 báo đỏ đúng như mong đợi. Sau đó code đã trả về nguyên trạng.
- tsc chỉ còn 2 lỗi cũ ở `prisma/seed-*`. eslint và prettier sạch trên 2 file đã sửa.
- Chưa thử trên Postgres thật với 2 luồng chạy song song. `approve()` chưa có test tích hợp.

## Lưu ý

- Không có migration, không đổi cấu hình; deploy như thường lệ.
- Lượt duyệt nay giữ khoá merge từ đầu transaction, không còn từ giữa chừng như trước. 3 nguồn mua ngoài sắt của cùng PI vẫn chờ lượt duyệt xong như trước, chỉ là bắt đầu chờ sớm hơn. Trần 15 giây của transaction không đổi.
- Hàm dùng chung `findOpenProposalForRecompute()` vẫn chưa kiểm lại trạng thái sau khoá. Nếu đề xuất vừa đóng hẳn, 3 nguồn mua ngoài sắt sẽ thêm dòng vào chính đề xuất đó (mở lại nó) thay vì tạo đề xuất mới. Việc này thuộc phần mua ngoài sắt, nêu ở đây để xử lý bên đó.
