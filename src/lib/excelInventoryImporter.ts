import * as XLSX from 'xlsx';
import { sanitizeSkuValue } from '../components/BarcodeGraphic';
import { truncateStr } from './utils';
import {
  FIELD_LIMITS,
  type BranchId,
  type BranchInfo,
  type Product,
  type StockMap,
} from '../types/boutique';

export type ExcelSchemaType = 'vestidos' | 'accesorios' | 'ceremonia';

export const EXCEL_SCHEMA_LABELS: Record<ExcelSchemaType, string> = {
  vestidos: 'Vestidos (Esquema A)',
  accesorios: 'Accesorios (Esquema B)',
  ceremonia: 'Ceremonia / Infantil (Esquema C)',
};

export interface ParsedExcelRow {
  tempId: string;
  sheetName: string;
  schema: ExcelSchemaType;
  excelRowNumber: number;
  codigoModelo: string;
  codigoActual: string;
  name: string;
  size: string;
  color: string;
  marca: string;
  especificaciones: string;
  price: number;
  costoReferencia?: number;
  rawStatus: string;
  statusNorm: string;
  isSold: boolean;
  isReserved: boolean;
  explicitQty: number | null;
}

export interface ParsedExcelSheet {
  sheetName: string;
  schema: ExcelSchemaType;
  headerRowNumber: number;
  rows: ParsedExcelRow[];
  detectedStatuses: string[];
}

export interface IgnoredExcelSheet {
  sheetName: string;
  reason: string;
}

export interface ParsedWorkbookResult {
  fileName: string;
  sheets: ParsedExcelSheet[];
  ignoredSheets: IgnoredExcelSheet[];
}

export type ImportClassification =
  | 'disponible'
  | 'otra_sucursal'
  | 'apartado_vendido'
  | 'omitido';

export interface ResolvedImportItem {
  row: ParsedExcelRow;
  barcodeSKU: string;
  category: string;
  stock: StockMap;
  totalUnits: number;
  assignedBranchId: BranchId | null;
  assignedBranchName: string;
  classification: ImportClassification;
  estatusOriginal: string;
}

export interface SheetImportSummary {
  sheetName: string;
  schema: ExcelSchemaType;
  totalDetected: number;
  disponiblesCount: number;
  disponiblesUnits: number;
  otraSucursalCount: number;
  otraSucursalUnits: number;
  otherBranchBreakdown: Record<string, { name: string; count: number; units: number }>;
  apartadoVendidoCount: number;
  omitidosCount: number;
}

const IGNORED_SHEET_EXACT = new Set([
  'HOJA1',
  'HOJA2',
  'HOJA3',
  'HOJA4',
  'HOJA5',
  'FORMULA LARGA',
  'FORMULAS',
  'AUXILIAR',
  'RESUMEN',
]);

const CEREMONY_SHEET_NAMES = new Set(['COMUNION', 'ROPONES', 'NINA', 'BISUTERIA']);
const ACCESSORY_SHEET_NAMES = new Set([
  'TIARAS',
  'VELOS',
  'LAZOS',
  'ARRAS',
  'COJINES',
  'RAMOS',
  'PEINETAS Y GUIAS',
  'JUEGOS BISUTERIA',
  'ARETES',
  'VARIOS',
  'ACCESORIOS',
]);
const DRESS_SHEET_NAMES = new Set(['XV', 'XV SENCILLOS', 'NOVIA', 'VESTIDOS NOCHE']);

export function normalizeTextKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function cleanCellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

export function parseExcelPrice(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Number(value.toFixed(2)) : 0;
  }
  const str = cleanCellText(value);
  if (!str) return 0;
  const cleaned = str.replace(/[^0-9.,-]/g, '').replace(/,/g, '');
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : 0;
}

function parseExcelQty(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.floor(value));
  }
  const str = cleanCellText(value);
  if (!str) return null;
  const cleaned = str.replace(/[^0-9.-]/g, '');
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : null;
}

function shouldIgnoreSheetByName(sheetName: string): boolean {
  const norm = normalizeTextKey(sheetName);
  if (!norm) return true;
  if (IGNORED_SHEET_EXACT.has(norm)) return true;
  if (/^HOJA\s*\d+$/i.test(norm)) return true;
  return false;
}

function findHeaderRowIndex(rows: unknown[][]): number {
  const maxScan = Math.min(rows.length, 25);
  for (let r = 0; r < maxScan; r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;
    const normalized = row.map(normalizeTextKey);
    const hasPrimaryCode = normalized.some(
      (h) =>
        h === 'CODIGO NUEVO' ||
        h === 'CODIGO ACTUAL' ||
        h === 'CODIGO PRODUCTO' ||
        h === 'COD NUEVO' ||
        h === 'COD ACTUAL' ||
        h === 'COD PRODUCTO'
    );
    if (hasPrimaryCode) {
      return r;
    }
  }
  return -1;
}

function buildHeaderIndexMap(
  headerRow: unknown[],
  schemaHint: 'vestidos' | 'other'
): { map: Map<string, number>; headersList: string[] } {
  const rawNormalized = headerRow.map(normalizeTextKey);

  // Regla especial Esquema A (Vestidos): si la columna de Color no tiene encabezado escrito
  // (como la columna F entre TALLA y MARCA en la pestaña "XV"), asignarla automáticamente como COLOR.
  if (!rawNormalized.includes('COLOR')) {
    const tallaIdx = rawNormalized.indexOf('TALLA');
    const marcaIdx = rawNormalized.indexOf('MARCA');

    if (tallaIdx >= 0 && marcaIdx > tallaIdx + 1) {
      for (let i = tallaIdx + 1; i < marcaIdx; i++) {
        if (!rawNormalized[i]) {
          rawNormalized[i] = 'COLOR';
          break;
        }
      }
    } else if (tallaIdx >= 0 && tallaIdx + 1 < rawNormalized.length && !rawNormalized[tallaIdx + 1]) {
      rawNormalized[tallaIdx + 1] = 'COLOR';
    } else if (
      schemaHint === 'vestidos' &&
      rawNormalized.length > 5 &&
      !rawNormalized[5] &&
      (rawNormalized.includes('CODIGO NUEVO') || rawNormalized.includes('ESTATUS'))
    ) {
      rawNormalized[5] = 'COLOR';
    }
  }

  const map = new Map<string, number>();
  for (let i = 0; i < rawNormalized.length; i++) {
    const h = rawNormalized[i];
    if (h && !map.has(h)) {
      map.set(h, i);
    }
  }

  return { map, headersList: rawNormalized.filter(Boolean) };
}

function detectSheetSchema(sheetName: string, headersList: string[]): ExcelSchemaType {
  const normSheet = normalizeTextKey(sheetName);
  const headerSet = new Set(headersList);

  if (
    CEREMONY_SHEET_NAMES.has(normSheet) ||
    (headerSet.has('CODIGO PRODUCTO') &&
      (headerSet.has('PRECIO FINAL') ||
        headerSet.has('PRECIO VENTA') ||
        headerSet.has('PRECIO INICIAL') ||
        headerSet.has('DESCRIPCION')))
  ) {
    return 'ceremonia';
  }

  if (
    ACCESSORY_SHEET_NAMES.has(normSheet) ||
    headerSet.has('DISPONIBLES') ||
    headerSet.has('CANTIDAD') ||
    headerSet.has('COLOR BASE') ||
    headerSet.has('COLOR PIEDRA') ||
    headerSet.has('COLOR FLOR') ||
    headerSet.has('ARTICULO')
  ) {
    return 'accesorios';
  }

  if (DRESS_SHEET_NAMES.has(normSheet)) {
    return 'vestidos';
  }

  return 'vestidos';
}

function getCellByAliases(
  row: unknown[],
  headerMap: Map<string, number>,
  aliases: string[]
): unknown {
  for (const alias of aliases) {
    const idx = headerMap.get(alias);
    if (idx !== undefined && idx < row.length) {
      const val = row[idx];
      if (val !== null && val !== undefined && cleanCellText(val) !== '') {
        return val;
      }
    }
  }
  return '';
}

function hasAnyColumn(headerMap: Map<string, number>, aliases: string[]): boolean {
  return aliases.some((a) => headerMap.has(a));
}

export function parseExcelWorkbook(buffer: ArrayBuffer, fileName: string): ParsedWorkbookResult {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheets: ParsedExcelSheet[] = [];
  const ignoredSheets: IgnoredExcelSheet[] = [];

  for (const sheetName of workbook.SheetNames) {
    if (shouldIgnoreSheetByName(sheetName)) {
      ignoredSheets.push({
        sheetName,
        reason: 'Pestaña auxiliar o de sistema omitida automáticamente.',
      });
      continue;
    }

    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) {
      ignoredSheets.push({ sheetName, reason: 'Hoja vacía.' });
      continue;
    }

    const rawMatrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
      header: 1,
      defval: '',
      blankrows: true,
    });

    if (!rawMatrix || rawMatrix.length === 0) {
      ignoredSheets.push({ sheetName, reason: 'Sin contenido.' });
      continue;
    }

    const headerIdx = findHeaderRowIndex(rawMatrix);
    if (headerIdx < 0) {
      ignoredSheets.push({
        sheetName,
        reason:
          'No se detectaron encabezados compatibles (CODIGO NUEVO, CÓDIGO ACTUAL o CÓDIGO PRODUCTO).',
      });
      continue;
    }

    const normSheet = normalizeTextKey(sheetName);
    const schemaHint =
      ACCESSORY_SHEET_NAMES.has(normSheet) || CEREMONY_SHEET_NAMES.has(normSheet)
        ? 'other'
        : 'vestidos';
    const { map: headerMap, headersList } = buildHeaderIndexMap(rawMatrix[headerIdx], schemaHint);
    const schema = detectSheetSchema(sheetName, headersList);

    const hasDisponiblesCol = hasAnyColumn(headerMap, ['DISPONIBLES', 'DISPONIBLE']);
    const hasCantidadCol = hasAnyColumn(headerMap, ['CANTIDAD', 'STOCK', 'EXISTENCIA']);

    const parsedRows: ParsedExcelRow[] = [];
    const statusSet = new Set<string>();

    for (let r = headerIdx + 1; r < rawMatrix.length; r++) {
      const row = rawMatrix[r];
      if (!Array.isArray(row)) continue;

      const hasAnyContent = row.some((cell) => cleanCellText(cell) !== '');
      if (!hasAnyContent) continue;

      const codigoNuevo = cleanCellText(
        getCellByAliases(row, headerMap, ['CODIGO NUEVO', 'COD NUEVO', 'CODIGO MODELO'])
      );
      const codigoActual = cleanCellText(
        getCellByAliases(row, headerMap, ['CODIGO ACTUAL', 'COD ACTUAL'])
      );
      const codigoProducto = cleanCellText(
        getCellByAliases(row, headerMap, ['CODIGO PRODUCTO', 'COD PRODUCTO'])
      );

      const articulo = cleanCellText(getCellByAliases(row, headerMap, ['ARTICULO']));
      const descripcion = cleanCellText(
        getCellByAliases(row, headerMap, ['DESCRIPCION', 'NOMBRE', 'PRODUCTO', 'MODELO'])
      );
      const marca = cleanCellText(getCellByAliases(row, headerMap, ['MARCA']));
      const estilo = cleanCellText(getCellByAliases(row, headerMap, ['ESTILO']));
      const especificacionesCol = cleanCellText(
        getCellByAliases(row, headerMap, ['ESPECIFICACIONES', 'DETALLES', 'OBSERVACIONES', 'NOTAS'])
      );
      const tallaCol = cleanCellText(getCellByAliases(row, headerMap, ['TALLA']));
      const tamanoCol = cleanCellText(getCellByAliases(row, headerMap, ['TAMANO']));
      const largoCol = cleanCellText(getCellByAliases(row, headerMap, ['LARGO']));
      const colorCol = cleanCellText(getCellByAliases(row, headerMap, ['COLOR']));
      const colorBase = cleanCellText(getCellByAliases(row, headerMap, ['COLOR BASE']));
      const colorPiedra = cleanCellText(getCellByAliases(row, headerMap, ['COLOR PIEDRA']));
      const colorFlor = cleanCellText(getCellByAliases(row, headerMap, ['COLOR FLOR']));
      const rawStatus = cleanCellText(getCellByAliases(row, headerMap, ['ESTATUS', 'STATUS', 'ESTADO']));

      const hasUsefulIdentity = Boolean(
        codigoNuevo || codigoActual || codigoProducto || articulo || descripcion || marca || estilo
      );
      if (!hasUsefulIdentity) continue;

      // Skip Excel summary lines like "TOTAL" when no product code is attached
      const firstNonEmpty = cleanCellText(row.find((c) => cleanCellText(c) !== ''));
      if (
        !codigoNuevo &&
        !codigoActual &&
        !codigoProducto &&
        /^TOTAL\b/i.test(firstNonEmpty)
      ) {
        continue;
      }

      let codigoModelo = '';
      let name = '';
      let size = '';
      let color = '';
      let especificaciones = '';
      let price = 0;
      let costoReferencia: number | undefined;
      let explicitQty: number | null = null;

      if (schema === 'ceremonia') {
        codigoModelo = codigoProducto || codigoNuevo || codigoActual;
        price = parseExcelPrice(
          getCellByAliases(row, headerMap, ['PRECIO FINAL', 'PRECIO VENTA', 'PRECIO'])
        );
        const costoRaw = getCellByAliases(row, headerMap, ['PRECIO INICIAL', 'COSTO']);
        if (cleanCellText(costoRaw) !== '') {
          costoReferencia = parseExcelPrice(costoRaw);
        }

        name =
          descripcion ||
          articulo ||
          [sheetName, marca, estilo, codigoModelo].filter(Boolean).join(' · ') ||
          sheetName;
        size = tallaCol || tamanoCol || 'Unitalla';
        color = colorCol || colorBase || 'Sin color';
        especificaciones = [descripcion, especificacionesCol, estilo]
          .filter((v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx)
          .join(' · ');

        if (hasDisponiblesCol) {
          const dVal = getCellByAliases(row, headerMap, ['DISPONIBLES', 'DISPONIBLE']);
          explicitQty = parseExcelQty(dVal) ?? 0;
        } else if (hasCantidadCol) {
          const cVal = getCellByAliases(row, headerMap, ['CANTIDAD', 'STOCK', 'EXISTENCIA']);
          explicitQty = parseExcelQty(cVal) ?? 0;
        }
      } else if (schema === 'accesorios') {
        codigoModelo = codigoNuevo || codigoProducto || codigoActual;
        price = parseExcelPrice(
          getCellByAliases(row, headerMap, ['PRECIO', 'PRECIO FINAL', 'PRECIO VENTA'])
        );

        const attrParts: string[] = [];
        if (articulo) attrParts.push(articulo);
        if (estilo) attrParts.push(`Estilo: ${estilo}`);
        if (colorBase) attrParts.push(`Base: ${colorBase}`);
        if (colorPiedra) attrParts.push(`Piedra: ${colorPiedra}`);
        if (colorFlor) attrParts.push(`Flor: ${colorFlor}`);
        if (largoCol) attrParts.push(`Largo: ${largoCol}`);
        if (tamanoCol) attrParts.push(`Tamaño: ${tamanoCol}`);
        if (especificacionesCol) attrParts.push(especificacionesCol);

        especificaciones = attrParts.join(' · ');
        color =
          colorCol ||
          [colorBase, colorPiedra, colorFlor].filter(Boolean).join(' / ') ||
          'Sin color';
        size = tallaCol || tamanoCol || largoCol || 'Unitalla';

        const titleParts = [articulo || descripcion || sheetName, estilo, codigoModelo].filter(
          (v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx
        );
        name = titleParts.join(' · ') || sheetName;

        if (hasDisponiblesCol) {
          const dVal = getCellByAliases(row, headerMap, ['DISPONIBLES', 'DISPONIBLE']);
          explicitQty = parseExcelQty(dVal) ?? 0;
        } else if (hasCantidadCol) {
          const cVal = getCellByAliases(row, headerMap, ['CANTIDAD', 'STOCK', 'EXISTENCIA']);
          explicitQty = parseExcelQty(cVal) ?? 0;
        }
      } else {
        // Esquema A: Vestidos (XV, XV SENCILLOS, NOVIA, VESTIDOS NOCHE)
        codigoModelo = codigoNuevo || codigoProducto || codigoActual;
        price = parseExcelPrice(
          getCellByAliases(row, headerMap, ['PRECIO', 'PRECIO FINAL', 'PRECIO VENTA'])
        );
        size = tallaCol || tamanoCol || 'Unitalla';
        color = colorCol || 'Sin color';

        const specParts = [estilo, especificacionesCol, descripcion].filter(
          (v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx
        );
        especificaciones = specParts.join(' · ');

        const dressNameParts = [
          descripcion || articulo,
          sheetName,
          marca,
          estilo,
          codigoModelo || codigoActual,
        ].filter((v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx);
        name = dressNameParts.join(' · ') || sheetName;
      }

      const statusNorm = normalizeTextKey(rawStatus);
      const isSold = statusNorm.includes('VENDID');
      const isReserved = statusNorm.includes('APARTAD');

      if (statusNorm && !isSold && !isReserved) {
        statusSet.add(statusNorm);
      }

      parsedRows.push({
        tempId: `${sheetName}-${r + 1}`,
        sheetName,
        schema,
        excelRowNumber: r + 1,
        codigoModelo: truncateStr(codigoModelo, FIELD_LIMITS.MODEL_CODE_MAX),
        codigoActual: truncateStr(codigoActual, FIELD_LIMITS.SKU_MAX),
        name: truncateStr(name, FIELD_LIMITS.PRODUCT_NAME_MAX),
        size: truncateStr(size || 'Unitalla', FIELD_LIMITS.SIZE_MAX),
        color: truncateStr(color || 'Sin color', FIELD_LIMITS.COLOR_MAX),
        marca: truncateStr(marca, FIELD_LIMITS.BRAND_MAX),
        especificaciones: truncateStr(especificaciones, FIELD_LIMITS.SPECS_MAX),
        price,
        costoReferencia,
        rawStatus: truncateStr(rawStatus, FIELD_LIMITS.STATUS_TAG_MAX),
        statusNorm,
        isSold,
        isReserved,
        explicitQty,
      });
    }

    if (parsedRows.length === 0) {
      ignoredSheets.push({
        sheetName,
        reason: 'Contiene encabezados pero no tiene registros de productos válidos.',
      });
      continue;
    }

    sheets.push({
      sheetName,
      schema,
      headerRowNumber: headerIdx + 1,
      rows: parsedRows,
      detectedStatuses: Array.from(statusSet),
    });
  }

  return { fileName, sheets, ignoredSheets };
}

export function matchBranchByStatusToken(
  statusNorm: string,
  branchList: BranchInfo[]
): BranchInfo | null {
  if (!statusNorm) return null;
  for (const branch of branchList) {
    const idNorm = normalizeTextKey(branch.id);
    const nameNorm = normalizeTextKey(branch.name);
    const cityNorm = normalizeTextKey(branch.city);

    if (
      (idNorm && idNorm === statusNorm) ||
      (nameNorm && (nameNorm === statusNorm || nameNorm.includes(statusNorm) || statusNorm.includes(nameNorm))) ||
      (cityNorm && (cityNorm === statusNorm || cityNorm.includes(statusNorm) || statusNorm.includes(cityNorm)))
    ) {
      return branch;
    }
  }
  return null;
}

function buildUniqueCode128Sku(
  row: ParsedExcelRow,
  usedSkus: Set<string>
): string {
  const actualClean = sanitizeSkuValue(row.codigoActual).slice(0, FIELD_LIMITS.SKU_MAX);
  if (actualClean && !usedSkus.has(actualClean)) {
    usedSkus.add(actualClean);
    return actualClean;
  }

  const modelPart = sanitizeSkuValue(row.codigoModelo || row.sheetName || 'PRD').slice(0, 28);
  const sizePart = sanitizeSkuValue(row.size).slice(0, 12);
  const colorPart = sanitizeSkuValue(row.color).slice(0, 18);

  const combinedBase = [modelPart, sizePart, colorPart].filter(Boolean).join('-').slice(0, FIELD_LIMITS.SKU_MAX);
  const baseCandidate = combinedBase || `BTQ-IMP-${row.excelRowNumber}`;

  if (!usedSkus.has(baseCandidate)) {
    usedSkus.add(baseCandidate);
    return baseCandidate;
  }

  let seq = 2;
  while (true) {
    const suffix = `-${seq}`;
    const trimmedBase = baseCandidate.slice(0, FIELD_LIMITS.SKU_MAX - suffix.length);
    const candidate = `${trimmedBase}${suffix}`;
    if (!usedSkus.has(candidate)) {
      usedSkus.add(candidate);
      return candidate;
    }
    seq += 1;
  }
}

export interface ResolveImportOptions {
  sheets: ParsedExcelSheet[];
  selectedSheetNames: string[];
  existingProducts: Product[];
  branchList: BranchInfo[];
  primaryBranchId: BranchId;
  skipSold: boolean;
  statusBranchOverrides: Record<string, BranchId | '__ZERO__'>;
}

export interface ResolvedImportPlan {
  items: ResolvedImportItem[];
  summariesBySheet: SheetImportSummary[];
  totals: {
    totalDetected: number;
    toInsertCount: number;
    disponiblesCount: number;
    disponiblesUnits: number;
    otraSucursalCount: number;
    otraSucursalUnits: number;
    apartadoVendidoCount: number;
    omitidosCount: number;
  };
}

export function resolveImportPlan(options: ResolveImportOptions): ResolvedImportPlan {
  const {
    sheets,
    selectedSheetNames,
    existingProducts,
    branchList,
    primaryBranchId,
    skipSold,
    statusBranchOverrides,
  } = options;

  const selectedSet = new Set(selectedSheetNames);
  const usedSkus = new Set<string>();
  for (const p of existingProducts) {
    if (p.sku) usedSkus.add(sanitizeSkuValue(p.sku));
    if (p.barcodeSKU) usedSkus.add(sanitizeSkuValue(p.barcodeSKU));
  }

  const branchNameMap = new Map<string, string>();
  for (const b of branchList) {
    branchNameMap.set(b.id, b.name);
  }

  const createEmptyStock = (): StockMap => {
    const map: StockMap = {};
    for (const b of branchList) {
      map[b.id] = 0;
    }
    return map;
  };

  const items: ResolvedImportItem[] = [];
  const summariesBySheet: SheetImportSummary[] = [];

  const totals = {
    totalDetected: 0,
    toInsertCount: 0,
    disponiblesCount: 0,
    disponiblesUnits: 0,
    otraSucursalCount: 0,
    otraSucursalUnits: 0,
    apartadoVendidoCount: 0,
    omitidosCount: 0,
  };

  for (const sheet of sheets) {
    if (!selectedSet.has(sheet.sheetName)) continue;

    const category = truncateStr(sheet.sheetName, FIELD_LIMITS.CATEGORY_MAX);
    const summary: SheetImportSummary = {
      sheetName: sheet.sheetName,
      schema: sheet.schema,
      totalDetected: sheet.rows.length,
      disponiblesCount: 0,
      disponiblesUnits: 0,
      otraSucursalCount: 0,
      otraSucursalUnits: 0,
      otherBranchBreakdown: {},
      apartadoVendidoCount: 0,
      omitidosCount: 0,
    };

    totals.totalDetected += sheet.rows.length;

    for (const row of sheet.rows) {
      if (row.isSold && skipSold) {
        summary.omitidosCount += 1;
        totals.omitidosCount += 1;
        continue;
      }

      const barcodeSKU = buildUniqueCode128Sku(row, usedSkus);
      const stock = createEmptyStock();
      let totalUnits = 0;
      let assignedBranchId: BranchId | null = null;
      let assignedBranchName = 'Sin stock (0)';
      let classification: ImportClassification = 'disponible';

      if (row.explicitQty !== null) {
        // Esquema B (Accesorios) o Ceremonia con DISPONIBLES / CANTIDAD explícita
        const qty = row.isSold || row.isReserved ? 0 : row.explicitQty;
        if (qty > 0) {
          stock[primaryBranchId] = qty;
          totalUnits = qty;
          assignedBranchId = primaryBranchId;
          assignedBranchName = branchNameMap.get(primaryBranchId) || primaryBranchId;
          classification = 'disponible';
          summary.disponiblesCount += 1;
          summary.disponiblesUnits += qty;
          totals.disponiblesCount += 1;
          totals.disponiblesUnits += qty;
        } else {
          classification = 'apartado_vendido';
          summary.apartadoVendidoCount += 1;
          totals.apartadoVendidoCount += 1;
        }
      } else if (row.isSold || row.isReserved) {
        classification = 'apartado_vendido';
        summary.apartadoVendidoCount += 1;
        totals.apartadoVendidoCount += 1;
      } else if (!row.statusNorm) {
        // ESTATUS vacío -> 1 unidad en la sucursal principal seleccionada
        stock[primaryBranchId] = 1;
        totalUnits = 1;
        assignedBranchId = primaryBranchId;
        assignedBranchName = branchNameMap.get(primaryBranchId) || primaryBranchId;
        classification = 'disponible';
        summary.disponiblesCount += 1;
        summary.disponiblesUnits += 1;
        totals.disponiblesCount += 1;
        totals.disponiblesUnits += 1;
      } else {
        // ESTATUS con nombre de sucursal o etiqueta mapeada
        const overrideTarget = statusBranchOverrides[row.statusNorm];
        const autoMatched = matchBranchByStatusToken(row.statusNorm, branchList);
        const targetId =
          overrideTarget === '__ZERO__'
            ? null
            : overrideTarget || autoMatched?.id || primaryBranchId;

        if (!targetId) {
          classification = 'apartado_vendido';
          summary.apartadoVendidoCount += 1;
          totals.apartadoVendidoCount += 1;
        } else if (targetId === primaryBranchId) {
          stock[primaryBranchId] = 1;
          totalUnits = 1;
          assignedBranchId = primaryBranchId;
          assignedBranchName = branchNameMap.get(primaryBranchId) || primaryBranchId;
          classification = 'disponible';
          summary.disponiblesCount += 1;
          summary.disponiblesUnits += 1;
          totals.disponiblesCount += 1;
          totals.disponiblesUnits += 1;
        } else {
          stock[targetId] = 1;
          totalUnits = 1;
          assignedBranchId = targetId;
          assignedBranchName = branchNameMap.get(targetId) || targetId;
          classification = 'otra_sucursal';
          summary.otraSucursalCount += 1;
          summary.otraSucursalUnits += 1;
          totals.otraSucursalCount += 1;
          totals.otraSucursalUnits += 1;
          if (!summary.otherBranchBreakdown[targetId]) {
            summary.otherBranchBreakdown[targetId] = {
              name: assignedBranchName,
              count: 0,
              units: 0,
            };
          }
          summary.otherBranchBreakdown[targetId].count += 1;
          summary.otherBranchBreakdown[targetId].units += 1;
        }
      }

      totals.toInsertCount += 1;
      items.push({
        row,
        barcodeSKU,
        category,
        stock,
        totalUnits,
        assignedBranchId,
        assignedBranchName,
        classification,
        estatusOriginal: row.rawStatus,
      });
    }

    summariesBySheet.push(summary);
  }

  return { items, summariesBySheet, totals };
}
