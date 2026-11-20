import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BookingQueryDto } from '../../modules/bookings/dto/booking-query.dto';
import { BatchStockLengthsQueryDto } from '../../modules/cutting-proposals/dto/cutting-batch-candidate.dto';
import { ConfirmIssueSlipDto } from '../../modules/issue-slips/dto/issue-slip.dto';
import { ListDeadlineBatchesQueryDto } from '../../modules/production-invoices/deadline-changes/dto/deadline-change.dto';
import { RecordTransferCheckDto } from '../../modules/production-invoices/dto/record-transfer-check.dto';
import { UpdateTransferCheckDefectPhotoDto } from '../../modules/production-invoices/dto/update-transfer-check-defect-photo.dto';
import { ListPurchaseProposalsQueryDto } from '../../modules/purchase-proposals/dto/list-purchase-proposals-query.dto';
import { OverReceiptStatsQueryDto } from '../../modules/purchase-proposals/dto/purchase-receipt.dto';
import { CreateQcReviewDto } from '../../modules/qc-reviews/dto/create-qc-review.dto';
import { CreateSteelIssueQcReviewDto } from '../../modules/qc-reviews/dto/create-steel-issue-qc-review.dto';
import { UpdateQcReviewPhotoDto } from '../../modules/qc-reviews/dto/update-qc-review-photo.dto';
import { UpdateSalesOrderDto } from '../../modules/sales-orders/dto/update-sales-order.dto';
import { CreateSupplierDto } from '../../modules/suppliers/dto/create-supplier.dto';
import { flattenValidationErrors } from '../pipes/validation-exception.factory';

/** Giống ValidationPipe ở main.ts: ép kiểu ngầm bật, whitelist + forbidNonWhitelisted. */
async function check<T extends object>(cls: new () => T, plain: object): Promise<string[]> {
  const inst = plainToInstance(cls, plain, { enableImplicitConversion: true });
  const errors = await validate(inst, { whitelist: true, forbidNonWhitelisted: true });
  return flattenValidationErrors(errors);
}
function instOf<T extends object>(cls: new () => T, plain: object): T {
  return plainToInstance(cls, plain, { enableImplicitConversion: true });
}

const OK = 'https://res.cloudinary.com/demo-cloud/image/upload/v1700000000/dna-erp/abc123.jpg';
const BAD = 'javascript:alert(1)';

describe('DTO đầu vào - T1-8 / T4-10 / T2-5', () => {
  const old = process.env.CLOUDINARY_CLOUD_NAME;
  beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
  });
  afterAll(() => {
    if (old === undefined) delete process.env.CLOUDINARY_CLOUD_NAME;
    else process.env.CLOUDINARY_CLOUD_NAME = old;
  });

  describe('T1-8 ảnh bằng chứng KCS / chuyền kiểm', () => {
    it('UpdateQcReviewPhotoDto: sai -> 1 câu; đúng, null, bỏ trống, rỗng -> qua', async () => {
      const errs = await check(UpdateQcReviewPhotoDto, { photoUrl: BAD });
      expect(errs).toHaveLength(1);
      expect(errs[0]).toMatch(/^Ảnh phải là tệp đã tải lên hệ thống/);
      expect(await check(UpdateQcReviewPhotoDto, { photoUrl: OK })).toEqual([]);
      expect(await check(UpdateQcReviewPhotoDto, { photoUrl: null })).toEqual([]);
      expect(await check(UpdateQcReviewPhotoDto, {})).toEqual([]);
      expect(await check(UpdateQcReviewPhotoDto, { photoUrl: '' })).toEqual([]);
    });

    it('UpdateTransferCheckDefectPhotoDto', async () => {
      expect(
        await check(UpdateTransferCheckDefectPhotoDto, { imageUrl: '/uploads/a.png' }),
      ).toHaveLength(1);
      expect(await check(UpdateTransferCheckDefectPhotoDto, { imageUrl: OK })).toEqual([]);
      expect(await check(UpdateTransferCheckDefectPhotoDto, { imageUrl: null })).toEqual([]);
    });

    it('CreateQcReviewDto / CreateSteelIssueQcReviewDto', async () => {
      expect(await check(CreateQcReviewDto, { failedQty: 0, photoUrl: BAD })).toHaveLength(1);
      expect(await check(CreateQcReviewDto, { failedQty: 0, photoUrl: OK })).toEqual([]);
      const errs = await check(CreateSteelIssueQcReviewDto, {
        segments: [],
        photoUrl: 'https://evil.example/a.jpg',
      });
      expect(errs.some((e) => e.startsWith('Ảnh phải là tệp'))).toBe(true);
      expect(await check(CreateSteelIssueQcReviewDto, { segments: [], photoUrl: OK })).toEqual([]);
    });

    it('RecordTransferCheckDto: defects[1].imageUrl sai -> "Dòng 2:"', async () => {
      const errs = await check(RecordTransferCheckDto, {
        pieceId: '1',
        checkedQty: 2,
        defects: [
          { reason: 'a', imageUrl: OK },
          { reason: 'b', imageUrl: BAD },
        ],
      });
      expect(
        errs.some((e) => e.startsWith('Dòng 2:') && e.includes('tệp đã tải lên hệ thống')),
      ).toBe(true);
    });

    it('không đặt CLOUDINARY_CLOUD_NAME -> từ chối URL không rỗng', async () => {
      delete process.env.CLOUDINARY_CLOUD_NAME;
      try {
        expect(await check(UpdateQcReviewPhotoDto, { photoUrl: OK })).toHaveLength(1);
      } finally {
        process.env.CLOUDINARY_CLOUD_NAME = 'demo-cloud';
      }
    });
  });

  describe('T4-10 ConfirmIssueSlipDto.signedSlipUrls', () => {
    it('một giá trị sai -> 400 cả lô; đúng -> qua; khoảng trắng -> qua (service báo câu cũ)', async () => {
      const bad = await check(ConfirmIssueSlipDto, {
        signedSlipUrls: ['/uploads/qa1911-fake.png'],
      });
      expect(bad).toHaveLength(1);
      expect(bad[0]).toMatch(/^Mỗi giá trị trong ảnh phiếu đã ký phải là tệp đã tải lên hệ thống/);
      expect(
        await check(ConfirmIssueSlipDto, { signedSlipUrls: [OK, 'https://evil.example/a.jpg'] }),
      ).toHaveLength(1);
      expect(await check(ConfirmIssueSlipDto, { signedSlipUrls: [OK] })).toEqual([]);
      expect(await check(ConfirmIssueSlipDto, { signedSlipUrls: ['  '] })).toEqual([]);
    });
  });

  describe('T2-5 kiểu tham số', () => {
    it('activeOnly: abc -> 400; false -> false; true -> true', async () => {
      const errs = await check(ListPurchaseProposalsQueryDto, { activeOnly: 'abc' });
      expect(errs).toHaveLength(1);
      expect(errs[0]).toContain('đúng/sai');
      expect(instOf(ListPurchaseProposalsQueryDto, { activeOnly: 'false' }).activeOnly).toBe(false);
      expect(instOf(ListPurchaseProposalsQueryDto, { activeOnly: 'true' }).activeOnly).toBe(true);
      expect(instOf(ListPurchaseProposalsQueryDto, {}).activeOnly).toBeUndefined();
    });

    it('includeCancelled: 1 / false / abc', async () => {
      expect(instOf(BookingQueryDto, { includeCancelled: '1' }).includeCancelled).toBe(true);
      expect(instOf(BookingQueryDto, { includeCancelled: 'false' }).includeCancelled).toBe(false);
      expect(await check(BookingQueryDto, { includeCancelled: 'abc' })).toHaveLength(1);
    });

    it('mine: false không lọc; abc -> 400', async () => {
      expect(instOf(ListDeadlineBatchesQueryDto, { mine: 'false' }).mine).toBe(false);
      expect(instOf(ListDeadlineBatchesQueryDto, { mine: '1' }).mine).toBe(true);
      expect(await check(ListDeadlineBatchesQueryDto, { mine: 'abc' })).toHaveLength(1);
    });

    it('deepVerify: abc -> 400; false -> false', async () => {
      expect(await check(BatchStockLengthsQueryDto, { deepVerify: 'abc' })).toHaveLength(1);
      expect(instOf(BatchStockLengthsQueryDto, { deepVerify: 'false' }).deepVerify).toBe(false);
      expect(instOf(BatchStockLengthsQueryDto, { deepVerify: 'true' }).deepVerify).toBe(true);
    });

    it('CreateSupplierDto.isActive: chuỗi -> 400; false -> qua', async () => {
      expect(await check(CreateSupplierDto, { name: 'A', isActive: 'abc' })).toHaveLength(1);
      expect(await check(CreateSupplierDto, { name: 'A', isActive: 'true' })).toHaveLength(1);
      expect(await check(CreateSupplierDto, { name: 'A', isActive: 'yes' })).toHaveLength(1);
      expect(await check(CreateSupplierDto, { name: 'A', isActive: false })).toEqual([]);
    });

    it('UpdateSalesOrderDto: note số -> "phải là chữ"; depositConfirmed abc -> 400; hợp lệ -> qua', async () => {
      const errs = await check(UpdateSalesOrderDto, { note: 123 });
      expect(errs).toEqual(expect.arrayContaining([expect.stringMatching(/phải là chữ/)]));
      expect(await check(UpdateSalesOrderDto, { depositConfirmed: 'abc' })).toHaveLength(1);
      expect(await check(UpdateSalesOrderDto, { isActive: 'abc' })).toHaveLength(1);
      expect(await check(UpdateSalesOrderDto, { note: 'abc' })).toEqual([]);
      expect(await check(UpdateSalesOrderDto, { depositConfirmed: true })).toEqual([]);
      expect(await check(UpdateSalesOrderDto, { isActive: false })).toEqual([]);
    });

    it('OverReceiptStatsQueryDto: to < from -> 400; bằng nhau / một đầu -> qua', async () => {
      expect(
        await check(OverReceiptStatsQueryDto, { from: '2026-12-31', to: '2026-01-01' }),
      ).toEqual(['Ngày bắt đầu phải trước hoặc bằng ngày kết thúc']);
      expect(
        await check(OverReceiptStatsQueryDto, { from: '2026-01-01', to: '2026-01-01' }),
      ).toEqual([]);
      expect(await check(OverReceiptStatsQueryDto, { from: '2026-01-01' })).toEqual([]);
      expect(await check(OverReceiptStatsQueryDto, { to: '2026-01-01' })).toEqual([]);
    });
  });
});
