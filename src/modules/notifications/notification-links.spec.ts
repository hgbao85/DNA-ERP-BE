import { NOTIFICATION_TYPES } from './notification-types';

/** Phân hệ FE thật (resolveDefaultModule.ts / app/page.tsx) - link trỏ ngoài danh sách này là link chết. */
const FE_MODULES = [
  'admin',
  'boss',
  'sales',
  'production',
  'production_plan',
  'purchasing',
  'materials_manager',
  'inbound_warehouse',
];

/** Type CỐ Ý không có link, kèm lý do - thêm type mới vào đây phải có lý do rõ ràng. */
const INTENTIONALLY_NO_LINK: Record<string, string> = {
  PI_PRODUCTION_ORDER_FAILED: 'chỉ Admin nhận, chưa có màn xử lý (retry chỉ có API)',
  QC_FAILED:
    '2 nhóm nhận (tổ gửi Phôi/Hàn/Sơn + QLSX) cần trang khác nhau trong CÙNG phân hệ production',
  CUTTING_PROPOSAL_AUTO_APPROVED: 'luồng cũ (tự duyệt) - solve-trước-PI không còn phát',
  CUTTING_WASTE_DEFAULT_CHANGED: 'BOSS/QLSX nhận, không có màn cấu hình ngưỡng ở phân hệ của họ',
};

describe('NOTIFICATION_TYPES - link', () => {
  const entries = Object.entries(NOTIFICATION_TYPES) as [
    string,
    { link?: (p: never) => unknown },
  ][];

  it('mọi type có link đều trỏ phân hệ FE có thật (cả link chính và link thay thế)', () => {
    for (const [name, def] of entries) {
      if (!def.link) continue;
      let link: {
        module?: string;
        page?: string;
        alternatives?: { module: string; page: string }[];
      } | null;
      try {
        link = def.link({ stage: 'PHOI' } as never) as typeof link;
      } catch {
        continue; // link phụ thuộc params riêng - đã có test riêng
      }
      if (!link) continue;
      expect(FE_MODULES).toContain(link.module);
      expect(link.page).toBeTruthy();
      for (const alt of link.alternatives ?? []) {
        expect(FE_MODULES).toContain(alt.module);
        expect(alt.module).not.toBe(link.module);
      }
      expect(name).toBeTruthy();
    }
  });

  it('type không có link phải nằm trong danh sách "cố ý" (kèm lý do)', () => {
    const noLink = entries
      .filter(([, d]) => !d.link)
      .map(([n]) => n)
      .sort();
    expect(noLink).toEqual(Object.keys(INTENTIONALLY_NO_LINK).sort());
  });
});

describe('NOTIFICATION_TYPES - thông báo mua hàng gửi QLSX', () => {
  it.each([
    'PURCHASE_PROPOSAL_APPROVED',
    'PURCHASE_PROPOSAL_ITEM_RECEIVED',
    'PURCHASE_PROPOSAL_PURCHASED',
  ] as const)(
    '%s trỏ "Tổng hợp lệnh SX" và nháy đúng PI theo mã PI (không phải lenh-sx chỉ có PI chờ duyệt)',
    (name) => {
      const link = NOTIFICATION_TYPES[name].link?.({ piCode: 'PI-2026-038', count: 1 }) as {
        module: string;
        page: string;
        params?: Record<string, string>;
      };
      expect(link.module).toBe('production');
      expect(link.page).toBe('ke-hoach');
      expect(link.params?.focus).toBe('PI_CODE:PI-2026-038');
    },
  );
});

describe('NOTIFICATION_TYPES - PURCHASE_PROPOSAL_CREATED người nhận', () => {
  const recipients = NOTIFICATION_TYPES.PURCHASE_PROPOSAL_CREATED.recipients;

  it('có buyerIds -> chỉ báo đúng người mua', () => {
    expect(recipients({ piCode: 'PI-1', count: 2, buyerIds: ['u1'] })).toEqual({ userIds: ['u1'] });
  });

  it('không có buyerIds -> báo cả nhóm Mua hàng (hành vi cũ)', () => {
    expect(recipients({ piCode: 'PI-1', count: 2 })).toEqual({ roles: ['PURCHASER'] });
  });
});

describe('NOTIFICATION_TYPES - trạng thái xưởng của lệnh (P1 mục 31)', () => {
  const names = [
    'PRODUCTION_ORDER_FLOOR_STARTED',
    'PRODUCTION_ORDER_FLOOR_PAUSED',
    'PRODUCTION_ORDER_FLOOR_RESUMED',
    'PRODUCTION_ORDER_FLOOR_FINISHED',
  ] as const;

  it.each(names)('%s báo các tổ xưởng, loại Mua hàng, nháy đúng PI', (name) => {
    const def = NOTIFICATION_TYPES[name];
    const rec = def.recipients({ piCode: 'PI-9', poNumber: 'PO-9-1' });
    expect(rec.roles).toEqual(['PHOI_STAFF', 'HAN_STAFF', 'SON_STAFF', 'KCS_STAFF']);
    // thủ kho theo warehouseScope + role, KHÔNG theo role WAREHOUSE_STAFF đơn thuần (khsx/sales demo cũng giữ role này)
    expect(rec.warehouseIds).toEqual(['phoi-son-han', 'vat-tu-tp', 'thanh-pham']);
    expect(rec.warehouseScopeRoles).toEqual(['WAREHOUSE_STAFF']);
    expect(rec.excludeRoles).toEqual(['PURCHASER']);
    const link = def.link?.({ piCode: 'PI-9', poNumber: 'PO-9-1' }) as {
      params?: Record<string, string>;
    };
    expect(link.params?.focus).toBe('PI_CODE:PI-9');
  });

  it('Tạm dừng là ALERT/WARNING (cần chú ý), các trạng thái còn lại là RESULT', () => {
    expect(NOTIFICATION_TYPES.PRODUCTION_ORDER_FLOOR_PAUSED.category).toBe('ALERT');
    expect(NOTIFICATION_TYPES.PRODUCTION_ORDER_FLOOR_PAUSED.severity).toBe('WARNING');
    expect(NOTIFICATION_TYPES.PRODUCTION_ORDER_FLOOR_FINISHED.category).toBe('RESULT');
  });
});

describe('NOTIFICATION_TYPES - PURCHASE_PROPOSAL_READY_TO_RECEIVE (P1 mục 31)', () => {
  it('báo thủ kho nhận của đúng kho, loại Mua hàng, trỏ "Nhập kho"', () => {
    const def = NOTIFICATION_TYPES.PURCHASE_PROPOSAL_READY_TO_RECEIVE;
    expect(def.recipients({ piCode: 'PI-1', count: 2, warehouseCodes: ['vat-tu-tp'] })).toEqual({
      warehouseIds: ['vat-tu-tp'],
      warehouseScopeRoles: ['WAREHOUSE_STAFF'],
      warehouseScopeExcludeRoles: ['PURCHASER'],
    });
    expect(def.link?.({ piCode: 'PI-1', count: 2 })).toMatchObject({
      module: 'inbound_warehouse',
      page: 'nhap-kho',
    });
  });
});
