import type {
  ActionType,
  AuditLog,
  BranchId,
  BranchInfo,
  BranchesConfig,
  BrandingConfig,
  CashRegisterShift,
  Customer,
  CustomerFiscalData,
  DiscountType,
  Layaway,
  LayawayPayment,
  OperatingScope,
  PaymentMethod,
  Product,
  ProductCategory,
  Sale,
  StockMap,
  UserPermissions,
  UserProfile,
  UserRole,
} from '../types/boutique';

export type Unsubscribe = () => void;

export interface ServiceActor {
  id: string;
  nombreCompleto: string;
  usuario: string;
  sucursalAsignada: BranchId;
}

export interface AuditPayload {
  userUid: string;
  userName: string;
  userUsuario: string;
  branchId: BranchId | 'all';
  branchName: string;
  actionType: ActionType;
  description: string;
}

export interface AuthSessionResult {
  user: UserProfile;
  token?: string;
}

export interface CreateUserInput {
  nombreCompleto: string;
  usuario: string;
  pinHash: string;
  rol: UserRole;
  sucursalAsignada: BranchId;
  permisos: UserPermissions;
  activo: boolean;
}

export interface UpdateUserInput {
  targetUser: UserProfile;
  nombreCompleto: string;
  usuario: string;
  pinHash: string;
  rol: UserRole;
  sucursalAsignada: BranchId;
  permisos: UserPermissions;
  activo: boolean;
  isEditingSelf: boolean;
}

export interface IAuthService {
  subscribeBranding(
    onData: (branding: BrandingConfig) => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
  subscribeBranches(
    onData: (config: BranchesConfig | null) => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
  subscribeCategories(
    onData: (items: string[] | null) => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
  subscribeUsers(
    onData: (users: UserProfile[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
  subscribeUserProfile(
    userId: string,
    onData: (user: UserProfile | null, invalidReason?: 'not_found' | 'invalid' | 'inactive') => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
  registerInitialAdmin(input: {
    nombreCompleto: string;
    usuario: string;
    pin: string;
    defaultBranchId: BranchId;
  }): Promise<AuthSessionResult>;
  loginWithCredentials(input: {
    usuario: string;
    pin: string;
    resolveBranchName: (branchId: BranchId) => string;
  }): Promise<AuthSessionResult>;
  logout(actor: ServiceActor, branchName: string): Promise<void>;
  toggleTheme(userId: string, nextDark: boolean): Promise<void>;
  setOperatingScope(userId: string, scope: OperatingScope): Promise<void>;
  createUser(input: CreateUserInput, actor: ServiceActor, branchName: string): Promise<UserProfile>;
  updateUser(input: UpdateUserInput, actor: ServiceActor, branchName: string): Promise<void>;
  toggleUserPermission(
    input: {
      targetUser: UserProfile;
      nextPermissions: UserPermissions;
      permLabel: string;
      enabled: boolean;
      branchName: string;
    },
    actor: ServiceActor
  ): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  updateBranding(
    input: { companyName: string; companyLogoUrl: string },
    actor: ServiceActor
  ): Promise<void>;
}

export interface ProductUpsertInput {
  sku: string;
  name: string;
  category: ProductCategory;
  size: string;
  color: string;
  price: number;
  stock: StockMap;
}

export interface AdjustStockInput {
  mode: 'restock' | 'discard';
  productId: string;
  branchId: BranchId;
  branchName: string;
  quantity: number;
  reason?: string;
}

export interface BulkImportProductEntry {
  sku: string;
  barcodeSKU: string;
  name: string;
  category: ProductCategory;
  size: string;
  color: string;
  price: number;
  stock: StockMap;
  codigoModelo?: string;
  codigoActual?: string;
  marca?: string;
  especificaciones?: string;
  estatusOriginal?: string;
  costoReferencia?: number;
}

export interface BulkExcelImportInput {
  fileName: string;
  selectedSheets: string[];
  existingCategories: string[];
  categoriesToAdd: string[];
  primaryBranchId: BranchId;
  primaryBranchName: string;
  items: BulkImportProductEntry[];
  summaryText: string;
}

export interface BulkExcelImportResult {
  insertedCount: number;
  categoriesAdded: string[];
  createdProducts: Product[];
}

export interface IInventoryService {
  subscribeProducts(
    onData: (products: Product[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
  findDuplicateSku(
    sku: string,
    excludeProductId?: string
  ): Promise<{ id: string; name?: string } | null>;
  createProduct(
    input: ProductUpsertInput,
    actor: ServiceActor,
    branchId: BranchId,
    branchName: string
  ): Promise<Product>;
  updateProduct(
    productId: string,
    input: ProductUpsertInput,
    actor: ServiceActor,
    branchId: BranchId,
    branchName: string
  ): Promise<void>;
  deleteProduct(productId: string): Promise<void>;
  adjustStock(
    input: AdjustStockInput,
    actor: ServiceActor
  ): Promise<{ previousStock: number; nextStock: number }>;
  bulkImportExcel(
    input: BulkExcelImportInput,
    actor: ServiceActor,
    onProgress?: (p: {
      done: number;
      total: number;
      currentBatch: number;
      totalBatches: number;
    }) => void
  ): Promise<BulkExcelImportResult>;
  clearAllProducts(
    actor: ServiceActor,
    onProgress?: (deletedCount: number) => void
  ): Promise<number>;
  updateCategories(
    input: {
      items: string[];
      auditDescription: string;
      renamed?: { from: string; to: string };
      affectedProductIds?: string[];
    },
    actor: ServiceActor
  ): Promise<void>;
  updateBranches(
    input: { items: BranchInfo[]; auditDescription: string },
    actor: ServiceActor
  ): Promise<void>;
}

export interface CreateSaleInput {
  branchId: BranchId;
  branchName: string;
  items: { productId: string; productName: string; quantity: number }[];
  subtotal: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  cashReceived: number;
  changeGiven: number;
  cardReference: string;
  transferReference: string;
  customer?: { id: string; nombreCompleto: string } | null;
}

export interface CloseCashShiftInput {
  shift: CashRegisterShift;
  branchId: BranchId;
  branchName: string;
  summary: {
    directSalesCount: number;
    directSalesCash: number;
    directSalesCard: number;
    directSalesTransfer: number;
    directSalesTotal: number;
    layawayPaymentsCount: number;
    layawayCash: number;
    layawayCard: number;
    layawayTransfer: number;
    layawayTotal: number;
    expectedCashTotal: number;
    totalCard: number;
    totalTransfer: number;
    grandTotalIncome: number;
  };
  countedCash: number;
  difference: number;
  observations: string;
}

export interface ISalesService {
  subscribeSales(
    options: { branchId?: BranchId; customerId?: string; limitCount?: number },
    onData: (sales: Sale[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
  createSale(
    input: CreateSaleInput,
    actor: ServiceActor
  ): Promise<Sale & { issuedLocallyAt?: Date }>;
  cancelSale(
    input: { sale: Sale; reason: string },
    actor: ServiceActor
  ): Promise<void>;
  subscribeCashShifts(
    branchId: BranchId,
    onData: (shifts: CashRegisterShift[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
  openCashShift(
    input: { branchId: BranchId; branchName: string; openingFund: number },
    actor: ServiceActor
  ): Promise<{ shiftId: string; folio: string }>;
  closeCashShift(
    input: CloseCashShiftInput,
    actor: ServiceActor
  ): Promise<CashRegisterShift & { closedLocallyAt?: Date }>;
}

export interface CreateLayawayInput {
  branchId: BranchId;
  branchName: string;
  customer: { id: string; nombreCompleto: string; telefono: string };
  items: { productId: string; productName: string; quantity: number }[];
  initialDeposit: number;
  paymentMethod: PaymentMethod;
  cashReceived: number;
  changeGiven: number;
  reference: string;
  notes: string;
}

export interface RegisterLayawayPaymentInput {
  layawayId: string;
  amount: number;
  paymentMethod: PaymentMethod;
  cashReceived: number;
  changeGiven: number;
  reference: string;
}

export interface ILayawayService {
  subscribeLayaways(
    options: { branchId?: BranchId; customerId?: string; limitCount?: number },
    onData: (layaways: Layaway[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
  subscribeLayawayPayments(
    options: { layawayId?: string; branchId?: BranchId; limitCount?: number },
    onData: (payments: LayawayPayment[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
  createLayaway(
    input: CreateLayawayInput,
    actor: ServiceActor
  ): Promise<{
    folio: string;
    receipt: (LayawayPayment & { issuedLocallyAt?: Date }) | null;
  }>;
  registerPayment(
    input: RegisterLayawayPaymentInput,
    actor: ServiceActor
  ): Promise<{
    receipt: LayawayPayment & { issuedLocallyAt?: Date };
    settled: boolean;
  }>;
  markDelivered(layaway: Layaway, actor: ServiceActor): Promise<void>;
  cancelLayaway(
    input: { layaway: Layaway; reason: string },
    actor: ServiceActor
  ): Promise<void>;
}

export interface CustomerFormInput {
  nombreCompleto: string;
  telefono: string;
  email: string;
  fechaEvento: string;
  notas: string;
  datosFiscales: CustomerFiscalData;
}

export interface ICustomerService {
  subscribeCustomers(
    onData: (customers: Customer[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
  createCustomer(
    input: CustomerFormInput,
    branchId: BranchId,
    branchName: string,
    actor: ServiceActor
  ): Promise<Customer>;
  updateCustomer(
    existingCustomer: Customer,
    input: CustomerFormInput,
    branchId: BranchId,
    branchName: string,
    actor: ServiceActor
  ): Promise<Customer>;
  deleteCustomer(
    customer: Customer,
    branchId: BranchId,
    branchName: string,
    actor: ServiceActor
  ): Promise<void>;
}

export interface ILogService {
  recordAuditLog(payload: AuditPayload): Promise<void>;
  subscribeLogs(
    limitCount: number,
    onData: (logs: AuditLog[]) => void,
    onError?: (err: Error) => void
  ): Unsubscribe;
}

export interface IDataProvider {
  readonly mode: 'firestore' | 'api';
  readonly authService: IAuthService;
  readonly inventoryService: IInventoryService;
  readonly salesService: ISalesService;
  readonly layawayService: ILayawayService;
  readonly customerService: ICustomerService;
  readonly logService: ILogService;
}
