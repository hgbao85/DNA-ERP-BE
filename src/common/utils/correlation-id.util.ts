import { v4 as uuidv4 } from 'uuid';
import { CORRELATION_ID_HEADER } from '../middleware/correlation-id.middleware';

interface HasHeaders {
  headers: Record<string, string | string[] | undefined>;
}

/** Reuses the caller-supplied correlation id header if present, otherwise mints one. */
export function resolveCorrelationId(req: HasHeaders): string {
  const existing = req.headers[CORRELATION_ID_HEADER];
  const value = Array.isArray(existing) ? existing[0] : existing;
  return value ?? uuidv4();
}
