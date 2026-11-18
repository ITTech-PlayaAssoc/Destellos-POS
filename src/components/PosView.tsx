import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Ban,
  Banknote,
  Barcode,
  Calendar,
  CreditCard,
  Minus,
  Plus,
  Printer,
  Receipt,
  Search,
  ShoppingBag,
  Trash2,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { salesService } from '../services/dataProvider';
import {
  formatCurrency,
  formatDateInputValue,
  formatDateTime,
  toMillis,
  truncateStr,
} from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { useHardware } from '../context/HardwareContext';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { playScanErrorBeep, playScanSuccessBeep } from '../lib/sound';
import {
  FIELD_LIMITS,
  type BranchId,
  type Customer,
  type DiscountType,
  type PaymentMethod,
  type Product,
  type Sale,
} from '../types/boutique';
import { CashRegisterTab } from './CashRegisterTab';
import { CustomerQuickModal } from './CustomerQuickModal';
import { ThermalTicketModal } from './ThermalTicketModal';

interface PosViewProps {
  products: Product[];
  loadingProducts: boolean;
  customers: Customer[];
  onGoToInventory?: () => void;
}

interface CartLine {
  product: Product;
  quantity: number;
}

export function PosView({
  products,
  loadingProducts,
  customers,
  onGoToInventory,
}: PosViewProps) {
  const { profile, branches, branchIds, operatingScope, getBranchName } = useAuth();
  const { hardware } = useHardware();

  const [posTab, setPosTab] = useState<'register' | 'history' | 'closing'>('register');
  const [selectedBranch, setSelectedBranch] = useState<BranchId>(
    operatingScope !== 'general'
      ? operatingScope
      : profile?.sucursalAsignada || branchIds[0] || 'branch_1'
  );
  const [barcodeInput, setBarcodeInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);

  const [discountType, setDiscountType] = useState<DiscountType>('none');
  const [discountInput, setDiscountInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Efectivo');
  const [cashReceivedInput, setCashReceivedInput] = useState('');
  const [cardReference, setCardReference] = useState('');
  const [transferReference, setTransferReference] = useState('');
  const [processingSale, setProcessingSale] = useState(false);

  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [showQuickCustomerModal, setShowQuickCustomerModal] = useState(false);
  const [isPrintingClosure, setIsPrintingClosure] = useState(false);

  const [scanMessage, setScanMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [completedSale, setCompletedSale] = useState<(Sale & { issuedLocallyAt?: Date }) | null>(
    null
  );
  const [scannedDetailProduct, setScannedDetailProduct] = useState<Product | null>(null);

  const [recentSales, setRecentSales] = useState<Sale[]>([]);
  const [loadingSales, setLoadingSales] = useState(true);
  const [historyFolioSearch, setHistoryFolioSearch] = useState('');
  const [historyDateFilter, setHistoryDateFilter] = useState('');
  const [cancelSaleTarget, setCancelSaleTarget] = useState<Sale | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancellingSale, setCancellingSale] = useState(false);

  const barcodeRef = useRef<HTMLInputElement>(null);

  const isAdmin = profile?.rol === 'admin';
  const fallbackBranch = branchIds[0] || 'branch_1';
  const validAdminBranch = branchIds.includes(selectedBranch) ? selectedBranch : fallbackBranch;
  const activeBranch: BranchId = isAdmin
    ? validAdminBranch
    : profile?.sucursalAsignada || fallbackBranch;

  useEffect(() => {
    if (isAdmin && operatingScope !== 'general') {
      setSelectedBranch(operatingScope);
    }
  }, [isAdmin, operatingScope]);

  useEffect(() => {
    if (posTab === 'register') {
      barcodeRef.current?.focus();
    }
  }, [posTab, activeBranch]);

  // Adjust cart quantities if admin switches active branch
  useEffect(() => {
    setCart((prev) =>
      prev
        .map((line) => {
          const freshProduct = products.find((p) => p.id === line.product.id) || line.product;
          const avail = freshProduct.stock?.[activeBranch] ?? 0;
          if (avail <= 0) return null;
          return {
            product: freshProduct,
            quantity: Math.min(line.quantity, avail),
          };
        })
        .filter((x): x is CartLine => x !== null)
    );
  }, [activeBranch, products]);

  // Subscribe to sales in real time
  useEffect(() => {
    if (!profile) return;
    setLoadingSales(true);

    const unsub = salesService.subscribeSales(
      isAdmin ? { limitCount: 250 } : { branchId: profile.sucursalAsignada, limitCount: 250 },
      (list) => {
        const sorted = [...list].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setRecentSales(sorted);
        setLoadingSales(false);
      },
      (error) => {
        setLoadingSales(false);
        console.error(error);
      }
    );

    return () => unsub();
  }, [profile?.id, profile?.sucursalAsignada, isAdmin]);

  const filteredSales = useMemo(() => {
    const q = historyFolioSearch.trim().toLowerCase();
    return recentSales.filter((sale) => {
      if (isAdmin && operatingScope !== 'general' && sale.branchId !== operatingScope) {
        return false;
      }
      if (q) {
        const matchFolio = sale.folio.toLowerCase().includes(q);
        const matchSeller = sale.sellerName.toLowerCase().includes(q);
        if (!matchFolio && !matchSeller) return false;
      }
      if (historyDateFilter) {
        const saleDate = formatDateInputValue(sale.createdAt);
        if (saleDate !== historyDateFilter) return false;
      }
      return true;
    });
  }, [recentSales, historyFolioSearch, historyDateFilter, isAdmin, operatingScope]);

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return [];
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        (p.barcodeSKU || '').toLowerCase().includes(q) ||
        (p.codigoModelo || '').toLowerCase().includes(q) ||
        (p.codigoActual || '').toLowerCase().includes(q) ||
        (p.marca || '').toLowerCase().includes(q) ||
        (p.especificaciones || '').toLowerCase().includes(q) ||
        p.size.toLowerCase().includes(q) ||
        p.color.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [products, searchTerm]);

  const subtotal = useMemo(
    () => cart.reduce((acc, line) => acc + line.product.price * line.quantity, 0),
    [cart]
  );

  const discountVal = Math.max(0, Number(discountInput) || 0);
  const discountAmount = useMemo(() => {
    if (discountType === 'none' || subtotal <= 0) return 0;
    if (discountType === 'percent') {
      const clampedPct = Math.min(100, discountVal);
      return Number(((subtotal * clampedPct) / 100).toFixed(2));
    }
    return Number(Math.min(subtotal, discountVal).toFixed(2));
  }, [discountType, discountVal, subtotal]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const matchingCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 6);
    return customers
      .filter(
        (c) =>
          c.nombreCompleto.toLowerCase().includes(q) ||
          c.telefono.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [customers, customerSearch]);

  if (!profile) return null;

  const showScanFeedback = (type: 'success' | 'error', text: string) => {
    setScanMessage({ type, text });
    setTimeout(() => {
      setScanMessage((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  };

  const addProductToCart = (product: Product): boolean => {
    const avail = product.stock?.[activeBranch] ?? 0;
    if (avail <= 0) {
      showScanFeedback(
        'error',
        `"${product.name}" no tiene existencias disponibles en ${getBranchName(activeBranch)}.`
      );
      return false;
    }

    const existing = cart.find((c) => c.product.id === product.id);
    if (existing && existing.quantity >= avail) {
      showScanFeedback(
        'error',
        `Stock máximo alcanzado para "${product.name}" (${avail} u. en ${getBranchName(activeBranch)}).`
      );
      return false;
    }

    setCart((prev) => {
      const idx = prev.findIndex((c) => c.product.id === product.id);
      if (idx >= 0) {
        const line = prev[idx];
        if (line.quantity >= avail) return prev;
        const next = [...prev];
        next[idx] = { product, quantity: line.quantity + 1 };
        return next;
      }
      return [...prev, { product, quantity: 1 }];
    });

    showScanFeedback(
      'success',
      existing ? `+1 ${product.name} agregado al carrito.` : `"${product.name}" agregado al carrito.`
    );
    return true;
  };

  const processScannedCode = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;

    const normalizedCode = code.replace(/\s+/g, '').toLowerCase();
    const match = products.find(
      (p) =>
        (p.barcodeSKU || '').trim().replace(/\s+/g, '').toLowerCase() === normalizedCode ||
        p.sku.trim().replace(/\s+/g, '').toLowerCase() === normalizedCode ||
        (p.codigoActual || '').trim().replace(/\s+/g, '').toLowerCase() === normalizedCode
    );

    if (!match) {
      playScanErrorBeep();
      showScanFeedback('error', `Código "${code}" no encontrado en el catálogo.`);
      return;
    }

    const avail = match.stock?.[activeBranch] ?? 0;
    if (avail <= 0) {
      playScanErrorBeep();
      showScanFeedback(
        'error',
        `"${match.name}" sin stock disponible en ${getBranchName(activeBranch)}.`
      );
      return;
    }

    if (hardware.posScanAction === 'show_detail') {
      playScanSuccessBeep();
      setScannedDetailProduct(match);
      showScanFeedback('success', `Artículo identificado: ${match.name}.`);
      return;
    }

    const added = addProductToCart(match);
    if (added) {
      playScanSuccessBeep();
    } else {
      playScanErrorBeep();
    }
  };

  useBarcodeScanner({
    enabled:
      hardware.globalScannerEnabled &&
      posTab === 'register' &&
      !completedSale &&
      !showQuickCustomerModal &&
      !cancelSaleTarget &&
      !scannedDetailProduct &&
      !isPrintingClosure,
    onScan: processScannedCode,
  });

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;

    processScannedCode(code);
    setBarcodeInput('');
    barcodeRef.current?.focus();
  };

  const updateCartQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.product.id !== productId) return line;
          const avail = line.product.stock?.[activeBranch] ?? 0;
          const nextQty = line.quantity + delta;
          if (nextQty <= 0) return null;
          if (nextQty > avail) {
            showScanFeedback(
              'error',
              `Solo hay ${avail} unidades disponibles en ${getBranchName(activeBranch)}.`
            );
            return line;
          }
          return { ...line, quantity: nextQty };
        })
        .filter((x): x is CartLine => x !== null)
    );
  };

  const total = Math.max(0, Number((subtotal - discountAmount).toFixed(2)));
  const cashReceived = Math.max(0, Number(cashReceivedInput) || 0);
  const changeGiven =
    paymentMethod === 'Efectivo' ? Math.max(0, Number((cashReceived - total).toFixed(2))) : 0;

  const canCheckout =
    cart.length > 0 && (paymentMethod !== 'Efectivo' || cashReceived >= total);

  const executeSaleTransaction = async () => {
    if (cart.length === 0) return;
    if (paymentMethod === 'Efectivo' && cashReceived < total) {
      showScanFeedback('error', 'El efectivo recibido es menor al total a cobrar.');
      return;
    }

    setProcessingSale(true);
    const branchName = getBranchName(activeBranch);
    const cleanCardRef =
      paymentMethod === 'Tarjeta' ? truncateStr(cardReference, FIELD_LIMITS.CARD_REF_MAX) : '';
    const cleanTransferRef =
      paymentMethod === 'Transferencia'
        ? truncateStr(transferReference, FIELD_LIMITS.CARD_REF_MAX)
        : '';
    const finalCashReceived =
      paymentMethod === 'Efectivo' ? Number(cashReceived.toFixed(2)) : total;
    const finalChangeGiven = paymentMethod === 'Efectivo' ? changeGiven : 0;

    try {
      const createdSaleData = await salesService.createSale(
        {
          branchId: activeBranch,
          branchName: truncateStr(branchName, FIELD_LIMITS.BRANCH_NAME_MAX),
          items: cart.map((line) => ({
            productId: line.product.id,
            productName: line.product.name,
            quantity: line.quantity,
          })),
          subtotal: Number(subtotal.toFixed(2)),
          discountType,
          discountValue: Number(discountVal.toFixed(2)),
          discountAmount,
          total,
          paymentMethod,
          cashReceived: finalCashReceived,
          changeGiven: finalChangeGiven,
          cardReference: cleanCardRef,
          transferReference: cleanTransferRef,
          customer: selectedCustomer
            ? {
                id: selectedCustomer.id,
                nombreCompleto: truncateStr(
                  selectedCustomer.nombreCompleto,
                  FIELD_LIMITS.DISPLAY_NAME_MAX
                ),
              }
            : null,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );

      setCart([]);
      setDiscountType('none');
      setDiscountInput('');
      setCashReceivedInput('');
      setCardReference('');
      setTransferReference('');
      setSelectedCustomerId('');
      setCustomerSearch('');

      setCompletedSale(createdSaleData);
      showScanFeedback('success', `Venta ${createdSaleData.folio} registrada correctamente.`);
    } catch (err) {
      showScanFeedback(
        'error',
        err instanceof Error ? err.message : 'Ocurrió un error al procesar la venta.'
      );
    } finally {
      setProcessingSale(false);
    }
  };

  const executeCancelSaleTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelSaleTarget || !isAdmin) return;
    const cleanReason = truncateStr(cancelReason, FIELD_LIMITS.CANCEL_REASON_MAX);
    if (!cleanReason) {
      showScanFeedback('error', 'Indica el motivo de la cancelación.');
      return;
    }

    setCancellingSale(true);
    const target = cancelSaleTarget;

    try {
      await salesService.cancelSale(
        {
          sale: target,
          reason: cleanReason,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );

      setCancelSaleTarget(null);
      setCancelReason('');
      setPosTab('history');
      showScanFeedback(
        'success',
        `Venta ${target.folio} cancelada. El stock en ${target.branchName} fue reintegrado.`
      );
    } catch (err) {
      showScanFeedback(
        'error',
        err instanceof Error ? err.message : 'No se pudo cancelar la venta.'
      );
    } finally {
      setCancellingSale(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Branch Selector (hidden on print when any ticket/closure print modal is open) */}
      <div
        className={`flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 ${
          completedSale || isPrintingClosure ? 'no-print' : ''
        }`}
      >
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-zinc-100 tracking-tight">
            Punto de Venta
          </h1>
          <p className="text-sm text-stone-600 dark:text-zinc-400 mt-1">
            Cobro en caja, tickets y corte por turno · Sucursal activa:{' '}
            <span className="font-medium text-stone-900 dark:text-zinc-200">
              {getBranchName(activeBranch)}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label
              htmlFor="pos-branch-select"
              className="text-xs font-medium text-stone-500 dark:text-zinc-400 whitespace-nowrap"
            >
              Sucursal:
            </label>
            <select
              id="pos-branch-select"
              value={activeBranch}
              disabled={!isAdmin}
              onChange={(e) => setSelectedBranch(e.target.value as BranchId)}
              className="rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 disabled:opacity-65 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
            >
              {branchIds.map((bId) => (
                <option key={bId} value={bId}>
                  {branches[bId]?.name || bId}
                </option>
              ))}
              {!branchIds.includes(activeBranch) && (
                <option value={activeBranch}>{getBranchName(activeBranch)}</option>
              )}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-stone-100 dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setPosTab('register')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                posTab === 'register'
                  ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                  : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-200'
              }`}
            >
              Caja / Cobro
            </button>
            <button
              type="button"
              onClick={() => setPosTab('history')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                posTab === 'history'
                  ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                  : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-200'
              }`}
            >
              Historial de Tickets
            </button>
            <button
              type="button"
              onClick={() => setPosTab('closing')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                posTab === 'closing'
                  ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                  : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-200'
              }`}
            >
              Cierre de Caja
            </button>
          </div>
        </div>
      </div>

      {posTab === 'closing' ? (
        <CashRegisterTab
          activeBranch={activeBranch}
          sales={recentSales}
          onPrintingChange={setIsPrintingClosure}
        />
      ) : (
        <div className={completedSale ? 'space-y-6 no-print' : 'space-y-6'}>
          {posTab === 'history' ? (
          <div className="space-y-4">
            {/* Folio & Date Search Controls */}
            <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-stone-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={historyFolioSearch}
                  onChange={(e) => setHistoryFolioSearch(e.target.value)}
                  placeholder="Buscar ticket por folio (ej. SUC1-00001) o vendedor..."
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-10 pr-4 py-2 text-sm text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="relative flex items-center">
                  <Calendar className="w-4 h-4 text-stone-400 dark:text-zinc-500 absolute left-3 pointer-events-none" />
                  <input
                    type="date"
                    value={historyDateFilter}
                    onChange={(e) => setHistoryDateFilter(e.target.value)}
                    aria-label="Filtrar ventas por fecha"
                    className="rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-9 pr-3 py-2 text-xs font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                  />
                </div>

                {(historyFolioSearch || historyDateFilter) && (
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryFolioSearch('');
                      setHistoryDateFilter('');
                    }}
                    className="px-3 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer whitespace-nowrap"
                  >
                    Limpiar filtros
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
              {loadingSales ? (
                <div className="p-6 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-10 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse"
                    />
                  ))}
                </div>
              ) : recentSales.length === 0 ? (
                <div className="px-6 py-16 text-center">
                  <div className="mx-auto w-12 h-12 rounded-xl bg-stone-100 dark:bg-zinc-800 flex items-center justify-center text-stone-500 dark:text-zinc-400 mb-4">
                    <Receipt className="w-6 h-6" />
                  </div>
                  <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                    Sin ventas registradas todavía
                  </h2>
                  <p className="mt-2 text-sm text-stone-500 dark:text-zinc-400 max-w-md mx-auto">
                    Los tickets de venta con folio consecutivo aparecerán aquí en tiempo real.
                  </p>
                  <button
                    type="button"
                    onClick={() => setPosTab('register')}
                    className="mt-6 px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium cursor-pointer"
                  >
                    Ir a Caja
                  </button>
                </div>
              ) : filteredSales.length === 0 ? (
                <div className="px-6 py-12 text-center text-sm text-stone-500 dark:text-zinc-400">
                  No se encontraron tickets que coincidan con la búsqueda actual.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-xs font-medium text-stone-500 dark:text-zinc-400">
                        <th className="py-3 px-4 whitespace-nowrap">Folio</th>
                        <th className="py-3 px-4 whitespace-nowrap">Fecha y hora</th>
                        <th className="py-3 px-4 whitespace-nowrap">Sucursal</th>
                        <th className="py-3 px-4">Vendedor</th>
                        <th className="py-3 px-4 whitespace-nowrap">Método</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">Total</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/80 text-sm">
                      {filteredSales.map((sale) => {
                        const isCancelled = sale.status === 'cancelada';
                        return (
                          <tr
                            key={sale.id}
                            className={`hover:bg-stone-50/80 dark:hover:bg-zinc-800/40 transition-colors ${
                              isCancelled ? 'opacity-75' : ''
                            }`}
                          >
                            <td className="py-3 px-4 whitespace-nowrap">
                              <div className="font-mono-tabular text-xs font-semibold text-stone-900 dark:text-zinc-100">
                                {sale.folio}
                              </div>
                              <div
                                className={`text-[11px] font-medium mt-0.5 ${
                                  isCancelled
                                    ? 'text-red-600 dark:text-red-400'
                                    : 'text-emerald-700 dark:text-emerald-400'
                                }`}
                              >
                                {isCancelled ? 'Cancelada' : 'Completada'}
                              </div>
                            </td>
                            <td className="py-3 px-4 font-mono-tabular text-xs text-stone-600 dark:text-zinc-400 whitespace-nowrap">
                              {formatDateTime(sale.createdAt)}
                            </td>
                            <td className="py-3 px-4 text-stone-700 dark:text-zinc-300 whitespace-nowrap">
                              {sale.branchName}
                            </td>
                            <td className="py-3 px-4 text-stone-700 dark:text-zinc-300">
                              <div>{sale.sellerName}</div>
                              <div className="text-xs text-stone-500 dark:text-zinc-400">
                                {sale.items.length} artículo(s)
                                {sale.customerName ? ` · Cliente: ${sale.customerName}` : ''}
                              </div>
                              {isCancelled && sale.cancellationReason && (
                                <div className="text-[11px] text-red-600 dark:text-red-400 mt-0.5 truncate max-w-xs">
                                  Motivo: {sale.cancellationReason}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-4 text-stone-700 dark:text-zinc-300 whitespace-nowrap">
                              {sale.paymentMethod}
                              {sale.cardReference ? ` (${sale.cardReference})` : ''}
                              {sale.transferReference ? ` (${sale.transferReference})` : ''}
                            </td>
                            <td
                              className={`py-3 px-4 text-right font-mono-tabular font-semibold whitespace-nowrap ${
                                isCancelled
                                  ? 'line-through text-stone-400 dark:text-zinc-500'
                                  : 'text-stone-900 dark:text-zinc-100'
                              }`}
                            >
                              {formatCurrency(sale.total)}
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => setCompletedSale(sale)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                                >
                                  <Printer className="w-3.5 h-3.5" />
                                  <span>Reimprimir</span>
                                </button>
                                {isAdmin && !isCancelled && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCancelSaleTarget(sale);
                                      setCancelReason('');
                                    }}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-red-200 dark:border-red-900/70 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 cursor-pointer"
                                  >
                                    <Ban className="w-3.5 h-3.5" />
                                    <span>Cancelar</span>
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left: Scanner + Product Catalog */}
            <div className="lg:col-span-7 xl:col-span-8 space-y-4">
              {/* Barcode Scanner Box */}
              <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row gap-3">
                  <div className="relative flex-1">
                    <Barcode className="w-4 h-4 text-amber-700 dark:text-amber-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      ref={barcodeRef}
                      type="text"
                      autoFocus
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      onKeyDown={handleBarcodeKeyDown}
                      placeholder="Lector de Código de Barras (escanea SKU y presiona Enter)..."
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 pl-10 pr-4 py-2.5 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-600/50"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => barcodeRef.current?.focus()}
                    className="px-3.5 py-2.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Enfocar lector
                  </button>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-500 dark:text-zinc-400">
                  <span>
                    Lector global:{' '}
                    <span className="font-medium text-stone-800 dark:text-zinc-200">
                      {hardware.globalScannerEnabled ? 'Activo en segundo plano' : 'Solo en campo enfocado'}
                    </span>
                  </span>
                  <span>
                    Acción al escanear:{' '}
                    <span className="font-medium text-stone-800 dark:text-zinc-200">
                      {hardware.posScanAction === 'show_detail'
                        ? 'Mostrar detalle'
                        : 'Agregar al carrito automáticamente'}
                    </span>
                  </span>
                </div>

                {scanMessage && (
                  <div
                    className={`rounded-lg border px-3.5 py-2 text-xs ${
                      scanMessage.type === 'success'
                        ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                        : 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
                    }`}
                  >
                    {scanMessage.text}
                  </div>
                )}

                <div className="relative">
                  <Search className="w-4 h-4 text-stone-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar producto por nombre, modelo, SKU, talla, color o categoría..."
                    className="w-full rounded-lg border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 pl-10 pr-10 py-2.5 text-sm text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-stone-400 hover:text-stone-700 dark:text-zinc-500 dark:hover:text-zinc-200 cursor-pointer"
                      aria-label="Limpiar búsqueda"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              {/* Search Results Only (Clean POS Interface) */}
              {loadingProducts ? (
                <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-12 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse"
                    />
                  ))}
                </div>
              ) : products.length === 0 ? (
                <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-14 text-center">
                  <div className="mx-auto w-12 h-12 rounded-xl bg-stone-100 dark:bg-zinc-800 flex items-center justify-center text-stone-500 dark:text-zinc-400 mb-4">
                    <ShoppingBag className="w-6 h-6" />
                  </div>
                  <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                    No hay productos disponibles para vender
                  </h2>
                  <p className="mt-2 text-sm text-stone-500 dark:text-zinc-400 max-w-md mx-auto">
                    Primero registra productos en el módulo de Inventario Multisucursal para habilitar las ventas en caja.
                  </p>
                  {onGoToInventory && (
                    <button
                      type="button"
                      onClick={onGoToInventory}
                      className="mt-6 px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium cursor-pointer"
                    >
                      Ir a Inventario
                    </button>
                  )}
                </div>
              ) : !searchTerm.trim() ? (
                <div className="rounded-xl border border-dashed border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-6 py-14 text-center">
                  <div className="mx-auto w-11 h-11 rounded-xl bg-stone-100 dark:bg-zinc-800 flex items-center justify-center text-amber-700 dark:text-amber-400 mb-3.5">
                    <Search className="w-5 h-5" />
                  </div>
                  <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                    Escanea o busca un artículo para agregarlo a la venta
                  </h2>
                  <p className="mt-1.5 text-xs text-stone-500 dark:text-zinc-400 max-w-md mx-auto">
                    Usa el lector de código de barras arriba o escribe el nombre, código de modelo, SKU, talla o color en el buscador ({products.length.toLocaleString('es-MX')} productos disponibles en catálogo).
                  </p>
                </div>
              ) : filteredProducts.length === 0 ? (
                <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-10 text-center space-y-3">
                  <p className="text-sm text-stone-500 dark:text-zinc-400">
                    No se encontraron productos para &ldquo;{searchTerm}&rdquo;.
                  </p>
                  <button
                    type="button"
                    onClick={() => setSearchTerm('')}
                    className="px-3.5 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
                  >
                    Limpiar búsqueda
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 flex items-center justify-between gap-2 text-xs text-stone-500 dark:text-zinc-400">
                    <span className="font-mono-tabular">
                      {filteredProducts.length > 30
                        ? `Mostrando 30 de ${filteredProducts.length} coincidencias (refina tu búsqueda si no ves la prenda)`
                        : `${filteredProducts.length} coincidencia(s) encontrada(s)`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                    >
                      Limpiar
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-xs font-medium text-stone-500 dark:text-zinc-400">
                          <th className="py-2.5 px-4">Producto</th>
                          <th className="py-2.5 px-4 whitespace-nowrap">SKU</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Stock</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Precio</th>
                          <th className="py-2.5 px-4 text-right whitespace-nowrap">Agregar</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/80 text-sm">
                        {filteredProducts.slice(0, 30).map((product) => {
                          const localStock = product.stock?.[activeBranch] ?? 0;
                          const inCartQty =
                            cart.find((c) => c.product.id === product.id)?.quantity ?? 0;
                          const disabled = localStock <= 0 || inCartQty >= localStock;
                          return (
                            <tr
                              key={product.id}
                              className="hover:bg-stone-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                            >
                              <td className="py-3 px-4">
                                <div className="font-medium text-stone-900 dark:text-zinc-100">
                                  {product.name}
                                </div>
                                <div className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                                  {product.category} · Talla {product.size} · {product.color}
                                  {product.codigoModelo ? ` · Mod. ${product.codigoModelo}` : ''}
                                </div>
                              </td>
                              <td className="py-3 px-4 font-mono-tabular text-xs text-stone-600 dark:text-zinc-400 whitespace-nowrap">
                                {product.sku}
                              </td>
                              <td className="py-3 px-4 text-right font-mono-tabular whitespace-nowrap">
                                <span
                                  className={
                                    localStock === 0
                                      ? 'text-red-600 dark:text-red-400 font-medium'
                                      : 'text-stone-800 dark:text-zinc-200 font-medium'
                                  }
                                >
                                  {localStock}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                                {formatCurrency(product.price)}
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  disabled={disabled}
                                  onClick={() => addProductToCart(product)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-xs font-medium disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap shrink-0"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span>Agregar</span>
                                </button>
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

            {/* Right: Contiguous Cart & Direct Checkout Module */}
            <div className="lg:col-span-5 xl:col-span-4 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-5 lg:sticky lg:top-6">
              <div className="flex items-center justify-between border-b border-stone-200 dark:border-zinc-800 pb-3.5">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                  <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                    Carrito de Venta
                  </h2>
                </div>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="text-xs text-stone-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400 cursor-pointer"
                  >
                    Vaciar
                  </button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="py-10 text-center text-sm text-stone-500 dark:text-zinc-400">
                  Escanea un código de barras o selecciona artículos del catálogo para iniciar la venta.
                </div>
              ) : (
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {cart.map((line) => {
                    const avail = line.product.stock?.[activeBranch] ?? 0;
                    return (
                      <div
                        key={line.product.id}
                        className="flex items-start justify-between gap-3 py-2.5 border-b border-stone-100 dark:border-zinc-800/80 last:border-b-0"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-stone-900 dark:text-zinc-100 truncate">
                            {line.product.name}
                          </p>
                          <p className="text-xs text-stone-500 dark:text-zinc-400 font-mono-tabular">
                            {formatCurrency(line.product.price)} c/u · Disp: {avail}
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => updateCartQty(line.product.id, -1)}
                            className="w-7 h-7 rounded-md border border-stone-200 dark:border-zinc-700 flex items-center justify-center text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                            aria-label="Disminuir cantidad"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-7 text-center font-mono-tabular text-sm font-semibold text-stone-900 dark:text-zinc-100">
                            {line.quantity}
                          </span>
                          <button
                            type="button"
                            disabled={line.quantity >= avail}
                            onClick={() => updateCartQty(line.product.id, 1)}
                            className="w-7 h-7 rounded-md border border-stone-200 dark:border-zinc-700 flex items-center justify-center text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 disabled:opacity-35 cursor-pointer"
                            aria-label="Aumentar cantidad"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => updateCartQty(line.product.id, -line.quantity)}
                            className="p-1.5 text-stone-400 hover:text-red-600 dark:text-zinc-500 dark:hover:text-red-400 cursor-pointer"
                            aria-label="Quitar del carrito"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Discount Section */}
              <div className="pt-3 border-t border-stone-200 dark:border-zinc-800 space-y-2.5">
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400">
                  Descuento opcional
                </label>
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-stone-100 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800">
                  {(
                    [
                      { id: 'none', label: 'Ninguno' },
                      { id: 'percent', label: 'Porcentaje %' },
                      { id: 'fixed', label: 'Fijo $' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setDiscountType(opt.id);
                        if (opt.id === 'none') setDiscountInput('');
                      }}
                      className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors whitespace-nowrap cursor-pointer ${
                        discountType === opt.id
                          ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                          : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {discountType !== 'none' && (
                  <input
                    type="number"
                    min="0"
                    max={discountType === 'percent' ? 100 : subtotal}
                    step="0.01"
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    placeholder={discountType === 'percent' ? 'Ej. 10 (%)' : 'Ej. 500 ($)'}
                    className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                  />
                )}
              </div>

              {/* Totals Summary */}
              <div className="pt-3 border-t border-stone-200 dark:border-zinc-800 space-y-2 text-sm">
                <div className="flex justify-between text-stone-600 dark:text-zinc-400">
                  <span>Subtotal</span>
                  <span className="font-mono-tabular">{formatCurrency(subtotal)}</span>
                </div>
                {discountAmount > 0 && (
                  <div className="flex justify-between text-amber-700 dark:text-amber-400">
                    <span>Descuento</span>
                    <span className="font-mono-tabular">-{formatCurrency(discountAmount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold text-stone-900 dark:text-zinc-100 pt-2 border-t border-stone-100 dark:border-zinc-800">
                  <span>Total</span>
                  <span className="font-mono-tabular">{formatCurrency(total)}</span>
                </div>
              </div>

              {/* Optional CRM Customer Association */}
              <div className="pt-3 border-t border-stone-200 dark:border-zinc-800 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-stone-600 dark:text-zinc-400">
                    Cliente (opcional, CRM)
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowQuickCustomerModal(true)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5" />
                    <span>Nuevo cliente</span>
                  </button>
                </div>

                {selectedCustomer ? (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 px-3 py-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <UserCheck className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-semibold text-stone-900 dark:text-zinc-100 truncate">
                          {selectedCustomer.nombreCompleto}
                        </p>
                        <p className="text-[11px] font-mono-tabular text-stone-600 dark:text-zinc-400">
                          {selectedCustomer.telefono}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomerId('');
                        setCustomerSearch('');
                      }}
                      className="p-1 text-stone-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400 cursor-pointer shrink-0"
                      aria-label="Desvincular cliente"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Buscar cliente por nombre o WhatsApp..."
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                    />
                    {customerSearch.trim().length > 0 && (
                      <div className="max-h-32 overflow-y-auto rounded-lg border border-stone-200 dark:border-zinc-800 divide-y divide-stone-100 dark:divide-zinc-800 bg-stone-50/60 dark:bg-zinc-950">
                        {matchingCustomers.length === 0 ? (
                          <div className="px-3 py-2 text-[11px] text-stone-500 dark:text-zinc-400">
                            Sin coincidencias. Usa &ldquo;Nuevo cliente&rdquo;.
                          </div>
                        ) : (
                          matchingCustomers.map((c) => (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setSelectedCustomerId(c.id);
                                setCustomerSearch('');
                              }}
                              className="w-full text-left px-3 py-1.5 hover:bg-white dark:hover:bg-zinc-900 flex items-center justify-between gap-2 text-xs cursor-pointer"
                            >
                              <span className="font-medium text-stone-900 dark:text-zinc-100 truncate">
                                {c.nombreCompleto}
                              </span>
                              <span className="text-[11px] font-mono-tabular text-stone-500 dark:text-zinc-400 shrink-0">
                                {c.telefono}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Direct Payment Method (3 Options) */}
              <div className="pt-3 border-t border-stone-200 dark:border-zinc-800 space-y-3">
                <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400">
                  Método de pago
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('Efectivo')}
                    className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      paymentMethod === 'Efectivo'
                        ? 'border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Banknote className="w-3.5 h-3.5 shrink-0" />
                    <span>Efectivo</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('Tarjeta')}
                    className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      paymentMethod === 'Tarjeta'
                        ? 'border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <CreditCard className="w-3.5 h-3.5 shrink-0" />
                    <span>Tarjeta</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod('Transferencia')}
                    className={`flex flex-col sm:flex-row items-center justify-center gap-1.5 py-2.5 px-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                      paymentMethod === 'Transferencia'
                        ? 'border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                        : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5 shrink-0" />
                    <span>Transfer.</span>
                  </button>
                </div>

                {paymentMethod === 'Efectivo' ? (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium text-stone-600 dark:text-zinc-400">
                        Monto recibido
                      </label>
                      <button
                        type="button"
                        disabled={total <= 0}
                        onClick={() => setCashReceivedInput(String(total))}
                        className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline disabled:opacity-40 cursor-pointer"
                      >
                        Monto exacto
                      </button>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cashReceivedInput}
                      onChange={(e) => setCashReceivedInput(e.target.value)}
                      placeholder="0.00"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                    />
                    <div className="flex justify-between items-center rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 px-3.5 py-2.5 text-sm">
                      <span className="text-stone-600 dark:text-zinc-400">Cambio</span>
                      <span className="font-mono-tabular font-bold text-stone-900 dark:text-zinc-100">
                        {formatCurrency(changeGiven)}
                      </span>
                    </div>
                  </div>
                ) : paymentMethod === 'Tarjeta' ? (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400">
                      Referencia / Autorización de terminal (opcional)
                    </label>
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.CARD_REF_MAX}
                      value={cardReference}
                      onChange={(e) => setCardReference(e.target.value)}
                      placeholder="Ej. AUT-849201"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-stone-600 dark:text-zinc-400">
                      Clave de rastreo / Referencia bancaria (opcional)
                    </label>
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.CARD_REF_MAX}
                      value={transferReference}
                      onChange={(e) => setTransferReference(e.target.value)}
                      placeholder="Ej. SPEI-20261117-9941"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                    />
                  </div>
                )}

                <button
                  type="button"
                  disabled={processingSale || !canCheckout}
                  onClick={() => void executeSaleTransaction()}
                  className="w-full py-3 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500 text-white font-medium text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {processingSale
                    ? 'Generando folio y ticket...'
                    : paymentMethod === 'Tarjeta'
                      ? 'Confirmar Venta con Tarjeta'
                      : paymentMethod === 'Transferencia'
                        ? 'Confirmar Transferencia y Emitir Ticket'
                        : 'Finalizar Venta y Emitir Ticket'}
                </button>
              </div>
            </div>
          </div>
          )}
        </div>
      )}

      {/* Unified Thermal Printable Digital Ticket Modal */}
      {completedSale && (
        <ThermalTicketModal
          document={{ type: 'sale', sale: completedSale }}
          closeLabel={posTab === 'register' ? 'Nueva venta' : 'Cerrar'}
          onClose={() => {
            setCompletedSale(null);
            if (posTab === 'register') {
              setTimeout(() => barcodeRef.current?.focus(), 0);
            }
          }}
        />
      )}

      {/* Scanned Product Detail Modal (when posScanAction === 'show_detail') */}
      {scannedDetailProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 no-print"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider font-medium text-amber-700 dark:text-amber-400">
                  Artículo escaneado · {scannedDetailProduct.category}
                </p>
                <h3 className="text-lg font-semibold text-stone-900 dark:text-zinc-100 mt-0.5 truncate">
                  {scannedDetailProduct.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setScannedDetailProduct(null)}
                className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
                aria-label="Cerrar detalle"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-lg border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950 p-4 space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-stone-500 dark:text-zinc-400">SKU / Código de barras</span>
                <span className="font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100">
                  {scannedDetailProduct.barcodeSKU || scannedDetailProduct.sku}
                </span>
              </div>
              {scannedDetailProduct.codigoActual && (
                <div className="flex justify-between gap-2">
                  <span className="text-stone-500 dark:text-zinc-400">Código anterior / Ref.</span>
                  <span className="font-mono-tabular text-stone-800 dark:text-zinc-200">
                    {scannedDetailProduct.codigoActual}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-stone-500 dark:text-zinc-400">Talla y Color</span>
                <span className="text-stone-900 dark:text-zinc-100">
                  Talla {scannedDetailProduct.size} · {scannedDetailProduct.color}
                </span>
              </div>
              {scannedDetailProduct.marca && (
                <div className="flex justify-between gap-2">
                  <span className="text-stone-500 dark:text-zinc-400">Marca</span>
                  <span className="text-stone-900 dark:text-zinc-100">
                    {scannedDetailProduct.marca}
                  </span>
                </div>
              )}
              {scannedDetailProduct.especificaciones && (
                <div className="pt-1 border-t border-stone-200 dark:border-zinc-800 text-stone-600 dark:text-zinc-400">
                  {scannedDetailProduct.especificaciones}
                </div>
              )}
              <div className="pt-2 border-t border-stone-200 dark:border-zinc-800 flex justify-between items-baseline">
                <span className="text-stone-600 dark:text-zinc-300 font-medium">
                  Stock en {getBranchName(activeBranch)}
                </span>
                <span className="font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400">
                  {scannedDetailProduct.stock?.[activeBranch] ?? 0} disponible(s)
                </span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-stone-600 dark:text-zinc-300 font-medium">Precio de venta</span>
                <span className="font-mono-tabular text-lg font-bold text-stone-900 dark:text-zinc-100">
                  {formatCurrency(scannedDetailProduct.price)}
                </span>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={() => setScannedDetailProduct(null)}
                className="flex-1 px-4 py-2.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = scannedDetailProduct;
                  setScannedDetailProduct(null);
                  addProductToCart(target);
                }}
                className="flex-1 px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium cursor-pointer"
              >
                Agregar al carrito
              </button>
            </div>
          </div>
        </div>
      )}

      {showQuickCustomerModal && (
        <CustomerQuickModal
          activeBranch={activeBranch}
          onClose={() => setShowQuickCustomerModal(false)}
          onSaved={(created) => {
            setSelectedCustomerId(created.id);
            setCustomerSearch('');
            setShowQuickCustomerModal(false);
            showScanFeedback(
              'success',
              `Cliente "${created.nombreCompleto}" registrado y vinculado a la venta.`
            );
          }}
        />
      )}

      {cancelSaleTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 no-print"
          role="dialog"
          aria-modal="true"
        >
          <form
            onSubmit={executeCancelSaleTransaction}
            className="w-full max-w-md rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xl space-y-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                  Cancelar Venta {cancelSaleTarget.folio}
                </h3>
                <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1">
                  Se reintegrará el stock vendido a {cancelSaleTarget.branchName} y el ticket quedará marcado como cancelado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCancelSaleTarget(null)}
                className="p-1 rounded-lg text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
                aria-label="Cerrar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-stone-500 dark:text-zinc-400">Importe de venta:</span>
                <span className="font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100">
                  {formatCurrency(cancelSaleTarget.total)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-stone-500 dark:text-zinc-400">Artículos a reintegrar:</span>
                <span className="font-mono-tabular text-stone-900 dark:text-zinc-100">
                  {cancelSaleTarget.items.reduce((s, it) => s + it.quantity, 0)} unidad(es)
                </span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Motivo de la cancelación *
              </label>
              <textarea
                rows={3}
                required
                maxLength={FIELD_LIMITS.CANCEL_REASON_MAX}
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Ej. Error de captura en caja, cambio de prenda solicitado por cliente..."
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-red-600/40"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={cancellingSale}
                onClick={() => setCancelSaleTarget(null)}
                className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                Cerrar
              </button>
              <button
                type="submit"
                disabled={cancellingSale || !cancelReason.trim()}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
              >
                {cancellingSale ? 'Cancelando...' : 'Confirmar Cancelación'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
