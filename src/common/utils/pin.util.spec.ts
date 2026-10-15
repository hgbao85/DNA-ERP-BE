import { isWeakPin } from './pin.util';

describe('isWeakPin', () => {
  it.each([
    '000000',
    '111111',
    '123456',
    '654321',
    '234567',
    '987654',
    '121212',
    '123123',
    '112233',
  ])('chặn %s', (pin) => expect(isWeakPin(pin)).toBe(true));
  it.each(['483920', '135790', '908172', '120934'])('cho phép %s', (pin) =>
    expect(isWeakPin(pin)).toBe(false),
  );
});
