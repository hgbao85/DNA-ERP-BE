import { ClsStore } from 'nestjs-cls';

/** Request-scoped values threaded through AsyncLocalStorage (nestjs-cls). */
export interface AppClsStore extends ClsStore {
  userId?: string;
  ip?: string;
}
