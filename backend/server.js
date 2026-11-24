import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import pool, { pingDatabase, withTransaction } from './db.js';
import {
  generateId,
  normalizeUsername,
  optionalAuth,
  requireAuth,
  sha256Hex,
  signAuthToken,
} from './authMiddleware.js';

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    credentials: true,
  })
);
app.use(express.json({ limit: '15mb' }));

// -----------------------------------------------------------------------------
// Constantes y Helpers de Mapeo (paridad con src/types/boutique.ts)
// -----------------------------------------------------------------------------
const DEFAULT_BRANCH_LIST = [
  { id: 'branch_1', name: 'Sucursal 1', city: '', address: '', phone: '' },
  { id: 'branch_2', name: 'Sucursal 2', city: '', address: '', phone: '' },
  { id: 'branch_3', name: 'Sucursal 3', city: '', address: '', phone: '' },
];

const DEFAULT_PRODUCT_CATEGORIES = [
  'Vestidos XV años',
  'Accesorios',
  'Tiaras',
  'Calzado',
  'General',
];

const DEFAULT_BRANDING_CONFIG = {
  companyName: 'Atelier Aurelia',
  companyLogoUrl: '',
  updatedByUid: 'system',
};

const FULL_ADMIN_PERMISSIONS = {
  viewInventory: true,
  addProduct: true,
  restockInventory: true,
  discardStock: true,
  performSales: true,
  viewOtherBranchesStock: true,
  manageCustomers: true,
  manageLayaways: true,
  cancelLayaways: true,
};

const DEFAULT_SELLER_PERMISSIONS = {
  viewInventory: true,
  addProduct: false,
  restockInventory: false,
  discardStock: false,
  performSales: true,
  viewOtherBranchesStock: false,
  manageCustomers: true,
  manageLayaways: true,
  cancelLayaways: false,
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function truncateStr(val, maxLen) {
  const s = String(val ?? '').trim();
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function parseJsonSafe(val, fallback) {
  if (val === null || val === undefined) return fallback;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

function toIso(val) {
  if (!val) return undefined;
  if (val instanceof Date) return val.toISOString();
  const d = new Date(val);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function formatCurrency(amount) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(Number(amount)) ? Number(amount) : 0);
}

function getBranchFolioPrefix(branchId) {
  const match = /^branch_(\d+)$/.exec(String(branchId || ''));
  if (match) return `SUC${match[1]}`;
  const clean = String(branchId || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  return clean.slice(0, 6) || 'SUC';
}

function formatConsecutiveFolio(branchId, sequence) {
  const prefix = getBranchFolioPrefix(branchId);
  const padded = String(Math.max(1, Math.floor(sequence))).padStart(5, '0');
  return `${prefix}-${padded}`;
}

function formatLayawayFolio(branchId, sequence) {
  const prefix = getBranchFolioPrefix(branchId);
  const padded = String(Math.max(1, Math.floor(sequence))).padStart(4, '0');
  return `APT-${prefix}-${padded}`;
}

function formatCashShiftFolio(branchId, date = new Date()) {
  const prefix = getBranchFolioPrefix(branchId);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `CAJA-${prefix}-${y}${m}${d}-${hh}${mm}`;
}

function mapUserRow(row, { exposePinHash = false } = {}) {
  return {
    id: row.id,
    nombreCompleto: row.nombre_completo,
    usuario: row.usuario,
    pinHash: exposePinHash ? row.pin_hash : '',
    rol: row.rol,
    sucursalAsignada: row.sucursal_asignada,
    permisos: parseJsonSafe(row.permisos, DEFAULT_SELLER_PERMISSIONS),
    modoOscuro: Boolean(row.modo_oscuro),
    activo: Boolean(row.activo),
    operatingScope: row.operating_scope || 'general',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    lastLoginAt: toIso(row.last_login_at),
  };
}

function mapProductRow(row, stockMap = {}) {
  const prod = {
    id: row.id,
    sku: row.sku,
    barcodeSKU: row.barcode_sku,
    name: row.name,
    category: row.category_name,
    size: row.size,
    color: row.color,
    price: Number(row.price || 0),
    stock: stockMap,
    createdByUid: row.created_by_uid || 'system',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
  if (row.codigo_modelo) prod.codigoModelo = row.codigo_modelo;
  if (row.codigo_actual) prod.codigoActual = row.codigo_actual;
  if (row.marca) prod.marca = row.marca;
  if (row.especificaciones) prod.especificaciones = row.especificaciones;
  if (row.estatus_original) prod.estatusOriginal = row.estatus_original;
  if (row.costo_referencia !== null && row.costo_referencia !== undefined) {
    prod.costoReferencia = Number(row.costo_referencia);
  }
  return prod;
}

function mapCustomerRow(row) {
  return {
    id: row.id,
    nombreCompleto: row.nombre_completo,
    telefono: row.telefono || '',
    email: row.email || '',
    fechaEvento: row.fecha_evento || '',
    notas: row.notas || '',
    datosFiscales: {
      rfc: row.rfc || '',
      razonSocial: row.razon_social || '',
      codigoPostal: row.codigo_postal || '',
      regimenFiscal: row.regimen_fiscal || '',
      usoCfdi: row.uso_cfdi || '',
    },
    createdByUid: row.created_by_uid || 'system',
    createdByName: row.created_by_name || '',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapSaleItemRow(row) {
  return {
    productId: row.product_id || '',
    sku: row.sku,
    name: row.name,
    size: row.size,
    color: row.color,
    unitPrice: Number(row.unit_price || 0),
    quantity: Number(row.quantity || 0),
    lineTotal: Number(row.line_total || 0),
  };
}

function mapSaleRow(row, items = []) {
  return {
    id: row.id,
    folio: row.folio,
    branchId: row.branch_id,
    branchName: row.branch_name,
    sellerUid: row.seller_uid || 'system',
    sellerName: row.seller_name,
    sellerUsuario: row.seller_usuario || '',
    items,
    subtotal: Number(row.subtotal || 0),
    discountType: row.discount_type || 'none',
    discountValue: Number(row.discount_value || 0),
    discountAmount: Number(row.discount_amount || 0),
    total: Number(row.total || 0),
    paymentMethod: row.payment_method,
    cashReceived: Number(row.cash_received || 0),
    changeGiven: Number(row.change_given || 0),
    cardReference: row.card_reference || '',
    transferReference: row.transfer_reference || '',
    customerId: row.customer_id || undefined,
    customerName: row.customer_name || undefined,
    status: row.status || 'completada',
    cancelledAt: toIso(row.cancelled_at),
    cancelledByUid: row.cancelled_by_uid || undefined,
    cancelledByName: row.cancelled_by_name || undefined,
    cancellationReason: row.cancellation_reason || undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapLayawayRow(row, items = []) {
  return {
    id: row.id,
    folio: row.folio,
    branchId: row.branch_id,
    branchName: row.branch_name,
    customerId: row.customer_id,
    customerName: row.customer_name,
    customerPhone: row.customer_phone || '',
    sellerUid: row.seller_uid || 'system',
    sellerName: row.seller_name,
    sellerUsuario: row.seller_usuario || '',
    items,
    total: Number(row.total || 0),
    totalPaid: Number(row.total_paid || 0),
    remainingBalance: Number(row.remaining_balance || 0),
    status: row.status,
    notes: row.notes || '',
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    settledAt: toIso(row.settled_at),
    deliveredAt: toIso(row.delivered_at),
    deliveredByUid: row.delivered_by_uid || undefined,
    deliveredByName: row.delivered_by_name || undefined,
    cancelledAt: toIso(row.cancelled_at),
    cancelledByUid: row.cancelled_by_uid || undefined,
    cancelledByName: row.cancelled_by_name || undefined,
    cancellationReason: row.cancellation_reason || undefined,
  };
}

function mapLayawayPaymentRow(row) {
  return {
    id: row.id,
    receiptFolio: row.receipt_folio,
    layawayId: row.layaway_id,
    layawayFolio: row.layaway_folio,
    branchId: row.branch_id,
    branchName: row.branch_name,
    customerId: row.customer_id,
    customerName: row.customer_name,
    sellerUid: row.seller_uid || 'system',
    sellerName: row.seller_name,
    sellerUsuario: row.seller_usuario || '',
    amount: Number(row.amount || 0),
    paymentMethod: row.payment_method,
    cashReceived: Number(row.cash_received || 0),
    changeGiven: Number(row.change_given || 0),
    reference: row.reference || '',
    balanceBefore: Number(row.balance_before || 0),
    balanceAfter: Number(row.balance_after || 0),
    isInitialDeposit: Boolean(row.is_initial_deposit),
    createdAt: toIso(row.created_at),
  };
}

function mapCashClosureRow(row) {
  return {
    id: row.id,
    folio: row.folio,
    branchId: row.branch_id,
    branchName: row.branch_name,
    status: row.status,
    openingFund: Number(row.opening_fund || 0),
    openedByUid: row.opened_by_uid || 'system',
    openedByName: row.opened_by_name,
    openedByUsuario: row.opened_by_usuario || '',
    openedAt: toIso(row.opened_at),
    updatedAt: toIso(row.updated_at),
    closedByUid: row.closed_by_uid || undefined,
    closedByName: row.closed_by_name || undefined,
    closedByUsuario: row.closed_by_usuario || undefined,
    closedAt: toIso(row.closed_at),
    directSalesCount: Number(row.direct_sales_count || 0),
    directSalesCash: Number(row.direct_sales_cash || 0),
    directSalesCard: Number(row.direct_sales_card || 0),
    directSalesTransfer: Number(row.direct_sales_transfer || 0),
    directSalesTotal: Number(row.direct_sales_total || 0),
    layawayPaymentsCount: Number(row.layaway_payments_count || 0),
    layawayCash: Number(row.layaway_cash || 0),
    layawayCard: Number(row.layaway_card || 0),
    layawayTransfer: Number(row.layaway_transfer || 0),
    layawayTotal: Number(row.layaway_total || 0),
    expectedCashTotal: Number(row.expected_cash_total || 0),
    totalCard: Number(row.total_card || 0),
    totalTransfer: Number(row.total_transfer || 0),
    grandTotalIncome: Number(row.grand_total_income || 0),
    countedCash: row.counted_cash !== null && row.counted_cash !== undefined ? Number(row.counted_cash) : undefined,
    difference: row.difference !== null && row.difference !== undefined ? Number(row.difference) : undefined,
    observations: row.observations || '',
  };
}

function mapAuditLogRow(row) {
  return {
    id: row.id,
    userUid: row.user_uid || 'system',
    userName: row.user_name,
    userUsuario: row.user_usuario || '',
    branchId: row.branch_id,
    branchName: row.branch_name,
    actionType: row.action_type,
    description: row.description,
    createdAt: toIso(row.created_at),
  };
}

async function insertAuditLog(conn, payload) {
  const id = generateId('log');
  await conn.query(
    `INSERT INTO audit_logs (
      id, user_uid, user_name, user_usuario, branch_id, branch_name, action_type, description
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      payload.userUid || null,
      truncateStr(payload.userName || 'Sistema', 120),
      truncateStr(payload.userUsuario || '', 64),
      truncateStr(payload.branchId || 'all', 64),
      truncateStr(payload.branchName || 'General', 80),
      truncateStr(payload.actionType, 48),
      truncateStr(payload.description, 600),
    ]
  );
  return id;
}

function resolveActor(req, bodyActor) {
  if (bodyActor && typeof bodyActor === 'object' && bodyActor.id) {
    return {
      id: String(bodyActor.id),
      nombreCompleto: String(bodyActor.nombreCompleto || 'Usuario'),
      usuario: String(bodyActor.usuario || ''),
      sucursalAsignada: String(bodyActor.sucursalAsignada || 'branch_1'),
    };
  }
  if (req.authUser) {
    return {
      id: req.authUser.uid,
      nombreCompleto: req.authUser.usuario,
      usuario: req.authUser.usuario,
      sucursalAsignada: 'branch_1',
    };
  }
  return {
    id: null,
    nombreCompleto: 'Sistema',
    usuario: 'system',
    sucursalAsignada: 'branch_1',
  };
}

async function loadProductsWithStock(executor, whereClause = '', params = []) {
  const [prodRows] = await executor.query(
    `SELECT * FROM products ${whereClause} ORDER BY updated_at DESC, created_at DESC`,
    params
  );
  if (prodRows.length === 0) return [];

  const prodIds = prodRows.map((p) => p.id);
  const placeholders = prodIds.map(() => '?').join(',');
  const [invRows] = await executor.query(
    `SELECT product_id, branch_id, quantity FROM branch_inventory WHERE product_id IN (${placeholders})`,
    prodIds
  );

  const stockByProd = new Map();
  for (const r of invRows) {
    let map = stockByProd.get(r.product_id);
    if (!map) {
      map = {};
      stockByProd.set(r.product_id, map);
    }
    map[r.branch_id] = Number(r.quantity || 0);
  }

  return prodRows.map((row) => mapProductRow(row, stockByProd.get(row.id) || {}));
}

async function syncProductInventory(conn, productId, stockMap) {
  const [branchRows] = await conn.query('SELECT id FROM branches');
  const validBranches = new Set(branchRows.map((b) => b.id));
  const entries = Object.entries(stockMap && typeof stockMap === 'object' ? stockMap : {});

  for (const [branchId, rawQty] of entries) {
    if (!validBranches.has(branchId)) continue;
    const qty = Math.max(0, Math.floor(Number(rawQty) || 0));
    await conn.query(
      `INSERT INTO branch_inventory (product_id, branch_id, quantity)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_at = CURRENT_TIMESTAMP(3)`,
      [productId, branchId, qty]
    );
  }
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// -----------------------------------------------------------------------------
// 1. Health Check
// -----------------------------------------------------------------------------
app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    try {
      await pingDatabase();
      res.json({
        status: 'ok',
        database: 'mariadb',
        connected: true,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      res.status(503).json({
        status: 'error',
        database: 'mariadb',
        connected: false,
        error: err instanceof Error ? err.message : 'Error de conexión con MariaDB',
      });
    }
  })
);

// -----------------------------------------------------------------------------
// 2. Autenticación Interna y Bootstrap de Administrador Inicial
// -----------------------------------------------------------------------------
async function handleBootstrap(req, res) {
  const { nombreCompleto, usuario, pin, pinHash: rawPinHash, defaultBranchId } = req.body || {};
  const cleanName = truncateStr(nombreCompleto, 120);
  const cleanUsuario = normalizeUsername(usuario);
  const computedPinHash =
    typeof rawPinHash === 'string' && /^[a-f0-9]{64}$/i.test(rawPinHash)
      ? rawPinHash.toLowerCase()
      : typeof pin === 'string' && pin.trim().length >= 4
        ? sha256Hex(pin.trim())
        : '';

  if (!cleanName || !cleanUsuario || !computedPinHash) {
    throw new HttpError(400, 'Nombre completo, usuario y contraseña/PIN son obligatorios.');
  }

  const result = await withTransaction(async (conn) => {
    const [countRows] = await conn.query('SELECT COUNT(*) AS total FROM users FOR UPDATE');
    if (Number(countRows[0]?.total || 0) > 0) {
      throw new HttpError(
        409,
        'Ya existe un administrador registrado. Inicia sesión con tus credenciales.'
      );
    }

    const [branchCountRows] = await conn.query('SELECT COUNT(*) AS total FROM branches');
    if (Number(branchCountRows[0]?.total || 0) === 0) {
      for (let i = 0; i < DEFAULT_BRANCH_LIST.length; i++) {
        const b = DEFAULT_BRANCH_LIST[i];
        await conn.query(
          `INSERT INTO branches (id, name, city, address, phone, is_active, sort_order)
           VALUES (?, ?, ?, ?, ?, TRUE, ?)`,
          [b.id, b.name, b.city, b.address, b.phone, i]
        );
      }
    }

    const [catCountRows] = await conn.query('SELECT COUNT(*) AS total FROM categories');
    if (Number(catCountRows[0]?.total || 0) === 0) {
      for (let i = 0; i < DEFAULT_PRODUCT_CATEGORIES.length; i++) {
        const catName = DEFAULT_PRODUCT_CATEGORIES[i];
        await conn.query(
          `INSERT INTO categories (id, name, sort_order) VALUES (?, ?, ?)`,
          [generateId('cat'), catName, i]
        );
      }
    }

    const adminId = generateId('usr');
    const assignedBranch = defaultBranchId || 'branch_1';

    await conn.query(
      `INSERT INTO users (
        id, nombre_completo, usuario, pin_hash, rol, sucursal_asignada,
        permisos, modo_oscuro, activo, operating_scope, last_login_at
      ) VALUES (?, ?, ?, ?, 'admin', ?, ?, FALSE, TRUE, 'general', CURRENT_TIMESTAMP(3))`,
      [
        adminId,
        cleanName,
        cleanUsuario,
        computedPinHash,
        assignedBranch,
        JSON.stringify(FULL_ADMIN_PERMISSIONS),
      ]
    );

    await conn.query(
      `INSERT INTO branding_settings (id, company_name, company_logo_url, updated_by_uid)
       VALUES ('branding', ?, ?, ?)
       ON DUPLICATE KEY UPDATE updated_by_uid = VALUES(updated_by_uid)`,
      [DEFAULT_BRANDING_CONFIG.companyName, DEFAULT_BRANDING_CONFIG.companyLogoUrl, adminId]
    );

    await insertAuditLog(conn, {
      userUid: adminId,
      userName: cleanName,
      userUsuario: cleanUsuario,
      branchId: 'all',
      branchName: 'Todas las sucursales',
      actionType: 'CREACION_USUARIO',
      description: `Registro inicial de Administrador Maestro ${cleanName} (@${cleanUsuario}).`,
    });

    const [createdRows] = await conn.query('SELECT * FROM users WHERE id = ?', [adminId]);
    const user = mapUserRow(createdRows[0]);
    const token = signAuthToken(user);
    return { user, token };
  });

  res.status(201).json(result);
}

app.post('/api/auth/bootstrap', asyncHandler(handleBootstrap));
app.post('/api/auth/bootstrap-admin', asyncHandler(handleBootstrap));

app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    const { usuario, pin, pinHash: rawPinHash } = req.body || {};
    const cleanUsuario = normalizeUsername(usuario);
    const enteredHash =
      typeof rawPinHash === 'string' && /^[a-f0-9]{64}$/i.test(rawPinHash)
        ? rawPinHash.toLowerCase()
        : typeof pin === 'string'
          ? sha256Hex(pin.trim())
          : '';

    if (!cleanUsuario || !enteredHash) {
      throw new HttpError(400, 'Ingresa usuario y contraseña / PIN.');
    }

    const result = await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT * FROM users WHERE usuario = ? LIMIT 1', [
        cleanUsuario,
      ]);
      if (rows.length === 0) {
        throw new HttpError(401, 'Usuario o contraseña / PIN incorrectos.');
      }

      const row = rows[0];
      if (String(row.pin_hash).toLowerCase() !== enteredHash) {
        throw new HttpError(401, 'Usuario o contraseña / PIN incorrectos.');
      }
      if (!row.activo) {
        throw new HttpError(
          403,
          'Tu cuenta se encuentra suspendida. Contacta a un administrador.'
        );
      }

      await conn.query(
        'UPDATE users SET last_login_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?',
        [row.id]
      );

      const [branchRows] = await conn.query('SELECT name FROM branches WHERE id = ?', [
        row.sucursal_asignada,
      ]);
      const branchName = branchRows[0]?.name || row.sucursal_asignada;

      await insertAuditLog(conn, {
        userUid: row.id,
        userName: row.nombre_completo,
        userUsuario: row.usuario,
        branchId: row.sucursal_asignada,
        branchName,
        actionType: 'INICIO_SESION',
        description: `Inicio de sesión interno de ${row.nombre_completo} (@${row.usuario}) en ${branchName}.`,
      });

      const user = mapUserRow(row);
      const token = signAuthToken(user);
      return { user, token };
    });

    res.json(result);
  })
);

app.post(
  '/api/auth/logout',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const actor = resolveActor(req, req.body?.actor);
    const branchName = req.body?.branchName || 'General';
    if (actor.id) {
      await withTransaction(async (conn) => {
        await insertAuditLog(conn, {
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId: actor.sucursalAsignada,
          branchName,
          actionType: 'CIERRE_SESION',
          description: `Cierre de sesión de ${actor.nombreCompleto} (@${actor.usuario}) en ${branchName}.`,
        });
      });
    }
    res.status(204).end();
  })
);

// -----------------------------------------------------------------------------
// 3. Branding / Identidad de Empresa (/api/settings/branding)
// -----------------------------------------------------------------------------
app.get(
  '/api/settings/branding',
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query(
      "SELECT company_name, company_logo_url, updated_by_uid, updated_at FROM branding_settings WHERE id = 'branding' LIMIT 1"
    );
    if (rows.length === 0) {
      res.json(DEFAULT_BRANDING_CONFIG);
      return;
    }
    const r = rows[0];
    res.json({
      companyName: r.company_name || DEFAULT_BRANDING_CONFIG.companyName,
      companyLogoUrl: r.company_logo_url || '',
      updatedByUid: r.updated_by_uid || 'system',
      updatedAt: toIso(r.updated_at),
    });
  })
);

app.put(
  '/api/settings/branding',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { companyName, companyLogoUrl = '' } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);
    const cleanName = truncateStr(companyName, 80);
    if (!cleanName) {
      throw new HttpError(400, 'El nombre de la empresa es obligatorio.');
    }

    await withTransaction(async (conn) => {
      await conn.query(
        `INSERT INTO branding_settings (id, company_name, company_logo_url, updated_by_uid)
         VALUES ('branding', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           company_name = VALUES(company_name),
           company_logo_url = VALUES(company_logo_url),
           updated_by_uid = VALUES(updated_by_uid),
           updated_at = CURRENT_TIMESTAMP(3)`,
        [cleanName, String(companyLogoUrl || ''), actor.id]
      );

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId: 'all',
        branchName: 'Todas las sucursales',
        actionType: 'CONFIGURACION_EMPRESA',
        description: `Actualización de identidad de empresa: "${cleanName}"${companyLogoUrl ? ' (con logotipo personalizado)' : ' (sin logotipo)'}.`,
      });
    });

    res.status(204).end();
  })
);

// -----------------------------------------------------------------------------
// 4. Sucursales (/api/branches y alias /api/settings/branches)
// -----------------------------------------------------------------------------
const getBranchesHandler = asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, city, address, phone, updated_at FROM branches WHERE is_active = TRUE ORDER BY sort_order ASC, id ASC'
  );
  if (rows.length === 0) {
    res.json(null);
    return;
  }
  const items = rows.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city || '',
    address: r.address || '',
    phone: r.phone || '',
  }));
  res.json({
    items,
    updatedAt: toIso(rows[0].updated_at),
    updatedByUid: 'system',
  });
});

const putBranchesBulkHandler = asyncHandler(async (req, res) => {
  const { items, auditDescription } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Debe existir al menos una sucursal activa.');
  }
  const actor = resolveActor(req, req.body?.actor);

  await withTransaction(async (conn) => {
    const incomingIds = new Set();
    for (let i = 0; i < items.length; i++) {
      const b = items[i];
      if (!b?.id || !b?.name) continue;
      incomingIds.add(b.id);
      await conn.query(
        `INSERT INTO branches (id, name, city, address, phone, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, TRUE, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           city = VALUES(city),
           address = VALUES(address),
           phone = VALUES(phone),
           is_active = TRUE,
           sort_order = VALUES(sort_order),
           updated_at = CURRENT_TIMESTAMP(3)`,
        [
          truncateStr(b.id, 64),
          truncateStr(b.name, 80),
          truncateStr(b.city || '', 80),
          truncateStr(b.address || '', 200),
          truncateStr(b.phone || '', 32),
          i,
        ]
      );
    }

    const [existingRows] = await conn.query('SELECT id FROM branches');
    for (const row of existingRows) {
      if (!incomingIds.has(row.id)) {
        await conn.query('UPDATE branches SET is_active = FALSE WHERE id = ?', [row.id]);
      }
    }

    await insertAuditLog(conn, {
      userUid: actor.id,
      userName: actor.nombreCompleto,
      userUsuario: actor.usuario,
      branchId: 'all',
      branchName: 'Todas las sucursales',
      actionType: 'CONFIGURACION_SUCURSALES',
      description: auditDescription || `Actualización de sucursales (${items.length} activas).`,
    });
  });

  res.status(204).end();
});

app.get('/api/branches', getBranchesHandler);
app.get('/api/settings/branches', getBranchesHandler);
app.put('/api/branches', requireAuth, putBranchesBulkHandler);
app.put('/api/settings/branches', requireAuth, putBranchesBulkHandler);

app.post(
  '/api/branches',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { id, name, city = '', address = '', phone = '' } = req.body || {};
    const branchId = truncateStr(id || generateId('branch'), 64);
    const cleanName = truncateStr(name, 80);
    if (!cleanName) throw new HttpError(400, 'El nombre de la sucursal es obligatorio.');

    await pool.query(
      `INSERT INTO branches (id, name, city, address, phone, is_active, sort_order)
       VALUES (?, ?, ?, ?, ?, TRUE, 99)`,
      [branchId, cleanName, truncateStr(city, 80), truncateStr(address, 200), truncateStr(phone, 32)]
    );

    res.status(201).json({ id: branchId, name: cleanName, city, address, phone });
  })
);

app.put(
  '/api/branches/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const branchId = req.params.id;
    const { name, city = '', address = '', phone = '' } = req.body || {};
    const cleanName = truncateStr(name, 80);
    if (!cleanName) throw new HttpError(400, 'El nombre de la sucursal es obligatorio.');

    const [result] = await pool.query(
      `UPDATE branches SET name = ?, city = ?, address = ?, phone = ?, is_active = TRUE WHERE id = ?`,
      [cleanName, truncateStr(city, 80), truncateStr(address, 200), truncateStr(phone, 32), branchId]
    );
    if (result.affectedRows === 0) throw new HttpError(404, 'Sucursal no encontrada.');
    res.json({ id: branchId, name: cleanName, city, address, phone });
  })
);

app.delete(
  '/api/branches/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const branchId = req.params.id;
    try {
      await pool.query('DELETE FROM branches WHERE id = ?', [branchId]);
    } catch {
      await pool.query('UPDATE branches SET is_active = FALSE WHERE id = ?', [branchId]);
    }
    res.status(204).end();
  })
);

// -----------------------------------------------------------------------------
// 5. Categorías (/api/categories y alias /api/settings/categories)
// -----------------------------------------------------------------------------
const getCategoriesHandler = asyncHandler(async (_req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, sort_order, updated_at FROM categories ORDER BY sort_order ASC, name ASC'
  );
  if (rows.length === 0) {
    res.json(null);
    return;
  }
  res.json({
    items: rows.map((r) => r.name),
    categories: rows.map((r) => ({ id: r.id, name: r.name, sortOrder: r.sort_order })),
    updatedAt: toIso(rows[0].updated_at),
  });
});

const putCategoriesBulkHandler = asyncHandler(async (req, res) => {
  const { items, auditDescription, renamed } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'Debe existir al menos una categoría.');
  }
  const actor = resolveActor(req, req.body?.actor);

  await withTransaction(async (conn) => {
    if (renamed && renamed.from && renamed.to && renamed.from !== renamed.to) {
      await conn.query('UPDATE products SET category_name = ? WHERE category_name = ?', [
        truncateStr(renamed.to, 64),
        truncateStr(renamed.from, 64),
      ]);
      await conn.query('UPDATE categories SET name = ? WHERE name = ?', [
        truncateStr(renamed.to, 64),
        truncateStr(renamed.from, 64),
      ]);
    }

    const cleanNames = [];
    for (let i = 0; i < items.length; i++) {
      const catName = truncateStr(items[i], 64);
      if (!catName) continue;
      cleanNames.push(catName);
      await conn.query(
        `INSERT INTO categories (id, name, sort_order, updated_by_uid)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sort_order = VALUES(sort_order),
           updated_by_uid = VALUES(updated_by_uid),
           updated_at = CURRENT_TIMESTAMP(3)`,
        [generateId('cat'), catName, i, actor.id]
      );
    }

    if (cleanNames.length > 0) {
      const placeholders = cleanNames.map(() => '?').join(',');
      await conn.query(
        `DELETE FROM categories WHERE name NOT IN (${placeholders})`,
        cleanNames
      );
    }

    await insertAuditLog(conn, {
      userUid: actor.id,
      userName: actor.nombreCompleto,
      userUsuario: actor.usuario,
      branchId: 'all',
      branchName: 'Todas las sucursales',
      actionType: 'CONFIGURACION_CATEGORIAS',
      description: auditDescription || `Actualización de categorías (${cleanNames.length}).`,
    });
  });

  res.status(204).end();
});

app.get('/api/categories', getCategoriesHandler);
app.get('/api/settings/categories', getCategoriesHandler);
app.put('/api/categories', requireAuth, putCategoriesBulkHandler);
app.put('/api/settings/categories', requireAuth, putCategoriesBulkHandler);

app.post(
  '/api/categories',
  requireAuth,
  asyncHandler(async (req, res) => {
    const cleanName = truncateStr(req.body?.name, 64);
    if (!cleanName) throw new HttpError(400, 'El nombre de categoría es obligatorio.');
    const actor = resolveActor(req, req.body?.actor);
    const id = generateId('cat');
    await pool.query(
      'INSERT INTO categories (id, name, sort_order, updated_by_uid) VALUES (?, ?, 99, ?)',
      [id, cleanName, actor.id]
    );
    res.status(201).json({ id, name: cleanName });
  })
);

app.put(
  '/api/categories/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const cleanName = truncateStr(req.body?.name, 64);
    if (!cleanName) throw new HttpError(400, 'El nombre de categoría es obligatorio.');
    const [existing] = await pool.query('SELECT name FROM categories WHERE id = ?', [
      req.params.id,
    ]);
    if (existing.length === 0) throw new HttpError(404, 'Categoría no encontrada.');

    await withTransaction(async (conn) => {
      await conn.query('UPDATE categories SET name = ? WHERE id = ?', [cleanName, req.params.id]);
      await conn.query('UPDATE products SET category_name = ? WHERE category_id = ?', [
        cleanName,
        req.params.id,
      ]);
    });
    res.json({ id: req.params.id, name: cleanName });
  })
);

app.delete(
  '/api/categories/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    res.status(204).end();
  })
);

// -----------------------------------------------------------------------------
// 6. Usuarios y Permisos (/api/users)
// -----------------------------------------------------------------------------
app.get(
  '/api/users',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
    if (!req.authUser) {
      // Pre-login bootstrap check: sin exponer datos sensibles ni hashes
      res.json(
        rows.map((r) => ({
          id: r.id,
          nombreCompleto: '',
          usuario: r.usuario,
          pinHash: '',
          rol: r.rol,
          sucursalAsignada: r.sucursal_asignada,
          permisos: DEFAULT_SELLER_PERMISSIONS,
          modoOscuro: false,
          activo: Boolean(r.activo),
          createdAt: toIso(r.created_at),
        }))
      );
      return;
    }
    res.json(rows.map((r) => mapUserRow(r)));
  })
);

app.get(
  '/api/users/:id',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ? LIMIT 1', [req.params.id]);
    if (rows.length === 0) {
      res.json(null);
      return;
    }
    res.json(mapUserRow(rows[0]));
  })
);

app.post(
  '/api/users',
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      nombreCompleto,
      usuario,
      pinHash,
      pin,
      rol = 'vendedor',
      sucursalAsignada = 'branch_1',
      permisos = DEFAULT_SELLER_PERMISSIONS,
      activo = true,
      branchName = '',
    } = req.body || {};

    const actor = resolveActor(req, req.body?.actor);
    const cleanName = truncateStr(nombreCompleto, 120);
    const cleanUsuario = normalizeUsername(usuario);
    const finalHash =
      typeof pinHash === 'string' && /^[a-f0-9]{64}$/i.test(pinHash)
        ? pinHash.toLowerCase()
        : typeof pin === 'string' && pin.trim().length >= 4
          ? sha256Hex(pin.trim())
          : '';

    if (!cleanName || !cleanUsuario || !finalHash) {
      throw new HttpError(400, 'Nombre completo, usuario y contraseña/PIN son obligatorios.');
    }

    const userId = generateId('usr');
    const finalPerms = rol === 'admin' ? FULL_ADMIN_PERMISSIONS : permisos;

    const createdUser = await withTransaction(async (conn) => {
      const [dupRows] = await conn.query('SELECT id FROM users WHERE usuario = ?', [cleanUsuario]);
      if (dupRows.length > 0) {
        throw new HttpError(409, `El usuario "${cleanUsuario}" ya existe.`);
      }

      await conn.query(
        `INSERT INTO users (
          id, nombre_completo, usuario, pin_hash, rol, sucursal_asignada,
          permisos, modo_oscuro, activo, operating_scope
        ) VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, ?, ?)`,
        [
          userId,
          cleanName,
          cleanUsuario,
          finalHash,
          rol === 'admin' ? 'admin' : 'vendedor',
          sucursalAsignada,
          JSON.stringify(finalPerms),
          Boolean(activo),
          rol === 'admin' ? 'general' : sucursalAsignada,
        ]
      );

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId: sucursalAsignada,
        branchName: branchName || sucursalAsignada,
        actionType: 'CREACION_USUARIO',
        description: `Alta de usuario ${cleanName} (@${cleanUsuario}) con rol ${rol} asignado a ${branchName || sucursalAsignada}.`,
      });

      const [rows] = await conn.query('SELECT * FROM users WHERE id = ?', [userId]);
      return mapUserRow(rows[0]);
    });

    res.status(201).json(createdUser);
  })
);

app.put(
  '/api/users/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.params.id;
    const {
      nombreCompleto,
      usuario,
      pinHash,
      pin,
      rol,
      sucursalAsignada,
      permisos,
      activo,
      branchName = '',
    } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);

    const cleanName = truncateStr(nombreCompleto, 120);
    const cleanUsuario = normalizeUsername(usuario);
    if (!cleanName || !cleanUsuario) {
      throw new HttpError(400, 'Nombre y usuario son obligatorios.');
    }

    const nextHash =
      typeof pinHash === 'string' && /^[a-f0-9]{64}$/i.test(pinHash)
        ? pinHash.toLowerCase()
        : typeof pin === 'string' && pin.trim().length >= 4
          ? sha256Hex(pin.trim())
          : null;

    await withTransaction(async (conn) => {
      const [existingRows] = await conn.query('SELECT * FROM users WHERE id = ? FOR UPDATE', [
        userId,
      ]);
      if (existingRows.length === 0) {
        throw new HttpError(404, 'Usuario no encontrado.');
      }

      const [dupRows] = await conn.query(
        'SELECT id FROM users WHERE usuario = ? AND id <> ?',
        [cleanUsuario, userId]
      );
      if (dupRows.length > 0) {
        throw new HttpError(409, `El usuario "${cleanUsuario}" ya está en uso.`);
      }

      const finalRole = rol === 'admin' ? 'admin' : 'vendedor';
      const finalPerms =
        finalRole === 'admin'
          ? FULL_ADMIN_PERMISSIONS
          : permisos || parseJsonSafe(existingRows[0].permisos, DEFAULT_SELLER_PERMISSIONS);

      await conn.query(
        `UPDATE users SET
          nombre_completo = ?,
          usuario = ?,
          pin_hash = COALESCE(?, pin_hash),
          rol = ?,
          sucursal_asignada = ?,
          permisos = ?,
          activo = ?,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
        [
          cleanName,
          cleanUsuario,
          nextHash,
          finalRole,
          sucursalAsignada || existingRows[0].sucursal_asignada,
          JSON.stringify(finalPerms),
          activo !== undefined ? Boolean(activo) : Boolean(existingRows[0].activo),
          userId,
        ]
      );

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId: sucursalAsignada || existingRows[0].sucursal_asignada,
        branchName: branchName || sucursalAsignada || existingRows[0].sucursal_asignada,
        actionType: 'EDICION_USUARIO',
        description: `Actualización de cuenta ${cleanName} (@${cleanUsuario}) — rol ${finalRole}, estado ${activo === false ? 'Inactivo' : 'Activo'}.`,
      });
    });

    res.status(204).end();
  })
);

app.patch(
  '/api/users/:id/theme',
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.query('UPDATE users SET modo_oscuro = ? WHERE id = ?', [
      Boolean(req.body?.modoOscuro),
      req.params.id,
    ]);
    res.status(204).end();
  })
);

app.patch(
  '/api/users/:id/operating-scope',
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.query('UPDATE users SET operating_scope = ? WHERE id = ?', [
      truncateStr(req.body?.operatingScope || 'general', 64),
      req.params.id,
    ]);
    res.status(204).end();
  })
);

app.patch(
  '/api/users/:id/permissions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.params.id;
    const { targetUser, nextPermissions, permLabel, enabled, branchName } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);

    await withTransaction(async (conn) => {
      await conn.query('UPDATE users SET permisos = ? WHERE id = ?', [
        JSON.stringify(nextPermissions || DEFAULT_SELLER_PERMISSIONS),
        userId,
      ]);

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId: targetUser?.sucursalAsignada || 'all',
        branchName: branchName || 'General',
        actionType: 'CAMBIO_PERMISOS',
        description: `Permiso "${permLabel || 'Permiso'}" ${enabled ? 'ACTIVADO' : 'DESACTIVADO'} para @${targetUser?.usuario || userId}.`,
      });
    });

    res.status(204).end();
  })
);

app.delete(
  '/api/users/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.status(204).end();
  })
);

// -----------------------------------------------------------------------------
// 7. Inventario y Productos (/api/products, /api/products/bulk)
// -----------------------------------------------------------------------------
app.get(
  '/api/products',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const list = await loadProductsWithStock(pool);
    res.json(list);
  })
);

app.get(
  '/api/products/check-sku',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sku = String(req.query.sku || '').trim();
    const excludeId = String(req.query.excludeId || '').trim();
    if (!sku) {
      res.json({ duplicate: null });
      return;
    }

    const [rows] = await pool.query(
      'SELECT id, name FROM products WHERE (sku = ? OR barcode_sku = ?) AND id <> ? LIMIT 1',
      [sku, sku, excludeId]
    );
    res.json({
      duplicate: rows.length > 0 ? { id: rows[0].id, name: rows[0].name } : null,
    });
  })
);

app.get(
  '/api/products/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const list = await loadProductsWithStock(pool, 'WHERE id = ?', [req.params.id]);
    if (list.length === 0) throw new HttpError(404, 'Producto no encontrado.');
    res.json(list[0]);
  })
);

app.post(
  '/api/products',
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      sku,
      name,
      category,
      size = 'Única',
      color = '',
      price,
      stock = {},
      branchId = 'branch_1',
      branchName = 'Sucursal 1',
    } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);

    const cleanSku = truncateStr(sku, 64);
    const cleanName = truncateStr(name, 140);
    const cleanCategory = truncateStr(category || 'General', 64);
    if (!cleanSku || !cleanName) {
      throw new HttpError(400, 'SKU / Código de barras y nombre son obligatorios.');
    }

    const prodId = generateId('prod');
    const created = await withTransaction(async (conn) => {
      const [dup] = await conn.query(
        'SELECT id FROM products WHERE sku = ? OR barcode_sku = ? LIMIT 1',
        [cleanSku, cleanSku]
      );
      if (dup.length > 0) {
        throw new HttpError(409, `El SKU / Código de barras "${cleanSku}" ya está registrado.`);
      }

      const [catRows] = await conn.query('SELECT id FROM categories WHERE name = ? LIMIT 1', [
        cleanCategory,
      ]);
      const categoryId = catRows[0]?.id || null;

      await conn.query(
        `INSERT INTO products (
          id, sku, barcode_sku, name, category_id, category_name, size, color, price, created_by_uid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          prodId,
          cleanSku,
          cleanSku,
          cleanName,
          categoryId,
          cleanCategory,
          truncateStr(size, 32),
          truncateStr(color, 48),
          Number(price || 0),
          actor.id,
        ]
      );

      await syncProductInventory(conn, prodId, stock);

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId,
        branchName,
        actionType: 'ALTA_PRODUCTO',
        description: `Alta de nuevo producto "${cleanName}" (Código de barras / SKU: ${cleanSku}, Categoría: ${cleanCategory}, Talla: ${size}, Color: ${color}, Precio: ${formatCurrency(price)}).`,
      });

      const list = await loadProductsWithStock(conn, 'WHERE id = ?', [prodId]);
      return list[0];
    });

    res.status(201).json(created);
  })
);

const bulkImportProductsHandler = asyncHandler(async (req, res) => {
  const {
    existingCategories = [],
    categoriesToAdd = [],
    primaryBranchId = 'branch_1',
    primaryBranchName = 'Sucursal 1',
    items = [],
    summaryText = '',
  } = req.body || {};
  const actor = resolveActor(req, req.body?.actor);

  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, 'No se recibieron productos para importar.');
  }

  const result = await withTransaction(async (conn) => {
    const mergedCategories = [...existingCategories, ...categoriesToAdd].slice(0, 50);
    for (let i = 0; i < mergedCategories.length; i++) {
      const catName = truncateStr(mergedCategories[i], 64);
      if (!catName) continue;
      await conn.query(
        `INSERT INTO categories (id, name, sort_order, updated_by_uid)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)`,
        [generateId('cat'), catName, i, actor.id]
      );
    }

    const [allCatRows] = await conn.query('SELECT id, name FROM categories');
    const catIdByName = new Map(allCatRows.map((c) => [c.name, c.id]));

    const createdProducts = [];
    for (const item of items) {
      const prodId = generateId('prod');
      const cleanBarcode = truncateStr(item.barcodeSKU || item.sku, 64);
      const cleanCategory = truncateStr(item.category || 'General', 64);
      const extraAttrs = {};
      if (item.codigoModelo) extraAttrs.codigoModelo = item.codigoModelo;
      if (item.codigoActual) extraAttrs.codigoActual = item.codigoActual;
      if (item.marca) extraAttrs.marca = item.marca;
      if (item.especificaciones) extraAttrs.especificaciones = item.especificaciones;
      if (item.estatusOriginal) extraAttrs.estatusOriginal = item.estatusOriginal;
      if (item.costoReferencia !== undefined) extraAttrs.costoReferencia = item.costoReferencia;

      await conn.query(
        `INSERT INTO products (
          id, sku, barcode_sku, codigo_modelo, codigo_actual, name,
          category_id, category_name, size, color, marca, especificaciones,
          estatus_original, costo_referencia, price, extra_attributes, created_by_uid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          prodId,
          cleanBarcode,
          cleanBarcode,
          truncateStr(item.codigoModelo || '', 64),
          truncateStr(item.codigoActual || '', 64),
          truncateStr(item.name, 140),
          catIdByName.get(cleanCategory) || null,
          cleanCategory,
          truncateStr(item.size || 'Única', 32),
          truncateStr(item.color || '', 48),
          truncateStr(item.marca || '', 64),
          truncateStr(item.especificaciones || '', 240),
          truncateStr(item.estatusOriginal || '', 64),
          item.costoReferencia !== undefined ? Number(item.costoReferencia) : null,
          Number(item.price || 0),
          Object.keys(extraAttrs).length > 0 ? JSON.stringify(extraAttrs) : null,
          actor.id,
        ]
      );

      await syncProductInventory(conn, prodId, item.stock || {});

      createdProducts.push({
        id: prodId,
        sku: cleanBarcode,
        barcodeSKU: cleanBarcode,
        name: truncateStr(item.name, 140),
        category: cleanCategory,
        size: truncateStr(item.size || 'Única', 32),
        color: truncateStr(item.color || '', 48),
        price: Number(item.price || 0),
        stock: item.stock || {},
        createdByUid: actor.id || 'system',
        ...extraAttrs,
      });
    }

    await insertAuditLog(conn, {
      userUid: actor.id,
      userName: actor.nombreCompleto,
      userUsuario: actor.usuario,
      branchId: primaryBranchId,
      branchName: primaryBranchName,
      actionType: 'IMPORTACION_EXCEL',
      description:
        summaryText ||
        `Importación masiva de Excel: ${createdProducts.length} producto(s) importado(s).`,
    });

    return {
      insertedCount: createdProducts.length,
      categoriesAdded: categoriesToAdd,
      createdProducts,
    };
  });

  res.status(201).json(result);
});

app.post('/api/products/bulk', requireAuth, bulkImportProductsHandler);
app.post('/api/products/bulk-import', requireAuth, bulkImportProductsHandler);

app.put(
  '/api/products/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const productId = req.params.id;
    const {
      sku,
      name,
      category,
      size = 'Única',
      color = '',
      price,
      stock = {},
      branchId = 'branch_1',
      branchName = 'Sucursal 1',
    } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);

    const cleanSku = truncateStr(sku, 64);
    const cleanName = truncateStr(name, 140);
    const cleanCategory = truncateStr(category || 'General', 64);

    await withTransaction(async (conn) => {
      const [existing] = await conn.query('SELECT id FROM products WHERE id = ? FOR UPDATE', [
        productId,
      ]);
      if (existing.length === 0) throw new HttpError(404, 'Producto no encontrado.');

      const [dup] = await conn.query(
        'SELECT id FROM products WHERE (sku = ? OR barcode_sku = ?) AND id <> ? LIMIT 1',
        [cleanSku, cleanSku, productId]
      );
      if (dup.length > 0) {
        throw new HttpError(409, `El SKU / Código de barras "${cleanSku}" pertenece a otro producto.`);
      }

      const [catRows] = await conn.query('SELECT id FROM categories WHERE name = ? LIMIT 1', [
        cleanCategory,
      ]);

      await conn.query(
        `UPDATE products SET
          sku = ?,
          barcode_sku = ?,
          name = ?,
          category_id = ?,
          category_name = ?,
          size = ?,
          color = ?,
          price = ?,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
        [
          cleanSku,
          cleanSku,
          cleanName,
          catRows[0]?.id || null,
          cleanCategory,
          truncateStr(size, 32),
          truncateStr(color, 48),
          Number(price || 0),
          productId,
        ]
      );

      await syncProductInventory(conn, productId, stock);

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId,
        branchName,
        actionType: 'ALTA_PRODUCTO',
        description: `Actualización de producto "${cleanName}" (Código de barras / SKU: ${cleanSku}, Precio: ${formatCurrency(price)}).`,
      });
    });

    res.status(204).end();
  })
);

app.post(
  '/api/products/:id/stock-adjust',
  requireAuth,
  asyncHandler(async (req, res) => {
    const productId = req.params.id;
    const { mode, branchId, branchName, quantity, reason = '' } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);
    const qty = Math.floor(Number(quantity) || 0);
    if (qty <= 0) throw new HttpError(400, 'La cantidad debe ser mayor a cero.');

    const isDiscard = mode === 'discard';
    const cleanReason = String(reason || '').trim();

    const result = await withTransaction(async (conn) => {
      const [prodRows] = await conn.query(
        'SELECT id, name, sku FROM products WHERE id = ? FOR UPDATE',
        [productId]
      );
      if (prodRows.length === 0) {
        throw new HttpError(404, 'El producto ya no existe en el catálogo.');
      }
      const prod = prodRows[0];

      const [invRows] = await conn.query(
        'SELECT quantity FROM branch_inventory WHERE product_id = ? AND branch_id = ? FOR UPDATE',
        [productId, branchId]
      );
      const previousStock = invRows.length > 0 ? Number(invRows[0].quantity) : 0;

      if (isDiscard && qty > previousStock) {
        throw new HttpError(
          400,
          `No puedes descartar ${qty} unidades; solo hay ${previousStock} disponibles en ${branchName}.`
        );
      }

      const nextStock = isDiscard ? previousStock - qty : previousStock + qty;

      await conn.query(
        `INSERT INTO branch_inventory (product_id, branch_id, quantity)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_at = CURRENT_TIMESTAMP(3)`,
        [productId, branchId, nextStock]
      );

      const noteSuffix = cleanReason ? ` Motivo: ${cleanReason}.` : '';
      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId,
        branchName,
        actionType: isDiscard ? 'DESCARTE_STOCK' : 'ENTRADA_STOCK',
        description: isDiscard
          ? `Descarte de ${qty} u. de "${prod.name}" (SKU ${prod.sku}) en ${branchName}. Stock: ${previousStock} -> ${nextStock}.${noteSuffix}`
          : `Entrada de ${qty} u. de "${prod.name}" (SKU ${prod.sku}) en ${branchName}. Stock: ${previousStock} -> ${nextStock}.${noteSuffix}`,
      });

      return { previousStock, nextStock };
    });

    res.json(result);
  })
);

app.delete(
  '/api/products/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
    res.status(204).end();
  })
);

app.delete(
  '/api/products',
  requireAuth,
  asyncHandler(async (req, res) => {
    const actor = resolveActor(req, req.body?.actor);
    const deletedCount = await withTransaction(async (conn) => {
      const [countRows] = await conn.query('SELECT COUNT(*) AS total FROM products');
      const total = Number(countRows[0]?.total || 0);
      if (total > 0) {
        await conn.query('DELETE FROM products');
        await insertAuditLog(conn, {
          userUid: actor.id,
          userName: actor.nombreCompleto,
          userUsuario: actor.usuario,
          branchId: 'all',
          branchName: 'Todas las sucursales',
          actionType: 'VACIADO_INVENTARIO',
          description: `Vaciado total temporal de inventario ejecutado: ${total} producto(s) eliminado(s) de MariaDB.`,
        });
      }
      return total;
    });
    res.json({ deletedCount });
  })
);

// -----------------------------------------------------------------------------
// 8. Clientes CRM y Datos Fiscales (/api/customers)
// -----------------------------------------------------------------------------
app.get(
  '/api/customers',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const [rows] = await pool.query('SELECT * FROM customers ORDER BY nombre_completo ASC');
    res.json(rows.map(mapCustomerRow));
  })
);

app.get(
  '/api/customers/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ? LIMIT 1', [
      req.params.id,
    ]);
    if (rows.length === 0) throw new HttpError(404, 'Cliente no encontrado.');
    res.json(mapCustomerRow(rows[0]));
  })
);

app.post(
  '/api/customers',
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      nombreCompleto,
      telefono = '',
      email = '',
      fechaEvento = '',
      notas = '',
      datosFiscales = {},
      branchId = 'branch_1',
      branchName = 'Sucursal 1',
    } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);
    const cleanName = truncateStr(nombreCompleto, 120);
    if (!cleanName) throw new HttpError(400, 'El nombre del cliente es obligatorio.');

    const customerId = generateId('cli');
    const created = await withTransaction(async (conn) => {
      await conn.query(
        `INSERT INTO customers (
          id, nombre_completo, telefono, email, fecha_evento, notas,
          rfc, razon_social, codigo_postal, regimen_fiscal, uso_cfdi,
          created_by_uid, created_by_name
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          customerId,
          cleanName,
          truncateStr(telefono, 32),
          truncateStr(email, 120),
          truncateStr(fechaEvento, 20),
          truncateStr(notas, 500),
          truncateStr(datosFiscales.rfc || '', 16),
          truncateStr(datosFiscales.razonSocial || '', 160),
          truncateStr(datosFiscales.codigoPostal || '', 10),
          truncateStr(datosFiscales.regimenFiscal || '', 100),
          truncateStr(datosFiscales.usoCfdi || '', 100),
          actor.id,
          truncateStr(actor.nombreCompleto, 120),
        ]
      );

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId,
        branchName,
        actionType: 'CREACION_CLIENTE',
        description: `Alta de cliente "${cleanName}" (WhatsApp/Tel: ${telefono}${fechaEvento ? `, Evento: ${fechaEvento}` : ''}${datosFiscales.rfc ? `, RFC: ${datosFiscales.rfc}` : ''}).`,
      });

      const [rows] = await conn.query('SELECT * FROM customers WHERE id = ?', [customerId]);
      return mapCustomerRow(rows[0]);
    });

    res.status(201).json(created);
  })
);

app.put(
  '/api/customers/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const customerId = req.params.id;
    const {
      nombreCompleto,
      telefono = '',
      email = '',
      fechaEvento = '',
      notas = '',
      datosFiscales = {},
      branchId = 'branch_1',
      branchName = 'Sucursal 1',
    } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);
    const cleanName = truncateStr(nombreCompleto, 120);
    if (!cleanName) throw new HttpError(400, 'El nombre del cliente es obligatorio.');

    const updated = await withTransaction(async (conn) => {
      const [existing] = await conn.query('SELECT id FROM customers WHERE id = ?', [customerId]);
      if (existing.length === 0) throw new HttpError(404, 'Cliente no encontrado.');

      await conn.query(
        `UPDATE customers SET
          nombre_completo = ?,
          telefono = ?,
          email = ?,
          fecha_evento = ?,
          notas = ?,
          rfc = ?,
          razon_social = ?,
          codigo_postal = ?,
          regimen_fiscal = ?,
          uso_cfdi = ?,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
        [
          cleanName,
          truncateStr(telefono, 32),
          truncateStr(email, 120),
          truncateStr(fechaEvento, 20),
          truncateStr(notas, 500),
          truncateStr(datosFiscales.rfc || '', 16),
          truncateStr(datosFiscales.razonSocial || '', 160),
          truncateStr(datosFiscales.codigoPostal || '', 10),
          truncateStr(datosFiscales.regimenFiscal || '', 100),
          truncateStr(datosFiscales.usoCfdi || '', 100),
          customerId,
        ]
      );

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId,
        branchName,
        actionType: 'EDICION_CLIENTE',
        description: `Actualización de expediente de cliente "${cleanName}" (Tel: ${telefono}${datosFiscales.rfc ? `, RFC: ${datosFiscales.rfc}` : ''}).`,
      });

      const [rows] = await conn.query('SELECT * FROM customers WHERE id = ?', [customerId]);
      return mapCustomerRow(rows[0]);
    });

    res.json(updated);
  })
);

app.delete(
  '/api/customers/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const customerId = req.params.id;
    const {
      branchId = 'branch_1',
      branchName = 'Sucursal 1',
    } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);

    await withTransaction(async (conn) => {
      const [existing] = await conn.query(
        'SELECT id, nombre_completo, telefono FROM customers WHERE id = ? FOR UPDATE',
        [customerId]
      );
      if (existing.length === 0) {
        throw new HttpError(404, 'Cliente no encontrado.');
      }

      const [layawayRows] = await conn.query(
        'SELECT COUNT(*) AS total FROM layaways WHERE customer_id = ? FOR UPDATE',
        [customerId]
      );
      if (Number(layawayRows[0]?.total || 0) > 0) {
        throw new HttpError(
          409,
          'No se puede quitar este cliente porque tiene apartados registrados en su historial.'
        );
      }

      await conn.query('DELETE FROM customers WHERE id = ?', [customerId]);

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId,
        branchName,
        actionType: 'ELIMINACION_CLIENTE',
        description: `Baja de cliente "${existing[0].nombre_completo}" (WhatsApp/Tel: ${existing[0].telefono}).`,
      });
    });

    res.status(204).end();
  })
);

// -----------------------------------------------------------------------------
// 9. Ventas Directas POS con Transacción SQL (/api/sales)
// -----------------------------------------------------------------------------
app.get(
  '/api/sales',
  requireAuth,
  asyncHandler(async (req, res) => {
    const branchId = req.query.branchId ? String(req.query.branchId) : null;
    const customerId = req.query.customerId ? String(req.query.customerId) : null;
    const limitCount = Math.min(500, Math.max(1, Number(req.query.limit || 250)));

    const conditions = [];
    const params = [];
    if (customerId) {
      conditions.push('customer_id = ?');
      params.push(customerId);
    } else if (branchId) {
      conditions.push('branch_id = ?');
      params.push(branchId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const [saleRows] = await pool.query(
      `SELECT * FROM sales ${whereClause} ORDER BY created_at DESC LIMIT ?`,
      [...params, limitCount]
    );
    if (saleRows.length === 0) {
      res.json([]);
      return;
    }

    const saleIds = saleRows.map((s) => s.id);
    const placeholders = saleIds.map(() => '?').join(',');
    const [itemRows] = await pool.query(
      `SELECT * FROM sale_items WHERE sale_id IN (${placeholders}) ORDER BY id ASC`,
      saleIds
    );

    const itemsBySale = new Map();
    for (const r of itemRows) {
      let arr = itemsBySale.get(r.sale_id);
      if (!arr) {
        arr = [];
        itemsBySale.set(r.sale_id, arr);
      }
      arr.push(mapSaleItemRow(r));
    }

    res.json(saleRows.map((row) => mapSaleRow(row, itemsBySale.get(row.id) || [])));
  })
);

app.get(
  '/api/sales/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [saleRows] = await pool.query('SELECT * FROM sales WHERE id = ? LIMIT 1', [
      req.params.id,
    ]);
    if (saleRows.length === 0) throw new HttpError(404, 'Venta no encontrada.');
    const [itemRows] = await pool.query(
      'SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id ASC',
      [req.params.id]
    );
    res.json(mapSaleRow(saleRows[0], itemRows.map(mapSaleItemRow)));
  })
);

app.post(
  '/api/sales',
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      branchId,
      branchName,
      items = [],
      subtotal = 0,
      discountType = 'none',
      discountValue = 0,
      discountAmount = 0,
      total = 0,
      paymentMethod,
      cashReceived = 0,
      changeGiven = 0,
      cardReference = '',
      transferReference = '',
      customer = null,
    } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);

    if (!branchId || !Array.isArray(items) || items.length === 0) {
      throw new HttpError(400, 'La venta requiere sucursal y al menos un producto.');
    }

    const createdSale = await withTransaction(async (conn) => {
      const [counterRows] = await conn.query(
        'SELECT last_sequence FROM folio_counters WHERE counter_key = ? FOR UPDATE',
        [branchId]
      );
      const nextSequence = (Number(counterRows[0]?.last_sequence) || 0) + 1;
      const assignedFolio = formatConsecutiveFolio(branchId, nextSequence);

      await conn.query(
        `INSERT INTO folio_counters (counter_key, branch_id, last_sequence)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_sequence = VALUES(last_sequence), updated_at = CURRENT_TIMESTAMP(3)`,
        [branchId, branchId, nextSequence]
      );

      const validatedItems = [];
      for (const line of items) {
        const qty = Math.floor(Number(line.quantity) || 0);
        if (qty <= 0) throw new HttpError(400, 'Cantidad inválida en la venta.');

        const [prodRows] = await conn.query(
          'SELECT id, sku, name, size, color, price FROM products WHERE id = ? FOR UPDATE',
          [line.productId]
        );
        if (prodRows.length === 0) {
          throw new HttpError(
            404,
            `El producto "${line.productName || line.productId}" ya no existe en el catálogo.`
          );
        }
        const prod = prodRows[0];

        const [invRows] = await conn.query(
          'SELECT quantity FROM branch_inventory WHERE product_id = ? AND branch_id = ? FOR UPDATE',
          [line.productId, branchId]
        );
        const currentQty = invRows.length > 0 ? Number(invRows[0].quantity) : 0;
        if (currentQty < qty) {
          throw new HttpError(
            409,
            `Stock insuficiente para "${prod.name}" en ${branchName}. Disponible: ${currentQty}, solicitado: ${qty}.`
          );
        }

        await conn.query(
          `INSERT INTO branch_inventory (product_id, branch_id, quantity)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_at = CURRENT_TIMESTAMP(3)`,
          [line.productId, branchId, currentQty - qty]
        );

        const unitPrice = Number(prod.price || 0);
        validatedItems.push({
          productId: prod.id,
          sku: prod.sku,
          name: prod.name,
          size: prod.size,
          color: prod.color,
          unitPrice,
          quantity: qty,
          lineTotal: Number((unitPrice * qty).toFixed(2)),
        });
      }

      const saleId = generateId('sale');
      const finalCardRef = paymentMethod === 'Tarjeta' ? truncateStr(cardReference, 64) : '';
      const finalTransferRef =
        paymentMethod === 'Transferencia' ? truncateStr(transferReference, 64) : '';

      await conn.query(
        `INSERT INTO sales (
          id, folio, branch_id, branch_name, seller_uid, seller_name, seller_usuario,
          customer_id, customer_name, subtotal, discount_type, discount_value, discount_amount,
          total, payment_method, cash_received, change_given, card_reference, transfer_reference, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completada')`,
        [
          saleId,
          assignedFolio,
          branchId,
          truncateStr(branchName, 80),
          actor.id,
          truncateStr(actor.nombreCompleto, 120),
          truncateStr(actor.usuario, 64),
          customer?.id || null,
          truncateStr(customer?.nombreCompleto || '', 120),
          Number(subtotal),
          discountType,
          Number(discountValue),
          Number(discountAmount),
          Number(total),
          paymentMethod,
          paymentMethod === 'Efectivo' ? Number(cashReceived) : Number(total),
          paymentMethod === 'Efectivo' ? Number(changeGiven) : 0,
          finalCardRef,
          finalTransferRef,
        ]
      );

      for (const item of validatedItems) {
        await conn.query(
          `INSERT INTO sale_items (
            sale_id, product_id, sku, name, size, color, unit_price, quantity, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            saleId,
            item.productId,
            item.sku,
            item.name,
            item.size,
            item.color,
            item.unitPrice,
            item.quantity,
            item.lineTotal,
          ]
        );
      }

      const totalUnits = validatedItems.reduce((sum, it) => sum + it.quantity, 0);
      const refText =
        paymentMethod === 'Tarjeta' && finalCardRef
          ? ` (Ref. tarjeta: ${finalCardRef})`
          : paymentMethod === 'Transferencia' && finalTransferRef
            ? ` (Rastreo: ${finalTransferRef})`
            : '';

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId,
        branchName,
        actionType: 'VENTA_REALIZADA',
        description: `Venta folio ${assignedFolio} en ${branchName} por ${formatCurrency(total)} (${totalUnits} u., ${paymentMethod}${refText}${customer ? `, Cliente: ${customer.nombreCompleto}` : ''}).`,
      });

      const [saleRows] = await conn.query('SELECT * FROM sales WHERE id = ?', [saleId]);
      return mapSaleRow(saleRows[0], validatedItems);
    });

    res.status(201).json(createdSale);
  })
);

app.post(
  '/api/sales/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const saleId = req.params.id;
    const reason = truncateStr(req.body?.reason || 'Cancelación operativa', 300);
    const actor = resolveActor(req, req.body?.actor);

    await withTransaction(async (conn) => {
      const [saleRows] = await conn.query('SELECT * FROM sales WHERE id = ? FOR UPDATE', [
        saleId,
      ]);
      if (saleRows.length === 0) throw new HttpError(404, 'La venta ya no existe.');
      const sale = saleRows[0];
      if (sale.status === 'cancelada') {
        throw new HttpError(409, 'Esta venta ya fue cancelada previamente.');
      }

      const [itemRows] = await conn.query('SELECT * FROM sale_items WHERE sale_id = ?', [saleId]);
      let totalUnits = 0;

      for (const item of itemRows) {
        totalUnits += Number(item.quantity || 0);
        if (!item.product_id) continue;

        const [invRows] = await conn.query(
          'SELECT quantity FROM branch_inventory WHERE product_id = ? AND branch_id = ? FOR UPDATE',
          [item.product_id, sale.branch_id]
        );
        const currentQty = invRows.length > 0 ? Number(invRows[0].quantity) : 0;
        await conn.query(
          `INSERT INTO branch_inventory (product_id, branch_id, quantity)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_at = CURRENT_TIMESTAMP(3)`,
          [item.product_id, sale.branch_id, currentQty + Number(item.quantity || 0)]
        );
      }

      await conn.query(
        `UPDATE sales SET
          status = 'cancelada',
          cancelled_at = CURRENT_TIMESTAMP(3),
          cancelled_by_uid = ?,
          cancelled_by_name = ?,
          cancellation_reason = ?,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
        [actor.id, truncateStr(actor.nombreCompleto, 120), reason, saleId]
      );

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId: sale.branch_id,
        branchName: sale.branch_name,
        actionType: 'VENTA_CANCELADA',
        description: `Venta folio ${sale.folio} cancelada (${formatCurrency(sale.total)}, ${totalUnits} u. devueltas a ${sale.branch_name}). Motivo: ${reason}`,
      });
    });

    res.status(204).end();
  })
);

// -----------------------------------------------------------------------------
// 10. Apartados y Abonos Libres con Transacción SQL (/api/layaways)
// -----------------------------------------------------------------------------
app.get(
  '/api/layaways',
  requireAuth,
  asyncHandler(async (req, res) => {
    const branchId = req.query.branchId ? String(req.query.branchId) : null;
    const customerId = req.query.customerId ? String(req.query.customerId) : null;
    const limitCount = Math.min(500, Math.max(1, Number(req.query.limit || 300)));

    const conditions = [];
    const params = [];
    if (customerId) {
      conditions.push('customer_id = ?');
      params.push(customerId);
    } else if (branchId) {
      conditions.push('branch_id = ?');
      params.push(branchId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const [layawayRows] = await pool.query(
      `SELECT * FROM layaways ${whereClause} ORDER BY created_at DESC LIMIT ?`,
      [...params, limitCount]
    );
    if (layawayRows.length === 0) {
      res.json([]);
      return;
    }

    const ids = layawayRows.map((l) => l.id);
    const placeholders = ids.map(() => '?').join(',');
    const [itemRows] = await pool.query(
      `SELECT * FROM layaway_items WHERE layaway_id IN (${placeholders}) ORDER BY id ASC`,
      ids
    );

    const itemsByLayaway = new Map();
    for (const r of itemRows) {
      let arr = itemsByLayaway.get(r.layaway_id);
      if (!arr) {
        arr = [];
        itemsByLayaway.set(r.layaway_id, arr);
      }
      arr.push(mapSaleItemRow(r));
    }

    res.json(layawayRows.map((row) => mapLayawayRow(row, itemsByLayaway.get(row.id) || [])));
  })
);

app.get(
  '/api/layaways/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM layaways WHERE id = ? LIMIT 1', [
      req.params.id,
    ]);
    if (rows.length === 0) throw new HttpError(404, 'Apartado no encontrado.');
    const [itemRows] = await pool.query(
      'SELECT * FROM layaway_items WHERE layaway_id = ? ORDER BY id ASC',
      [req.params.id]
    );
    res.json(mapLayawayRow(rows[0], itemRows.map(mapSaleItemRow)));
  })
);

app.get(
  '/api/layaway-payments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const layawayId = req.query.layawayId ? String(req.query.layawayId) : null;
    const branchId = req.query.branchId ? String(req.query.branchId) : null;
    const limitCount = Math.min(500, Math.max(1, Number(req.query.limit || 100)));

    const conditions = [];
    const params = [];
    if (layawayId) {
      conditions.push('layaway_id = ?');
      params.push(layawayId);
    } else if (branchId) {
      conditions.push('branch_id = ?');
      params.push(branchId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows] = await pool.query(
      `SELECT * FROM layaway_payments ${whereClause} ORDER BY created_at DESC LIMIT ?`,
      [...params, limitCount]
    );
    res.json(rows.map(mapLayawayPaymentRow));
  })
);

app.post(
  '/api/layaways',
  requireAuth,
  asyncHandler(async (req, res) => {
    const {
      branchId,
      branchName,
      customer,
      items = [],
      initialDeposit = 0,
      paymentMethod = 'Efectivo',
      cashReceived = 0,
      changeGiven = 0,
      reference = '',
      notes = '',
    } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);

    if (!branchId || !customer?.id || !Array.isArray(items) || items.length === 0) {
      throw new HttpError(400, 'El apartado requiere sucursal, cliente y al menos un producto.');
    }

    const result = await withTransaction(async (conn) => {
      const counterKey = `layaway_${branchId}`;
      const [counterRows] = await conn.query(
        'SELECT last_sequence FROM folio_counters WHERE counter_key = ? FOR UPDATE',
        [counterKey]
      );
      const nextSequence = (Number(counterRows[0]?.last_sequence) || 0) + 1;
      const generatedFolio = formatLayawayFolio(branchId, nextSequence);

      await conn.query(
        `INSERT INTO folio_counters (counter_key, branch_id, last_sequence)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_sequence = VALUES(last_sequence), updated_at = CURRENT_TIMESTAMP(3)`,
        [counterKey, branchId, nextSequence]
      );

      const validatedItems = [];
      for (const line of items) {
        const qty = Math.floor(Number(line.quantity) || 0);
        if (qty <= 0) throw new HttpError(400, 'Cantidad inválida en el apartado.');

        const [prodRows] = await conn.query(
          'SELECT id, sku, name, size, color, price FROM products WHERE id = ? FOR UPDATE',
          [line.productId]
        );
        if (prodRows.length === 0) {
          throw new HttpError(
            404,
            `El producto "${line.productName || line.productId}" ya no existe en el catálogo.`
          );
        }
        const prod = prodRows[0];

        const [invRows] = await conn.query(
          'SELECT quantity FROM branch_inventory WHERE product_id = ? AND branch_id = ? FOR UPDATE',
          [line.productId, branchId]
        );
        const avail = invRows.length > 0 ? Number(invRows[0].quantity) : 0;
        if (avail < qty) {
          throw new HttpError(
            409,
            `Stock insuficiente para "${prod.name}" en ${branchName}. Disponible: ${avail}, solicitado: ${qty}.`
          );
        }

        await conn.query(
          `INSERT INTO branch_inventory (product_id, branch_id, quantity)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_at = CURRENT_TIMESTAMP(3)`,
          [line.productId, branchId, avail - qty]
        );

        const unitPrice = Number(prod.price || 0);
        validatedItems.push({
          productId: prod.id,
          sku: prod.sku,
          name: prod.name,
          size: prod.size,
          color: prod.color,
          unitPrice,
          quantity: qty,
          lineTotal: Number((unitPrice * qty).toFixed(2)),
        });
      }

      const freshTotal = Number(
        validatedItems.reduce((sum, it) => sum + it.lineTotal, 0).toFixed(2)
      );
      const deposit = Number(initialDeposit || 0);
      if (deposit > freshTotal) {
        throw new HttpError(400, 'El anticipo supera el total actualizado de las prendas.');
      }

      const remainingRaw = Number(Math.max(0, freshTotal - deposit).toFixed(2));
      const isSettled = remainingRaw <= 0.009;
      const finalRemaining = isSettled ? 0 : remainingRaw;
      const finalPaid = isSettled ? freshTotal : deposit;

      const layawayId = generateId('apt');
      await conn.query(
        `INSERT INTO layaways (
          id, folio, branch_id, branch_name, customer_id, customer_name, customer_phone,
          seller_uid, seller_name, seller_usuario, total, total_paid, remaining_balance,
          status, notes, settled_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          layawayId,
          generatedFolio,
          branchId,
          truncateStr(branchName, 80),
          customer.id,
          truncateStr(customer.nombreCompleto, 120),
          truncateStr(customer.telefono || '', 32),
          actor.id,
          truncateStr(actor.nombreCompleto, 120),
          truncateStr(actor.usuario, 64),
          freshTotal,
          finalPaid,
          finalRemaining,
          isSettled ? 'liquidado' : 'activo',
          truncateStr(notes, 400),
          isSettled ? new Date() : null,
        ]
      );

      for (const item of validatedItems) {
        await conn.query(
          `INSERT INTO layaway_items (
            layaway_id, product_id, sku, name, size, color, unit_price, quantity, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            layawayId,
            item.productId,
            item.sku,
            item.name,
            item.size,
            item.color,
            item.unitPrice,
            item.quantity,
            item.lineTotal,
          ]
        );
      }

      let receipt = null;
      if (finalPaid > 0) {
        const paymentId = generateId('abn');
        const receiptFolio = `AB-${getBranchFolioPrefix(branchId)}-${String(nextSequence).padStart(4, '0')}-01`;
        const finalCash = paymentMethod === 'Efectivo' ? Number(Number(cashReceived).toFixed(2)) : finalPaid;
        const finalChange = paymentMethod === 'Efectivo' ? Number(changeGiven || 0) : 0;
        const cleanRef = paymentMethod === 'Efectivo' ? '' : truncateStr(reference, 64);

        await conn.query(
          `INSERT INTO layaway_payments (
            id, receipt_folio, layaway_id, layaway_folio, branch_id, branch_name,
            customer_id, customer_name, seller_uid, seller_name, seller_usuario,
            amount, payment_method, cash_received, change_given, reference,
            balance_before, balance_after, is_initial_deposit
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
          [
            paymentId,
            receiptFolio,
            layawayId,
            generatedFolio,
            branchId,
            truncateStr(branchName, 80),
            customer.id,
            truncateStr(customer.nombreCompleto, 120),
            actor.id,
            truncateStr(actor.nombreCompleto, 120),
            truncateStr(actor.usuario, 64),
            finalPaid,
            paymentMethod,
            finalCash,
            finalChange,
            cleanRef,
            freshTotal,
            finalRemaining,
          ]
        );

        const [payRows] = await conn.query('SELECT * FROM layaway_payments WHERE id = ?', [
          paymentId,
        ]);
        receipt = mapLayawayPaymentRow(payRows[0]);
      }

      const units = validatedItems.reduce((s, it) => s + it.quantity, 0);
      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId,
        branchName,
        actionType: 'APARTADO_CREADO',
        description: `Nuevo apartado ${generatedFolio} para ${customer.nombreCompleto} (${units} u., Total: ${formatCurrency(freshTotal)}, Anticipo: ${formatCurrency(finalPaid)} en ${finalPaid > 0 ? paymentMethod : 'Sin anticipo'}).`,
      });

      return { folio: generatedFolio, receipt };
    });

    res.status(201).json(result);
  })
);

app.post(
  '/api/layaways/:id/payments',
  requireAuth,
  asyncHandler(async (req, res) => {
    const layawayId = req.params.id;
    const {
      amount,
      paymentMethod = 'Efectivo',
      cashReceived = 0,
      changeGiven = 0,
      reference = '',
    } = req.body || {};
    const actor = resolveActor(req, req.body?.actor);
    const payAmount = Number(amount || 0);
    if (payAmount <= 0) throw new HttpError(400, 'El monto del abono debe ser mayor a cero.');

    const cleanRef = paymentMethod === 'Efectivo' ? '' : truncateStr(reference, 64);

    const result = await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT * FROM layaways WHERE id = ? FOR UPDATE', [
        layawayId,
      ]);
      if (rows.length === 0) throw new HttpError(404, 'El apartado ya no existe.');
      const fresh = rows[0];

      if (fresh.status !== 'activo') {
        throw new HttpError(409, 'Este apartado ya no admite abonos porque no está activo.');
      }
      const currentRemaining = Number(fresh.remaining_balance || 0);
      if (payAmount > currentRemaining + 0.001) {
        throw new HttpError(
          400,
          `El saldo pendiente actualizado es ${formatCurrency(currentRemaining)}.`
        );
      }

      const nextRemainingRaw = Number((currentRemaining - payAmount).toFixed(2));
      const isSettled = nextRemainingRaw <= 0.009;
      const nextRemaining = isSettled ? 0 : nextRemainingRaw;
      const nextTotalPaid = isSettled
        ? Number(fresh.total)
        : Number((Number(fresh.total_paid || 0) + payAmount).toFixed(2));

      await conn.query(
        `UPDATE layaways SET
          total_paid = ?,
          remaining_balance = ?,
          status = ?,
          settled_at = CASE WHEN ? THEN CURRENT_TIMESTAMP(3) ELSE settled_at END,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
        [nextTotalPaid, nextRemaining, isSettled ? 'liquidado' : 'activo', isSettled, layawayId]
      );

      const paymentId = generateId('abn');
      const suffix = String(Math.floor(Date.now() % 10000)).padStart(4, '0');
      const receiptFolio = `AB-${String(fresh.folio).replace(/^APT-/, '')}-${suffix}`;
      const finalCash = paymentMethod === 'Efectivo' ? Number(Number(cashReceived).toFixed(2)) : payAmount;
      const finalChange = paymentMethod === 'Efectivo' ? Number(changeGiven || 0) : 0;

      await conn.query(
        `INSERT INTO layaway_payments (
          id, receipt_folio, layaway_id, layaway_folio, branch_id, branch_name,
          customer_id, customer_name, seller_uid, seller_name, seller_usuario,
          amount, payment_method, cash_received, change_given, reference,
          balance_before, balance_after, is_initial_deposit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
        [
          paymentId,
          receiptFolio,
          fresh.id,
          fresh.folio,
          fresh.branch_id,
          fresh.branch_name,
          fresh.customer_id,
          fresh.customer_name,
          actor.id,
          truncateStr(actor.nombreCompleto, 120),
          truncateStr(actor.usuario, 64),
          payAmount,
          paymentMethod,
          finalCash,
          finalChange,
          cleanRef,
          currentRemaining,
          nextRemaining,
        ]
      );

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId: fresh.branch_id,
        branchName: fresh.branch_name,
        actionType: isSettled ? 'APARTADO_LIQUIDADO' : 'ABONO_APARTADO',
        description: isSettled
          ? `Abono final de ${formatCurrency(payAmount)} (${paymentMethod}${cleanRef ? `, ref: ${cleanRef}` : ''}) en ${fresh.folio} de ${fresh.customer_name}. Apartado LIQUIDADO.`
          : `Abono de ${formatCurrency(payAmount)} (${paymentMethod}${cleanRef ? `, ref: ${cleanRef}` : ''}) en ${fresh.folio} de ${fresh.customer_name}. Saldo restante: ${formatCurrency(nextRemaining)}.`,
      });

      const [payRows] = await conn.query('SELECT * FROM layaway_payments WHERE id = ?', [
        paymentId,
      ]);
      return { receipt: mapLayawayPaymentRow(payRows[0]), settled: isSettled };
    });

    res.status(201).json(result);
  })
);

app.post(
  '/api/layaways/:id/deliver',
  requireAuth,
  asyncHandler(async (req, res) => {
    const layawayId = req.params.id;
    const actor = resolveActor(req, req.body?.actor);

    await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT * FROM layaways WHERE id = ? FOR UPDATE', [
        layawayId,
      ]);
      if (rows.length === 0) throw new HttpError(404, 'Apartado no encontrado.');
      const fresh = rows[0];

      await conn.query(
        `UPDATE layaways SET
          status = 'entregado',
          delivered_at = CURRENT_TIMESTAMP(3),
          delivered_by_uid = ?,
          delivered_by_name = ?,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
        [actor.id, truncateStr(actor.nombreCompleto, 120), layawayId]
      );

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId: fresh.branch_id,
        branchName: fresh.branch_name,
        actionType: 'APARTADO_ENTREGADO',
        description: `Entrega física completada del apartado ${fresh.folio} para ${fresh.customer_name}.`,
      });
    });

    res.status(204).end();
  })
);

app.post(
  '/api/layaways/:id/cancel',
  requireAuth,
  asyncHandler(async (req, res) => {
    const layawayId = req.params.id;
    const reason = truncateStr(req.body?.reason || 'Cancelación operativa', 300);
    const actor = resolveActor(req, req.body?.actor);

    await withTransaction(async (conn) => {
      const [rows] = await conn.query('SELECT * FROM layaways WHERE id = ? FOR UPDATE', [
        layawayId,
      ]);
      if (rows.length === 0) throw new HttpError(404, 'El apartado ya no existe.');
      const fresh = rows[0];
      if (fresh.status === 'entregado' || fresh.status === 'cancelado') {
        throw new HttpError(409, 'Este apartado ya fue entregado o cancelado.');
      }

      const [itemRows] = await conn.query(
        'SELECT product_id, quantity FROM layaway_items WHERE layaway_id = ?',
        [layawayId]
      );

      for (const item of itemRows) {
        if (!item.product_id) continue;
        const [invRows] = await conn.query(
          'SELECT quantity FROM branch_inventory WHERE product_id = ? AND branch_id = ? FOR UPDATE',
          [item.product_id, fresh.branch_id]
        );
        const currentQty = invRows.length > 0 ? Number(invRows[0].quantity) : 0;
        await conn.query(
          `INSERT INTO branch_inventory (product_id, branch_id, quantity)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE quantity = VALUES(quantity), updated_at = CURRENT_TIMESTAMP(3)`,
          [item.product_id, fresh.branch_id, currentQty + Number(item.quantity || 0)]
        );
      }

      await conn.query(
        `UPDATE layaways SET
          status = 'cancelado',
          cancelled_at = CURRENT_TIMESTAMP(3),
          cancelled_by_uid = ?,
          cancelled_by_name = ?,
          cancellation_reason = ?,
          updated_at = CURRENT_TIMESTAMP(3)
        WHERE id = ?`,
        [actor.id, truncateStr(actor.nombreCompleto, 120), reason, layawayId]
      );

      await insertAuditLog(conn, {
        userUid: actor.id,
        userName: actor.nombreCompleto,
        userUsuario: actor.usuario,
        branchId: fresh.branch_id,
        branchName: fresh.branch_name,
        actionType: 'APARTADO_CANCELADO',
        description: `Cancelación de apartado ${fresh.folio} (${fresh.customer_name}). Stock devuelto a ${fresh.branch_name}. Motivo: ${reason}.`,
      });
    });

    res.status(204).end();
  })
);

// -----------------------------------------------------------------------------
// 11. Cortes y Cierres de Caja (/api/cash-closures y alias /api/cash-registers)
// -----------------------------------------------------------------------------
const getCashClosuresHandler = asyncHandler(async (req, res) => {
  const branchId = req.query.branchId ? String(req.query.branchId) : null;
  const whereClause = branchId ? 'WHERE branch_id = ?' : '';
  const params = branchId ? [branchId] : [];
  const [rows] = await pool.query(
    `SELECT * FROM cash_closures ${whereClause} ORDER BY opened_at DESC LIMIT 100`,
    params
  );
  res.json(rows.map(mapCashClosureRow));
});

const getCashClosureByIdHandler = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM cash_closures WHERE id = ? LIMIT 1', [
    req.params.id,
  ]);
  if (rows.length === 0) throw new HttpError(404, 'Corte de caja no encontrado.');
  res.json(mapCashClosureRow(rows[0]));
});

const openCashClosureHandler = asyncHandler(async (req, res) => {
  const { branchId, branchName, openingFund = 0 } = req.body || {};
  const actor = resolveActor(req, req.body?.actor);
  if (!branchId) throw new HttpError(400, 'La sucursal es obligatoria.');

  const shiftId = generateId('caja');
  const folio = formatCashShiftFolio(branchId);

  await withTransaction(async (conn) => {
    await conn.query(
      `INSERT INTO cash_closures (
        id, folio, branch_id, branch_name, status, opening_fund,
        opened_by_uid, opened_by_name, opened_by_usuario
      ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
      [
        shiftId,
        folio,
        branchId,
        truncateStr(branchName || branchId, 80),
        Number(openingFund || 0),
        actor.id,
        truncateStr(actor.nombreCompleto, 120),
        truncateStr(actor.usuario, 64),
      ]
    );

    await insertAuditLog(conn, {
      userUid: actor.id,
      userName: actor.nombreCompleto,
      userUsuario: actor.usuario,
      branchId,
      branchName: branchName || branchId,
      actionType: 'APERTURA_CAJA',
      description: `Apertura de caja folio ${folio} en ${branchName || branchId} con fondo inicial de ${formatCurrency(openingFund)}.`,
    });
  });

  res.status(201).json({ shiftId, folio });
});

const closeCashClosureHandler = asyncHandler(async (req, res) => {
  const shiftId = req.params.id;
  const { shift, branchId, branchName, summary, countedCash = 0, difference = 0, observations = '' } =
    req.body || {};
  const actor = resolveActor(req, req.body?.actor);

  const diffNum = Number(difference || 0);
  const diffLabel =
    diffNum === 0
      ? 'Cuadre exacto ($0.00)'
      : diffNum > 0
        ? `Sobrante de ${formatCurrency(diffNum)}`
        : `Faltante de ${formatCurrency(Math.abs(diffNum))}`;

  const closedShift = await withTransaction(async (conn) => {
    const [existing] = await conn.query('SELECT * FROM cash_closures WHERE id = ? FOR UPDATE', [
      shiftId,
    ]);
    if (existing.length === 0) throw new HttpError(404, 'Turno de caja no encontrado.');
    const row = existing[0];

    await conn.query(
      `UPDATE cash_closures SET
        status = 'closed',
        closed_by_uid = ?,
        closed_by_name = ?,
        closed_by_usuario = ?,
        closed_at = CURRENT_TIMESTAMP(3),
        direct_sales_count = ?,
        direct_sales_cash = ?,
        direct_sales_card = ?,
        direct_sales_transfer = ?,
        direct_sales_total = ?,
        layaway_payments_count = ?,
        layaway_cash = ?,
        layaway_card = ?,
        layaway_transfer = ?,
        layaway_total = ?,
        expected_cash_total = ?,
        total_card = ?,
        total_transfer = ?,
        grand_total_income = ?,
        counted_cash = ?,
        difference = ?,
        observations = ?,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE id = ?`,
      [
        actor.id,
        truncateStr(actor.nombreCompleto, 120),
        truncateStr(actor.usuario, 64),
        Number(summary?.directSalesCount || 0),
        Number(summary?.directSalesCash || 0),
        Number(summary?.directSalesCard || 0),
        Number(summary?.directSalesTransfer || 0),
        Number(summary?.directSalesTotal || 0),
        Number(summary?.layawayPaymentsCount || 0),
        Number(summary?.layawayCash || 0),
        Number(summary?.layawayCard || 0),
        Number(summary?.layawayTransfer || 0),
        Number(summary?.layawayTotal || 0),
        Number(summary?.expectedCashTotal || 0),
        Number(summary?.totalCard || 0),
        Number(summary?.totalTransfer || 0),
        Number(summary?.grandTotalIncome || 0),
        Number(countedCash || 0),
        diffNum,
        truncateStr(observations, 500),
        shiftId,
      ]
    );

    await insertAuditLog(conn, {
      userUid: actor.id,
      userName: actor.nombreCompleto,
      userUsuario: actor.usuario,
      branchId: branchId || row.branch_id,
      branchName: branchName || row.branch_name,
      actionType: 'CIERRE_CAJA',
      description: `Cierre de caja ${shift?.folio || row.folio} en ${branchName || row.branch_name}. Esperado efectivo: ${formatCurrency(summary?.expectedCashTotal || 0)}, Contado: ${formatCurrency(countedCash)}, Resultado: ${diffLabel}. Ingresos del turno: ${formatCurrency(summary?.grandTotalIncome || 0)}.`,
    });

    const [updatedRows] = await conn.query('SELECT * FROM cash_closures WHERE id = ?', [shiftId]);
    return mapCashClosureRow(updatedRows[0]);
  });

  res.json(closedShift);
});

app.get('/api/cash-closures', requireAuth, getCashClosuresHandler);
app.get('/api/cash-registers', requireAuth, getCashClosuresHandler);
app.get('/api/cash-closures/:id', requireAuth, getCashClosureByIdHandler);
app.get('/api/cash-registers/:id', requireAuth, getCashClosureByIdHandler);
app.post('/api/cash-closures/open', requireAuth, openCashClosureHandler);
app.post('/api/cash-registers/open', requireAuth, openCashClosureHandler);
app.post('/api/cash-closures/:id/close', requireAuth, closeCashClosureHandler);
app.post('/api/cash-registers/:id/close', requireAuth, closeCashClosureHandler);

app.delete(
  '/api/cash-closures/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await pool.query('DELETE FROM cash_closures WHERE id = ?', [req.params.id]);
    res.status(204).end();
  })
);

// -----------------------------------------------------------------------------
// 12. Bitácora de Auditoría (/api/logs y alias /api/audit-logs)
// -----------------------------------------------------------------------------
const getLogsHandler = asyncHandler(async (req, res) => {
  const limitCount = Math.min(500, Math.max(1, Number(req.query.limit || 200)));
  const [rows] = await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?', [
    limitCount,
  ]);
  res.json(rows.map(mapAuditLogRow));
});

const postLogHandler = asyncHandler(async (req, res) => {
  const { userUid, userName, userUsuario, branchId, branchName, actionType, description } =
    req.body || {};
  await insertAuditLog(pool, {
    userUid,
    userName,
    userUsuario,
    branchId,
    branchName,
    actionType,
    description,
  });
  res.status(201).json({ ok: true });
});

app.get('/api/logs', requireAuth, getLogsHandler);
app.get('/api/audit-logs', requireAuth, getLogsHandler);
app.post('/api/logs', requireAuth, postLogHandler);
app.post('/api/audit-logs', requireAuth, postLogHandler);

// -----------------------------------------------------------------------------
// Manejo Global de Errores
// -----------------------------------------------------------------------------
app.use((err, _req, res, _next) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message =
    err instanceof Error && err.message
      ? err.message
      : 'Error interno en el servidor API.';
  if (status >= 500) {
    console.error('[API Error]', err);
  }
  res.status(status).json({ error: message, message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Atelier Boutique REST API listening on http://0.0.0.0:${PORT}`);
});
