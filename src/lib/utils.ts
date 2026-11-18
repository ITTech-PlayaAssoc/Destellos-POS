import type { AppTimestamp, BranchId, UserProfile } from '../types/boutique';

export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  const clean = normalizeUsername(value);
  return clean.length >= 1 && clean.length <= 64 && /^[a-zA-Z0-9._-]+$/.test(clean);
}

export function isInternalAuthUser(data: unknown): data is UserProfile {
  if (!data || typeof data !== 'object') return false;
  const d = data as Record<string, unknown>;
  return (
    typeof d.id === 'string' &&
    typeof d.usuario === 'string' &&
    d.usuario.length > 0 &&
    typeof d.pinHash === 'string' &&
    d.pinHash.length === 64 &&
    (d.rol === 'admin' || d.rol === 'vendedor')
  );
}

export function generateId(prefix: string): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, '');
  const randomPart = Math.random().toString(36).slice(2, 10);
  return `${cleanPrefix}_${Date.now()}_${randomPart}`;
}

export function getBranchFolioPrefix(branchId: BranchId): string {
  const match = /^branch_(\d+)$/.exec(branchId);
  if (match) return `SUC${match[1]}`;
  const clean = branchId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return clean.slice(0, 6) || 'SUC';
}

export function formatConsecutiveFolio(branchId: BranchId, sequence: number): string {
  const prefix = getBranchFolioPrefix(branchId);
  const padded = String(Math.max(1, Math.floor(sequence))).padStart(5, '0');
  return `${prefix}-${padded}`;
}

export function formatLayawayFolio(branchId: BranchId, sequence: number): string {
  const prefix = getBranchFolioPrefix(branchId);
  const padded = String(Math.max(1, Math.floor(sequence))).padStart(4, '0');
  return `APT-${prefix}-${padded}`;
}

export function formatCashShiftFolio(branchId: BranchId, date = new Date()): string {
  const prefix = getBranchFolioPrefix(branchId);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `CAJA-${prefix}-${y}${m}${d}-${hh}${mm}`;
}

export function formatEventDate(dateStr: string | undefined | null): string {
  if (!dateStr) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!match) return dateStr;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function toDateValue(ts: AppTimestamp | null | undefined): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return Number.isNaN(ts.getTime()) ? null : ts;
  if (typeof ts === 'number') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === 'string') {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === 'object' && typeof ts.toDate === 'function') {
    const d = ts.toDate();
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function toMillis(ts: AppTimestamp | null | undefined): number {
  if (!ts) return 0;
  if (typeof ts === 'object' && !(ts instanceof Date) && typeof ts.toMillis === 'function') {
    return ts.toMillis();
  }
  const d = toDateValue(ts);
  return d ? d.getTime() : 0;
}

export function formatDateTime(ts: AppTimestamp | null | undefined): string {
  const date = toDateValue(ts);
  if (!date) return '—';
  return new Intl.DateTimeFormat('es-MX', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function formatDateInputValue(ts: AppTimestamp | null | undefined): string {
  const d = toDateValue(ts);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function truncateStr(val: string, maxLen: number): string {
  const trimmed = val.trim();
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AA';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
