import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Banknote,
  Barcode,
  BookmarkCheck,
  CreditCard,
  Eye,
  Minus,
  PackageCheck,
  Plus,
  Printer,
  Search,
  Trash2,
  UserPlus,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { layawayService } from '../services/dataProvider';
import {
  formatCurrency,
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
  LAYAWAY_STATUS_LABELS,
  type BranchId,
  type Customer,
  type Layaway,
  type LayawayPayment,
  type LayawayStatus,
  type PaymentMethod,
  type Product,
} from '../types/boutique';
import { CustomerQuickModal } from './CustomerQuickModal';
import { ThermalTicketModal } from './ThermalTicketModal';

interface LayawaysViewProps {
  products: Product[];
  customers: Customer[];
}

export function LayawaysView({ products, customers }: LayawaysViewProps) {
  const {
    profile,
    branches,
    branchIds,
    operatingScope,
    hasPermission,
    getBranchName,
  } = useAuth();
  const { hardware } = useHardware();

  const isAdmin = profile?.rol === 'admin';
  const [selectedBranch, setSelectedBranch] = useState<BranchId>(
    operatingScope !== 'general'
      ? operatingScope
      : profile?.sucursalAsignada || branchIds[0] || 'branch_1'
  );

  useEffect(() => {
    if (isAdmin && operatingScope !== 'general') {
      setSelectedBranch(operatingScope);
    }
  }, [isAdmin, operatingScope]);

  const fallbackBranch = branchIds[0] || 'branch_1';
  const validAdminBranch = branchIds.includes(selectedBranch) ? selectedBranch : fallbackBranch;
  const activeBranch: BranchId = isAdmin
    ? validAdminBranch
    : profile?.sucursalAsignada || fallbackBranch;

  const [layaways, setLayaways] = useState<Layaway[]>([]);
  const [loadingLayaways, setLoadingLayaways] = useState(true);
  const [statusFilter, setStatusFilter] = useState<'all' | LayawayStatus>('all');
  const [search, setSearch] = useState('');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [paymentModalLayaway, setPaymentModalLayaway] = useState<Layaway | null>(null);
  const [detailLayaway, setDetailLayaway] = useState<Layaway | null>(null);
  const [cancelLayawayTarget, setCancelLayawayTarget] = useState<Layaway | null>(null);
  const [printablePayment, setPrintablePayment] = useState<
    (LayawayPayment & { issuedLocallyAt?: Date }) | null
  >(null);

  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (!profile) return;
    setLoadingLayaways(true);

    const unsub = layawayService.subscribeLayaways(
      isAdmin ? { limitCount: 300 } : { branchId: profile.sucursalAsignada, limitCount: 300 },
      (list) => {
        const sorted = [...list].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setLayaways(sorted);
        setLoadingLayaways(false);
      },
      (err) => {
        setLoadingLayaways(false);
        console.error(err);
      }
    );

    return () => unsub();
  }, [profile?.id, profile?.sucursalAsignada, isAdmin]);

  const filteredLayaways = useMemo(() => {
    const q = search.trim().toLowerCase();
    return layaways.filter((l) => {
      if (isAdmin && operatingScope !== 'general' && l.branchId !== operatingScope) {
        return false;
      }
      if (statusFilter !== 'all' && l.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        l.folio.toLowerCase().includes(q) ||
        l.customerName.toLowerCase().includes(q) ||
        l.customerPhone.toLowerCase().includes(q) ||
        l.items.some((it) => it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q))
      );
    });
  }, [layaways, statusFilter, search, isAdmin, operatingScope]);

  if (!profile) return null;

  const canCancelLayaway = isAdmin || hasPermission('cancelLayaways');

  const showToast = (type: 'success' | 'error', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const handleMarkDelivered = async (layaway: Layaway) => {
    if (layaway.status !== 'liquidado') return;
    try {
      await layawayService.markDelivered(layaway, {
        id: profile.id,
        nombreCompleto: profile.nombreCompleto,
        usuario: profile.usuario,
        sucursalAsignada: profile.sucursalAsignada,
      });
      showToast('success', `Apartado ${layaway.folio} marcado como entregado.`);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'No se pudo marcar el apartado como entregado.'
      );
    }
  };

  useBarcodeScanner({
    enabled:
      hardware.globalScannerEnabled &&
      !showCreateModal &&
      !paymentModalLayaway &&
      !detailLayaway &&
      !cancelLayawayTarget &&
      !printablePayment,
    onScan: (rawCode) => {
      const code = rawCode.trim();
      if (!code) return;
      const normalized = code.replace(/\s+/g, '').toLowerCase();
      const matchedProduct = products.find(
        (p) =>
          (p.barcodeSKU || '').trim().replace(/\s+/g, '').toLowerCase() === normalized ||
          p.sku.trim().replace(/\s+/g, '').toLowerCase() === normalized ||
          (p.codigoActual || '').trim().replace(/\s+/g, '').toLowerCase() === normalized
      );

      if (matchedProduct) {
        playScanSuccessBeep();
        setSearch(matchedProduct.sku);
        showToast('success', `Buscando apartados con "${matchedProduct.name}".`);
      } else {
        setSearch(code);
        playScanSuccessBeep();
      }
    },
  });

  return (
    <div className="space-y-6">
      <div className={printablePayment ? 'space-y-6 no-print' : 'space-y-6'}>
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900 dark:text-zinc-100 tracking-tight">
              Apartados (Abono Libre)
            </h1>
            <p className="text-sm text-stone-600 dark:text-zinc-400 mt-1">
              Reserva de prendas sin intereses ni plazos fijos · Sucursal activa:{' '}
              <span className="font-medium text-stone-900 dark:text-zinc-200">
                {getBranchName(activeBranch)}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {isAdmin && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="layaways-branch-select"
                  className="text-xs font-medium text-stone-500 dark:text-zinc-400 whitespace-nowrap"
                >
                  Sucursal alta:
                </label>
                <select
                  id="layaways-branch-select"
                  value={activeBranch}
                  onChange={(e) => setSelectedBranch(e.target.value as BranchId)}
                  className="rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100"
                >
                  {branchIds.map((bId) => (
                    <option key={bId} value={bId}>
                      {branches[bId]?.name || bId}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo Apartado</span>
            </button>
          </div>
        </div>

        {toast && (
          <div
            className={`rounded-lg border px-4 py-3 text-sm ${
              toast.type === 'success'
                ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                : 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
            }`}
          >
            {toast.text}
          </div>
        )}

        {/* Filters & Search */}
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-stone-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por folio (APT-...), cliente, teléfono o SKU..."
              className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-10 pr-4 py-2 text-sm text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
            />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-lg bg-stone-100 dark:bg-zinc-900 border border-stone-200 dark:border-zinc-800 overflow-x-auto">
            {(
              [
                { id: 'all', label: 'Todos' },
                { id: 'activo', label: 'Activos con saldo' },
                { id: 'liquidado', label: 'Liquidados' },
                { id: 'entregado', label: 'Entregados' },
                { id: 'cancelado', label: 'Cancelados' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-white dark:bg-zinc-800 text-stone-900 dark:text-zinc-100 shadow-xs'
                    : 'text-stone-600 dark:text-zinc-400 hover:text-stone-900 dark:hover:text-zinc-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Table / Empty State */}
        {loadingLayaways ? (
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-12 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse" />
            ))}
          </div>
        ) : layaways.length === 0 ? (
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-16 text-center">
            <div className="mx-auto w-12 h-12 rounded-xl bg-stone-100 dark:bg-zinc-800 flex items-center justify-center text-stone-500 dark:text-zinc-400 mb-4">
              <BookmarkCheck className="w-6 h-6" />
            </div>
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              No hay apartados registrados todavía
            </h2>
            <p className="mt-2 text-sm text-stone-500 dark:text-zinc-400 max-w-md mx-auto">
              Reserva vestidos o accesorios para un cliente descontando el inventario al instante y recibe abonos libres en Efectivo, Tarjeta o Transferencia.
            </p>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Crear primer apartado</span>
            </button>
          </div>
        ) : filteredLayaways.length === 0 ? (
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-12 text-center text-sm text-stone-500 dark:text-zinc-400">
            No se encontraron apartados con los filtros actuales.
          </div>
        ) : (
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-xs font-medium text-stone-500 dark:text-zinc-400">
                    <th className="py-3 px-4 whitespace-nowrap">Folio</th>
                    <th className="py-3 px-4">Cliente</th>
                    <th className="py-3 px-4">Prendas apartadas</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Total</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Abonado</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Saldo Pendiente</th>
                    <th className="py-3 px-4 whitespace-nowrap">Estado</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/80 text-sm">
                  {filteredLayaways.map((layaway) => {
                    const itemCount = layaway.items.reduce((s, it) => s + it.quantity, 0);
                    return (
                      <tr
                        key={layaway.id}
                        className="hover:bg-stone-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 align-top whitespace-nowrap">
                          <div className="font-mono-tabular text-xs font-semibold text-stone-900 dark:text-zinc-100">
                            {layaway.folio}
                          </div>
                          <div className="text-[11px] text-stone-500 dark:text-zinc-400 mt-0.5">
                            {layaway.branchName}
                          </div>
                        </td>
                        <td className="py-3 px-4 align-top">
                          <div className="font-medium text-stone-900 dark:text-zinc-100">
                            {layaway.customerName}
                          </div>
                          <div className="text-xs font-mono-tabular text-stone-500 dark:text-zinc-400 mt-0.5">
                            {layaway.customerPhone}
                          </div>
                        </td>
                        <td className="py-3 px-4 align-top text-xs text-stone-700 dark:text-zinc-300">
                          <div className="font-medium">
                            {itemCount} {itemCount === 1 ? 'prenda' : 'prendas'}
                          </div>
                          <div className="text-stone-500 dark:text-zinc-400 truncate max-w-56">
                            {layaway.items.map((it) => `${it.quantity}× ${it.name}`).join(', ')}
                          </div>
                        </td>
                        <td className="py-3 px-4 align-top text-right font-mono-tabular text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                          {formatCurrency(layaway.total)}
                        </td>
                        <td className="py-3 px-4 align-top text-right font-mono-tabular text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {formatCurrency(layaway.totalPaid)}
                        </td>
                        <td className="py-3 px-4 align-top text-right font-mono-tabular font-semibold whitespace-nowrap">
                          <span
                            className={
                              layaway.remainingBalance > 0
                                ? 'text-amber-700 dark:text-amber-400'
                                : 'text-stone-900 dark:text-zinc-100'
                            }
                          >
                            {formatCurrency(layaway.remainingBalance)}
                          </span>
                        </td>
                        <td className="py-3 px-4 align-top text-xs whitespace-nowrap">
                          <span
                            className={
                              layaway.status === 'activo'
                                ? 'font-medium text-amber-700 dark:text-amber-400'
                                : layaway.status === 'liquidado'
                                  ? 'font-semibold text-emerald-700 dark:text-emerald-400'
                                  : layaway.status === 'entregado'
                                    ? 'font-medium text-stone-600 dark:text-zinc-300'
                                    : 'font-medium text-red-600 dark:text-red-400'
                            }
                          >
                            {LAYAWAY_STATUS_LABELS[layaway.status]}
                          </span>
                        </td>
                        <td className="py-3 px-4 align-top text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {layaway.status === 'activo' && (
                              <button
                                type="button"
                                onClick={() => setPaymentModalLayaway(layaway)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-xs font-medium cursor-pointer"
                              >
                                <Wallet className="w-3.5 h-3.5" />
                                <span>Registrar Abono</span>
                              </button>
                            )}

                            {layaway.status === 'liquidado' && (
                              <button
                                type="button"
                                onClick={() => void handleMarkDelivered(layaway)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-emerald-700 text-white hover:bg-emerald-800 text-xs font-medium cursor-pointer"
                              >
                                <PackageCheck className="w-3.5 h-3.5" />
                                <span>Entregar</span>
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => setDetailLayaway(layaway)}
                              title="Ver detalle e historial de abonos"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Detalle</span>
                            </button>

                            {canCancelLayaway &&
                              (layaway.status === 'activo' || layaway.status === 'liquidado') && (
                                <button
                                  type="button"
                                  onClick={() => setCancelLayawayTarget(layaway)}
                                  title="Cancelar apartado y devolver stock"
                                  className="p-1.5 rounded-md text-stone-400 hover:text-red-600 hover:bg-red-50 dark:text-zinc-500 dark:hover:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
                                  aria-label={`Cancelar apartado ${layaway.folio}`}
                                >
                                  <XCircle className="w-4 h-4" />
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
          </div>
        )}
      </div>

      {/* Create Layaway Modal */}
      {showCreateModal && (
        <CreateLayawayModal
          activeBranch={activeBranch}
          products={products}
          customers={customers}
          onClose={() => setShowCreateModal(false)}
          onCreated={(folio, initialPaymentReceipt) => {
            setShowCreateModal(false);
            showToast('success', `Apartado ${folio} registrado y stock reservado correctamente.`);
            if (initialPaymentReceipt) {
              setPrintablePayment(initialPaymentReceipt);
            }
          }}
        />
      )}

      {/* Register Payment Modal */}
      {paymentModalLayaway && (
        <RegisterPaymentModal
          layaway={paymentModalLayaway}
          onClose={() => setPaymentModalLayaway(null)}
          onPaid={(receipt, settled) => {
            setPaymentModalLayaway(null);
            setPrintablePayment(receipt);
            showToast(
              'success',
              settled
                ? `Abono aplicado. El apartado ${receipt.layawayFolio} quedó liquidado y listo para entrega.`
                : `Abono de ${formatCurrency(receipt.amount)} registrado en ${receipt.layawayFolio}.`
            );
          }}
        />
      )}

      {/* Detail & Payment History Modal */}
      {detailLayaway && (
        <LayawayDetailModal
          layaway={detailLayaway}
          onClose={() => setDetailLayaway(null)}
          onReprintPayment={(p) => {
            setDetailLayaway(null);
            setPrintablePayment(p);
          }}
        />
      )}

      {/* Cancel Layaway Modal */}
      {cancelLayawayTarget && (
        <CancelLayawayModal
          layaway={cancelLayawayTarget}
          onClose={() => setCancelLayawayTarget(null)}
          onCancelled={(folio) => {
            setCancelLayawayTarget(null);
            showToast(
              'success',
              `Apartado ${folio} cancelado. Las prendas fueron devueltas al stock.`
            );
          }}
        />
      )}

      {/* Unified Thermal Printable Layaway Payment Receipt */}
      {printablePayment && (
        <ThermalTicketModal
          document={{
            type: 'layaway_payment',
            payment: printablePayment,
            layaway: layaways.find((l) => l.id === printablePayment.layawayId) || null,
          }}
          onClose={() => setPrintablePayment(null)}
        />
      )}
    </div>
  );
}

interface CreateLayawayModalProps {
  activeBranch: BranchId;
  products: Product[];
  customers: Customer[];
  onClose: () => void;
  onCreated: (
    folio: string,
    initialReceipt: (LayawayPayment & { issuedLocallyAt?: Date }) | null
  ) => void;
}

function CreateLayawayModal({
  activeBranch,
  products,
  customers,
  onClose,
  onCreated,
}: CreateLayawayModalProps) {
  const { profile, getBranchName } = useAuth();
  const { hardware } = useHardware();
  const branchName = getBranchName(activeBranch);

  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [showQuickCustomerModal, setShowQuickCustomerModal] = useState(false);

  const [barcodeInput, setBarcodeInput] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [items, setItems] = useState<{ product: Product; quantity: number }[]>([]);

  const [initialDepositInput, setInitialDepositInput] = useState('0');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Efectivo');
  const [cashReceivedInput, setCashReceivedInput] = useState('');
  const [referenceInput, setReferenceInput] = useState('');
  const [notes, setNotes] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return customers.slice(0, 30);
    return customers
      .filter(
        (c) =>
          c.nombreCompleto.toLowerCase().includes(q) ||
          c.telefono.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [customers, customerSearch]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 40);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.barcodeSKU || '').toLowerCase().includes(q) ||
          (p.codigoModelo || '').toLowerCase().includes(q) ||
          (p.marca || '').toLowerCase().includes(q) ||
          p.color.toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [products, productSearch]);

  const total = useMemo(
    () =>
      Number(
        items.reduce((sum, line) => sum + line.product.price * line.quantity, 0).toFixed(2)
      ),
    [items]
  );

  if (!profile) return null;

  const addProduct = (product: Product): boolean => {
    setError(null);
    const avail = product.stock?.[activeBranch] ?? 0;
    if (avail <= 0) {
      setError(`"${product.name}" no tiene existencias disponibles en ${branchName}.`);
      return false;
    }

    const existing = items.find((l) => l.product.id === product.id);
    if (existing && existing.quantity >= avail) {
      setError(`Solo hay ${avail} unidades disponibles de "${product.name}" en ${branchName}.`);
      return false;
    }

    setItems((prev) => {
      const idx = prev.findIndex((l) => l.product.id === product.id);
      if (idx >= 0) {
        if (prev[idx].quantity >= avail) return prev;
        const next = [...prev];
        next[idx] = { product, quantity: prev[idx].quantity + 1 };
        return next;
      }
      return [...prev, { product, quantity: 1 }];
    });
    return true;
  };

  const processLayawayScan = (rawCode: string) => {
    const clean = rawCode.trim();
    if (!clean) return;
    const code = clean.replace(/\s+/g, '').toLowerCase();

    const match = products.find(
      (p) =>
        (p.barcodeSKU || '').trim().replace(/\s+/g, '').toLowerCase() === code ||
        p.sku.trim().replace(/\s+/g, '').toLowerCase() === code ||
        (p.codigoActual || '').trim().replace(/\s+/g, '').toLowerCase() === code
    );
    if (!match) {
      playScanErrorBeep();
      setError(`Código "${clean}" no encontrado en el catálogo.`);
      return;
    }

    const added = addProduct(match);
    if (added) {
      playScanSuccessBeep();
    } else {
      playScanErrorBeep();
    }
  };

  useBarcodeScanner({
    enabled: hardware.globalScannerEnabled && !showQuickCustomerModal,
    onScan: processLayawayScan,
  });

  const handleBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;

    processLayawayScan(code);
    setBarcodeInput('');
    barcodeRef.current?.focus();
  };

  const updateItemQty = (productId: string, delta: number) => {
    setItems((prev) =>
      prev
        .map((line) => {
          if (line.product.id !== productId) return line;
          const avail = line.product.stock?.[activeBranch] ?? 0;
          const nextQty = line.quantity + delta;
          if (nextQty <= 0) return null;
          if (nextQty > avail) return line;
          return { ...line, quantity: nextQty };
        })
        .filter((x): x is { product: Product; quantity: number } => x !== null)
    );
  };

  const parsedDeposit = Math.max(0, Number(Number(initialDepositInput || 0).toFixed(2)) || 0);
  const parsedCashReceived = Math.max(0, Number(cashReceivedInput) || 0);
  const changeGiven =
    paymentMethod === 'Efectivo' && parsedDeposit > 0
      ? Math.max(0, Number((parsedCashReceived - parsedDeposit).toFixed(2)))
      : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedCustomer) {
      setError('Debes vincular obligatoriamente un cliente del CRM.');
      return;
    }
    if (items.length === 0) {
      setError('Agrega al menos una prenda o producto al apartado.');
      return;
    }
    if (parsedDeposit > total) {
      setError('El anticipo inicial no puede ser mayor al total del apartado.');
      return;
    }
    if (parsedDeposit > 0 && paymentMethod === 'Efectivo' && parsedCashReceived < parsedDeposit) {
      setError('El efectivo recibido es menor al anticipo inicial.');
      return;
    }

    setSaving(true);
    const cleanNotes = truncateStr(notes, FIELD_LIMITS.LAYAWAY_NOTES_MAX);
    const cleanRef = truncateStr(referenceInput, FIELD_LIMITS.CARD_REF_MAX);

    try {
      const result = await layawayService.createLayaway(
        {
          branchId: activeBranch,
          branchName,
          customer: {
            id: selectedCustomer.id,
            nombreCompleto: selectedCustomer.nombreCompleto,
            telefono: selectedCustomer.telefono,
          },
          items: items.map((l) => ({
            productId: l.product.id,
            productName: l.product.name,
            quantity: l.quantity,
          })),
          initialDeposit: parsedDeposit,
          paymentMethod,
          cashReceived: parsedCashReceived,
          changeGiven,
          reference: cleanRef,
          notes: cleanNotes,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );

      onCreated(result.folio, result.receipt);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el apartado.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 no-print"
        role="dialog"
        aria-modal="true"
      >
        <div className="w-full max-w-4xl rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl overflow-hidden max-h-[92vh] flex flex-col">
          <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800">
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Nuevo Apartado (Abono Libre)
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                Sucursal: {branchName} · Las prendas se apartan del inventario inmediatamente.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
              aria-label="Cerrar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-6">
            {error && (
              <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            {/* Step 1: Mandatory Customer Binding */}
            <div className="rounded-lg border border-stone-200 dark:border-zinc-800 p-4 space-y-3 bg-stone-50/50 dark:bg-zinc-950/40">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <label className="text-xs font-semibold text-stone-800 dark:text-zinc-200">
                  1. Cliente vinculado (CRM) *
                </label>
                <button
                  type="button"
                  onClick={() => setShowQuickCustomerModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-medium text-stone-800 dark:text-zinc-100 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer self-start sm:self-auto"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>Registrar cliente nuevo</span>
                </button>
              </div>

              {selectedCustomer ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 px-3.5 py-2.5 text-xs">
                  <div>
                    <p className="font-semibold text-stone-900 dark:text-zinc-100">
                      {selectedCustomer.nombreCompleto}
                    </p>
                    <p className="font-mono-tabular text-stone-600 dark:text-zinc-400">
                      {selectedCustomer.telefono}
                      {selectedCustomer.fechaEvento ? ` · Evento: ${selectedCustomer.fechaEvento}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setSelectedCustomerId('')}
                    className="text-xs font-medium text-stone-600 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
                  >
                    Cambiar
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={customerSearch}
                      onChange={(e) => setCustomerSearch(e.target.value)}
                      placeholder="Buscar cliente por nombre o WhatsApp..."
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-9 pr-3 py-2 text-xs text-stone-900 dark:text-zinc-100"
                    />
                  </div>
                  {customers.length === 0 ? (
                    <p className="text-xs text-stone-500 dark:text-zinc-400">
                      No hay clientes en el CRM todavía. Usa &ldquo;Registrar cliente nuevo&rdquo;.
                    </p>
                  ) : (
                    <div className="max-h-32 overflow-y-auto rounded-lg border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-stone-100 dark:divide-zinc-800">
                      {filteredCustomers.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedCustomerId(c.id)}
                          className="w-full text-left px-3 py-2 text-xs hover:bg-stone-50 dark:hover:bg-zinc-800 flex items-center justify-between gap-2 cursor-pointer"
                        >
                          <span className="font-medium text-stone-900 dark:text-zinc-100 truncate">
                            {c.nombreCompleto}
                          </span>
                          <span className="font-mono-tabular text-stone-500 dark:text-zinc-400 shrink-0">
                            {c.telefono}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Select Products */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
              <div className="lg:col-span-7 space-y-3">
                <label className="block text-xs font-semibold text-stone-800 dark:text-zinc-200">
                  2. Seleccionar prendas de {branchName} *
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="relative">
                    <Barcode className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      ref={barcodeRef}
                      type="text"
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      onKeyDown={handleBarcodeKeyDown}
                      placeholder="Escanear SKU + Enter..."
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 pl-9 pr-3 py-2 text-xs font-mono-tabular text-stone-900 dark:text-zinc-100"
                    />
                  </div>

                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                      placeholder="Buscar prenda por nombre, SKU..."
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-9 pr-3 py-2 text-xs text-stone-900 dark:text-zinc-100"
                    />
                  </div>
                </div>

                <div className="max-h-56 overflow-y-auto rounded-lg border border-stone-200 dark:border-zinc-800 divide-y divide-stone-100 dark:divide-zinc-800">
                  {filteredProducts.length === 0 ? (
                    <div className="p-4 text-xs text-center text-stone-500 dark:text-zinc-400">
                      Sin productos disponibles.
                    </div>
                  ) : (
                    filteredProducts.map((p) => {
                      const avail = p.stock?.[activeBranch] ?? 0;
                      const inList = items.find((i) => i.product.id === p.id)?.quantity ?? 0;
                      const disabled = avail <= 0 || inList >= avail;
                      return (
                        <div
                          key={p.id}
                          className="px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-medium text-stone-900 dark:text-zinc-100 truncate">
                              {p.name}
                            </p>
                            <p className="text-stone-500 dark:text-zinc-400 font-mono-tabular">
                              {p.sku} · Talla {p.size} · Stock: {avail}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100">
                              {formatCurrency(p.price)}
                            </span>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => addProduct(p)}
                              className="px-2.5 py-1 rounded-md bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 disabled:opacity-35 text-xs font-medium cursor-pointer"
                            >
                              Agregar
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Selected Items & Optional Initial Deposit */}
              <div className="lg:col-span-5 space-y-4">
                <div className="rounded-lg border border-stone-200 dark:border-zinc-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-stone-800 dark:text-zinc-200">
                      Prendas en el apartado ({items.length})
                    </span>
                    <span className="font-mono-tabular text-sm font-bold text-stone-900 dark:text-zinc-100">
                      Total: {formatCurrency(total)}
                    </span>
                  </div>

                  {items.length === 0 ? (
                    <p className="text-xs text-stone-500 dark:text-zinc-400 py-4 text-center">
                      Agrega prendas para calcular el total.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {items.map((line) => (
                        <div
                          key={line.product.id}
                          className="flex items-center justify-between gap-2 text-xs py-1.5 border-b border-stone-100 dark:border-zinc-800 last:border-b-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-stone-900 dark:text-zinc-100 truncate">
                              {line.product.name}
                            </p>
                            <p className="font-mono-tabular text-stone-500 dark:text-zinc-400">
                              {formatCurrency(line.product.price)} c/u
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => updateItemQty(line.product.id, -1)}
                              className="w-6 h-6 rounded border border-stone-200 dark:border-zinc-700 flex items-center justify-center cursor-pointer"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="w-6 text-center font-mono-tabular font-semibold">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updateItemQty(line.product.id, 1)}
                              className="w-6 h-6 rounded border border-stone-200 dark:border-zinc-700 flex items-center justify-center cursor-pointer"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => updateItemQty(line.product.id, -line.quantity)}
                              className="p-1 text-stone-400 hover:text-red-600 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Optional Initial Deposit */}
                <div className="rounded-lg border border-stone-200 dark:border-zinc-800 p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                      Anticipo inicial (opcional, $0 para iniciar sin abono)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={total > 0 ? total : undefined}
                      step="0.01"
                      value={initialDepositInput}
                      onChange={(e) => setInitialDepositInput(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100"
                    />
                  </div>

                  {parsedDeposit > 0 && (
                    <div className="space-y-2.5 pt-1">
                      <div className="grid grid-cols-3 gap-1.5">
                        {(['Efectivo', 'Tarjeta', 'Transferencia'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setPaymentMethod(m)}
                            className={`py-1.5 px-2 rounded-md border text-[11px] font-medium cursor-pointer ${
                              paymentMethod === m
                                ? 'border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                                : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-200'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>

                      {paymentMethod === 'Efectivo' ? (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-stone-600 dark:text-zinc-400">Efectivo recibido</span>
                            <button
                              type="button"
                              onClick={() => setCashReceivedInput(String(parsedDeposit))}
                              className="text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                            >
                              Exacto
                            </button>
                          </div>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={cashReceivedInput}
                            onChange={(e) => setCashReceivedInput(e.target.value)}
                            placeholder="0.00"
                            className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs font-mono-tabular text-stone-900 dark:text-zinc-100"
                          />
                          <div className="flex justify-between text-xs text-stone-600 dark:text-zinc-400">
                            <span>Cambio:</span>
                            <span className="font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100">
                              {formatCurrency(changeGiven)}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <input
                          type="text"
                          maxLength={FIELD_LIMITS.CARD_REF_MAX}
                          value={referenceInput}
                          onChange={(e) => setReferenceInput(e.target.value)}
                          placeholder={
                            paymentMethod === 'Tarjeta'
                              ? 'Referencia / Autorización terminal (opcional)'
                              : 'Clave de rastreo / Referencia bancaria (opcional)'
                          }
                          className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs font-mono-tabular text-stone-900 dark:text-zinc-100"
                        />
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                      Notas del apartado (opcional)
                    </label>
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.LAYAWAY_NOTES_MAX}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Ej. Vestido separado para entrega en agosto..."
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-xs text-stone-900 dark:text-zinc-100"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-stone-200 dark:border-zinc-800 flex items-center justify-between gap-3">
              <div className="text-xs text-stone-600 dark:text-zinc-400">
                Saldo pendiente inicial:{' '}
                <span className="font-mono-tabular font-bold text-stone-900 dark:text-zinc-100">
                  {formatCurrency(Math.max(0, total - parsedDeposit))}
                </span>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving || !selectedCustomer || items.length === 0}
                  className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-40 cursor-pointer"
                >
                  {saving ? 'Reservando stock...' : 'Confirmar Apartado'}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>

      {showQuickCustomerModal && (
        <CustomerQuickModal
          activeBranch={activeBranch}
          onClose={() => setShowQuickCustomerModal(false)}
          onSaved={(created) => {
            setShowQuickCustomerModal(false);
            setSelectedCustomerId(created.id);
          }}
        />
      )}
    </>
  );
}

interface RegisterPaymentModalProps {
  layaway: Layaway;
  onClose: () => void;
  onPaid: (receipt: LayawayPayment & { issuedLocallyAt?: Date }, settled: boolean) => void;
}

function RegisterPaymentModal({ layaway, onClose, onPaid }: RegisterPaymentModalProps) {
  const { profile } = useAuth();
  const [amountInput, setAmountInput] = useState(String(layaway.remainingBalance));
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('Efectivo');
  const [cashReceivedInput, setCashReceivedInput] = useState('');
  const [referenceInput, setReferenceInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  const parsedAmount = Math.max(0, Number(Number(amountInput || 0).toFixed(2)) || 0);
  const parsedCash = Math.max(0, Number(cashReceivedInput) || 0);
  const changeGiven =
    paymentMethod === 'Efectivo' ? Math.max(0, Number((parsedCash - parsedAmount).toFixed(2))) : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (parsedAmount <= 0) {
      setError('El monto del abono debe ser mayor a $0.00.');
      return;
    }
    if (parsedAmount > layaway.remainingBalance + 0.001) {
      setError('El abono no puede exceder el saldo pendiente actual.');
      return;
    }
    if (paymentMethod === 'Efectivo' && parsedCash < parsedAmount) {
      setError('El efectivo recibido es menor al monto del abono.');
      return;
    }

    setSaving(true);
    const cleanRef = truncateStr(referenceInput, FIELD_LIMITS.CARD_REF_MAX);

    try {
      const result = await layawayService.registerPayment(
        {
          layawayId: layaway.id,
          amount: parsedAmount,
          paymentMethod,
          cashReceived: parsedCash,
          changeGiven,
          reference: cleanRef,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );

      onPaid(result.receipt, result.settled);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo registrar el abono.');
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
            Registrar Abono — {layaway.folio}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 px-4 py-3 text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-stone-500 dark:text-zinc-400">Cliente:</span>
              <span className="font-semibold text-stone-900 dark:text-zinc-100">
                {layaway.customerName}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-stone-500 dark:text-zinc-400">Saldo pendiente actual:</span>
              <span className="font-mono-tabular font-bold text-amber-700 dark:text-amber-400">
                {formatCurrency(layaway.remainingBalance)}
              </span>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-stone-700 dark:text-zinc-300">
                Monto del abono (MXN) *
              </label>
              <button
                type="button"
                onClick={() => setAmountInput(String(layaway.remainingBalance))}
                className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
              >
                Liquidar saldo completo
              </button>
            </div>
            <input
              type="number"
              required
              min="0.01"
              max={layaway.remainingBalance}
              step="0.01"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
              Forma de pago
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod('Efectivo')}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg border text-xs font-medium cursor-pointer ${
                  paymentMethod === 'Efectivo'
                    ? 'border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-200'
                }`}
              >
                <Banknote className="w-3.5 h-3.5" />
                <span>Efectivo</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('Tarjeta')}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg border text-xs font-medium cursor-pointer ${
                  paymentMethod === 'Tarjeta'
                    ? 'border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-200'
                }`}
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Tarjeta</span>
              </button>
              <button
                type="button"
                onClick={() => setPaymentMethod('Transferencia')}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-lg border text-xs font-medium cursor-pointer ${
                  paymentMethod === 'Transferencia'
                    ? 'border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                    : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-200'
                }`}
              >
                <ArrowRightLeft className="w-3.5 h-3.5" />
                <span>Transferencia</span>
              </button>
            </div>
          </div>

          {paymentMethod === 'Efectivo' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-stone-700 dark:text-zinc-300">
                  Monto recibido en efectivo *
                </label>
                <button
                  type="button"
                  onClick={() => setCashReceivedInput(String(parsedAmount))}
                  className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                >
                  Monto exacto
                </button>
              </div>
              <input
                type="number"
                required
                min={parsedAmount}
                step="0.01"
                value={cashReceivedInput}
                onChange={(e) => setCashReceivedInput(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100"
              />
              <div className="flex justify-between text-xs text-stone-600 dark:text-zinc-400">
                <span>Cambio a entregar</span>
                <span className="font-mono-tabular font-bold text-stone-900 dark:text-zinc-100">
                  {formatCurrency(changeGiven)}
                </span>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                {paymentMethod === 'Tarjeta'
                  ? 'Referencia / Autorización terminal (opcional)'
                  : 'Clave de rastreo / Referencia bancaria (opcional)'}
              </label>
              <input
                type="text"
                maxLength={FIELD_LIMITS.CARD_REF_MAX}
                value={referenceInput}
                onChange={(e) => setReferenceInput(e.target.value)}
                placeholder={paymentMethod === 'Tarjeta' ? 'Ej. AUT-849201' : 'Ej. SPEI-9381029'}
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100"
              />
            </div>
          )}

          <div className="pt-3 flex justify-end gap-3 border-t border-stone-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500 text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Aplicando abono...' : 'Registrar Abono y Recibo'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface LayawayDetailModalProps {
  layaway: Layaway;
  onClose: () => void;
  onReprintPayment: (payment: LayawayPayment) => void;
}

function LayawayDetailModal({ layaway, onClose, onReprintPayment }: LayawayDetailModalProps) {
  const [payments, setPayments] = useState<LayawayPayment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsub = layawayService.subscribeLayawayPayments(
      { layawayId: layaway.id, limitCount: 100 },
      (list) => {
        const sorted = [...list].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setPayments(sorted);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        console.error(err);
      }
    );
    return () => unsub();
  }, [layaway.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 no-print"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800">
          <div>
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              Detalle de Apartado — {layaway.folio}
            </h2>
            <p className="text-xs text-stone-500 dark:text-zinc-400">
              {layaway.customerName} · {layaway.customerPhone} · {LAYAWAY_STATUS_LABELS[layaway.status]}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* Items */}
          <div>
            <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 mb-2">
              Prendas apartadas
            </h3>
            <div className="border border-stone-200 dark:border-zinc-800 rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-50 dark:bg-zinc-950/60 border-b border-stone-200 dark:border-zinc-800 text-stone-500 dark:text-zinc-400">
                    <th className="py-2 px-3">Prenda</th>
                    <th className="py-2 px-3 text-center">Cant</th>
                    <th className="py-2 px-3 text-right">Importe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-zinc-800">
                  {layaway.items.map((it, idx) => (
                    <tr key={idx}>
                      <td className="py-2 px-3">
                        <div className="font-medium text-stone-900 dark:text-zinc-100">{it.name}</div>
                        <div className="font-mono-tabular text-stone-500 dark:text-zinc-400">
                          {it.sku} · Talla {it.size} · {it.color}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-center font-mono-tabular">{it.quantity}</td>
                      <td className="py-2 px-3 text-right font-mono-tabular font-semibold">
                        {formatCurrency(it.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {layaway.notes && (
            <div className="rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 px-3.5 py-2.5">
              <span className="font-semibold text-stone-800 dark:text-zinc-200">Notas: </span>
              <span className="text-stone-600 dark:text-zinc-400">{layaway.notes}</span>
            </div>
          )}

          {layaway.status === 'cancelado' && layaway.cancellationReason && (
            <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 px-3.5 py-2.5 text-red-700 dark:text-red-300">
              <span className="font-semibold">Motivo de cancelación: </span>
              {layaway.cancellationReason}
            </div>
          )}

          {/* Payments History */}
          <div>
            <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 mb-2">
              Historial de Abonos ({payments.length})
            </h3>
            {loading ? (
              <div className="h-14 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse" />
            ) : payments.length === 0 ? (
              <p className="text-stone-500 dark:text-zinc-400">
                Aún no se han registrado abonos para este apartado.
              </p>
            ) : (
              <div className="border border-stone-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-stone-50 dark:bg-zinc-950/60 border-b border-stone-200 dark:border-zinc-800 text-stone-500 dark:text-zinc-400">
                      <th className="py-2 px-3">Recibo</th>
                      <th className="py-2 px-3">Fecha</th>
                      <th className="py-2 px-3">Método</th>
                      <th className="py-2 px-3 text-right">Monto</th>
                      <th className="py-2 px-3 text-right">Recibo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100 dark:divide-zinc-800">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2 px-3 font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100">
                          {p.receiptFolio}
                        </td>
                        <td className="py-2 px-3 font-mono-tabular text-stone-600 dark:text-zinc-400">
                          {formatDateTime(p.createdAt)}
                        </td>
                        <td className="py-2 px-3 text-stone-700 dark:text-zinc-300">
                          {p.paymentMethod}
                          {p.reference ? ` (${p.reference})` : ''}
                        </td>
                        <td className="py-2 px-3 text-right font-mono-tabular font-semibold text-emerald-700 dark:text-emerald-400">
                          {formatCurrency(p.amount)}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => onReprintPayment(p)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-stone-200 dark:border-zinc-700 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                          >
                            <Printer className="w-3 h-3" />
                            <span>Imprimir</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface CancelLayawayModalProps {
  layaway: Layaway;
  onClose: () => void;
  onCancelled: (folio: string) => void;
}

function CancelLayawayModal({ layaway, onClose, onCancelled }: CancelLayawayModalProps) {
  const { profile } = useAuth();
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanReason = truncateStr(reason, FIELD_LIMITS.CANCEL_REASON_MAX);
    if (!cleanReason) {
      setError('Ingresa el motivo de cancelación.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await layawayService.cancelLayaway(
        {
          layaway,
          reason: cleanReason,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );

      onCancelled(layaway.folio);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar el apartado.');
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
      <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-lg space-y-4">
        <h3 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
          Cancelar Apartado — {layaway.folio}
        </h3>
        <p className="text-xs text-stone-600 dark:text-zinc-400 leading-relaxed">
          Se devolverán automáticamente todas las prendas reservadas al inventario de{' '}
          <span className="font-semibold text-stone-900 dark:text-zinc-200">
            {layaway.branchName}
          </span>
          .
        </p>

        {error && (
          <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleConfirm} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
              Motivo de cancelación *
            </label>
            <textarea
              required
              rows={2}
              maxLength={FIELD_LIMITS.CANCEL_REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej. Solicitud del cliente / cambio de modelo"
              className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100"
            />
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 cursor-pointer"
            >
              Volver
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
            >
              {saving ? 'Cancelando...' : 'Confirmar Cancelación'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
