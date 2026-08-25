import { PurchaseProposalStatus } from '../../generated/prisma/client';
import { recomputeProposalStatus } from './purchase-proposal-status.util';

const S = PurchaseProposalStatus;

describe('recomputeProposalStatus', () => {
  const makeTx = (itemStatuses: PurchaseProposalStatus[]) => {
    const findMany = jest.fn().mockResolvedValue(itemStatuses.map((status) => ({ status })));
    const update = jest.fn();
    return { tx: { purchaseProposalItem: { findMany }, purchaseProposal: { update } }, update };
  };

  it.each<[string, PurchaseProposalStatus[], PurchaseProposalStatus]>([
    ['mọi item NEW -> NEW', [S.NEW, S.NEW], S.NEW],
    ['có item rời NEW (QUOTING) -> QUOTING', [S.NEW, S.QUOTING], S.QUOTING],
    ['mọi item ít nhất SUBMITTED -> SUBMITTED', [S.SUBMITTED, S.PURCHASING], S.SUBMITTED],
    [
      'còn 1 item QUOTING cạnh SUBMITTED -> QUOTING (chưa đủ cả)',
      [S.SUBMITTED, S.QUOTING],
      S.QUOTING,
    ],
    ['mọi item ít nhất PURCHASING -> PURCHASING', [S.PURCHASING, S.PURCHASED], S.PURCHASING],
    ['mọi item PURCHASED -> PURCHASED', [S.PURCHASED, S.PURCHASED], S.PURCHASED],
    // REJECTED ưu tiên hiện ra dù các dòng khác đã SUBMITTED/PURCHASING - cần chú ý xử lý.
    [
      'có item REJECTED (dù dòng khác đã PURCHASING) -> REJECTED',
      [S.REJECTED, S.PURCHASING],
      S.REJECTED,
    ],
    ['có item REJECTED cạnh NEW -> REJECTED', [S.REJECTED, S.NEW], S.REJECTED],
    ['1 item duy nhất PURCHASED -> PURCHASED', [S.PURCHASED], S.PURCHASED],
  ])('%s', async (_label, itemStatuses, expected) => {
    const { tx, update } = makeTx(itemStatuses);

    await recomputeProposalStatus(tx as never, 300n);

    expect(update).toHaveBeenCalledWith({ where: { id: 300n }, data: { status: expected } });
  });

  it('đọc status TƯƠI qua findMany theo đúng proposalId truyền vào', async () => {
    const { tx } = makeTx([S.NEW]);

    await recomputeProposalStatus(tx as never, 777n);

    expect(tx.purchaseProposalItem.findMany).toHaveBeenCalledWith({
      where: { proposalId: 777n },
      select: { status: true },
    });
  });
});
