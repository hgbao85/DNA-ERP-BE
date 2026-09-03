/**
 * Re-export mỏng - logic thật đã tổng quát hoá sang warehouse-family.util.ts (2026-09-03, mở rộng
 * đa-instance cho cả phoi-son-han/vat-tu-tp, không chỉ thanh-pham). Giữ file này để mọi call site
 * cũ (`import { isThanhPhamScope } from '.../thanh-pham-scope.util'`) không cần sửa lại.
 */
export { isThanhPhamScope } from './warehouse-family.util';
