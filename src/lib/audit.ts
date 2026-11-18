import { logService, type AuditPayload } from '../services/dataProvider';

export type { AuditPayload };

export async function recordAuditLog(payload: AuditPayload): Promise<void> {
  await logService.recordAuditLog(payload);
}
