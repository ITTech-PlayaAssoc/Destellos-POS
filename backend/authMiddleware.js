import crypto from 'node:crypto';

const EPHEMERAL_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret() {
  return process.env.API_JWT_SECRET?.trim() || EPHEMERAL_SECRET;
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex');
}

export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function generateId(prefix) {
  const cleanPrefix = String(prefix || 'id').replace(/[^a-zA-Z0-9_-]/g, '');
  const rand = crypto.randomBytes(4).toString('hex');
  return `${cleanPrefix}_${Date.now()}_${rand}`;
}

export function signAuthToken(user) {
  const payload = {
    uid: user.id,
    usuario: user.usuario,
    rol: user.rol,
    iat: Date.now(),
    exp: Date.now() + 1000 * 60 * 60 * 24 * 7, // 7 días
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyAuthToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto
    .createHmac('sha256', getSigningSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload?.uid || (payload.exp && Date.now() > payload.exp)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function extractBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export function optionalAuth(req, _res, next) {
  const token = extractBearerToken(req);
  if (token) {
    req.authUser = verifyAuthToken(token);
  }
  next();
}

export function requireAuth(req, res, next) {
  const token = extractBearerToken(req);
  const payload = verifyAuthToken(token);
  if (!payload) {
    res.status(401).json({
      error: 'Sesión no válida o expirada. Inicia sesión nuevamente.',
    });
    return;
  }
  req.authUser = payload;
  next();
}
