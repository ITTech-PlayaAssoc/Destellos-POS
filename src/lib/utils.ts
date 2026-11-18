import type { AppTimestamp, BranchId, UserProfile } from '../types/boutique';

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function encodeUtf8Bytes(input: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(input);
  }
  const encoded = unescape(encodeURIComponent(input));
  const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    bytes[i] = encoded.charCodeAt(i);
  }
  return bytes;
}

function rotr32(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256PureJs(input: string): string {
  const bytes = encodeUtf8Bytes(input);
  const len = bytes.length;
  const bitLen = len * 8;

  // Pad with 0x80, zeros, then 64-bit big-endian bit length so total is multiple of 64 bytes
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[len] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr32(w[i - 15], 7) ^ rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr32(w[i - 2], 17) ^ rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => word.toString(16).padStart(8, '0'))
    .join('');
}

export async function hashPin(pin: string): Promise<string> {
  const subtle =
    (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) ||
    (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle);

  if (subtle) {
    try {
      const data = encodeUtf8Bytes(pin);
      const hashBuffer = await subtle.digest('SHA-256', new Uint8Array(data));
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fall through to pure JS SHA-256 if subtle.digest rejects in restricted contexts
    }
  }

  return sha256PureJs(pin);
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
