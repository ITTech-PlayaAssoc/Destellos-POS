import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  CheckCircle2,
  FileSpreadsheet,
  Layers,
  Upload,
  X,
} from 'lucide-react';
import { inventoryService, type BulkImportProductEntry } from '../services/dataProvider';
import { formatCurrency, truncateStr } from '../lib/utils';
import {
  EXCEL_SCHEMA_LABELS,
  matchBranchByStatusToken,
  parseExcelWorkbook,
  resolveImportPlan,
  type ParsedWorkbookResult,
} from '../lib/excelInventoryImporter';
import { useAuth } from '../context/AuthContext';
import { FIELD_LIMITS, type BranchId, type Product } from '../types/boutique';
import type { StickerBatchItem } from './BarcodeModal';

interface ExcelImportModalProps {
  existingProducts: Product[];
  defaultBranchId: BranchId;
  onClose: () => void;
  onImported: (message: string) => void;
  onPrintBatchStickers?: (items: StickerBatchItem[]) => void;
}

const BATCH_CHUNK_SIZE = 400;

export function ExcelImportModal({
  existingProducts,
  defaultBranchId,
  onClose,
  onImported,
  onPrintBatchStickers,
}: ExcelImportModalProps) {
  const { profile, branchList, categories } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsingFile, setParsingFile] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [workbookData, setWorkbookData] = useState<ParsedWorkbookResult | null>(null);

  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [primaryBranchId, setPrimaryBranchId] = useState<BranchId>(
    branchList.some((b) => b.id === defaultBranchId)
      ? defaultBranchId
      : branchList[0]?.id || 'branch_1'
  );
  const [skipSold, setSkipSold] = useState(false);
  const [statusBranchOverrides, setStatusBranchOverrides] = useState<
    Record<string, BranchId | '__ZERO__'>
  >({});
  const [previewSheetFilter, setPreviewSheetFilter] = useState<string>('ALL');

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
    currentBatch: number;
    totalBatches: number;
  } | null>(null);
  const [completedSummary, setCompletedSummary] = useState<{
    insertedCount: number;
    categoriesAdded: string[];
    sheetsCount: number;
    importedBatchItems: StickerBatchItem[];
  } | null>(null);

  useEffect(() => {
    if (!branchList.some((b) => b.id === primaryBranchId) && branchList[0]) {
      setPrimaryBranchId(branchList[0].id);
    }
  }, [branchList, primaryBranchId]);

  const unmappedStatusTokens = useMemo(() => {
    if (!workbookData) return [];
    const selectedSet = new Set(selectedSheets);
    const tokens = new Set<string>();
    for (const s of workbookData.sheets) {
      if (!selectedSet.has(s.sheetName)) continue;
      for (const tok of s.detectedStatuses) {
        if (!matchBranchByStatusToken(tok, branchList)) {
          tokens.add(tok);
        }
      }
    }
    return Array.from(tokens);
  }, [workbookData, selectedSheets, branchList]);

  const importPlan = useMemo(() => {
    if (!workbookData) return null;
    return resolveImportPlan({
      sheets: workbookData.sheets,
      selectedSheetNames: selectedSheets,
      existingProducts,
      branchList,
      primaryBranchId,
      skipSold,
      statusBranchOverrides,
    });
  }, [
    workbookData,
    selectedSheets,
    existingProducts,
    branchList,
    primaryBranchId,
    skipSold,
    statusBranchOverrides,
  ]);

  const categoriesToAdd = useMemo(() => {
    if (!workbookData) return [];
    const existingSet = new Set(categories.map((c) => c.trim().toLowerCase()));
    const candidates: string[] = [];
    for (const sheetName of selectedSheets) {
      const cleanCat = truncateStr(sheetName, FIELD_LIMITS.CATEGORY_MAX);
      if (cleanCat && !existingSet.has(cleanCat.toLowerCase())) {
        existingSet.add(cleanCat.toLowerCase());
        candidates.push(cleanCat);
      }
    }
    const remainingSlots = Math.max(0, 50 - categories.length);
    return candidates.slice(0, remainingSlots);
  }, [workbookData, selectedSheets, categories]);

  const previewRows = useMemo(() => {
    if (!importPlan) return [];
    const filtered =
      previewSheetFilter === 'ALL'
        ? importPlan.items
        : importPlan.items.filter((i) => i.row.sheetName === previewSheetFilter);
    return filtered.slice(0, 60);
  }, [importPlan, previewSheetFilter]);

  if (!profile) return null;

  const processFile = async (file: File) => {
    setParseError(null);
    setImportError(null);

    const lower = file.name.toLowerCase();
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
      setParseError('Selecciona un archivo de Excel válido con extensión .xlsx o .xls.');
      return;
    }

    setParsingFile(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = parseExcelWorkbook(buffer, file.name);
      if (parsed.sheets.length === 0) {
        setParseError(
          'No se encontraron pestañas con encabezados válidos (CODIGO NUEVO, CÓDIGO ACTUAL o CÓDIGO PRODUCTO) y filas de productos.'
        );
        setWorkbookData(null);
        return;
      }

      setWorkbookData(parsed);
      setSelectedSheets(parsed.sheets.map((s) => s.sheetName));
      setPreviewSheetFilter('ALL');
      setStatusBranchOverrides({});
    } catch {
      setParseError(
        'No se pudo leer el libro de Excel. Verifica que el archivo no esté dañado ni protegido con contraseña.'
      );
      setWorkbookData(null);
    } finally {
      setParsingFile(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void processFile(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void processFile(file);
    }
  };

  const toggleSheet = (name: string) => {
    setSelectedSheets((prev) =>
      prev.includes(name) ? prev.filter((s) => s !== name) : [...prev, name]
    );
  };

  const selectOnlyXvSheets = () => {
    if (!workbookData) return;
    const xvSheets = workbookData.sheets
      .filter((s) => {
        const up = s.sheetName.trim().toUpperCase();
        return up === 'XV' || up === 'XV SENCILLOS';
      })
      .map((s) => s.sheetName);
    setSelectedSheets(xvSheets);
    setPreviewSheetFilter('ALL');
  };

  const handleExecuteImport = async () => {
    if (!workbookData || !importPlan || importPlan.items.length === 0 || importing) return;

    setImporting(true);
    setImportError(null);

    const itemsToInsert = importPlan.items;
    const totalItems = itemsToInsert.length;
    const totalBatches = Math.ceil(totalItems / BATCH_CHUNK_SIZE);

    setProgress({
      done: 0,
      total: totalItems,
      currentBatch: 1,
      totalBatches,
    });

    try {
      const primaryName =
        branchList.find((b) => b.id === primaryBranchId)?.name || primaryBranchId;
      const summaryText = truncateStr(
        `Importación Excel "${workbookData.fileName}": ${totalItems} producto(s) en ${selectedSheets.length} pestaña(s) (${selectedSheets.join(', ')}). Sucursal principal: ${primaryName}. Disponibles: ${importPlan.totals.disponiblesCount}, Otra sucursal: ${importPlan.totals.otraSucursalCount}, Stock 0: ${importPlan.totals.apartadoVendidoCount}, Omitidos: ${importPlan.totals.omitidosCount}.`,
        FIELD_LIMITS.AUDIT_DESC_MAX
      );

      const entries: BulkImportProductEntry[] = itemsToInsert.map((item) => ({
        sku: item.barcodeSKU,
        barcodeSKU: item.barcodeSKU,
        name: item.row.name,
        category: item.category,
        size: item.row.size,
        color: item.row.color,
        price: item.row.price,
        stock: item.stock,
        codigoModelo: item.row.codigoModelo,
        codigoActual: item.row.codigoActual,
        marca: item.row.marca,
        especificaciones: item.row.especificaciones,
        estatusOriginal: item.estatusOriginal,
        costoReferencia: item.row.costoReferencia,
      }));

      const result = await inventoryService.bulkImportExcel(
        {
          fileName: workbookData.fileName,
          selectedSheets,
          existingCategories: categories,
          categoriesToAdd,
          primaryBranchId,
          primaryBranchName: primaryName,
          items: entries,
          summaryText,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        },
        (p) => setProgress(p)
      );

      const importedBatchItems: StickerBatchItem[] = result.createdProducts.map((product) => {
        const totalUnitsStock = Object.values(product.stock || {}).reduce(
          (acc, q) => acc + (q || 0),
          0
        );
        return {
          product,
          copies: Math.max(1, totalUnitsStock),
        };
      });

      setCompletedSummary({
        insertedCount: result.insertedCount,
        categoriesAdded: result.categoriesAdded,
        sheetsCount: selectedSheets.length,
        importedBatchItems,
      });
      onImported(
        `Importación completada: ${result.insertedCount} producto(s) agregados desde "${workbookData.fileName}".`
      );
    } catch (err) {
      setImportError(
        err instanceof Error
          ? err.message
          : 'Ocurrió un error al guardar los lotes de importación.'
      );
    } finally {
      setImporting(false);
    }
  };

  const progressPct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 no-print"
      role="dialog"
      aria-modal="true"
      aria-labelledby="excel-import-title"
    >
      <div className="w-full max-w-6xl rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900/50 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="excel-import-title"
                className="text-base font-semibold text-stone-900 dark:text-zinc-100 truncate"
              >
                Importador Inteligente de Inventario (.xlsx)
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400 truncate">
                Lectura multi-pestaña, detección automática de encabezados y generación de códigos CODE128 únicos.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={importing}
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 cursor-pointer"
            aria-label="Cerrar importador"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {parseError && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-300">
              {parseError}
            </div>
          )}

          {importError && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-800 dark:text-red-300">
              {importError}
            </div>
          )}

          {completedSummary ? (
            <div className="py-10 text-center space-y-4">
              <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900/50 flex items-center justify-center text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-stone-900 dark:text-zinc-100">
                  Importación masiva finalizada
                </h3>
                <p className="text-sm text-stone-600 dark:text-zinc-400 mt-1">
                  Se guardaron{' '}
                  <span className="font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100">
                    {completedSummary.insertedCount}
                  </span>{' '}
                  productos desde{' '}
                  <span className="font-mono-tabular font-semibold">
                    {completedSummary.sheetsCount}
                  </span>{' '}
                  pestaña(s) y se registró el movimiento en la Bitácora de Auditoría.
                </p>
                {completedSummary.categoriesAdded.length > 0 && (
                  <p className="text-xs text-stone-500 dark:text-zinc-400 mt-2">
                    Categorías nuevas dadas de alta automáticamente:{' '}
                    <span className="font-medium text-stone-800 dark:text-zinc-200">
                      {completedSummary.categoriesAdded.join(', ')}
                    </span>
                  </p>
                )}
              </div>
              <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                {onPrintBatchStickers && completedSummary.importedBatchItems.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onPrintBatchStickers(completedSummary.importedBatchItems)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 text-stone-900 dark:text-zinc-100 hover:bg-stone-50 dark:hover:bg-zinc-800 text-sm font-medium cursor-pointer"
                  >
                    <Barcode className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                    <span>
                      Imprimir Etiquetas ({completedSummary.importedBatchItems.length})
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium cursor-pointer"
                >
                  Volver al Inventario
                </button>
              </div>
            </div>
          ) : !workbookData ? (
            <div className="space-y-5">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="hidden"
              />

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => !parsingFile && fileInputRef.current?.click()}
                className="rounded-xl border-2 border-dashed border-stone-300 dark:border-zinc-700 hover:border-amber-600 dark:hover:border-amber-500 bg-stone-50/70 dark:bg-zinc-950/60 px-6 py-14 text-center transition-colors cursor-pointer"
              >
                <div className="mx-auto w-12 h-12 rounded-xl bg-white dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 flex items-center justify-center text-stone-600 dark:text-zinc-300 mb-4">
                  <Upload className="w-6 h-6" />
                </div>
                <p className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                  {parsingFile
                    ? 'Analizando libro de Excel y detectando encabezados...'
                    : 'Arrastra aquí tu archivo .xlsx o haz clic para seleccionarlo'}
                </p>
                <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1.5 max-w-lg mx-auto leading-relaxed">
                  Soporta libros multi-pestaña con encabezados dinámicos (fila 3), variantes de talla/color en vestidos, conteo de accesorios y artículos de ceremonia/infantil.
                </p>
                <button
                  type="button"
                  disabled={parsingFile}
                  className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-xs font-medium whitespace-nowrap cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>{parsingFile ? 'Procesando...' : 'Seleccionar archivo Excel'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-stone-600 dark:text-zinc-400">
                <div className="rounded-lg border border-stone-200 dark:border-zinc-800 p-4 space-y-1">
                  <p className="font-semibold text-stone-900 dark:text-zinc-100">
                    Esquema A · Vestidos
                  </p>
                  <p className="leading-relaxed">
                    XV, XV Sencillos, Novia, Noche. Detecta color en columna F sin encabezado y evalúa ESTATUS (disponible, otra sucursal, Apartado o Vendido).
                  </p>
                </div>
                <div className="rounded-lg border border-stone-200 dark:border-zinc-800 p-4 space-y-1">
                  <p className="font-semibold text-stone-900 dark:text-zinc-100">
                    Esquema B · Accesorios
                  </p>
                  <p className="leading-relaxed">
                    Tiaras, Velos, Lazos, Arras, Cojines, Ramos, Peinetas, Aretes. Toma stock de DISPONIBLES o CANTIDAD y combina detalles de piedra, base y largo.
                  </p>
                </div>
                <div className="rounded-lg border border-stone-200 dark:border-zinc-800 p-4 space-y-1">
                  <p className="font-semibold text-stone-900 dark:text-zinc-100">
                    Esquema C · Ceremonia / Infantil
                  </p>
                  <p className="leading-relaxed">
                    Comunión, Ropones, Niña, Bisutería. Mapea CÓDIGO PRODUCTO, PRECIO FINAL, DESCRIPCIÓN y conserva PRECIO INICIAL como costo de referencia.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Top File Bar & Global Options */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-stone-200 dark:border-zinc-800">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-zinc-100">
                    <FileSpreadsheet className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                    <span className="truncate">{workbookData.fileName}</span>
                  </div>
                  <p className="text-xs text-stone-500 dark:text-zinc-400">
                    {workbookData.sheets.length} pestaña(s) con datos detectadas
                    {workbookData.ignoredSheets.length > 0 && (
                      <> · {workbookData.ignoredSheets.length} auxiliar(es)/vacía(s) omitida(s)</>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <label
                      htmlFor="import-primary-branch"
                      className="text-xs font-medium text-stone-600 dark:text-zinc-300 whitespace-nowrap"
                    >
                      Sucursal principal:
                    </label>
                    <select
                      id="import-primary-branch"
                      disabled={importing}
                      value={primaryBranchId}
                      onChange={(e) => setPrimaryBranchId(e.target.value as BranchId)}
                      className="rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs text-stone-900 dark:text-zinc-100"
                    >
                      {branchList.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                          {b.city ? ` (${b.city})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label className="inline-flex items-center gap-2 text-xs text-stone-700 dark:text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      disabled={importing}
                      checked={skipSold}
                      onChange={(e) => setSkipSold(e.target.checked)}
                      className="rounded border-stone-300 dark:border-zinc-700 text-stone-900 focus:ring-amber-600"
                    />
                    <span>Omitir marcados como VENDIDO</span>
                  </label>

                  <button
                    type="button"
                    disabled={importing}
                    onClick={() => {
                      setWorkbookData(null);
                      setSelectedSheets([]);
                      setParseError(null);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 whitespace-nowrap cursor-pointer disabled:opacity-40"
                  >
                    Cambiar archivo
                  </button>
                </div>
              </div>

              {/* Sheet / Category Selector */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                    <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                      Pestañas a importar (se asignan como Categoría)
                    </h3>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() =>
                        setSelectedSheets(workbookData.sheets.map((s) => s.sheetName))
                      }
                      className="px-2.5 py-1 rounded-md border border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
                    >
                      Seleccionar todas
                    </button>
                    {workbookData.sheets.some((s) =>
                      ['XV', 'XV SENCILLOS'].includes(s.sheetName.trim().toUpperCase())
                    ) && (
                      <button
                        type="button"
                        disabled={importing}
                        onClick={selectOnlyXvSheets}
                        className="px-2.5 py-1 rounded-md border border-stone-200 dark:border-zinc-700 text-stone-700 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
                      >
                        Solo XV y XV SENCILLOS
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => setSelectedSheets([])}
                      className="px-2.5 py-1 rounded-md border border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800 whitespace-nowrap cursor-pointer"
                    >
                      Limpiar selección
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {workbookData.sheets.map((sheet) => {
                    const checked = selectedSheets.includes(sheet.sheetName);
                    return (
                      <button
                        key={sheet.sheetName}
                        type="button"
                        disabled={importing}
                        onClick={() => toggleSheet(sheet.sheetName)}
                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                          checked
                            ? 'border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                            : 'border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950 text-stone-600 dark:text-zinc-400 hover:border-stone-300 dark:hover:border-zinc-700'
                        }`}
                      >
                        <span>{sheet.sheetName}</span>
                        <span
                          className={`font-mono-tabular ${
                            checked
                              ? 'text-stone-300 dark:text-zinc-600'
                              : 'text-stone-400 dark:text-zinc-500'
                          }`}
                        >
                          ({sheet.rows.length})
                        </span>
                      </button>
                    );
                  })}
                </div>

                {categoriesToAdd.length > 0 && (
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    Categorías nuevas que se crearán automáticamente en el catálogo:{' '}
                    <span className="font-medium">{categoriesToAdd.join(', ')}</span>
                  </p>
                )}
              </div>

              {/* Unmapped ESTATUS branch tokens alert */}
              {unmappedStatusTokens.length > 0 && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-4 space-y-3">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-900 dark:text-amber-200">
                      <p className="font-semibold">
                        Valores en columna ESTATUS sin sucursal coincidente directa
                      </p>
                      <p className="mt-0.5 text-amber-800/90 dark:text-amber-300/90">
                        Asigna a qué sucursal deseas enviar el stock (1 u.) para estos estatus detectados (por defecto ingresan a la sucursal principal):
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {unmappedStatusTokens.map((tok) => (
                      <div key={tok} className="flex items-center gap-2">
                        <span className="text-xs font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100 truncate min-w-20">
                          {tok}
                        </span>
                        <select
                          disabled={importing}
                          value={statusBranchOverrides[tok] || primaryBranchId}
                          onChange={(e) =>
                            setStatusBranchOverrides((prev) => ({
                              ...prev,
                              [tok]: e.target.value as BranchId | '__ZERO__',
                            }))
                          }
                          className="flex-1 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2.5 py-1.5 text-xs text-stone-900 dark:text-zinc-100"
                        >
                          {branchList.map((b) => (
                            <option key={b.id} value={b.id}>
                              1 u. → {b.name}
                            </option>
                          ))}
                          <option value="__ZERO__">0 u. (Solo etiqueta)</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Summary Breakdown by Sheet */}
              {importPlan && importPlan.summariesBySheet.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                    Resumen previo por pestaña seleccionada
                  </h3>
                  <div className="rounded-lg border border-stone-200 dark:border-zinc-800 overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950/70 text-stone-500 dark:text-zinc-400 font-medium">
                          <th className="py-2.5 px-3.5 whitespace-nowrap">Pestaña / Categoría</th>
                          <th className="py-2.5 px-3.5 whitespace-nowrap">Esquema detectado</th>
                          <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Detectados</th>
                          <th className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            Disponibles (Principal)
                          </th>
                          <th className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            Otra sucursal
                          </th>
                          <th className="py-2.5 px-3.5 text-right whitespace-nowrap">
                            Stock 0 (Apartado/Vendido)
                          </th>
                          {skipSold && (
                            <th className="py-2.5 px-3.5 text-right whitespace-nowrap">Omitidos</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/80">
                        {importPlan.summariesBySheet.map((sum) => {
                          const otherText = Object.values(sum.otherBranchBreakdown)
                            .map((o) => `${o.name}: ${o.count}`)
                            .join(', ');
                          return (
                            <tr key={sum.sheetName} className="hover:bg-stone-50/70 dark:hover:bg-zinc-800/30">
                              <td className="py-2.5 px-3.5 font-medium text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                                {sum.sheetName}
                              </td>
                              <td className="py-2.5 px-3.5 text-stone-600 dark:text-zinc-400 whitespace-nowrap">
                                {EXCEL_SCHEMA_LABELS[sum.schema]}
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-mono-tabular text-stone-800 dark:text-zinc-200">
                                {sum.totalDetected}
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-mono-tabular text-emerald-700 dark:text-emerald-400">
                                {sum.disponiblesCount}{' '}
                                <span className="text-stone-400 dark:text-zinc-500">
                                  ({sum.disponiblesUnits} u.)
                                </span>
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-mono-tabular text-amber-700 dark:text-amber-400">
                                {sum.otraSucursalCount}
                                {otherText && (
                                  <span className="block font-sans text-[11px] text-stone-500 dark:text-zinc-400">
                                    {otherText}
                                  </span>
                                )}
                              </td>
                              <td className="py-2.5 px-3.5 text-right font-mono-tabular text-stone-600 dark:text-zinc-400">
                                {sum.apartadoVendidoCount}
                              </td>
                              {skipSold && (
                                <td className="py-2.5 px-3.5 text-right font-mono-tabular text-stone-500 dark:text-zinc-500">
                                  {sum.omitidosCount}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-stone-200 dark:border-zinc-800 bg-stone-50/80 dark:bg-zinc-950/60 font-semibold text-stone-900 dark:text-zinc-100">
                          <td className="py-2.5 px-3.5" colSpan={2}>
                            Total a importar ({importPlan.totals.toInsertCount} producto(s))
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular">
                            {importPlan.totals.totalDetected}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular text-emerald-700 dark:text-emerald-400">
                            {importPlan.totals.disponiblesCount} ({importPlan.totals.disponiblesUnits}{' '}
                            u.)
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular text-amber-700 dark:text-amber-400">
                            {importPlan.totals.otraSucursalCount}
                          </td>
                          <td className="py-2.5 px-3.5 text-right font-mono-tabular">
                            {importPlan.totals.apartadoVendidoCount}
                          </td>
                          {skipSold && (
                            <td className="py-2.5 px-3.5 text-right font-mono-tabular">
                              {importPlan.totals.omitidosCount}
                            </td>
                          )}
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {/* Preview Sample Rows */}
              {importPlan && importPlan.items.length > 0 && (
                <div className="space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                      Vista previa de productos y SKUs CODE128 (primeros {previewRows.length} de{' '}
                      {importPlan.items.length})
                    </h3>
                    <select
                      value={previewSheetFilter}
                      onChange={(e) => setPreviewSheetFilter(e.target.value)}
                      className="rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs text-stone-900 dark:text-zinc-100 self-start sm:self-auto"
                    >
                      <option value="ALL">Todas las pestañas seleccionadas</option>
                      {selectedSheets.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="rounded-lg border border-stone-200 dark:border-zinc-800 overflow-x-auto max-h-64">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-stone-50 dark:bg-zinc-950 z-10 border-b border-stone-200 dark:border-zinc-800 text-stone-500 dark:text-zinc-400">
                        <tr>
                          <th className="py-2 px-3 whitespace-nowrap">SKU CODE128</th>
                          <th className="py-2 px-3 whitespace-nowrap">Modelo</th>
                          <th className="py-2 px-3 whitespace-nowrap">Categoría</th>
                          <th className="py-2 px-3">Producto / Detalles</th>
                          <th className="py-2 px-3 whitespace-nowrap">Talla · Color</th>
                          <th className="py-2 px-3 text-right whitespace-nowrap">Precio</th>
                          <th className="py-2 px-3 whitespace-nowrap">Estatus / Asignación</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/80">
                        {previewRows.map((item) => (
                          <tr
                            key={`${item.row.tempId}-${item.barcodeSKU}`}
                            className="hover:bg-stone-50/70 dark:hover:bg-zinc-800/30"
                          >
                            <td className="py-2 px-3 font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                              {item.barcodeSKU}
                            </td>
                            <td className="py-2 px-3 font-mono-tabular text-stone-600 dark:text-zinc-400 whitespace-nowrap">
                              {item.row.codigoModelo || '—'}
                            </td>
                            <td className="py-2 px-3 text-stone-700 dark:text-zinc-300 whitespace-nowrap">
                              {item.category}
                            </td>
                            <td className="py-2 px-3 max-w-xs">
                              <p className="font-medium text-stone-900 dark:text-zinc-100 truncate">
                                {item.row.name}
                              </p>
                              {(item.row.marca || item.row.especificaciones) && (
                                <p className="text-[11px] text-stone-500 dark:text-zinc-400 truncate">
                                  {[item.row.marca, item.row.especificaciones]
                                    .filter(Boolean)
                                    .join(' · ')}
                                </p>
                              )}
                            </td>
                            <td className="py-2 px-3 text-stone-600 dark:text-zinc-400 whitespace-nowrap">
                              {item.row.size} · {item.row.color}
                            </td>
                            <td className="py-2 px-3 text-right font-mono-tabular text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                              {formatCurrency(item.row.price)}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap">
                              <span
                                className={
                                  item.classification === 'disponible'
                                    ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                                    : item.classification === 'otra_sucursal'
                                      ? 'text-amber-700 dark:text-amber-400 font-medium'
                                      : 'text-stone-500 dark:text-zinc-400'
                                }
                              >
                                {item.totalUnits} u. · {item.assignedBranchName}
                              </span>
                              {item.estatusOriginal && (
                                <span className="ml-1.5 text-[11px] text-stone-400 dark:text-zinc-500">
                                  ({item.estatusOriginal})
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Progress Bar during batch writes */}
              {importing && progress && (
                <div className="rounded-lg border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950 p-4 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-stone-900 dark:text-zinc-100">
                      Guardando lote {progress.currentBatch} de {progress.totalBatches} en Cloud Firestore...
                    </span>
                    <span className="font-mono-tabular text-stone-600 dark:text-zinc-300">
                      {progress.done} / {progress.total} ({progressPct}%)
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-stone-200 dark:bg-zinc-800 overflow-hidden">
                    <div
                      className="h-full bg-stone-900 dark:bg-amber-500 transition-all duration-200"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        {!completedSummary && (
          <div className="px-6 py-4 border-t border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 flex flex-wrap items-center justify-between gap-3 shrink-0">
            <p className="text-xs text-stone-500 dark:text-zinc-400">
              {workbookData && importPlan
                ? `Se insertarán ${importPlan.totals.toInsertCount} documento(s) en lotes de 400.`
                : 'Formato compatible: .xlsx / .xls'}
            </p>

            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={importing}
                onClick={onClose}
                className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer disabled:opacity-40"
              >
                Cancelar
              </button>

              {workbookData && (
                <button
                  type="button"
                  disabled={importing || !importPlan || importPlan.items.length === 0}
                  onClick={() => void handleExecuteImport()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-xs font-medium transition-colors disabled:opacity-45 cursor-pointer whitespace-nowrap"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {importing
                      ? 'Importando inventario...'
                      : `Confirmar e Importar (${importPlan?.items.length || 0})`}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
