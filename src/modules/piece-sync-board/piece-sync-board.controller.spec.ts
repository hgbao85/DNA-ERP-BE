import { BadRequestException } from '@nestjs/common';
import { PieceSyncBoardController } from './piece-sync-board.controller';

describe('PieceSyncBoardController', () => {
  const getBoard = jest.fn().mockResolvedValue({ rows: [] });
  const controller = new PieceSyncBoardController({ getBoard } as never);

  beforeEach(() => getBoard.mockClear());

  it('tách productionInvoiceIds theo dấu phẩy', async () => {
    await controller.getBoard('u1', '7, 8,');
    expect(getBoard).toHaveBeenCalledWith(['7', '8'], undefined, 'u1');
  });

  it('không truyền query -> getBoard(undefined)', async () => {
    await controller.getBoard('u1', undefined);
    expect(getBoard).toHaveBeenCalledWith(undefined, undefined, 'u1');
  });

  it('id không phải số -> 400, không gọi service', () => {
    expect(() => controller.getBoard('u1', '7,abc')).toThrow(BadRequestException);
    expect(getBoard).not.toHaveBeenCalled();
  });
});
