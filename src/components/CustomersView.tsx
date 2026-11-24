import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookmarkCheck,
  Calendar,
  Edit3,
  FileText,
  Mail,
  Phone,
  Receipt,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { customerService, layawayService, salesService } from '../services/dataProvider';
import { formatCurrency, formatDateTime, formatEventDate, toMillis } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import {
  LAYAWAY_STATUS_LABELS,
  type Customer,
  type Layaway,
  type Sale,
} from '../types/boutique';
import { CustomerQuickModal } from './CustomerQuickModal';

interface CustomersViewProps {
  customers: Customer[];
  loading: boolean;
  onGoToLayaways?: () => void;
}

export function CustomersView({ customers, loading, onGoToLayaways }: CustomersViewProps) {
  const { profile, operatingScope, hasPermission, getBranchName } = useAuth();

  const [search, setSearch] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<
    { type: 'create' } | { type: 'edit'; customer: Customer } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [customerSales, setCustomerSales] = useState<Sale[]>([]);
  const [customerLayaways, setCustomerLayaways] = useState<Layaway[]>([]);
  const [loadingProfileHistory, setLoadingProfileHistory] = useState(false);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(
      (c) =>
        c.nombreCompleto.toLowerCase().includes(q) ||
        c.telefono.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q) ||
        c.datosFiscales?.rfc?.toLowerCase().includes(q) ||
        c.datosFiscales?.razonSocial?.toLowerCase().includes(q)
    );
  }, [customers, search]);

  const selectedCustomer = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  // Real-time purchase & layaway history for the selected customer
  useEffect(() => {
    if (!selectedCustomerId) {
      setCustomerSales([]);
      setCustomerLayaways([]);
      setLoadingProfileHistory(false);
      return;
    }

    setLoadingProfileHistory(true);
    let salesDone = false;
    let layawaysDone = false;
    const checkDone = () => {
      if (salesDone && layawaysDone) setLoadingProfileHistory(false);
    };

    const unsubSales = salesService.subscribeSales(
      { customerId: selectedCustomerId, limitCount: 100 },
      (list) => {
        const sorted = [...list].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setCustomerSales(sorted);
        salesDone = true;
        checkDone();
      },
      (err) => {
        salesDone = true;
        checkDone();
        console.error(err);
      }
    );

    const unsubLayaways = layawayService.subscribeLayaways(
      { customerId: selectedCustomerId, limitCount: 100 },
      (list) => {
        const sorted = [...list].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setCustomerLayaways(sorted);
        layawaysDone = true;
        checkDone();
      },
      (err) => {
        layawaysDone = true;
        checkDone();
        console.error(err);
      }
    );

    return () => {
      unsubSales();
      unsubLayaways();
    };
  }, [selectedCustomerId]);

  if (!profile) return null;

  const canAccessLayaways = profile.rol === 'admin' || hasPermission('manageLayaways');
  const canManageCustomers = profile.rol === 'admin' || hasPermission('manageCustomers');

  const totalPendingBalance = customerLayaways
    .filter((l) => l.status === 'activo')
    .reduce((acc, l) => acc + l.remainingBalance, 0);

  const activeOrSettledCount = customerLayaways.filter(
    (l) => l.status === 'activo' || l.status === 'liquidado'
  ).length;

  const showToast = (text: string, type: 'success' | 'error' = 'success') => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const handleConfirmDeleteCustomer = async () => {
    if (!deleteTarget || !canManageCustomers) return;
    setDeletingCustomer(true);
    setDeleteError(null);
    const branchId =
      operatingScope !== 'general' ? operatingScope : profile.sucursalAsignada;
    try {
      await customerService.deleteCustomer(
        deleteTarget,
        branchId,
        getBranchName(branchId),
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );
      const removedName = deleteTarget.nombreCompleto;
      if (selectedCustomerId === deleteTarget.id) {
        setSelectedCustomerId(null);
      }
      setDeleteTarget(null);
      showToast(`Cliente "${removedName}" eliminado del directorio CRM.`, 'success');
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'No se pudo quitar al cliente del CRM.'
      );
    } finally {
      setDeletingCustomer(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-zinc-100 tracking-tight">
            Clientes (CRM)
          </h1>
          <p className="text-sm text-stone-600 dark:text-zinc-400 mt-1">
            Directorio de clientes, fechas de evento, datos fiscales e historial de compras y apartados.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setModalMode({ type: 'create' })}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>Nuevo Cliente</span>
        </button>
      </div>

      {toast && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            toast.type === 'error'
              ? 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
              : 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
          }`}
        >
          {toast.text}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-16 text-center">
          <div className="mx-auto w-12 h-12 rounded-xl bg-stone-100 dark:bg-zinc-800 flex items-center justify-center text-stone-500 dark:text-zinc-400 mb-4">
            <Users className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
            Aún no hay clientes registrados
          </h2>
          <p className="mt-2 text-sm text-stone-500 dark:text-zinc-400 max-w-md mx-auto">
            Crea el primer expediente de cliente con su teléfono de contacto, fecha de XV años y datos fiscales opcionales para vincular compras y apartados.
          </p>
          <button
            type="button"
            onClick={() => setModalMode({ type: 'create' })}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium cursor-pointer"
          >
            <UserPlus className="w-4 h-4" />
            <span>Registrar primer cliente</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Customer Search & Directory */}
          <div className="lg:col-span-5 space-y-4">
            <div className="relative">
              <Search className="w-4 h-4 text-stone-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nombre, WhatsApp, correo o RFC..."
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 pl-10 pr-4 py-2 text-sm text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              />
            </div>

            {filteredCustomers.length === 0 ? (
              <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 text-center text-sm text-stone-500 dark:text-zinc-400">
                No se encontraron clientes para &ldquo;{search}&rdquo;.
              </div>
            ) : (
              <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 divide-y divide-stone-100 dark:divide-zinc-800 overflow-hidden">
                {filteredCustomers.map((c) => {
                  const active = c.id === selectedCustomerId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCustomerId(c.id)}
                      className={`w-full text-left px-4 py-3.5 transition-colors cursor-pointer ${
                        active
                          ? 'bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                          : 'hover:bg-stone-50 dark:hover:bg-zinc-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold truncate">{c.nombreCompleto}</p>
                        {c.datosFiscales?.rfc && (
                          <span
                            className={`text-[11px] font-mono-tabular shrink-0 ${
                              active
                                ? 'text-stone-300 dark:text-zinc-600'
                                : 'text-stone-500 dark:text-zinc-400'
                            }`}
                          >
                            {c.datosFiscales.rfc}
                          </span>
                        )}
                      </div>
                      <p
                        className={`text-xs mt-1 font-mono-tabular truncate ${
                          active
                            ? 'text-stone-300 dark:text-zinc-700'
                            : 'text-stone-500 dark:text-zinc-400'
                        }`}
                      >
                        {c.telefono}
                        {c.fechaEvento ? ` · Evento: ${formatEventDate(c.fechaEvento)}` : ''}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Customer Profile & History */}
          <div className="lg:col-span-7">
            {!selectedCustomer ? (
              <div className="rounded-xl border border-dashed border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-6 py-16 text-center">
                <p className="text-sm font-medium text-stone-900 dark:text-zinc-100">
                  Selecciona un cliente de la lista
                </p>
                <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1.5 max-w-sm mx-auto">
                  Aquí verás su expediente completo, datos de facturación, historial de compras directas, apartados y saldo pendiente.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-6">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-stone-200 dark:border-zinc-800 pb-5">
                  <div className="space-y-1.5 min-w-0">
                    <h2 className="text-xl font-semibold text-stone-900 dark:text-zinc-100 truncate">
                      {selectedCustomer.nombreCompleto}
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-600 dark:text-zinc-400">
                      <span className="inline-flex items-center gap-1.5 font-mono-tabular">
                        <Phone className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                        {selectedCustomer.telefono}
                      </span>
                      {selectedCustomer.email && (
                        <span className="inline-flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-stone-400" />
                          {selectedCustomer.email}
                        </span>
                      )}
                      {selectedCustomer.fechaEvento && (
                        <span className="inline-flex items-center gap-1.5 font-mono-tabular">
                          <Calendar className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                          Evento: {formatEventDate(selectedCustomer.fechaEvento)}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setModalMode({ type: 'edit', customer: selectedCustomer })}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Editar expediente</span>
                    </button>

                    {canManageCustomers && (
                      <button
                        type="button"
                        disabled={loadingProfileHistory || customerLayaways.length > 0}
                        title={
                          customerLayaways.length > 0
                            ? 'No se puede quitar un cliente con apartados registrados'
                            : 'Quitar cliente del CRM'
                        }
                        onClick={() => {
                          setDeleteError(null);
                          setDeleteTarget(selectedCustomer);
                        }}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 dark:border-red-900/60 text-xs font-medium text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Quitar cliente</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Metrics Strip */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-b border-stone-200 dark:border-zinc-800 pb-5">
                  <div>
                    <p className="text-xs text-stone-500 dark:text-zinc-400">Compras directas</p>
                    <p className="text-lg font-semibold font-mono-tabular text-stone-900 dark:text-zinc-100 mt-0.5">
                      {customerSales.length}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 dark:text-zinc-400">
                      Apartados activos / liquidados
                    </p>
                    <p className="text-lg font-semibold font-mono-tabular text-stone-900 dark:text-zinc-100 mt-0.5">
                      {activeOrSettledCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-stone-500 dark:text-zinc-400">
                      Saldo total pendiente
                    </p>
                    <p
                      className={`text-lg font-semibold font-mono-tabular mt-0.5 ${
                        totalPendingBalance > 0
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}
                    >
                      {formatCurrency(totalPendingBalance)}
                    </p>
                  </div>
                </div>

                {/* Notes & Fiscal Data */}
                {(selectedCustomer.notas ||
                  selectedCustomer.datosFiscales?.rfc ||
                  selectedCustomer.datosFiscales?.razonSocial) && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5 border-b border-stone-200 dark:border-zinc-800 pb-5 text-xs">
                    {selectedCustomer.notas && (
                      <div>
                        <p className="font-semibold text-stone-800 dark:text-zinc-200 mb-1">
                          Notas de seguimiento
                        </p>
                        <p className="text-stone-600 dark:text-zinc-400 leading-relaxed whitespace-pre-wrap">
                          {selectedCustomer.notas}
                        </p>
                      </div>
                    )}

                    {(selectedCustomer.datosFiscales?.rfc ||
                      selectedCustomer.datosFiscales?.razonSocial) && (
                      <div>
                        <p className="font-semibold text-stone-800 dark:text-zinc-200 mb-1 inline-flex items-center gap-1.5">
                          <FileText className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                          <span>Datos fiscales</span>
                        </p>
                        <dl className="space-y-0.5 text-stone-600 dark:text-zinc-400">
                          {selectedCustomer.datosFiscales.rfc && (
                            <div>
                              RFC:{' '}
                              <span className="font-mono-tabular font-medium text-stone-900 dark:text-zinc-200">
                                {selectedCustomer.datosFiscales.rfc}
                              </span>
                            </div>
                          )}
                          {selectedCustomer.datosFiscales.razonSocial && (
                            <div>Razón Social: {selectedCustomer.datosFiscales.razonSocial}</div>
                          )}
                          {selectedCustomer.datosFiscales.codigoPostal && (
                            <div>
                              C.P.:{' '}
                              <span className="font-mono-tabular">
                                {selectedCustomer.datosFiscales.codigoPostal}
                              </span>
                            </div>
                          )}
                          {selectedCustomer.datosFiscales.regimenFiscal && (
                            <div>Régimen: {selectedCustomer.datosFiscales.regimenFiscal}</div>
                          )}
                          {selectedCustomer.datosFiscales.usoCfdi && (
                            <div>CFDI: {selectedCustomer.datosFiscales.usoCfdi}</div>
                          )}
                        </dl>
                      </div>
                    )}
                  </div>
                )}

                {/* Layaways History */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 inline-flex items-center gap-2">
                      <BookmarkCheck className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                      <span>Apartados ({customerLayaways.length})</span>
                    </h3>
                    {canAccessLayaways && onGoToLayaways && (
                      <button
                        type="button"
                        onClick={onGoToLayaways}
                        className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                      >
                        Ir a Apartados
                      </button>
                    )}
                  </div>

                  {loadingProfileHistory ? (
                    <div className="h-14 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse" />
                  ) : customerLayaways.length === 0 ? (
                    <p className="text-xs text-stone-500 dark:text-zinc-400">
                      Sin apartados registrados para este cliente.
                    </p>
                  ) : (
                    <div className="overflow-x-auto border border-stone-200 dark:border-zinc-800 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-stone-500 dark:text-zinc-400">
                            <th className="py-2 px-3">Folio</th>
                            <th className="py-2 px-3">Estado</th>
                            <th className="py-2 px-3 text-right">Total</th>
                            <th className="py-2 px-3 text-right">Abonado</th>
                            <th className="py-2 px-3 text-right">Saldo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100 dark:divide-zinc-800">
                          {customerLayaways.map((l) => (
                            <tr key={l.id}>
                              <td className="py-2 px-3 font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                                {l.folio}
                              </td>
                              <td className="py-2 px-3 text-stone-700 dark:text-zinc-300">
                                {LAYAWAY_STATUS_LABELS[l.status]}
                              </td>
                              <td className="py-2 px-3 text-right font-mono-tabular whitespace-nowrap">
                                {formatCurrency(l.total)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono-tabular text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                                {formatCurrency(l.totalPaid)}
                              </td>
                              <td className="py-2 px-3 text-right font-mono-tabular font-semibold whitespace-nowrap">
                                {formatCurrency(l.remainingBalance)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Direct Purchases History */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 inline-flex items-center gap-2">
                    <Receipt className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                    <span>Historial de Compras Directas ({customerSales.length})</span>
                  </h3>

                  {loadingProfileHistory ? (
                    <div className="h-14 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse" />
                  ) : customerSales.length === 0 ? (
                    <p className="text-xs text-stone-500 dark:text-zinc-400">
                      Aún no tiene tickets de venta directa vinculados.
                    </p>
                  ) : (
                    <div className="overflow-x-auto border border-stone-200 dark:border-zinc-800 rounded-lg">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-stone-500 dark:text-zinc-400">
                            <th className="py-2 px-3">Folio</th>
                            <th className="py-2 px-3">Fecha</th>
                            <th className="py-2 px-3">Sucursal</th>
                            <th className="py-2 px-3">Pago</th>
                            <th className="py-2 px-3 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-stone-100 dark:divide-zinc-800">
                          {customerSales.map((s) => (
                            <tr key={s.id}>
                              <td className="py-2 px-3 font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                                {s.folio}
                              </td>
                              <td className="py-2 px-3 font-mono-tabular text-stone-600 dark:text-zinc-400 whitespace-nowrap">
                                {formatDateTime(s.createdAt)}
                              </td>
                              <td className="py-2 px-3 text-stone-700 dark:text-zinc-300 whitespace-nowrap">
                                {s.branchName}
                              </td>
                              <td className="py-2 px-3 text-stone-700 dark:text-zinc-300 whitespace-nowrap">
                                {s.paymentMethod}
                              </td>
                              <td className="py-2 px-3 text-right font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                                {formatCurrency(s.total)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {modalMode && (
        <CustomerQuickModal
          editingCustomer={modalMode.type === 'edit' ? modalMode.customer : null}
          onClose={() => setModalMode(null)}
          onSaved={(savedCustomer, isEdit) => {
            setModalMode(null);
            setSelectedCustomerId(savedCustomer.id);
            showToast(
              isEdit
                ? `Expediente de "${savedCustomer.nombreCompleto}" actualizado.`
                : `Cliente "${savedCustomer.nombreCompleto}" registrado en el CRM.`
            );
          }}
        />
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900/60 flex items-center justify-center text-red-600 dark:text-red-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                  Quitar cliente del CRM
                </h3>
                <p className="mt-1.5 text-sm text-stone-600 dark:text-zinc-400 leading-relaxed">
                  ¿Estás seguro de eliminar a{' '}
                  <span className="font-semibold text-stone-900 dark:text-zinc-100">
                    {deleteTarget.nombreCompleto}
                  </span>{' '}
                  ({deleteTarget.telefono})? Esta acción eliminará su expediente de forma permanente.
                </p>
                {customerSales.length > 0 && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    Los {customerSales.length} ticket(s) de venta directa previos conservarán su historial de folios y nombre sin verse afectados.
                  </p>
                )}
              </div>
            </div>

            {deleteError && (
              <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                disabled={deletingCustomer}
                onClick={() => {
                  setDeleteTarget(null);
                  setDeleteError(null);
                }}
                className="px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={deletingCustomer}
                onClick={() => void handleConfirmDeleteCustomer()}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50 cursor-pointer"
              >
                {deletingCustomer ? 'Eliminando...' : 'Quitar cliente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
