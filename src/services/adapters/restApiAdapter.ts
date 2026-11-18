import { persistApiToken, readStoredApiToken } from '../../lib/sessionStorage';
import { hashPin, normalizeUsername, toMillis } from '../../lib/utils';
import type {
  AuditLog,
  BranchesConfig,
  BrandingConfig,
  CashRegisterShift,
  Customer,
  Layaway,
  LayawayPayment,
  Product,
  Sale,
  UserProfile,
} from '../../types/boutique';
import type {
  AuthSessionResult,
  BulkExcelImportResult,
  IAuthService,
  ICustomerService,
  IDataProvider,
  IInventoryService,
  ILayawayService,
  ILogService,
  ISalesService,
  Unsubscribe,
} from '../types';

type Topic =
  | 'branding'
  | 'branches'
  | 'categories'
  | 'users'
  | 'products'
  | 'sales'
  | 'cash_registers'
  | 'layaways'
  | 'layaway_payments'
  | 'customers'
  | 'audit_logs';

const topicListeners = new Map<Topic, Set<() => void>>();

function emitTopic(topic: Topic): void {
  const listeners = topicListeners.get(topic);
  if (!listeners) return;
  for (const fn of listeners) {
    fn();
  }
}

function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!raw) return '/api';
  return raw.replace(/\/+$/, '');
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const token = readStoredApiToken();

  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  if (init.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Error de red';
    throw new Error(
      `No se pudo conectar con el servidor API (${baseUrl}): ${reason}`
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
  }

  if (!response.ok) {
    const errObj = (parsed && typeof parsed === 'object' ? parsed : {}) as {
      message?: string;
      error?: string;
    };
    throw new Error(
      errObj.message ||
        errObj.error ||
        `Error del servidor (${response.status} ${response.statusText}).`
    );
  }

  return parsed as T;
}

function createPollingSubscription<T>(
  topics: Topic[],
  fetcher: () => Promise<T>,
  onData: (data: T) => void,
  onError?: (err: Error) => void,
  pollIntervalMs = 30000
): Unsubscribe {
  let cancelled = false;
  let lastSerialized: string | null = null;

  const runFetch = async () => {
    if (cancelled) return;
    try {
      const data = await fetcher();
      if (cancelled) return;
      let serialized: string | null = null;
      try {
        serialized = JSON.stringify(data);
      } catch {
        serialized = null;
      }
      if (serialized !== null && serialized === lastSerialized) {
        return;
      }
      lastSerialized = serialized;
      onData(data);
    } catch (err) {
      if (cancelled) return;
      const error = err instanceof Error ? err : new Error(String(err));
      if (onError) {
        onError(error);
      } else {
        console.warn('REST API subscription error:', error.message);
      }
    }
  };

  void runFetch();

  const unsubs: (() => void)[] = [];
  for (const topic of topics) {
    let set = topicListeners.get(topic);
    if (!set) {
      set = new Set();
      topicListeners.set(topic, set);
    }
    const handler = () => {
      void runFetch();
    };
    set.add(handler);
    unsubs.push(() => {
      set?.delete(handler);
    });
  }

  const timer = window.setInterval(() => {
    void runFetch();
  }, pollIntervalMs);

  return () => {
    cancelled = true;
    window.clearInterval(timer);
    for (const u of unsubs) u();
  };
}

const logService: ILogService = {
  async recordAuditLog(payload) {
    await apiRequest<void>('/logs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    emitTopic('audit_logs');
  },

  subscribeLogs(limitCount, onData, onError) {
    return createPollingSubscription(
      ['audit_logs'],
      () => apiRequest<AuditLog[]>(`/logs?limit=${encodeURIComponent(String(limitCount))}`),
      onData,
      onError
    );
  },
};

const authService: IAuthService = {
  subscribeBranding(onData, onError) {
    return createPollingSubscription(
      ['branding'],
      () => apiRequest<BrandingConfig>('/settings/branding'),
      onData,
      onError
    );
  },

  subscribeBranches(onData, onError) {
    return createPollingSubscription(
      ['branches'],
      () => apiRequest<BranchesConfig | null>('/branches'),
      onData,
      onError
    );
  },

  subscribeCategories(onData, onError) {
    return createPollingSubscription(
      ['categories'],
      async () => {
        const res = await apiRequest<{ items?: string[] } | null>('/categories');
        return Array.isArray(res?.items) && res.items.length > 0 ? res.items : null;
      },
      onData,
      onError
    );
  },

  subscribeUsers(onData, onError) {
    return createPollingSubscription(
      ['users'],
      async () => {
        const list = await apiRequest<UserProfile[]>('/users');
        return list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      },
      onData,
      onError
    );
  },

  subscribeUserProfile(userId, onData, onError) {
    return createPollingSubscription(
      ['users'],
      async () => {
        const user = await apiRequest<UserProfile | null>(
          `/users/${encodeURIComponent(userId)}`
        );
        return user;
      },
      (user) => {
        if (!user) {
          onData(null, 'not_found');
          return;
        }
        if (!user.activo) {
          onData(null, 'inactive');
          return;
        }
        onData(user);
      },
      onError
    );
  },

  async registerInitialAdmin({ nombreCompleto, usuario, pin, defaultBranchId }) {
    const pinHash = await hashPin(pin);
    const result = await apiRequest<AuthSessionResult>('/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify({
        nombreCompleto,
        usuario: normalizeUsername(usuario),
        pinHash,
        defaultBranchId,
      }),
    });
    if (result.token) {
      persistApiToken(result.token);
    }
    emitTopic('users');
    emitTopic('branches');
    emitTopic('categories');
    emitTopic('branding');
    emitTopic('audit_logs');
    return result;
  },

  async loginWithCredentials({ usuario, pin }) {
    const pinHash = await hashPin(pin);
    const result = await apiRequest<AuthSessionResult>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        usuario: normalizeUsername(usuario),
        pinHash,
      }),
    });
    if (result.token) {
      persistApiToken(result.token);
    }
    emitTopic('users');
    emitTopic('audit_logs');
    return result;
  },

  async logout(actor, branchName) {
    try {
      await apiRequest<void>('/auth/logout', {
        method: 'POST',
        body: JSON.stringify({ actor, branchName }),
      });
    } finally {
      persistApiToken(null);
      emitTopic('audit_logs');
    }
  },

  async toggleTheme(userId, nextDark) {
    await apiRequest<void>(`/users/${encodeURIComponent(userId)}/theme`, {
      method: 'PATCH',
      body: JSON.stringify({ modoOscuro: nextDark }),
    });
    emitTopic('users');
  },

  async setOperatingScope(userId, scope) {
    await apiRequest<void>(`/users/${encodeURIComponent(userId)}/operating-scope`, {
      method: 'PATCH',
      body: JSON.stringify({ operatingScope: scope }),
    });
    emitTopic('users');
  },

  async createUser(input, actor, branchName) {
    const created = await apiRequest<UserProfile>('/users', {
      method: 'POST',
      body: JSON.stringify({ ...input, actor, branchName }),
    });
    emitTopic('users');
    emitTopic('audit_logs');
    return created;
  },

  async updateUser(input, actor, branchName) {
    await apiRequest<void>(`/users/${encodeURIComponent(input.targetUser.id)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, actor, branchName }),
    });
    emitTopic('users');
    emitTopic('audit_logs');
  },

  async toggleUserPermission(input, actor) {
    await apiRequest<void>(
      `/users/${encodeURIComponent(input.targetUser.id)}/permissions`,
      {
        method: 'PATCH',
        body: JSON.stringify({ ...input, actor }),
      }
    );
    emitTopic('users');
    emitTopic('audit_logs');
  },

  async deleteUser(userId) {
    await apiRequest<void>(`/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
    emitTopic('users');
  },

  async updateBranding(input, actor) {
    await apiRequest<void>('/settings/branding', {
      method: 'PUT',
      body: JSON.stringify({ ...input, actor }),
    });
    emitTopic('branding');
    emitTopic('audit_logs');
  },
};

const inventoryService: IInventoryService = {
  subscribeProducts(onData, onError) {
    return createPollingSubscription(
      ['products'],
      () => apiRequest<Product[]>('/products'),
      onData,
      onError
    );
  },

  async findDuplicateSku(sku, excludeProductId) {
    const params = new URLSearchParams({ sku });
    if (excludeProductId) params.set('excludeId', excludeProductId);
    const res = await apiRequest<{ duplicate: { id: string; name?: string } | null }>(
      `/products/check-sku?${params.toString()}`
    );
    return res.duplicate;
  },

  async createProduct(input, actor, branchId, branchName) {
    const created = await apiRequest<Product>('/products', {
      method: 'POST',
      body: JSON.stringify({ ...input, actor, branchId, branchName }),
    });
    emitTopic('products');
    emitTopic('audit_logs');
    return created;
  },

  async updateProduct(productId, input, actor, branchId, branchName) {
    await apiRequest<void>(`/products/${encodeURIComponent(productId)}`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, actor, branchId, branchName }),
    });
    emitTopic('products');
    emitTopic('audit_logs');
  },

  async deleteProduct(productId) {
    await apiRequest<void>(`/products/${encodeURIComponent(productId)}`, {
      method: 'DELETE',
    });
    emitTopic('products');
  },

  async adjustStock(input, actor) {
    const res = await apiRequest<{ previousStock: number; nextStock: number }>(
      `/products/${encodeURIComponent(input.productId)}/stock-adjust`,
      {
        method: 'POST',
        body: JSON.stringify({ ...input, actor }),
      }
    );
    emitTopic('products');
    emitTopic('audit_logs');
    return res;
  },

  async bulkImportExcel(input, actor, onProgress) {
    const total = input.items.length;
    onProgress?.({ done: 0, total, currentBatch: 1, totalBatches: 1 });
    const result = await apiRequest<BulkExcelImportResult>('/products/bulk', {
      method: 'POST',
      body: JSON.stringify({ ...input, actor }),
    });
    onProgress?.({ done: total, total, currentBatch: 1, totalBatches: 1 });
    emitTopic('products');
    emitTopic('categories');
    emitTopic('audit_logs');
    return result;
  },

  async clearAllProducts(actor, onProgress) {
    const res = await apiRequest<{ deletedCount: number }>('/products', {
      method: 'DELETE',
      body: JSON.stringify({ actor }),
    });
    onProgress?.(res.deletedCount);
    emitTopic('products');
    emitTopic('audit_logs');
    return res.deletedCount;
  },

  async updateCategories(input, actor) {
    await apiRequest<void>('/categories', {
      method: 'PUT',
      body: JSON.stringify({ ...input, actor }),
    });
    emitTopic('categories');
    emitTopic('products');
    emitTopic('audit_logs');
  },

  async updateBranches(input, actor) {
    await apiRequest<void>('/branches', {
      method: 'PUT',
      body: JSON.stringify({ ...input, actor }),
    });
    emitTopic('branches');
    emitTopic('audit_logs');
  },
};

const salesService: ISalesService = {
  subscribeSales({ branchId, customerId, limitCount = 250 }, onData, onError) {
    const params = new URLSearchParams({ limit: String(limitCount) });
    if (branchId) params.set('branchId', branchId);
    if (customerId) params.set('customerId', customerId);
    return createPollingSubscription(
      ['sales'],
      async () => {
        const list = await apiRequest<Sale[]>(`/sales?${params.toString()}`);
        return list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      },
      onData,
      onError
    );
  },

  async createSale(input, actor) {
    const sale = await apiRequest<Sale>('/sales', {
      method: 'POST',
      body: JSON.stringify({ ...input, actor }),
    });
    emitTopic('sales');
    emitTopic('products');
    emitTopic('audit_logs');
    return { ...sale, issuedLocallyAt: new Date() };
  },

  async cancelSale(input, actor) {
    await apiRequest<void>(`/sales/${encodeURIComponent(input.sale.id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: input.reason, actor }),
    });
    emitTopic('sales');
    emitTopic('products');
    emitTopic('audit_logs');
  },

  subscribeCashShifts(branchId, onData, onError) {
    return createPollingSubscription(
      ['cash_registers'],
      async () => {
        const list = await apiRequest<CashRegisterShift[]>(
          `/cash-closures?branchId=${encodeURIComponent(branchId)}`
        );
        return list.sort((a, b) => toMillis(b.openedAt) - toMillis(a.openedAt));
      },
      onData,
      onError
    );
  },

  async openCashShift(input, actor) {
    const res = await apiRequest<{ shiftId: string; folio: string }>(
      '/cash-closures/open',
      {
        method: 'POST',
        body: JSON.stringify({ ...input, actor }),
      }
    );
    emitTopic('cash_registers');
    emitTopic('audit_logs');
    return res;
  },

  async closeCashShift(input, actor) {
    const closed = await apiRequest<CashRegisterShift>(
      `/cash-closures/${encodeURIComponent(input.shift.id)}/close`,
      {
        method: 'POST',
        body: JSON.stringify({ ...input, actor }),
      }
    );
    emitTopic('cash_registers');
    emitTopic('audit_logs');
    return { ...closed, closedLocallyAt: new Date() };
  },
};

const layawayService: ILayawayService = {
  subscribeLayaways({ branchId, customerId, limitCount = 300 }, onData, onError) {
    const params = new URLSearchParams({ limit: String(limitCount) });
    if (branchId) params.set('branchId', branchId);
    if (customerId) params.set('customerId', customerId);
    return createPollingSubscription(
      ['layaways'],
      async () => {
        const list = await apiRequest<Layaway[]>(`/layaways?${params.toString()}`);
        return list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      },
      onData,
      onError
    );
  },

  subscribeLayawayPayments({ layawayId, branchId, limitCount = 100 }, onData, onError) {
    const params = new URLSearchParams({ limit: String(limitCount) });
    if (layawayId) params.set('layawayId', layawayId);
    if (branchId) params.set('branchId', branchId);
    return createPollingSubscription(
      ['layaway_payments'],
      async () => {
        const list = await apiRequest<LayawayPayment[]>(
          `/layaway-payments?${params.toString()}`
        );
        return list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      },
      onData,
      onError
    );
  },

  async createLayaway(input, actor) {
    const res = await apiRequest<{
      folio: string;
      receipt: LayawayPayment | null;
    }>('/layaways', {
      method: 'POST',
      body: JSON.stringify({ ...input, actor }),
    });
    emitTopic('layaways');
    emitTopic('layaway_payments');
    emitTopic('products');
    emitTopic('audit_logs');
    return {
      folio: res.folio,
      receipt: res.receipt ? { ...res.receipt, issuedLocallyAt: new Date() } : null,
    };
  },

  async registerPayment(input, actor) {
    const res = await apiRequest<{ receipt: LayawayPayment; settled: boolean }>(
      `/layaways/${encodeURIComponent(input.layawayId)}/payments`,
      {
        method: 'POST',
        body: JSON.stringify({ ...input, actor }),
      }
    );
    emitTopic('layaways');
    emitTopic('layaway_payments');
    emitTopic('audit_logs');
    return {
      receipt: { ...res.receipt, issuedLocallyAt: new Date() },
      settled: res.settled,
    };
  },

  async markDelivered(layaway, actor) {
    await apiRequest<void>(`/layaways/${encodeURIComponent(layaway.id)}/deliver`, {
      method: 'POST',
      body: JSON.stringify({ actor }),
    });
    emitTopic('layaways');
    emitTopic('audit_logs');
  },

  async cancelLayaway(input, actor) {
    await apiRequest<void>(`/layaways/${encodeURIComponent(input.layaway.id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: input.reason, actor }),
    });
    emitTopic('layaways');
    emitTopic('products');
    emitTopic('audit_logs');
  },
};

const customerService: ICustomerService = {
  subscribeCustomers(onData, onError) {
    return createPollingSubscription(
      ['customers'],
      () => apiRequest<Customer[]>('/customers'),
      onData,
      onError
    );
  },

  async createCustomer(input, branchId, branchName, actor) {
    const created = await apiRequest<Customer>('/customers', {
      method: 'POST',
      body: JSON.stringify({ ...input, branchId, branchName, actor }),
    });
    emitTopic('customers');
    emitTopic('audit_logs');
    return created;
  },

  async updateCustomer(existingCustomer, input, branchId, branchName, actor) {
    const updated = await apiRequest<Customer>(
      `/customers/${encodeURIComponent(existingCustomer.id)}`,
      {
        method: 'PUT',
        body: JSON.stringify({ ...input, branchId, branchName, actor }),
      }
    );
    emitTopic('customers');
    emitTopic('audit_logs');
    return updated;
  },
};

export const restApiDataProvider: IDataProvider = {
  mode: 'api',
  authService,
  inventoryService,
  salesService,
  layawayService,
  customerService,
  logService,
};
