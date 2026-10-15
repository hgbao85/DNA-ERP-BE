/** PIN công nhân xưởng: đúng 6 chữ số (2026-10-13, tự đặt ở lần đăng nhập đầu - xem AuthService.pinSetup). */
export const PIN_REGEX = /^\d{6}$/;

/** Khoá tạm sau bấy nhiêu lần nhập sai liên tiếp / trong bấy nhiêu phút (chỉ tài khoản công nhân). */
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;
/** Sau khi QLSX tạo tài khoản / cho đặt lại PIN, công nhân có bấy nhiêu giờ để tự đặt PIN. */
export const PIN_CLAIM_HOURS = 72;

/**
 * PIN quá dễ đoán: cả 6 số giống nhau (000000), dãy tăng/giảm (123456, 654321), lặp 2 hoặc 3 số (121212, 123123),
 * hoặc vài PIN phổ biến. Chỉ chặn các kiểu rõ ràng - PIN 6 số chỉ có 1 triệu khả năng, chống dò chính là khoá sau 5 lần sai.
 */
export function isWeakPin(pin: string): boolean {
  if (/^(\d)\1{5}$/.test(pin)) return true;
  if (/^(\d\d)\1{2}$/.test(pin) || /^(\d\d\d)\1$/.test(pin)) return true;
  const digits = [...pin].map(Number);
  const steps = digits.slice(1).map((d, i) => d - digits[i]);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  return ['112233', '696969', '520520', '131313'].includes(pin);
}
