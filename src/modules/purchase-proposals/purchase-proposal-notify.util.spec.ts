import { PurchaseProposalStatus } from '../../generated/prisma/client';
import { PrismaServiceType } from '../../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { notifyPurchaseProposalCreated } from './purchase-proposal-notify.util';

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
