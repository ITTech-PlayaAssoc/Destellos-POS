import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Barcode,
  CheckCircle2,
  Edit3,
  FileSpreadsheet,
  MinusCircle,
  Package,
  Plus,
  PlusCircle,
  Printer,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { inventoryService } from '../services/dataProvider';
import { formatCurrency, truncateStr } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { useHardware } from '../context/HardwareContext';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { playScanErrorBeep, playScanSuccessBeep } from '../lib/sound';
import {
  FIELD_LIMITS,
  type BranchId,
  type Product,
  type ProductCategory,
  type StockMap,
} from '../types/boutique';
import { BarcodeGraphic, generateNextBoutiqueSku, sanitizeSkuValue } from './BarcodeGraphic';
import { BarcodeModal, type StickerBatchItem } from './BarcodeModal';
import { ExcelImportModal } from './ExcelImportModal';

interface InventoryViewProps {
  products: Product[];
  loading: boolean;
}

export function InventoryView({ products, loading }: InventoryViewProps) {
  const {
    profile,
    branches,
    branchIds,
    categories,
    operatingScope,
    hasPermission,
    getBranchName,
  } = useAuth();

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('Todas');
  const [selectedLocalBranch, setSelectedLocalBranch] = useState<BranchId>(
    operatingScope !== 'general'
      ? operatingScope
      : profile?.sucursalAsignada || branchIds[0] || 'branch_1'
  );

  useEffect(() => {
    if (profile?.rol === 'admin' && operatingScope !== 'general') {
      setSelectedLocalBranch(operatingScope);
    }
  }, [profile?.rol, operatingScope]);

  useEffect(() => {
    if (categoryFilter !== 'Todas' && !categories.includes(categoryFilter)) {
      setCategoryFilter('Todas');
    }
  }, [categories, categoryFilter]);

  const { hardware } = useHardware();
  const [barcodeState, setBarcodeState] = useState<{
    product?: Product;
    batchItems?: StickerBatchItem[];
    initialCopies?: number;
    justCreated?: boolean;
  } | null>(null);
  const [highlightedProductId, setHighlightedProductId] = useState<string | null>(null);
  const [showProductModal, setShowProductModal] = useState(false);
  const [showExcelImportModal, setShowExcelImportModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [stockModal, setStockModal] = useState<{
    mode: 'restock' | 'discard';
    product: Product;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [showClearAllModal, setShowClearAllModal] = useState(false);
  const [clearAllConfirmText, setClearAllConfirmText] = useState('');
  const [clearingAll, setClearingAll] = useState(false);
  const [clearAllProgress, setClearAllProgress] = useState(0);

  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchesCat = categoryFilter === 'Todas' || p.category === categoryFilter;
      if (!matchesCat) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcodeSKU || '').toLowerCase().includes(q) ||
        (p.codigoModelo || '').toLowerCase().includes(q) ||
        (p.codigoActual || '').toLowerCase().includes(q) ||
        (p.marca || '').toLowerCase().includes(q) ||
        (p.especificaciones || '').toLowerCase().includes(q) ||
        p.color.toLowerCase().includes(q) ||
        p.size.toLowerCase().includes(q)
      );
    });
  }, [products, search, categoryFilter]);

  if (!profile) return null;

  const isAdmin = profile.rol === 'admin';
  const fallbackBranch = branchIds[0] || 'branch_1';
  const validAdminBranch = branchIds.includes(selectedLocalBranch)
    ? selectedLocalBranch
    : fallbackBranch;
  const activeBranch: BranchId = isAdmin
    ? validAdminBranch
    : profile.sucursalAsignada || fallbackBranch;
  const otherBranches = branchIds.filter((b) => b !== activeBranch);
  const canViewOtherBranches = isAdmin || hasPermission('viewOtherBranchesStock');
  const canAddProduct = isAdmin || hasPermission('addProduct');
  const canRestock = isAdmin || hasPermission('restockInventory');
  const canDiscard = isAdmin || hasPermission('discardStock');

  const showToast = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
    setTimeout(() => {
      setFeedback((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  useBarcodeScanner({
    enabled:
      hardware.globalScannerEnabled &&
      !showProductModal &&
      !showExcelImportModal &&
      !stockModal &&
      !deleteTarget &&
      !showClearAllModal &&
      !barcodeState,
    onScan: (rawCode) => {
      const code = rawCode.trim();
      if (!code) return;
      const normalized = code.replace(/\s+/g, '').toLowerCase();
      const match = products.find(
        (p) =>
          (p.barcodeSKU || '').trim().replace(/\s+/g, '').toLowerCase() === normalized ||
          p.sku.trim().replace(/\s+/g, '').toLowerCase() === normalized ||
          (p.codigoActual || '').trim().replace(/\s+/g, '').toLowerCase() === normalized
      );

      if (!match) {
        playScanErrorBeep();
        setCategoryFilter('Todas');
        setSearch(code);
        showToast('error', `No se encontró ningún producto con el código "${code}".`);
        return;
      }

      playScanSuccessBeep();
      setCategoryFilter('Todas');
      setSearch(match.barcodeSKU || match.sku);
      setHighlightedProductId(match.id);
      setTimeout(() => {
        setHighlightedProductId((prev) => (prev === match.id ? null : prev));
      }, 3500);
      showToast(
        'success',
        `Producto localizado: ${match.name} (${match.barcodeSKU || match.sku}).`
      );
    },
  });

  const handleDeleteProduct = async () => {
    if (!deleteTarget || !isAdmin) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await inventoryService.deleteProduct(target.id);
      showToast('success', `Producto "${target.name}" eliminado del catálogo.`);
    } catch (error) {
      showToast(
        'error',
        error instanceof Error ? error.message : 'No se pudo eliminar el producto.'
      );
    }
  };

  const handleClearAllInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || clearAllConfirmText.trim().toUpperCase() !== 'BORRAR') return;

    setClearingAll(true);
    setClearAllProgress(0);

    try {
      const totalDeleted = await inventoryService.clearAllProducts(
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        },
        (deleted) => setClearAllProgress(deleted)
      );

      setShowClearAllModal(false);
      setClearAllConfirmText('');
      showToast(
        'success',
        totalDeleted > 0
          ? `Inventario vaciado: se eliminaron ${totalDeleted} producto(s) de todas las sucursales.`
          : 'El inventario ya se encontraba vacío.'
      );
    } catch (error) {
      showToast(
        'error',
        error instanceof Error ? error.message : 'No se pudo vaciar el inventario.'
      );
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className={barcodeState ? 'space-y-6 no-print' : 'space-y-6'}>
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-zinc-100 tracking-tight">
            Inventario Multisucursal
          </h1>
          <p className="text-sm text-stone-600 dark:text-zinc-400 mt-1">
            Catálogo en tiempo real · Sucursal local activa:{' '}
            <span className="font-medium text-stone-900 dark:text-zinc-200">
              {getBranchName(activeBranch)}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
            <div className="flex items-center gap-2">
              <label
                htmlFor="inventory-branch-select"
                className="text-xs font-medium text-stone-500 dark:text-zinc-400 whitespace-nowrap"
              >
                Vista local:
              </label>
              <select
                id="inventory-branch-select"
                value={activeBranch}
                onChange={(e) => setSelectedLocalBranch(e.target.value as BranchId)}
                className="rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              >
                {branchIds.map((bId) => (
                  <option key={bId} value={bId}>
                    {branches[bId]?.name || bId}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isAdmin && products.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setClearAllConfirmText('');
                setClearAllProgress(0);
                setShowClearAllModal(true);
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-red-300 dark:border-red-900/70 bg-white dark:bg-zinc-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
              <span>Borrar todo el inventario (Temporal)</span>
            </button>
          )}

          {canAddProduct && (
            <>
              <button
                type="button"
                onClick={() => setShowExcelImportModal(true)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-800 dark:text-zinc-100 hover:bg-stone-50 dark:hover:bg-zinc-800 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                <span>Importar Excel</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingProduct(null);
                  setShowProductModal(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Nuevo Producto</span>
              </button>
            </>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            feedback.type === 'success'
              ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
              : 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Search & Category Filters */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-stone-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por SKU, modelo, marca, nombre, color o talla..."
            className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-10 pr-4 py-2 text-sm text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
          />
        </div>

        <div className="flex items-center gap-1 p-1 rounded-lg bg-stone-100 dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 overflow-x-auto">
          {['Todas', ...categories].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                categoryFilter === cat
                  ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                  : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      {loading ? (
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-3">
          {[1, 2, 3, 4].map((row) => (
            <div
              key={row}
              className="h-10 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse"
            />
          ))}
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-16 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-stone-100 dark:bg-zinc-800 flex items-center justify-center text-stone-500 dark:text-zinc-400 mb-4">
            <Package className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
            Tu catálogo de inventario está vacío
          </h2>
          <p className="mt-2 text-sm text-stone-500 dark:text-zinc-400 max-w-md mx-auto">
            Aún no hay vestidos, tiaras, calzado o accesorios registrados en el catálogo. Comienza dando de alta el primer producto.
          </p>
          {canAddProduct && (
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => setShowExcelImportModal(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-stone-800 dark:text-zinc-100 hover:bg-stone-50 dark:hover:bg-zinc-800 text-sm font-medium transition-colors cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                <span>Importar desde Excel (.xlsx)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingProduct(null);
                  setShowProductModal(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Registrar primer producto</span>
              </button>
            </div>
          )}
        </div>
      ) : filteredProducts.length === 0 ? (
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-12 text-center">
          <p className="text-sm font-medium text-stone-900 dark:text-zinc-100">
            No se encontraron productos con los filtros actuales
          </p>
          <p className="mt-1 text-xs text-stone-500 dark:text-zinc-400">
            Intenta ajustar la búsqueda o seleccionar otra categoría.
          </p>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setCategoryFilter('Todas');
            }}
            className="mt-4 px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
          >
            Limpiar filtros
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-xs font-medium text-stone-500 dark:text-zinc-400">
                  <th className="py-3 px-4 whitespace-nowrap">SKU</th>
                  <th className="py-3 px-4">Producto</th>
                  <th className="py-3 px-4 whitespace-nowrap">Detalles</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Precio</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap text-stone-900 dark:text-zinc-200">
                    Stock Local ({getBranchName(activeBranch)})
                  </th>
                  {canViewOtherBranches &&
                    otherBranches.map((bId) => (
                      <th key={bId} className="py-3 px-4 text-right whitespace-nowrap">
                        {getBranchName(bId)}
                      </th>
                    ))}
                  <th className="py-3 px-4 text-right whitespace-nowrap">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/80 text-sm">
                {filteredProducts.map((product) => {
                  const localQty = product.stock?.[activeBranch] ?? 0;
                  const isHighlighted = highlightedProductId === product.id;
                  return (
                    <tr
                      key={product.id}
                      className={`transition-colors ${
                        isHighlighted
                          ? 'bg-amber-50/90 dark:bg-amber-950/35 ring-1 ring-inset ring-amber-400/70'
                          : 'hover:bg-stone-50/80 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono-tabular text-xs text-stone-600 dark:text-zinc-300 whitespace-nowrap">
                        <div>{product.sku}</div>
                        {product.codigoModelo && product.codigoModelo !== product.sku && (
                          <div className="text-[11px] text-stone-400 dark:text-zinc-500">
                            Mod. {product.codigoModelo}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-stone-900 dark:text-zinc-100">
                          {product.name}
                        </div>
                        <div className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                          <span>{product.category}</span>
                          {product.marca && <span> · {product.marca}</span>}
                          {product.estatusOriginal && <span> · {product.estatusOriginal}</span>}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-stone-600 dark:text-zinc-400 whitespace-nowrap">
                        <span>Talla {product.size}</span>
                        <span className="mx-1.5 text-stone-300 dark:text-zinc-700" aria-hidden="true">
                          ·
                        </span>
                        <span>{product.color}</span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular font-medium text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                        {formatCurrency(product.price)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <span
                          className={`font-mono-tabular font-semibold ${
                            localQty === 0
                              ? 'text-red-600 dark:text-red-400'
                              : localQty <= 2
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-stone-900 dark:text-zinc-100'
                          }`}
                        >
                          {localQty}
                        </span>
                        {localQty === 0 && (
                          <span className="ml-1.5 text-[11px] text-red-600 dark:text-red-400">
                            Agotado
                          </span>
                        )}
                      </td>
                      {canViewOtherBranches &&
                        otherBranches.map((bId) => (
                          <td
                            key={bId}
                            className="py-3 px-4 text-right font-mono-tabular text-stone-600 dark:text-zinc-400 whitespace-nowrap"
                          >
                            {product.stock?.[bId] ?? 0}
                          </td>
                        ))}
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              setBarcodeState({
                                product,
                                initialCopies: Math.max(1, localQty),
                              })
                            }
                            title="Imprimir etiqueta con código de barras"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                          >
                            <Barcode className="w-3.5 h-3.5" />
                            <span>Etiqueta</span>
                          </button>

                          {canRestock && (
                            <button
                              type="button"
                              onClick={() => setStockModal({ mode: 'restock', product })}
                              title="Rellenar stock"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-emerald-200 dark:border-emerald-900/60 text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <PlusCircle className="w-3.5 h-3.5" />
                              <span>Rellenar</span>
                            </button>
                          )}

                          {canDiscard && (
                            <button
                              type="button"
                              onClick={() => setStockModal({ mode: 'discard', product })}
                              title="Descartar / mermar stock"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-amber-200 dark:border-amber-900/60 text-xs font-medium text-amber-800 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                            >
                              <MinusCircle className="w-3.5 h-3.5" />
                              <span>Descartar</span>
                            </button>
                          )}

                          {isAdmin && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingProduct(product);
                                  setShowProductModal(true);
                                }}
                                title="Editar producto"
                                className="p-1.5 rounded-md text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                                aria-label={`Editar ${product.name}`}
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(product)}
                                title="Eliminar producto"
                                className="p-1.5 rounded-md text-stone-400 hover:text-red-600 hover:bg-red-50 dark:text-zinc-500 dark:hover:text-red-400 dark:hover:bg-red-950/40 transition-colors cursor-pointer"
                                aria-label={`Eliminar ${product.name}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {barcodeState && (
        <BarcodeModal
          product={barcodeState.product}
          batchItems={barcodeState.batchItems}
          initialCopies={barcodeState.initialCopies}
          justCreated={barcodeState.justCreated}
          onClose={() => setBarcodeState(null)}
        />
      )}

      {showExcelImportModal && (
        <ExcelImportModal
          existingProducts={products}
          defaultBranchId={activeBranch}
          onClose={() => setShowExcelImportModal(false)}
          onImported={(msg) => showToast('success', msg)}
          onPrintBatchStickers={(items) => {
            setShowExcelImportModal(false);
            setBarcodeState({ batchItems: items });
          }}
        />
      )}

      {showProductModal && (
        <ProductFormModal
          existingProducts={products}
          editingProduct={editingProduct}
          activeBranch={activeBranch}
          onClose={() => {
            setShowProductModal(false);
            setEditingProduct(null);
          }}
          onSaved={(msg) => showToast('success', msg)}
          onOpenStickers={(product, copies) => {
            setShowProductModal(false);
            setEditingProduct(null);
            setBarcodeState({
              product,
              initialCopies: Math.max(1, copies),
              justCreated: true,
            });
          }}
        />
      )}

      {stockModal && (
        <StockAdjustModal
          mode={stockModal.mode}
          product={stockModal.product}
          defaultBranch={activeBranch}
          onClose={() => setStockModal(null)}
          onSaved={(msg) => showToast('success', msg)}
        />
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 no-print"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-lg">
            <h3 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              Eliminar producto
            </h3>
            <p className="mt-2 text-sm text-stone-600 dark:text-zinc-400">
              ¿Estás seguro de eliminar <span className="font-medium text-stone-900 dark:text-zinc-100">{deleteTarget.name}</span> (SKU {deleteTarget.sku})? Esta acción es permanente.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDeleteProduct}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 text-sm font-medium cursor-pointer"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {showClearAllModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 no-print"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={handleClearAllInventory}
            className="w-full max-w-md rounded-xl border border-red-200 dark:border-red-900/60 bg-white dark:bg-zinc-900 p-6 shadow-xl space-y-4"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                  Borrar todo el inventario (Temporal)
                </h3>
                <p className="mt-1 text-xs text-stone-600 dark:text-zinc-400 leading-relaxed">
                  Esta acción eliminará permanentemente los{' '}
                  <span className="font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100">
                    {products.length}
                  </span>{' '}
                  productos registrados en el sistema y su stock en todas las sucursales. No se puede deshacer.
                </p>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Escribe <span className="font-mono-tabular font-bold text-red-600 dark:text-red-400">BORRAR</span> para confirmar
              </label>
              <input
                type="text"
                autoFocus
                disabled={clearingAll}
                value={clearAllConfirmText}
                onChange={(e) => setClearAllConfirmText(e.target.value)}
                placeholder="BORRAR"
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-600/40"
              />
            </div>

            {clearingAll && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-stone-600 dark:text-zinc-400 font-mono-tabular">
                  <span>Eliminando productos por lotes...</span>
                  <span>{clearAllProgress} borrados</span>
                </div>
                <div className="h-2 rounded-full bg-stone-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-red-600 transition-all duration-200"
                    style={{
                      width: `${Math.min(
                        100,
                        products.length > 0 ? Math.round((clearAllProgress / products.length) * 100) : 100
                      )}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={clearingAll}
                onClick={() => setShowClearAllModal(false)}
                className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={clearingAll || clearAllConfirmText.trim().toUpperCase() !== 'BORRAR'}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
              >
                {clearingAll ? 'Eliminando...' : 'Eliminar todo el inventario'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

interface ProductFormModalProps {
  existingProducts: Product[];
  editingProduct: Product | null;
  activeBranch: BranchId;
  onClose: () => void;
  onSaved: (message: string) => void;
  onOpenStickers: (product: Product, defaultCopies: number) => void;
}

function ProductFormModal({
  existingProducts,
  editingProduct,
  activeBranch,
  onClose,
  onSaved,
  onOpenStickers,
}: ProductFormModalProps) {
  const { profile, branches, branchIds, categories, getBranchName } = useAuth();
  const isEdit = Boolean(editingProduct);
  const isAdmin = profile?.rol === 'admin';

  const [sku, setSku] = useState(editingProduct?.sku || '');
  const [name, setName] = useState(editingProduct?.name || '');
  const [category, setCategory] = useState<ProductCategory>(
    editingProduct?.category || categories[0] || 'General'
  );
  const [size, setSize] = useState(editingProduct?.size || '');
  const [color, setColor] = useState(editingProduct?.color || '');
  const [price, setPrice] = useState(editingProduct ? String(editingProduct.price) : '');
  const [stock, setStock] = useState<StockMap>(() => {
    const base: StockMap = {};
    for (const bId of branchIds) {
      base[bId] = 0;
    }
    return { ...base, ...(editingProduct?.stock || {}) };
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdResult, setCreatedResult] = useState<{
    product: Product;
    defaultCopies: number;
  } | null>(null);

  const autoSuggestedSku = useMemo(
    () => generateNextBoutiqueSku(existingProducts),
    [existingProducts]
  );

  if (!profile) return null;

  const trimmedSku = sanitizeSkuValue(sku);
  const livePreviewSku = trimmedSku || (!isEdit ? autoSuggestedSku : '');

  const handleGenerateSku = () => {
    setError(null);
    setSku(generateNextBoutiqueSku(existingProducts));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const rawOrAutoSku = trimmedSku || (!isEdit ? generateNextBoutiqueSku(existingProducts) : '');
    const cleanSku = truncateStr(rawOrAutoSku, FIELD_LIMITS.SKU_MAX);
    const cleanName = truncateStr(name, FIELD_LIMITS.PRODUCT_NAME_MAX);
    const cleanSize = truncateStr(size, FIELD_LIMITS.SIZE_MAX);
    const cleanColor = truncateStr(color, FIELD_LIMITS.COLOR_MAX);
    const parsedPrice = Number(price);

    if (!cleanSku || !cleanName || !cleanSize || !cleanColor) {
      setError('Completa todos los campos obligatorios del producto.');
      return;
    }

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setError('Ingresa un precio de venta válido mayor o igual a 0.');
      return;
    }

    const duplicateLocal = existingProducts.find(
      (p) => p.sku.trim().toLowerCase() === cleanSku.toLowerCase() && p.id !== editingProduct?.id
    );
    if (duplicateLocal) {
      setError(`Ya existe un producto registrado con el SKU "${cleanSku}" (${duplicateLocal.name}).`);
      return;
    }

    const cleanStock: StockMap = {};
    for (const bId of Array.from(new Set([...branchIds, ...Object.keys(stock)]))) {
      cleanStock[bId] = Math.max(0, Math.floor(Number(stock[bId]) || 0));
    }
    const finalPrice = Number(parsedPrice.toFixed(2));

    setSaving(true);
    try {
      // Validación contra códigos duplicados
      const duplicate = await inventoryService.findDuplicateSku(cleanSku, editingProduct?.id);
      if (duplicate) {
        setError(
          `Ya existe un producto registrado con el código de barras "${cleanSku}"${duplicate.name ? ` (${duplicate.name})` : ''}.`
        );
        setSaving(false);
        return;
      }

      const actor = {
        id: profile.id,
        nombreCompleto: profile.nombreCompleto,
        usuario: profile.usuario,
        sucursalAsignada: profile.sucursalAsignada,
      };
      const branchName = getBranchName(activeBranch);
      const payload = {
        sku: cleanSku,
        name: cleanName,
        category,
        size: cleanSize,
        color: cleanColor,
        price: finalPrice,
        stock: cleanStock,
      };

      if (isEdit && editingProduct) {
        await inventoryService.updateProduct(
          editingProduct.id,
          payload,
          actor,
          activeBranch,
          branchName
        );
        onSaved(`Producto "${cleanName}" actualizado correctamente.`);
        onClose();
      } else {
        const created = await inventoryService.createProduct(
          payload,
          actor,
          activeBranch,
          branchName
        );
        onSaved(`Producto "${cleanName}" registrado con código ${cleanSku}.`);
        const totalEnteredStock = branchIds.reduce(
          (sum, bId) => sum + (cleanStock[bId] ?? 0),
          0
        );
        setCreatedResult({
          product: created,
          defaultCopies: Math.max(1, totalEnteredStock),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el producto.');
    } finally {
      setSaving(false);
    }
  };

  if (createdResult) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 no-print"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800">
            <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="w-5 h-5" />
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Producto Guardado
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6 space-y-5">
            <p className="text-sm text-stone-600 dark:text-zinc-300">
              <span className="font-semibold text-stone-900 dark:text-zinc-100">
                {createdResult.product.name}
              </span>{' '}
              se registró con el código{' '}
              <span className="font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100">
                {createdResult.product.sku}
              </span>
              .
            </p>

            <div className="rounded-lg border border-stone-200 dark:border-zinc-700 bg-white p-4 text-center">
              <p className="text-xs font-semibold text-stone-900 truncate">
                {createdResult.product.name} · {formatCurrency(createdResult.product.price)}
              </p>
              <p className="text-[11px] text-stone-500 mb-2">
                Talla {createdResult.product.size} · {createdResult.product.color}
              </p>
              <BarcodeGraphic
                value={createdResult.product.sku}
                width={1.45}
                height={38}
                fontSize={10}
                margin={2}
              />
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => onOpenStickers(createdResult.product, createdResult.defaultCopies)}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium cursor-pointer whitespace-nowrap"
              >
                <Printer className="w-4 h-4" />
                <span>Imprimir Etiquetas / Stickers</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 no-print"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
            {isEdit ? 'Editar Producto' : 'Alta de Nuevo Producto'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                SKU / Código de Barras {!isEdit && <span className="font-normal text-stone-500 dark:text-zinc-400">(opcional: se genera automático si se deja vacío)</span>}
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.SKU_MAX}
                  value={sku}
                  onChange={(e) => setSku(sanitizeSkuValue(e.target.value))}
                  placeholder={isEdit ? 'SKU del producto' : `Escanea código o deja vacío (${autoSuggestedSku})`}
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                />
                <button
                  type="button"
                  onClick={handleGenerateSku}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Barcode className="w-3.5 h-3.5" />
                  <span>Generar Código Automático</span>
                </button>
              </div>
            </div>

            {/* Live CODE128 Barcode Preview */}
            <div className="rounded-lg border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950/70 p-3">
              <div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-zinc-400 mb-2">
                <span>
                  {trimmedSku
                    ? 'Vista previa en vivo (CODE128)'
                    : `Vista previa automática si queda vacío (${autoSuggestedSku})`}
                </span>
                <span className="font-mono-tabular">CODE128</span>
              </div>
              <div className="rounded-md border border-stone-200 bg-white px-3 py-2 flex items-center justify-center overflow-x-auto">
                <BarcodeGraphic
                  value={livePreviewSku}
                  width={1.45}
                  height={36}
                  fontSize={10}
                  margin={2}
                  textMargin={1}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Nombre del producto *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.PRODUCT_NAME_MAX}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Vestido Princesa Imperial con Pedrería"
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Categoría *
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as ProductCategory)}
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              >
                {(category && !categories.includes(category)
                  ? [...categories, category]
                  : categories
                ).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Talla *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.SIZE_MAX}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                placeholder="Ej. 8, M, Unitalla"
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Color *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.COLOR_MAX}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="Ej. Marfil / Champagne"
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Precio de venta (MXN) *
              </label>
              <input
                type="number"
                required
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-stone-200 dark:border-zinc-800">
            <p className="text-xs font-medium text-stone-700 dark:text-zinc-300 mb-3">
              {isEdit ? 'Existencias por sucursal' : 'Existencias iniciales por sucursal'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {branchIds.map((bId) => {
                const locked = !isAdmin && bId !== profile.sucursalAsignada;
                return (
                  <div key={bId}>
                    <label className="block text-xs text-stone-500 dark:text-zinc-400 mb-1 truncate">
                      {branches[bId]?.name || bId}
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      disabled={locked}
                      value={stock[bId] ?? 0}
                      onChange={(e) =>
                        setStock((prev) => ({
                          ...prev,
                          [bId]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                        }))
                      }
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 disabled:opacity-50"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          <div className="pt-4 flex justify-end gap-3 border-t border-stone-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Validando y guardando...' : isEdit ? 'Guardar cambios' : 'Crear producto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface StockAdjustModalProps {
  mode: 'restock' | 'discard';
  product: Product;
  defaultBranch: BranchId;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function StockAdjustModal({
  mode,
  product,
  defaultBranch,
  onClose,
  onSaved,
}: StockAdjustModalProps) {
  const { profile, branches, branchIds, getBranchName } = useAuth();
  const isAdmin = profile?.rol === 'admin';

  const [targetBranch, setTargetBranch] = useState<BranchId>(
    isAdmin ? defaultBranch : profile?.sucursalAsignada || defaultBranch
  );
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  const isDiscard = mode === 'discard';
  const currentBranchStock = product.stock?.[targetBranch] ?? 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const qty = Math.floor(Number(quantity));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('La cantidad debe ser un número entero mayor a 0.');
      return;
    }

    const cleanReason = reason.trim();
    if (isDiscard && !cleanReason) {
      setError('El motivo de descarte o merma es obligatorio.');
      return;
    }

    setSaving(true);
    try {
      const branchName = getBranchName(targetBranch);
      await inventoryService.adjustStock(
        {
          mode,
          productId: product.id,
          branchId: targetBranch,
          branchName,
          quantity: qty,
          reason: cleanReason,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );

      onSaved(
        isDiscard
          ? `Se descartaron ${qty} unidades de "${product.name}" en ${branchName}.`
          : `Se agregaron ${qty} unidades de "${product.name}" en ${branchName}.`
      );
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo actualizar el inventario.'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 no-print"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
            {isDiscard ? 'Descartar / Mermar Stock' : 'Rellenar Stock (Entrada)'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 px-4 py-3">
            <p className="text-sm font-medium text-stone-900 dark:text-zinc-100">{product.name}</p>
            <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5 font-mono-tabular">
              SKU {product.sku} · Stock actual en {getBranchName(targetBranch)}: {currentBranchStock} u.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
              Sucursal
            </label>
            <select
              value={targetBranch}
              disabled={!isAdmin}
              onChange={(e) => setTargetBranch(e.target.value as BranchId)}
              className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 disabled:opacity-60"
            >
              {branchIds.map((bId) => (
                <option key={bId} value={bId}>
                  {branches[bId]?.name || bId} (Actual: {product.stock?.[bId] ?? 0})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
              {isDiscard ? 'Cantidad a descontar *' : 'Cantidad a agregar *'}
            </label>
            <input
              type="number"
              required
              min="1"
              max={isDiscard ? Math.max(1, currentBranchStock) : 100000}
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
              {isDiscard ? 'Motivo obligatorio (Merma, daño, ajuste) *' : 'Nota o referencia de entrada (opcional)'}
            </label>
            <textarea
              required={isDiscard}
              rows={2}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                isDiscard
                  ? 'Ej. Prenda dañada en exhibición / ajuste físico de inventario'
                  : 'Ej. Reposición de proveedor / traspaso interno'
              }
              className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
            />
          </div>

          <div className="pt-3 flex justify-end gap-3 border-t border-stone-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving || (isDiscard && currentBranchStock === 0)}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 cursor-pointer ${
                isDiscard
                  ? 'bg-amber-700 hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-700'
                  : 'bg-stone-900 hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200'
              }`}
            >
              {saving
                ? 'Aplicando...'
                : isDiscard
                  ? 'Confirmar descarte'
                  : 'Confirmar entrada'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
