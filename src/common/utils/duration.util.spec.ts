import { parseDurationMs } from './duration.util';

describe('parseDurationMs', () => {
  it.each([
    ['15m', 15 * 60 * 1000],
    ['7d', 7 * 24 * 60 * 60 * 1000],
    ['60s', 60 * 1000],
    ['2h', 2 * 60 * 60 * 1000],
  ])('parses "%s" as %d ms', (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  it('throws on an invalid format', () => {
    expect(() => parseDurationMs('15')).toThrow();
    expect(() => parseDurationMs('15x')).toThrow();
    expect(() => parseDurationMs('abc')).toThrow();
  });
});
