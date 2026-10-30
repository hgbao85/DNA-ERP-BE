import { uniqueTargetOf } from './all-exceptions.filter';

describe('uniqueTargetOf (P2002)', () => {
  it('engine cũ: meta.target', () => {
    expect(uniqueTargetOf({ target: ['code'] })).toBe('code');
  });

  it('driver adapter: tên cột ở driverAdapterError.cause.constraint.fields (trước đây ra "undefined", test thật 32.27)', () => {
    expect(
      uniqueTargetOf({
        modelName: 'DataHealthFinding',
        driverAdapterError: {
          cause: {
            kind: 'UniqueConstraintViolation',
            constraint: { fields: ['"checkCode"', '"entityKey"'] },
          },
        },
      }),
    ).toBe('checkCode, entityKey');
  });

  it('không có thông tin -> chữ chung, không "undefined"', () => {
    expect(uniqueTargetOf(undefined)).toBe('unknown field');
  });
});
