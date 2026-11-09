import { BadRequestException } from '@nestjs/common';
import { PieceSyncBoardController } from './piece-sync-board.controller';

describe('PieceSyncBoardController', () => {
  const getBoard = jest.fn().mockResolvedValue({ rows: [] });
  const controller = new PieceSyncBoardController({ getBoard } as never);

  beforeEach(() => getBoard.mockClear());

  it('tách productionInvoiceIds theo dấu phẩy', async () => {
    await controller.getBoard('7, 8,');
    expect(getBoard).toHaveBeenCalledWith(['7', '8']);
  });

  it('không truyền query -> getBoard(undefined)', async () => {
    await controller.getBoard(undefined);
    expect(getBoard).toHaveBeenCalledWith(undefined);
  });

  it('id không phải số -> 400, không gọi service', () => {
    expect(() => controller.getBoard('7,abc')).toThrow(BadRequestException);
    expect(getBoard).not.toHaveBeenCalled();
  });
});
