export const SESSION_STORAGE_KEY = 'aa_internal_session';
export const API_TOKEN_STORAGE_KEY = 'aa_api_bearer_token';

export function readStoredApiToken(): string | null {
  try {
    return (
      localStorage.getItem(API_TOKEN_STORAGE_KEY) ||
      sessionStorage.getItem(API_TOKEN_STORAGE_KEY) ||
      null
    );
  } catch {
    return null;
  }
}

export function persistApiToken(token: string | null): void {
  try {
    if (!token) {
      localStorage.removeItem(API_TOKEN_STORAGE_KEY);
      sessionStorage.removeItem(API_TOKEN_STORAGE_KEY);
      return;
    }
    localStorage.setItem(API_TOKEN_STORAGE_KEY, token);
    sessionStorage.setItem(API_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage quota errors
  }
}
