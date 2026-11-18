import { SESSION_STORAGE_KEY } from './sessionStorage';
export { SESSION_STORAGE_KEY };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  sessionInfo: {
    userId?: string | null;
    usuario?: string | null;
  };
}

function readStoredSession(): { userId?: string | null; usuario?: string | null } {
  try {
    const raw =
      localStorage.getItem(SESSION_STORAGE_KEY) ||
      sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { userId?: string; usuario?: string };
    return {
      userId: parsed.userId ?? null,
      usuario: parsed.usuario ?? null,
    };
  } catch {
    return {};
  }
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    sessionInfo: readStoredSession(),
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
