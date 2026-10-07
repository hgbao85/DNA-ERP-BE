import {
  PERMISSION_MODULES,
  PermissionModule,
} from '../common/constants/permission-modules.constant';
import { NotificationLink } from '../modules/notifications/notification-types';

/**
 * HỢP ĐỒNG REALTIME - nguồn sự thật DUY NHẤT cho tên event, room và payload giữa BE và FE.
 * FE import đúng file này (qua bản sao `src/realtime/contract.ts` bên FE) thay vì gõ chuỗi tay.
 *
 * Nguyên tắc: push TÍN HIỆU NHỎ (id + action + topic), không push object nghiệp vụ đầy đủ. FE nhận
 * tín hiệu rồi REFETCH qua REST - REST là nơi duy nhất áp phân quyền/warehouse scope, nên socket
 * không bao giờ là đường lộ dữ liệu.
 */

/** Tên event: `<miền>.<quá khứ>`. Thêm event mới = thêm ở đây trước, rồi mới publish. */
export const REALTIME_EVENTS = {
  /** Gửi tới room `user:<id>` - chỉ người nhận thông báo. */
  NOTIFICATION_CREATED: 'notification.created',
  /** Gửi tới room `perm:<MODULE>:VIEW` của các module trong REALTIME_ENTITY_ROUTES. */
  ENTITY_CHANGED: 'entity.changed',
  /** Gửi tới room `user:<id>`: đổi trạng thái thông báo (đã đọc/lưu trữ/đóng) - đồng bộ giữa các tab. */
  NOTIFICATION_CHANGED: 'notification.changed',
} as const;

export type RealtimeEventName = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

/** Tên room. Server tự join socket vào room theo JWT - client KHÔNG tự chọn room. */
export const REALTIME_ROOMS = {
  user: (userId: string): string => `user:${userId}`,
  /** Chỉ quyền VIEW mới nhận realtime - ai xem được màn hình đó thì mới cần làm mới dữ liệu. */
  permission: (module: PermissionModule): string => `perm:${module}:VIEW`,
} as const;

/**
 * Entity nghiệp vụ được phát realtime. Thêm entity = thêm 1 dòng ở REALTIME_ENTITY_ROUTES và gọi
 * RealtimeService.publishEntityChanged() SAU KHI transaction commit ở service tương ứng.
 */
export type RealtimeEntity =
  | 'WAREHOUSE_TRANSFER'
  | 'PURCHASE_PROPOSAL'
  | 'STEEL_ISSUE'
  | 'PRODUCTION_BATCH'
  | 'QC_REVIEW'
  | 'MATERIAL_ISSUE'
  | 'PACKAGING_ISSUE'
  | 'MATERIAL_YIELD_ISSUE'
  | 'WEAVING_ISSUE'
  | 'STOCK'
  | 'PRODUCTION_INVOICE'
  | 'CUTTING_PROPOSAL'
  | 'SALES_ORDER'
  | 'SKU'
  | 'MATERIAL_YIELD_RECIPE'
  | 'PRODUCTION_ORDER';

export interface RealtimeEntityRoute {
  /** Module nào được nhận event (room perm:<module>:VIEW). */
  modules: PermissionModule[];
  /** Topic FE dùng để chọn màn hình/cache cần refetch. Đặt ở BE để FE không phải tự map lại. */
  topics: string[];
}

export const REALTIME_ENTITY_ROUTES: Record<RealtimeEntity, RealtimeEntityRoute> = {
  WAREHOUSE_TRANSFER: {
    modules: [PERMISSION_MODULES.WAREHOUSE_TRANSFER, PERMISSION_MODULES.STOCK],
    topics: ['warehouse-transfers', 'stock'],
  },
  PURCHASE_PROPOSAL: {
    modules: [PERMISSION_MODULES.PURCHASE_PROPOSAL],
    topics: ['purchase-proposals'],
  },
  STEEL_ISSUE: {
    modules: [PERMISSION_MODULES.STEEL_ISSUE, PERMISSION_MODULES.STOCK],
    topics: ['steel-issues', 'stock'],
  },
  PRODUCTION_BATCH: {
    modules: [PERMISSION_MODULES.PRODUCTION_BATCH],
    topics: ['production-batches'],
  },
  QC_REVIEW: {
    modules: [PERMISSION_MODULES.QC_REVIEW],
    topics: ['qc-reviews', 'production-batches'],
  },
  MATERIAL_ISSUE: {
    modules: [PERMISSION_MODULES.MATERIAL_ISSUE, PERMISSION_MODULES.STOCK],
    topics: ['material-issues', 'stock'],
  },
  PACKAGING_ISSUE: {
    modules: [PERMISSION_MODULES.PACKAGING_ISSUE, PERMISSION_MODULES.STOCK],
    topics: ['packaging-issues', 'stock'],
  },
  MATERIAL_YIELD_ISSUE: {
    modules: [PERMISSION_MODULES.MATERIAL_YIELD_ISSUE, PERMISSION_MODULES.STOCK],
    topics: ['material-yield-issues', 'stock'],
  },
  WEAVING_ISSUE: {
    modules: [PERMISSION_MODULES.WEAVING_ISSUE, PERMISSION_MODULES.STOCK],
    topics: ['weaving-issues', 'stock'],
  },
  STOCK: {
    modules: [PERMISSION_MODULES.STOCK],
    topics: ['stock'],
  },
  PRODUCTION_INVOICE: {
    modules: [PERMISSION_MODULES.PRODUCTION_INVOICE],
    topics: ['production-invoices'],
  },
  SKU: {
    modules: [PERMISSION_MODULES.SKU],
    topics: ['skus'],
  },
  MATERIAL_YIELD_RECIPE: {
    modules: [PERMISSION_MODULES.MATERIAL_YIELD_RECIPE],
    topics: ['material-yield-recipes'],
  },
  PRODUCTION_ORDER: {
    modules: [PERMISSION_MODULES.PRODUCTION_ORDER],
    topics: ['production-orders'],
  },
  SALES_ORDER: {
    modules: [PERMISSION_MODULES.SALES_ORDER],
    topics: ['sales-orders'],
  },
  CUTTING_PROPOSAL: {
    modules: [PERMISSION_MODULES.CUTTING_PROPOSAL],
    topics: ['cutting-proposals', 'production-invoices'],
  },
};

/** Hành động đã xảy ra trên entity - FE chỉ dùng để chọn thông báo, không dùng để ghi state. */
export type RealtimeEntityAction =
  | 'CREATED'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'APPROVED'
  | 'RECEIVED'
  | 'QC_RECORDED'
  | 'ADJUSTED'
  | 'UPDATED'
  | 'DELETED'
  | 'SHIPPED'
  | 'PROGRESS'
  | 'FINISHED';

/** Vỏ bọc chung mọi event: eventId để FE khử trùng, occurredAt/correlationId để truy vết log. */
export interface RealtimeEnvelope<TName extends RealtimeEventName, TPayload> {
  eventId: string;
  name: TName;
  occurredAt: string;
  correlationId: string | null;
  payload: TPayload;
}

export interface NotificationCreatedPayload {
  notificationId: string;
  /** null cho thông báo announcement tự do của admin. */
  type: string | null;
  category: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  link: NotificationLink | null;
  /** true = sự kiện trùng được gộp vào thông báo cũ chưa đọc (dedupeKey). */
  merged: boolean;
  createdAt: string;
}

export interface EntityChangedPayload {
  entity: RealtimeEntity;
  entityId: string;
  action: RealtimeEntityAction;
  /** Lấy từ REALTIME_ENTITY_ROUTES tại thời điểm publish. */
  topics: string[];
}

export interface NotificationChangedPayload {
  action: 'READ' | 'READ_ALL' | 'ARCHIVED' | 'RESOLVED';
  notificationIds: string[];
}

export interface RealtimeEventMap {
  [REALTIME_EVENTS.NOTIFICATION_CREATED]: NotificationCreatedPayload;
  [REALTIME_EVENTS.ENTITY_CHANGED]: EntityChangedPayload;
  [REALTIME_EVENTS.NOTIFICATION_CHANGED]: NotificationChangedPayload;
}

/** Giới hạn độ dài correlationId nhận từ client - tránh nhét chuỗi tuỳ ý vào log. */
export const MAX_CORRELATION_ID_LENGTH = 64;
