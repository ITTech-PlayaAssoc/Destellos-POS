export type AppTimestamp =
  | Date
  | string
  | number
  | { toDate: () => Date; toMillis?: () => number };

export type BranchId = string;
export type OperatingScope = 'general' | BranchId;
export type UserRole = 'admin' | 'vendedor';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  vendedor: 'Vendedor',
};

export const DEFAULT_PRODUCT_CATEGORIES = [
  'Vestidos XV años',
  'Accesorios',
  'Tiaras',
  'Calzado',
  'General',
] as const;

export const PRODUCT_CATEGORIES = DEFAULT_PRODUCT_CATEGORIES;

export type ProductCategory = string;

export type ActionType =
  | 'INICIO_SESION'
  | 'CIERRE_SESION'
  | 'CREACION_USUARIO'
  | 'EDICION_USUARIO'
  | 'CAMBIO_PERMISOS'
  | 'ALTA_PRODUCTO'
  | 'IMPORTACION_EXCEL'
  | 'ENTRADA_STOCK'
  | 'DESCARTE_STOCK'
  | 'VACIADO_INVENTARIO'
  | 'VENTA_REALIZADA'
  | 'VENTA_CANCELADA'
  | 'CONFIGURACION_SUCURSALES'
  | 'CONFIGURACION_CATEGORIAS'
  | 'CONFIGURACION_EMPRESA'
  | 'CREACION_CLIENTE'
  | 'EDICION_CLIENTE'
  | 'ELIMINACION_CLIENTE'
  | 'APARTADO_CREADO'
  | 'ABONO_APARTADO'
  | 'APARTADO_LIQUIDADO'
  | 'APARTADO_ENTREGADO'
  | 'APARTADO_CANCELADO'
  | 'APERTURA_CAJA'
  | 'CIERRE_CAJA';

export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  INICIO_SESION: 'Inicio de sesión',
  CIERRE_SESION: 'Cierre de sesión',
  CREACION_USUARIO: 'Creación de usuario',
  EDICION_USUARIO: 'Edición de usuario',
  CAMBIO_PERMISOS: 'Cambio de permisos',
  ALTA_PRODUCTO: 'Alta de producto',
  IMPORTACION_EXCEL: 'Importación masiva Excel',
  ENTRADA_STOCK: 'Entrada de stock',
  DESCARTE_STOCK: 'Descarte de stock',
  VACIADO_INVENTARIO: 'Vaciado total de inventario',
  VENTA_REALIZADA: 'Venta realizada',
  VENTA_CANCELADA: 'Venta cancelada',
  CONFIGURACION_SUCURSALES: 'Gestión de sucursales',
  CONFIGURACION_CATEGORIAS: 'Gestión de categorías',
  CONFIGURACION_EMPRESA: 'Identidad de empresa',
  CREACION_CLIENTE: 'Alta de cliente',
  EDICION_CLIENTE: 'Edición de cliente',
  ELIMINACION_CLIENTE: 'Baja de cliente',
  APARTADO_CREADO: 'Nuevo apartado',
  ABONO_APARTADO: 'Abono de apartado',
  APARTADO_LIQUIDADO: 'Apartado liquidado',
  APARTADO_ENTREGADO: 'Entrega de apartado',
  APARTADO_CANCELADO: 'Cancelación de apartado',
  APERTURA_CAJA: 'Apertura de caja',
  CIERRE_CAJA: 'Cierre / Corte de caja',
};

export interface UserPermissions {
  viewInventory: boolean;
  addProduct: boolean;
  restockInventory: boolean;
  discardStock: boolean;
  performSales: boolean;
  viewOtherBranchesStock: boolean;
  manageCustomers: boolean;
  manageLayaways: boolean;
  cancelLayaways: boolean;
}

export const DEFAULT_SELLER_PERMISSIONS: UserPermissions = {
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

export const FULL_ADMIN_PERMISSIONS: UserPermissions = {
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

export interface BranchInfo {
  id: BranchId;
  name: string;
  city: string;
  address: string;
  phone: string;
}

export interface BranchesConfig {
  items?: BranchInfo[];
  branch_1?: BranchInfo;
  branch_2?: BranchInfo;
  branch_3?: BranchInfo;
  updatedAt?: AppTimestamp;
  updatedByUid: string;
}

export const DEFAULT_BRANCH_LIST: BranchInfo[] = [
  {
    id: 'branch_1',
    name: 'Sucursal 1',
    city: '',
    address: '',
    phone: '',
  },
  {
    id: 'branch_2',
    name: 'Sucursal 2',
    city: '',
    address: '',
    phone: '',
  },
  {
    id: 'branch_3',
    name: 'Sucursal 3',
    city: '',
    address: '',
    phone: '',
  },
];

export const DEFAULT_BRANCHES_CONFIG: {
  items: BranchInfo[];
  branch_1: BranchInfo;
  branch_2: BranchInfo;
  branch_3: BranchInfo;
} = {
  items: DEFAULT_BRANCH_LIST,
  branch_1: DEFAULT_BRANCH_LIST[0],
  branch_2: DEFAULT_BRANCH_LIST[1],
  branch_3: DEFAULT_BRANCH_LIST[2],
};

export interface CategoriesConfig {
  items: string[];
  updatedAt?: AppTimestamp;
  updatedByUid: string;
}

export interface UserProfile {
  id: string;
  nombreCompleto: string;
  usuario: string;
  pinHash: string;
  rol: UserRole;
  sucursalAsignada: BranchId;
  permisos: UserPermissions;
  modoOscuro: boolean;
  activo: boolean;
  operatingScope?: OperatingScope;
  createdAt?: AppTimestamp;
  updatedAt?: AppTimestamp;
  lastLoginAt?: AppTimestamp;
}

export interface BranchCounter {
  branchId: string;
  lastSequence: number;
  updatedAt?: AppTimestamp;
}

export type StockMap = Record<string, number>;

export interface Product {
  id: string;
  sku: string;
  barcodeSKU?: string;
  codigoModelo?: string;
  codigoActual?: string;
  name: string;
  category: ProductCategory;
  size: string;
  color: string;
  marca?: string;
  especificaciones?: string;
  estatusOriginal?: string;
  costoReferencia?: number;
  price: number;
  stock: StockMap;
  createdByUid: string;
  createdAt?: AppTimestamp;
  updatedAt?: AppTimestamp;
}

export interface SaleItem {
  productId: string;
  sku: string;
  name: string;
  size: string;
  color: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export type DiscountType = 'none' | 'fixed' | 'percent';
export type PaymentMethod = 'Efectivo' | 'Tarjeta' | 'Transferencia';
export type SaleStatus = 'completada' | 'cancelada';

export interface Sale {
  id: string;
  folio: string;
  branchId: BranchId;
  branchName: string;
  sellerUid: string;
  sellerName: string;
  sellerUsuario?: string;
  sellerEmail?: string;
  items: SaleItem[];
  subtotal: number;
  discountType: DiscountType;
  discountValue: number;
  discountAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  cashReceived: number;
  changeGiven: number;
  cardReference: string;
  transferReference?: string;
  customerId?: string;
  customerName?: string;
  status?: SaleStatus;
  cancelledAt?: AppTimestamp;
  cancelledByUid?: string;
  cancelledByName?: string;
  cancellationReason?: string;
  updatedAt?: AppTimestamp;
  createdAt?: AppTimestamp;
}

export interface CustomerFiscalData {
  rfc: string;
  razonSocial: string;
  codigoPostal: string;
  regimenFiscal: string;
  usoCfdi: string;
}

export interface Customer {
  id: string;
  nombreCompleto: string;
  telefono: string;
  email: string;
  fechaEvento: string;
  notas: string;
  datosFiscales: CustomerFiscalData;
  createdByUid: string;
  createdByName: string;
  createdAt?: AppTimestamp;
  updatedAt?: AppTimestamp;
}

export const FISCAL_REGIMES = [
  '',
  '601 - General de Ley Personas Morales',
  '605 - Sueldos y Salarios e Ingresos Asimilados',
  '606 - Arrendamiento',
  '612 - Personas Físicas con Actividades Empresariales y Profesionales',
  '616 - Sin obligaciones fiscales',
  '621 - Incorporación Fiscal',
  '625 - Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas',
  '626 - Régimen Simplificado de Confianza (RESICO)',
] as const;

export const CFDI_USAGES = [
  '',
  'G01 - Adquisición de mercancías',
  'G03 - Gastos en general',
  'S01 - Sin efectos fiscales',
  'CP01 - Pagos',
] as const;

export type LayawayStatus = 'activo' | 'liquidado' | 'entregado' | 'cancelado';

export const LAYAWAY_STATUS_LABELS: Record<LayawayStatus, string> = {
  activo: 'Activo con saldo',
  liquidado: 'Liquidado / Listo para entrega',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

export interface Layaway {
  id: string;
  folio: string;
  branchId: BranchId;
  branchName: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  sellerUid: string;
  sellerName: string;
  sellerUsuario: string;
  items: SaleItem[];
  total: number;
  totalPaid: number;
  remainingBalance: number;
  status: LayawayStatus;
  notes: string;
  createdAt?: AppTimestamp;
  updatedAt?: AppTimestamp;
  settledAt?: AppTimestamp;
  deliveredAt?: AppTimestamp;
  deliveredByUid?: string;
  deliveredByName?: string;
  cancelledAt?: AppTimestamp;
  cancelledByUid?: string;
  cancelledByName?: string;
  cancellationReason?: string;
}

export interface LayawayPayment {
  id: string;
  receiptFolio: string;
  layawayId: string;
  layawayFolio: string;
  branchId: BranchId;
  branchName: string;
  customerId: string;
  customerName: string;
  sellerUid: string;
  sellerName: string;
  sellerUsuario: string;
  amount: number;
  paymentMethod: PaymentMethod;
  cashReceived: number;
  changeGiven: number;
  reference: string;
  balanceBefore: number;
  balanceAfter: number;
  isInitialDeposit: boolean;
  createdAt?: AppTimestamp;
}

export type CashRegisterStatus = 'open' | 'closed';

export interface CashRegisterShift {
  id: string;
  folio: string;
  branchId: BranchId;
  branchName: string;
  status: CashRegisterStatus;
  openingFund: number;
  openedByUid: string;
  openedByName: string;
  openedByUsuario: string;
  openedAt?: AppTimestamp;
  updatedAt?: AppTimestamp;
  closedByUid?: string;
  closedByName?: string;
  closedByUsuario?: string;
  closedAt?: AppTimestamp;
  directSalesCount?: number;
  directSalesCash?: number;
  directSalesCard?: number;
  directSalesTransfer?: number;
  directSalesTotal?: number;
  layawayPaymentsCount?: number;
  layawayCash?: number;
  layawayCard?: number;
  layawayTransfer?: number;
  layawayTotal?: number;
  expectedCashTotal?: number;
  totalCard?: number;
  totalTransfer?: number;
  grandTotalIncome?: number;
  countedCash?: number;
  difference?: number;
  observations?: string;
}

export interface AuditLog {
  id: string;
  userUid: string;
  userName: string;
  userUsuario?: string;
  userEmail?: string;
  branchId: BranchId | 'all';
  branchName: string;
  actionType: ActionType;
  description: string;
  createdAt?: AppTimestamp;
}

export interface BrandingConfig {
  companyName: string;
  companyLogoUrl: string;
  updatedAt?: AppTimestamp;
  updatedByUid: string;
}

export const DEFAULT_BRANDING_CONFIG: Omit<BrandingConfig, 'updatedAt' | 'updatedByUid'> = {
  companyName: 'Atelier Aurelia',
  companyLogoUrl: '',
};

export const FIELD_LIMITS = {
  SKU_MAX: 64,
  MODEL_CODE_MAX: 64,
  PRODUCT_NAME_MAX: 140,
  CATEGORY_MAX: 64,
  SIZE_MAX: 32,
  COLOR_MAX: 48,
  BRAND_MAX: 64,
  SPECS_MAX: 240,
  STATUS_TAG_MAX: 64,
  BRANCH_NAME_MAX: 80,
  BRANCH_CITY_MAX: 80,
  BRANCH_ADDRESS_MAX: 200,
  BRANCH_PHONE_MAX: 32,
  DISPLAY_NAME_MAX: 120,
  USERNAME_MAX: 64,
  PIN_HASH_LEN: 64,
  CARD_REF_MAX: 64,
  AUDIT_DESC_MAX: 600,
  COMPANY_NAME_MAX: 80,
  COMPANY_LOGO_MAX: 200000,
  PHONE_MAX: 32,
  EMAIL_MAX: 120,
  EVENT_DATE_MAX: 20,
  NOTES_MAX: 500,
  RFC_MAX: 16,
  RAZON_SOCIAL_MAX: 160,
  CP_MAX: 10,
  REGIMEN_MAX: 100,
  CFDI_MAX: 100,
  LAYAWAY_NOTES_MAX: 400,
  CANCEL_REASON_MAX: 300,
  OBSERVATIONS_MAX: 500,
} as const;
