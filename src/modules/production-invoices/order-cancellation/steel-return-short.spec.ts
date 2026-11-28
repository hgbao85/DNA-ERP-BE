/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument -- mock prisma dạng jest.fn */
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SteelReturnStatus } from '../../../generated/prisma/client';
import { OrderCancellationService } from './order-cancellation.service';
import {
  barsLeftCutTeamById,
  outstandingShortById,
  type SteelReturnBarsRow,
} from './steel-return.util';

/**
 * Lỗi 1 chạy thử huỷ lệnh (báo 28/11/2026): QLSX ghi trả 6 cây, thủ kho Phôi xác nhận 5 - trước đây tổ cắt vẫn bị trừ 6 (mọi chỗ
 * tính lấy số QLSX ghi), cây chênh mất khỏi sổ, không ai được báo. Nghiệp vụ chốt phương án a: phần chênh vẫn tính còn ở tổ cắt,
 * báo QLSX đi tìm - tìm thấy thì ghi trả thêm, không thấy thì xác nhận mất.
 */
const row = (over: Partial<SteelReturnBarsRow> = {}): SteelReturnBarsRow => ({
  id: 1n,
  status: SteelReturnStatus.CONFIRMED,
  bars: 6,
  confirmedBars: 5,
  makeupForId: null,
  shortLostAt: null,
  ...over,
});

describe('steel-return.util - số cây đã rời tổ cắt', () => {
  it('dòng chờ xác nhận: tính theo số QLSX ghi (cây đã đem ra)', () => {
    const r = row({ status: SteelReturnStatus.PENDING, confirmedBars: null });
    expect(barsLeftCutTeamById([r]).get('1')).toBe(6);
    expect(outstandingShortById([r]).size).toBe(0);
  });

  it('xác nhận 5/6: tổ chỉ bị trừ 5, phần thiếu 1 còn treo', () => {
    expect(barsLeftCutTeamById([row()]).get('1')).toBe(5);
    expect(outstandingShortById([row()]).get('1')).toBe(1);
  });

  it('dòng cũ trước 28/11 (CONFIRMED, confirmedBars null) = đủ số ghi', () => {
    const r = row({ confirmedBars: null });
    expect(barsLeftCutTeamById([r]).get('1')).toBe(6);
    expect(outstandingShortById([r]).size).toBe(0);
  });

  it('ghi trả thêm 1 cây (chờ xác nhận): tổng rời tổ 6, hết thiếu', () => {
    const makeup = row({
      id: 2n,
      status: SteelReturnStatus.PENDING,
      bars: 1,
      confirmedBars: null,
      makeupForId: 1n,
    });
    const left = barsLeftCutTeamById([row(), makeup]);
    expect((left.get('1') ?? 0) + (left.get('2') ?? 0)).toBe(6);
    expect(outstandingShortById([row(), makeup]).size).toBe(0);
  });

  it('dòng ghi trả thêm lại bị đếm thiếu: thiếu chuyển sang dòng mới, dòng gốc hết thiếu', () => {
    const makeup = row({ id: 2n, bars: 1, confirmedBars: 0, makeupForId: 1n });
    const out = outstandingShortById([row(), makeup]);
    expect(out.get('1')).toBeUndefined();
    expect(out.get('2')).toBe(1);
  });

  it('xác nhận mất: phần thiếu còn treo rời tổ (hao hụt), không tính trùng phần đã ghi trả thêm', () => {
    const lostAll = row({ bars: 6, confirmedBars: 4, shortLostAt: new Date() });
    expect(barsLeftCutTeamById([lostAll]).get('1')).toBe(6);
    const partly = row({ bars: 6, confirmedBars: 4, shortLostAt: new Date() });
    const makeup = row({
      id: 2n,
      status: SteelReturnStatus.PENDING,
      bars: 1,
      confirmedBars: null,
      makeupForId: 1n,
    });
    const left = barsLeftCutTeamById([partly, makeup]);
    expect((left.get('1') ?? 0) + (left.get('2') ?? 0)).toBe(6);
    expect(outstandingShortById([partly, makeup]).size).toBe(0);
  });
});

describe('OrderCancellationService - ghi trả thêm / xác nhận mất / báo thiếu', () => {
  function make(rows: SteelReturnBarsRow[]) {
    const created: any[] = [];
    const updated: any[] = [];
    const tx: any = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      steelReturn: {
        findMany: jest.fn().mockResolvedValue(rows),
        create: jest.fn((a: any) => {
          created.push(a.data);
          return Promise.resolve({});
        }),
        update: jest.fn((a: any) => {
          updated.push(a);
          return Promise.resolve({});
        }),
      },
    };
    const prisma: any = {
      steelReturn: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1n,
          cancelRequestId: 9n,
          productionInvoiceId: 89n,
          materialId: 5n,
          lengthMm: 6000,
          warehouseId: 3n,
          bars: 6,
        }),
      },
      $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
    };
    const notifications = { emit: jest.fn(), resolve: jest.fn().mockResolvedValue(undefined) };
    const svc = new OrderCancellationService(
      prisma,
      {} as never,
      notifications as never,
      { publishEntityChanged: jest.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    jest.spyOn(svc, 'listCutSteel').mockResolvedValue([]);
    return { svc, created, updated, notifications };
  }
  const actor = { id: 'qlsx', roles: [] } as any;

  it('ghi trả thêm: tạo dòng mới chờ thủ kho xác nhận, trỏ về dòng thiếu; đủ thì đóng thông báo', async () => {
    const { svc, created, notifications } = make([row()]);
    await svc.makeupSteelReturn(actor, '1', 1);
    expect(created).toEqual([
      expect.objectContaining({
        bars: 1,
        makeupForId: 1n,
        status: SteelReturnStatus.PENDING,
        productionInvoiceId: 89n,
        lengthMm: 6000,
      }),
    ]);
    expect(notifications.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'STEEL_RETURN', entityId: '1' }),
    );
  });

  it('ghi trả thêm quá phần thiếu -> 400, không tạo dòng', async () => {
    const { svc, created } = make([row()]);
    await expect(svc.makeupSteelReturn(actor, '1', 2)).rejects.toBeInstanceOf(BadRequestException);
    expect(created).toHaveLength(0);
  });

  it('xác nhận mất: ghi lý do, đóng thông báo; không còn thiếu thì 409', async () => {
    const { svc, updated, notifications } = make([row()]);
    await svc.markSteelReturnLost(actor, '1', ' Tìm không thấy ');
    expect(updated[0].data).toEqual(
      expect.objectContaining({ shortLostById: 'qlsx', shortLostNote: 'Tìm không thấy' }),
    );
    expect(notifications.resolve).toHaveBeenCalled();

    const done = make([row({ confirmedBars: 6 })]);
    await expect(done.svc.markSteelReturnLost(actor, '1', 'x x x')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
