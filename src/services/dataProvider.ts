import { firestoreDataProvider } from './adapters/firestoreAdapter';
import { restApiDataProvider } from './adapters/restApiAdapter';
import type { IDataProvider } from './types';

export type DataSourceMode = 'firestore' | 'api';

const rawSource = (import.meta.env.VITE_DATA_SOURCE || 'firestore').trim().toLowerCase();
export const ACTIVE_DATA_SOURCE: DataSourceMode = rawSource === 'api' ? 'api' : 'firestore';

export const dataProvider: IDataProvider =
  ACTIVE_DATA_SOURCE === 'api' ? restApiDataProvider : firestoreDataProvider;

export const authService = dataProvider.authService;
export const inventoryService = dataProvider.inventoryService;
export const salesService = dataProvider.salesService;
export const layawayService = dataProvider.layawayService;
export const customerService = dataProvider.customerService;
export const logService = dataProvider.logService;

export type {
  AdjustStockInput,
  AuditPayload,
  AuthSessionResult,
  BulkExcelImportInput,
  BulkExcelImportResult,
  BulkImportProductEntry,
  CloseCashShiftInput,
  CreateLayawayInput,
  CreateSaleInput,
  CreateUserInput,
  CustomerFormInput,
  IAuthService,
  ICustomerService,
  IDataProvider,
  IInventoryService,
  ILayawayService,
  ILogService,
  ISalesService,
  ProductUpsertInput,
  RegisterLayawayPaymentInput,
  ServiceActor,
  Unsubscribe,
  UpdateUserInput,
} from './types';
