import { AsyncLocalStorage } from 'node:async_hooks';
import { ClsService } from 'nestjs-cls';
import { AppClsStore } from '../../common/interfaces/cls-store.interface';
import { withTransactionContext } from '../prisma.service';
import { withAuditLog } from './audit-log.extension';

/**
 * B5 (23/11/2026): nhật ký ghi CÙNG transaction nghiệp vụ. Trước đây extension luôn ghi qua client gốc (kết nối riêng,
 * ngoài transaction) - nghiệp vụ bị huỷ thì dòng nhật ký "đã tạo / đã sửa" vẫn còn (thử sống: phiếu xuất sắt 146, giữ chỗ
 * 157 trên bản sao).
 */
type HookParams = {
  model: string;
  operation: string;
  args: { where?: unknown; data?: unknown };
  query: (a: unknown) => Promise<unknown>;
  __internalParams?: { transaction?: { kind: string; id?: string } };
};
type Hooks = Record<'create' | 'update' | 'delete', (p: HookParams) => Promise<unknown>>;

const fakeDb = (findFirstResult: unknown = null) => ({
  auditLog: { create: jest.fn().mockResolvedValue({}) },
  steelIssue: { findFirst: jest.fn().mockResolvedValue(findFirstResult) },
  user: { findFirst: jest.fn().mockResolvedValue(findFirstResult) },
});

function setup() {
  const cls = new ClsService<AppClsStore>(new AsyncLocalStorage());
  const base = { ...fakeDb({ id: 7n, status: 'ISSUED' }), $extends: (cfg: unknown) => cfg };
  const ext = (withAuditLog(cls) as unknown as (c: unknown) => unknown)(base) as {
    query: { $allModels: Hooks };
  };
  return { cls, base, hooks: ext.query.$allModels };
}

const ITX = { transaction: { kind: 'itx', id: 'tx-1' } };

describe('withAuditLog - ghi nhật ký cùng transaction (B5 23/11)', () => {
  it('câu lệnh trong transaction: ghi nhật ký qua client của CHÍNH transaction đó, không qua client gốc', async () => {
    const { cls, base, hooks } = setup();
    const tx = fakeDb();
    await cls.run(async () => {
      cls.set('userId', 'u-1');
      cls.set('prismaTx', tx);
      await hooks.create({
        model: 'SteelIssue',
        operation: 'create',
        args: { data: {} },
        query: () => Promise.resolve({ id: 146n }),
        __internalParams: ITX,
      });
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tableName: 'SteelIssue',
        recordId: '146',
        userId: 'u-1',
      }) as unknown,
    });
    expect(base.auditLog.create).not.toHaveBeenCalled();
  });

  it('câu lệnh NGOÀI transaction (kể cả khi đang có transaction mở trong cùng ngữ cảnh) -> client gốc như trước', async () => {
    const { cls, base, hooks } = setup();
    const tx = fakeDb();
    await cls.run(async () => {
      cls.set('prismaTx', tx);
      await hooks.create({
        model: 'SteelIssue',
        operation: 'create',
        args: { data: {} },
        query: () => Promise.resolve({ id: 1n }),
        __internalParams: {},
      });
    });
    expect(base.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });

  it('update trong transaction: đọc "trước khi sửa" trong transaction (thấy thay đổi trước đó của chính nó)', async () => {
    const { cls, base, hooks } = setup();
    const tx = fakeDb({ id: 7n, status: 'RECEIVED' });
    await cls.run(async () => {
      cls.set('prismaTx', tx);
      await hooks.update({
        model: 'SteelIssue',
        operation: 'update',
        args: { where: { id: 7n }, data: { status: 'CUT' } },
        query: () => Promise.resolve({ id: 7n, status: 'CUT' }),
        __internalParams: ITX,
      });
    });
    expect(tx.steelIssue.findFirst).toHaveBeenCalledWith({ where: { id: 7n } });
    expect(base.steelIssue.findFirst).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        oldValue: { id: 7n, status: 'RECEIVED' },
        newValue: { id: 7n, status: 'CUT' },
      }) as unknown,
    });
  });

  it('bảng xoá mềm: transaction không đọc được dòng đã xoá mềm (lớp xoá mềm lọc) -> đọc lại bằng client gốc', async () => {
    const { cls, base, hooks } = setup();
    const tx = fakeDb(null);
    await cls.run(async () => {
      cls.set('prismaTx', tx);
      await hooks.update({
        model: 'User',
        operation: 'update',
        args: { where: { id: 'u-9' }, data: { deletedAt: null } },
        query: () => Promise.resolve({ id: 'u-9' }),
        __internalParams: ITX,
      });
    });
    expect(base.user.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ oldValue: { id: 7n, status: 'ISSUED' } }) as unknown,
    });
  });

  it('không có ngữ cảnh CLS (job nền) -> client gốc, không lỗi', async () => {
    const { base, hooks } = setup();
    await hooks.create({
      model: 'SteelIssue',
      operation: 'create',
      args: { data: {} },
      query: () => Promise.resolve({ id: 2n }),
      __internalParams: ITX,
    });
    expect(base.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('withTransactionContext - đặt client của transaction vào CLS (B5 23/11)', () => {
  const makeClient = () => {
    let n = 0;
    return {
      name: 'gốc',
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => Promise<unknown>)({ txNo: ++n })
          : Promise.resolve('mảng'),
      ),
      ping(this: { name: string }) {
        return this.name;
      },
    };
  };

  it('callback thấy prismaTx = đúng tx, vẫn giữ userId của request; ra khỏi callback thì hết', async () => {
    const cls = new ClsService<AppClsStore>(new AsyncLocalStorage());
    const client = withTransactionContext(makeClient(), cls);
    await cls.run(async () => {
      cls.set('userId', 'u-1');
      const seen = await client.$transaction((tx: unknown) =>
        Promise.resolve({
          tx: cls.get('prismaTx'),
          userId: cls.get('userId'),
          same: cls.get('prismaTx') === tx,
        }),
      );
      expect(seen).toEqual({ tx: { txNo: 1 }, userId: 'u-1', same: true });
      expect(cls.get('prismaTx')).toBeUndefined();
    });
  });

  it('2 transaction chạy song song mỗi cái thấy tx của mình', async () => {
    const cls = new ClsService<AppClsStore>(new AsyncLocalStorage());
    const client = withTransactionContext(makeClient(), cls);
    const run = () =>
      client.$transaction(async (tx: unknown) => {
        await new Promise((r) => setTimeout(r, 10));
        return cls.get('prismaTx') === tx;
      });
    await cls.run(async () => {
      await expect(Promise.all([run(), run()])).resolves.toEqual([true, true]);
    });
  });

  it('dạng mảng $transaction([...]) và các hàm khác chạy như cũ (gắn đúng this)', async () => {
    const cls = new ClsService<AppClsStore>(new AsyncLocalStorage());
    const client = withTransactionContext(makeClient(), cls);
    await expect(client.$transaction([] as unknown)).resolves.toBe('mảng');
    expect(client.ping()).toBe('gốc');
  });
});
