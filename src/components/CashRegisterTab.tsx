import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  Calculator,
  CheckCircle2,
  Clock,
  CreditCard,
  History,
  Lock,
  Printer,
  Unlock,
} from 'lucide-react';
import { layawayService, salesService } from '../services/dataProvider';
import {
  formatCurrency,
  formatDateTime,
  toMillis,
  truncateStr,
} from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import {
  FIELD_LIMITS,
  type BranchId,
  type CashRegisterShift,
  type LayawayPayment,
  type Sale,
} from '../types/boutique';
import { ThermalTicketModal } from './ThermalTicketModal';

interface CashRegisterTabProps {
  activeBranch: BranchId;
  sales: Sale[];
  onPrintingChange?: (printing: boolean) => void;
}

type PrintableShift = CashRegisterShift & {
  openedLocallyAt?: Date;
  closedLocallyAt?: Date;
};

function round2(val: number): number {
  return Number((Number.isFinite(val) ? val : 0).toFixed(2));
}

export function CashRegisterTab({
  activeBranch,
  sales,
  onPrintingChange,
}: CashRegisterTabProps) {
  const { profile, getBranchName } = useAuth();

  const [shifts, setShifts] = useState<CashRegisterShift[]>([]);
  const [loadingShifts, setLoadingShifts] = useState(true);
  const [layawayPayments, setLayawayPayments] = useState<LayawayPayment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(true);

  const [openingFundInput, setOpeningFundInput] = useState('');
  const [openingSubmitting, setOpeningSubmitting] = useState(false);

  const [countedCashInput, setCountedCashInput] = useState('');
  const [observations, setObservations] = useState('');
  const [closingSubmitting, setClosingSubmitting] = useState(false);

  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const [printingShift, setPrintingShift] = useState<PrintableShift | null>(null);

  useEffect(() => {
    onPrintingChange?.(Boolean(printingShift));
    return () => {
      onPrintingChange?.(false);
    };
  }, [printingShift, onPrintingChange]);

  // Subscribe to cash_registers for activeBranch
  useEffect(() => {
    if (!profile) return;
    setLoadingShifts(true);

    const unsub = salesService.subscribeCashShifts(
      activeBranch,
      (list) => {
        const sorted = [...list].sort((a, b) => {
          const ta = toMillis(a.openedAt) || Date.now();
          const tb = toMillis(b.openedAt) || Date.now();
          return tb - ta;
        });
        setShifts(sorted);
        setLoadingShifts(false);
      },
      (err) => {
        setLoadingShifts(false);
        console.error(err);
      }
    );

    return () => unsub();
  }, [profile?.id, activeBranch]);

  // Subscribe to layaway_payments for activeBranch
  useEffect(() => {
    if (!profile) return;
    setLoadingPayments(true);

    const unsub = layawayService.subscribeLayawayPayments(
      { branchId: activeBranch, limitCount: 250 },
      (list) => {
        setLayawayPayments(list);
        setLoadingPayments(false);
      },
      (err) => {
        setLoadingPayments(false);
        console.error(err);
      }
    );

    return () => unsub();
  }, [profile?.id, activeBranch]);

  // Reset form inputs when switching branch
  useEffect(() => {
    setOpeningFundInput('');
    setCountedCashInput('');
    setObservations('');
    setFeedback(null);
  }, [activeBranch]);

  const openShift = useMemo(
    () => shifts.find((s) => s.status === 'open') || null,
    [shifts]
  );

  const closedShifts = useMemo(
    () => shifts.filter((s) => s.status === 'closed'),
    [shifts]
  );

  const shiftSummary = useMemo(() => {
    if (!openShift) {
      return {
        directSalesCount: 0,
        directSalesCash: 0,
        directSalesCard: 0,
        directSalesTransfer: 0,
        directSalesTotal: 0,
        layawayPaymentsCount: 0,
        layawayCash: 0,
        layawayCard: 0,
        layawayTransfer: 0,
        layawayTotal: 0,
        expectedCashTotal: 0,
        totalCard: 0,
        totalTransfer: 0,
        grandTotalIncome: 0,
      };
    }

    const openedMs = toMillis(openShift.openedAt) || Date.now();

    const shiftSales = sales.filter((s) => {
      if (s.branchId !== activeBranch) return false;
      if (s.status === 'cancelada') return false;
      const ms = toMillis(s.createdAt);
      if (!ms) return false;
      return ms >= openedMs;
    });

    const shiftLayawayPayments = layawayPayments.filter((p) => {
      if (p.branchId !== activeBranch) return false;
      const ms = toMillis(p.createdAt);
      if (!ms) return false;
      return ms >= openedMs;
    });

    let directSalesCash = 0;
    let directSalesCard = 0;
    let directSalesTransfer = 0;

    for (const s of shiftSales) {
      const amt = Number(s.total) || 0;
      if (s.paymentMethod === 'Efectivo') directSalesCash += amt;
      else if (s.paymentMethod === 'Tarjeta') directSalesCard += amt;
      else if (s.paymentMethod === 'Transferencia') directSalesTransfer += amt;
    }

    let layawayCash = 0;
    let layawayCard = 0;
    let layawayTransfer = 0;

    for (const p of shiftLayawayPayments) {
      const amt = Number(p.amount) || 0;
      if (p.paymentMethod === 'Efectivo') layawayCash += amt;
      else if (p.paymentMethod === 'Tarjeta') layawayCard += amt;
      else if (p.paymentMethod === 'Transferencia') layawayTransfer += amt;
    }

    directSalesCash = round2(directSalesCash);
    directSalesCard = round2(directSalesCard);
    directSalesTransfer = round2(directSalesTransfer);
    const directSalesTotal = round2(directSalesCash + directSalesCard + directSalesTransfer);

    layawayCash = round2(layawayCash);
    layawayCard = round2(layawayCard);
    layawayTransfer = round2(layawayTransfer);
    const layawayTotal = round2(layawayCash + layawayCard + layawayTransfer);

    const expectedCashTotal = round2(
      (Number(openShift.openingFund) || 0) + directSalesCash + layawayCash
    );
    const totalCard = round2(directSalesCard + layawayCard);
    const totalTransfer = round2(directSalesTransfer + layawayTransfer);
    const grandTotalIncome = round2(directSalesTotal + layawayTotal);

    return {
      directSalesCount: shiftSales.length,
      directSalesCash,
      directSalesCard,
      directSalesTransfer,
      directSalesTotal,
      layawayPaymentsCount: shiftLayawayPayments.length,
      layawayCash,
      layawayCard,
      layawayTransfer,
      layawayTotal,
      expectedCashTotal,
      totalCard,
      totalTransfer,
      grandTotalIncome,
    };
  }, [openShift, sales, layawayPayments, activeBranch]);

  if (!profile) return null;

  const branchName = getBranchName(activeBranch);
  const countedCashTrimmed = countedCashInput.trim();
  const hasCountedCash = countedCashTrimmed !== '' && !Number.isNaN(Number(countedCashTrimmed));
  const countedCash = hasCountedCash ? Math.max(0, round2(Number(countedCashTrimmed))) : 0;
  const rawDiff = hasCountedCash ? round2(countedCash - shiftSummary.expectedCashTotal) : 0;
  const difference = Math.abs(rawDiff) < 0.01 ? 0 : rawDiff;

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (openShift) {
      setFeedback({
        type: 'error',
        text: `Ya existe un turno de caja abierto en ${branchName}.`,
      });
      return;
    }

    const parsedFund = Number(openingFundInput === '' ? '0' : openingFundInput);
    if (!Number.isFinite(parsedFund) || parsedFund < 0) {
      setFeedback({
        type: 'error',
        text: 'El fondo inicial en efectivo debe ser un monto igual o mayor a $0.00.',
      });
      return;
    }

    const cleanOpeningFund = round2(parsedFund);

    setOpeningSubmitting(true);
    try {
      const { folio } = await salesService.openCashShift(
        {
          branchId: activeBranch,
          branchName,
          openingFund: cleanOpeningFund,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );

      setOpeningFundInput('');
      setFeedback({
        type: 'success',
        text: `Caja abierta (${folio}) con fondo inicial de ${formatCurrency(cleanOpeningFund)}.`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudo abrir el turno de caja.',
      });
    } finally {
      setOpeningSubmitting(false);
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    if (!openShift) return;
    if (!openShift.openedAt) {
      setFeedback({
        type: 'error',
        text: 'Espera un segundo a que se confirme la marca de tiempo de apertura en el servidor.',
      });
      return;
    }

    if (!hasCountedCash || countedCash < 0) {
      setFeedback({
        type: 'error',
        text: 'Ingresa el efectivo físico contado en el cajón para realizar el arqueo.',
      });
      return;
    }

    const cleanObs = truncateStr(observations, FIELD_LIMITS.OBSERVATIONS_MAX);
    const diffLabel =
      difference === 0
        ? 'Cuadre exacto ($0.00)'
        : difference > 0
          ? `Sobrante de ${formatCurrency(difference)}`
          : `Faltante de ${formatCurrency(Math.abs(difference))}`;

    setClosingSubmitting(true);
    try {
      const completedReport = await salesService.closeCashShift(
        {
          shift: openShift,
          branchId: activeBranch,
          branchName,
          summary: shiftSummary,
          countedCash,
          difference,
          observations: cleanObs,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );

      setCountedCashInput('');
      setObservations('');
      setPrintingShift(completedReport);
      setFeedback({
        type: 'success',
        text: `Cierre de caja ${openShift.folio} guardado (${diffLabel}).`,
      });
    } catch (err) {
      setFeedback({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudo cerrar la caja.',
      });
    } finally {
      setClosingSubmitting(false);
    }
  };

  const renderDiffStatus = (diffVal: number) => {
    if (Math.abs(diffVal) < 0.01) {
      return (
        <span className="inline-flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-semibold">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Cuadre exacto</span>
        </span>
      );
    }
    if (diffVal > 0) {
      return (
        <span className="inline-flex items-center gap-1.5 text-amber-700 dark:text-amber-400 font-semibold">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Sobrante (+{formatCurrency(diffVal)})</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-red-700 dark:text-red-400 font-semibold">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>Faltante (-{formatCurrency(Math.abs(diffVal))})</span>
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className={printingShift ? 'space-y-6 no-print' : 'space-y-6'}>
        {feedback && (
          <div
            className={`rounded-lg border px-4 py-3 text-xs ${
              feedback.type === 'success'
                ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                : 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
            }`}
          >
            {feedback.text}
          </div>
        )}

        {loadingShifts || loadingPayments ? (
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-12 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse"
              />
            ))}
          </div>
        ) : !openShift ? (
          /* Apertura de Caja Card */
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 sm:p-8">
            <div className="max-w-lg mx-auto space-y-5">
              <div className="flex items-start gap-4">
                <div className="w-11 h-11 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/50 flex items-center justify-center text-amber-700 dark:text-amber-400 shrink-0">
                  <Unlock className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-stone-900 dark:text-zinc-100">
                    Apertura de Caja — {branchName}
                  </h2>
                  <p className="text-sm text-stone-500 dark:text-zinc-400 mt-1">
                    No hay un turno abierto actualmente en esta sucursal. Registra el fondo inicial en efectivo para comenzar a contabilizar ventas directas y abonos de apartados del turno.
                  </p>
                </div>
              </div>

              <form onSubmit={handleOpenShift} className="space-y-4 pt-2">
                <div>
                  <label
                    htmlFor="opening-fund-input"
                    className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5"
                  >
                    Fondo inicial en efectivo (MXN)
                  </label>
                  <input
                    id="opening-fund-input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={openingFundInput}
                    onChange={(e) => setOpeningFundInput(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-base font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                  />
                  <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-1.5">
                    Este monto se sumará al efectivo de ventas y abonos para calcular el efectivo esperado al cierre.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={openingSubmitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
                >
                  {openingSubmitting ? 'Abriendo turno de caja...' : 'Abrir Turno de Caja'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          /* Active Shift Summary + Arqueo y Cierre */
          <div className="space-y-6">
            {/* Active Shift Banner */}
            <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                      Turno Abierto · {branchName}
                    </h2>
                    <span className="font-mono-tabular text-xs font-semibold text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 px-2 py-0.5 rounded-md">
                      {openShift.folio}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1">
                    Abierto por <span className="font-medium text-stone-700 dark:text-zinc-300">{openShift.openedByName}</span> (@{openShift.openedByUsuario}) ·{' '}
                    <span className="font-mono-tabular">
                      {openShift.openedAt ? formatDateTime(openShift.openedAt) : 'Sincronizando...'}
                    </span>
                  </p>
                </div>
              </div>

              <div className="text-left sm:text-right border-t sm:border-t-0 pt-3 sm:pt-0 border-stone-100 dark:border-zinc-800">
                <span className="block text-[11px] uppercase tracking-wider text-stone-500 dark:text-zinc-400">
                  Fondo inicial en caja
                </span>
                <span className="font-mono-tabular text-lg font-bold text-stone-900 dark:text-zinc-100">
                  {formatCurrency(openShift.openingFund)}
                </span>
              </div>
            </div>

            {/* KPI Summary Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="flex items-center justify-between text-xs text-stone-500 dark:text-zinc-400">
                  <span>Total Efectivo esperado en caja</span>
                  <Banknote className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="mt-2 font-mono-tabular text-2xl font-bold text-stone-900 dark:text-zinc-100">
                  {formatCurrency(shiftSummary.expectedCashTotal)}
                </p>
                <p className="mt-1 text-[11px] text-stone-500 dark:text-zinc-400 font-mono-tabular">
                  Fondo {formatCurrency(openShift.openingFund)} + Efectivo del turno{' '}
                  {formatCurrency(shiftSummary.directSalesCash + shiftSummary.layawayCash)}
                </p>
              </div>

              <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="flex items-center justify-between text-xs text-stone-500 dark:text-zinc-400">
                  <span>Total Tarjeta</span>
                  <CreditCard className="w-4 h-4 text-stone-600 dark:text-zinc-400" />
                </div>
                <p className="mt-2 font-mono-tabular text-2xl font-bold text-stone-900 dark:text-zinc-100">
                  {formatCurrency(shiftSummary.totalCard)}
                </p>
                <p className="mt-1 text-[11px] text-stone-500 dark:text-zinc-400 font-mono-tabular">
                  Ventas {formatCurrency(shiftSummary.directSalesCard)} + Abonos{' '}
                  {formatCurrency(shiftSummary.layawayCard)}
                </p>
              </div>

              <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
                <div className="flex items-center justify-between text-xs text-stone-500 dark:text-zinc-400">
                  <span>Total Transferencia</span>
                  <ArrowRightLeft className="w-4 h-4 text-stone-600 dark:text-zinc-400" />
                </div>
                <p className="mt-2 font-mono-tabular text-2xl font-bold text-stone-900 dark:text-zinc-100">
                  {formatCurrency(shiftSummary.totalTransfer)}
                </p>
                <p className="mt-1 text-[11px] text-stone-500 dark:text-zinc-400 font-mono-tabular">
                  Ventas {formatCurrency(shiftSummary.directSalesTransfer)} + Abonos{' '}
                  {formatCurrency(shiftSummary.layawayTransfer)}
                </p>
              </div>

              <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 p-4">
                <div className="flex items-center justify-between text-xs text-amber-800 dark:text-amber-300 font-medium">
                  <span>Ingresos netos del turno</span>
                  <Calculator className="w-4 h-4" />
                </div>
                <p className="mt-2 font-mono-tabular text-2xl font-bold text-stone-900 dark:text-zinc-100">
                  {formatCurrency(shiftSummary.grandTotalIncome)}
                </p>
                <p className="mt-1 text-[11px] text-stone-600 dark:text-zinc-400 font-mono-tabular">
                  {shiftSummary.directSalesCount} venta(s) · {shiftSummary.layawayPaymentsCount} abono(s)
                </p>
              </div>
            </div>

            {/* Breakdown Tables + Arqueo & Cierre Form */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left: Detailed Breakdown */}
              <div className="lg:col-span-7 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
                <div className="px-5 py-4 border-b border-stone-200 dark:border-zinc-800">
                  <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                    Desglose en Tiempo Real del Turno
                  </h3>
                  <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5">
                    Separación entre ventas directas de mostrador y abonos de apartados recibidos desde la apertura.
                  </p>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-xs font-medium text-stone-500 dark:text-zinc-400">
                        <th className="py-3 px-4">Concepto</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">Efectivo</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">Tarjeta</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">Transferencia</th>
                        <th className="py-3 px-4 text-right whitespace-nowrap">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/80">
                      <tr>
                        <td className="py-3 px-4">
                          <div className="font-medium text-stone-900 dark:text-zinc-100">
                            Ventas directas
                          </div>
                          <div className="text-xs text-stone-500 dark:text-zinc-400 font-mono-tabular">
                            {shiftSummary.directSalesCount} ticket(s) emitido(s)
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-stone-800 dark:text-zinc-200 whitespace-nowrap">
                          {formatCurrency(shiftSummary.directSalesCash)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-stone-800 dark:text-zinc-200 whitespace-nowrap">
                          {formatCurrency(shiftSummary.directSalesCard)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-stone-800 dark:text-zinc-200 whitespace-nowrap">
                          {formatCurrency(shiftSummary.directSalesTransfer)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                          {formatCurrency(shiftSummary.directSalesTotal)}
                        </td>
                      </tr>

                      <tr>
                        <td className="py-3 px-4">
                          <div className="font-medium text-stone-900 dark:text-zinc-100">
                            Abonos de apartados
                          </div>
                          <div className="text-xs text-stone-500 dark:text-zinc-400 font-mono-tabular">
                            {shiftSummary.layawayPaymentsCount} abono(s) recibido(s)
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-stone-800 dark:text-zinc-200 whitespace-nowrap">
                          {formatCurrency(shiftSummary.layawayCash)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-stone-800 dark:text-zinc-200 whitespace-nowrap">
                          {formatCurrency(shiftSummary.layawayCard)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-stone-800 dark:text-zinc-200 whitespace-nowrap">
                          {formatCurrency(shiftSummary.layawayTransfer)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                          {formatCurrency(shiftSummary.layawayTotal)}
                        </td>
                      </tr>

                      <tr className="bg-stone-50/70 dark:bg-zinc-950/60">
                        <td className="py-3 px-4 font-medium text-stone-700 dark:text-zinc-300">
                          Fondo inicial en efectivo
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-stone-800 dark:text-zinc-200 whitespace-nowrap">
                          {formatCurrency(openShift.openingFund)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-stone-400 dark:text-zinc-600">
                          —
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-stone-400 dark:text-zinc-600">
                          —
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-stone-800 dark:text-zinc-200 whitespace-nowrap">
                          {formatCurrency(openShift.openingFund)}
                        </td>
                      </tr>

                      <tr className="bg-stone-100/70 dark:bg-zinc-800/50 font-semibold">
                        <td className="py-3.5 px-4 text-stone-900 dark:text-zinc-100">
                          Totales del turno (incluye fondo en efectivo)
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-tabular text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                          {formatCurrency(shiftSummary.expectedCashTotal)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-tabular text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                          {formatCurrency(shiftSummary.totalCard)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-tabular text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                          {formatCurrency(shiftSummary.totalTransfer)}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono-tabular text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                          {formatCurrency(
                            round2(openShift.openingFund + shiftSummary.grandTotalIncome)
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Right: Arqueo y Cierre Form */}
              <form
                onSubmit={handleCloseShift}
                className="lg:col-span-5 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 space-y-4"
              >
                <div className="flex items-center gap-2.5 border-b border-stone-200 dark:border-zinc-800 pb-3.5">
                  <Lock className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                  <h3 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                    Arqueo y Cierre de Caja
                  </h3>
                </div>

                <div className="rounded-lg bg-stone-50 dark:bg-zinc-950 border border-stone-200 dark:border-zinc-800 px-3.5 py-2.5 flex items-center justify-between text-sm">
                  <span className="text-stone-600 dark:text-zinc-400">
                    Efectivo esperado en cajón
                  </span>
                  <span className="font-mono-tabular font-bold text-stone-900 dark:text-zinc-100">
                    {formatCurrency(shiftSummary.expectedCashTotal)}
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label
                      htmlFor="counted-cash-input"
                      className="text-xs font-medium text-stone-700 dark:text-zinc-300"
                    >
                      Efectivo físico contado (MXN) *
                    </label>
                    <button
                      type="button"
                      onClick={() => setCountedCashInput(String(shiftSummary.expectedCashTotal))}
                      className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
                    >
                      Igualar a esperado
                    </button>
                  </div>
                  <input
                    id="counted-cash-input"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={countedCashInput}
                    onChange={(e) => setCountedCashInput(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-base font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                  />
                </div>

                {hasCountedCash && (
                  <div
                    className={`rounded-lg border px-3.5 py-3 text-xs flex items-center justify-between ${
                      difference === 0
                        ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30'
                        : difference > 0
                          ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30'
                          : 'border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30'
                    }`}
                  >
                    <span className="text-stone-700 dark:text-zinc-300 font-medium">
                      Resultado del arqueo
                    </span>
                    <span className="font-mono-tabular">{renderDiffStatus(difference)}</span>
                  </div>
                )}

                <div>
                  <label
                    htmlFor="closure-observations"
                    className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5"
                  >
                    Observaciones de cierre (opcional)
                  </label>
                  <textarea
                    id="closure-observations"
                    rows={2}
                    maxLength={FIELD_LIMITS.OBSERVATIONS_MAX}
                    value={observations}
                    onChange={(e) => setObservations(e.target.value)}
                    placeholder="Ej. Turno matutino sin incidencias, comprobantes de terminal adjuntos..."
                    className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                  />
                </div>

                <button
                  type="submit"
                  disabled={closingSubmitting || !hasCountedCash || !openShift.openedAt}
                  className="w-full py-3 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500 text-white font-medium text-sm transition-colors disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
                >
                  {closingSubmitting
                    ? 'Guardando corte de caja...'
                    : 'Cerrar Caja y Generar Comprobante'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* Historical Closures Table */}
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-5 py-4 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-stone-500 dark:text-zinc-400" />
              <h3 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                Historial de Cortes de Caja — {branchName}
              </h3>
            </div>
            <span className="text-xs font-mono-tabular text-stone-500 dark:text-zinc-400">
              {closedShifts.length} corte(s)
            </span>
          </div>

          {closedShifts.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-stone-500 dark:text-zinc-400">
              Aún no se han registrado cierres de caja en {branchName}.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-xs font-medium text-stone-500 dark:text-zinc-400">
                    <th className="py-3 px-4 whitespace-nowrap">Folio</th>
                    <th className="py-3 px-4 whitespace-nowrap">Cierre</th>
                    <th className="py-3 px-4">Responsable</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Esperado Efec.</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Contado Físico</th>
                    <th className="py-3 px-4 whitespace-nowrap">Resultado</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Ingresos Turno</th>
                    <th className="py-3 px-4 text-right whitespace-nowrap">Comprobante</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/80">
                  {closedShifts.map((shift) => {
                    const diffVal = Number(shift.difference) || 0;
                    return (
                      <tr
                        key={shift.id}
                        className="hover:bg-stone-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                      >
                        <td className="py-3 px-4 font-mono-tabular text-xs font-semibold text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                          {shift.folio}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-xs text-stone-600 dark:text-zinc-400 whitespace-nowrap">
                          {formatDateTime(shift.closedAt || shift.openedAt)}
                        </td>
                        <td className="py-3 px-4 text-stone-700 dark:text-zinc-300">
                          <div>{shift.closedByName || shift.openedByName}</div>
                          <div className="text-[11px] text-stone-500 dark:text-zinc-400">
                            {shift.directSalesCount || 0} venta(s) ·{' '}
                            {shift.layawayPaymentsCount || 0} abono(s)
                          </div>
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-stone-800 dark:text-zinc-200 whitespace-nowrap">
                          {formatCurrency(shift.expectedCashTotal || 0)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-medium text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                          {formatCurrency(shift.countedCash || 0)}
                        </td>
                        <td className="py-3 px-4 text-xs whitespace-nowrap font-mono-tabular">
                          {renderDiffStatus(diffVal)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                          {formatCurrency(shift.grandTotalIncome || 0)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setPrintingShift(shift)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            <span>Ver / Imprimir</span>
                          </button>
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

      {/* Unified Thermal Printable Comprobante de Cierre de Caja Modal */}
      {printingShift && (
        <ThermalTicketModal
          document={{ type: 'cash_closure', shift: printingShift }}
          onClose={() => setPrintingShift(null)}
        />
      )}
    </div>
  );
}
