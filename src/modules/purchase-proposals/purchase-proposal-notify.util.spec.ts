import { PurchaseProposalStatus } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  notifyPurchaseDemandDropped,
  notifyPurchaseProposalCreated,
} from './purchase-proposal-notify.util';

describe('notifyPurchaseProposalCreated - người nhận theo người mua (N-4)', () => {
  const run = async (buyers: (string | null)[]) => {
    const prisma = {
      purchaseProposal: {
        findUnique: jest.fn().mockResolvedValue({
          id: 7n,
          status: PurchaseProposalStatus.NEW,
          productionInvoice: { code: 'PI-2026-038' },
        }),
      },
      purchaseProposalItem: {
        findMany: jest.fn().mockResolvedValue(buyers.map((buyerId) => ({ material: { buyerId } }))),
      },
    };
    const notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    await notifyPurchaseProposalCreated(
      prisma as unknown as PrismaServiceType,
      notifications as unknown as NotificationsService,
      7n,
    );
    return notifications.emit;
  };

  it('mọi vật tư còn chờ đều có người mua -> gửi buyerIds (không trùng)', async () => {
    const emit = await run(['u-a', 'u-b', 'u-a']);
    expect(emit).toHaveBeenCalledWith(
      'PURCHASE_PROPOSAL_CREATED',
      expect.objectContaining({
        params: { piCode: 'PI-2026-038', count: 3, buyerIds: ['u-a', 'u-b'] },
      }),
    );
  });

  it('có vật tư chưa giao người mua -> KHÔNG gửi buyerIds (báo cả nhóm Mua hàng như cũ)', async () => {
    const emit = await run(['u-a', null]);
    expect(emit).toHaveBeenCalledWith(
      'PURCHASE_PROPOSAL_CREATED',
      expect.objectContaining({ params: { piCode: 'PI-2026-038', count: 2 } }),
    );
  });

  it('không còn vật tư chờ -> không phát', async () => {
    const emit = await run([]);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('notifyPurchaseDemandDropped - nhu cầu giảm dưới số đã ký (câu 3 với người A)', () => {
  const run = async (input: { neededQty: number; signedQty: number }, buyerId: string | null) => {
    const prisma = {
      productionInvoice: { findUnique: jest.fn().mockResolvedValue({ code: 'PI-2026-031' }) },
      material: {
        findUnique: jest.fn().mockResolvedValue({ code: 'SAT-001', unit: 'cây', buyerId }),
      },
    };
    const notifications = { emit: jest.fn().mockResolvedValue(undefined) };
    await notifyPurchaseDemandDropped(
      prisma as unknown as PrismaServiceType,
      notifications as unknown as NotificationsService,
      { productionInvoiceId: 7n, materialId: 30n, ...input },
    );
    return notifications.emit;
  };

  it('giảm dưới số đã ký -> báo người mua phụ trách, dedupe theo (lệnh, vật tư)', async () => {
    const emit = await run({ neededQty: 50, signedQty: 110 }, 'u-buyer');
    expect(emit).toHaveBeenCalledWith('PURCHASE_DEMAND_DROPPED', {
      entityId: '7',
      actorId: undefined,
      dedupeKey: 'PURCHASE_DEMAND_DROPPED:7:30',
      params: {
        piCode: 'PI-2026-031',
        materialCode: 'SAT-001',
        unit: 'cây',
        neededQty: 50,
        signedQty: 110,
        buyerIds: ['u-buyer'],
      },
    });
  });

  it('nhu cầu không giảm dưới số đã ký -> không báo', async () => {
    const emit = await run({ neededQty: 110, signedQty: 110 }, 'u-buyer');
    expect(emit).not.toHaveBeenCalled();
  });
});
