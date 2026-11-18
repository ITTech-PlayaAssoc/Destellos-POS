import { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Ban,
  BookmarkCheck,
  BookmarkX,
  Building2,
  CheckCircle2,
  ClipboardList,
  Package,
  ShoppingBag,
} from 'lucide-react';
import { layawayService, salesService } from '../services/dataProvider';
import { formatCurrency, formatDateInputValue, formatDateTime } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import type { BranchId, Layaway, Product, Sale } from '../types/boutique';

interface AdminDashboardViewProps {
  products: Product[];
  loadingProducts: boolean;
  onNavigate: (
    tab: 'pos' | 'layaways' | 'catalog_branches' | 'inventory' | 'settings'
  ) => void;
}

function getLocalTodayString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function AdminDashboardView({
  products,
  loadingProducts,
  onNavigate,
}: AdminDashboardViewProps) {
  const { profile, branding, branchList, branchIds, operatingScope, getBranchName } = useAuth();

  const [sales, setSales] = useState<Sale[]>([]);
  const [loadingSales, setLoadingSales] = useState(true);
  const [layaways, setLayaways] = useState<Layaway[]>([]);
  const [loadingLayaways, setLoadingLayaways] = useState(true);

  const isAdmin = profile?.rol === 'admin';

  useEffect(() => {
    if (!profile || !isAdmin) {
      setSales([]);
      setLoadingSales(false);
      return;
    }

    setLoadingSales(true);
    const unsub = salesService.subscribeSales(
      { limitCount: 500 },
      (list) => {
        setSales(list);
        setLoadingSales(false);
      },
      (err) => {
        setLoadingSales(false);
        console.error(err);
      }
    );

    return () => unsub();
  }, [profile?.id, isAdmin]);

  useEffect(() => {
    if (!profile || !isAdmin) {
      setLayaways([]);
      setLoadingLayaways(false);
      return;
    }

    setLoadingLayaways(true);
    const unsub = layawayService.subscribeLayaways(
      { limitCount: 500 },
      (list) => {
        setLayaways(list);
        setLoadingLayaways(false);
      },
      (err) => {
        setLoadingLayaways(false);
        console.error(err);
      }
    );

    return () => unsub();
  }, [profile?.id, isAdmin]);

  const todayStr = getLocalTodayString();
  const scopeBranchId: BranchId | null = operatingScope !== 'general' ? operatingScope : null;

  const metrics = useMemo(() => {
    let totalUnitsInStock = 0;
    let productsWithStockCount = 0;

    for (const p of products) {
      let productUnits = 0;
      if (scopeBranchId) {
        productUnits = Math.max(0, Number(p.stock?.[scopeBranchId]) || 0);
      } else {
        for (const bId of branchIds) {
          productUnits += Math.max(0, Number(p.stock?.[bId]) || 0);
        }
        for (const [k, qty] of Object.entries(p.stock || {})) {
          if (!branchIds.includes(k)) {
            productUnits += Math.max(0, Number(qty) || 0);
          }
        }
      }
      if (productUnits > 0) productsWithStockCount += 1;
      totalUnitsInStock += productUnits;
    }

    const scopedSales = scopeBranchId
      ? sales.filter((s) => s.branchId === scopeBranchId)
      : sales;
    const scopedLayaways = scopeBranchId
      ? layaways.filter((l) => l.branchId === scopeBranchId)
      : layaways;

    const todayCompletedSales = scopedSales.filter((s) => {
      if (s.status === 'cancelada') return false;
      return formatDateInputValue(s.createdAt) === todayStr;
    });

    const todaySalesRevenue = todayCompletedSales.reduce(
      (sum, s) => sum + (Number(s.total) || 0),
      0
    );
    const todaySoldUnits = todayCompletedSales.reduce(
      (sum, s) => sum + s.items.reduce((itemSum, it) => itemSum + (Number(it.quantity) || 0), 0),
      0
    );

    const cancelledSales = scopedSales.filter((s) => s.status === 'cancelada');
    const cancelledSalesAmount = cancelledSales.reduce(
      (sum, s) => sum + (Number(s.total) || 0),
      0
    );
    const cancelledSalesUnits = cancelledSales.reduce(
      (sum, s) => sum + s.items.reduce((itemSum, it) => itemSum + (Number(it.quantity) || 0), 0),
      0
    );

    const activeLayaways = scopedLayaways.filter((l) => l.status === 'activo');
    const reservedLayawayUnits = activeLayaways.reduce(
      (sum, l) => sum + l.items.reduce((itemSum, it) => itemSum + (Number(it.quantity) || 0), 0),
      0
    );
    const activeLayawaysBalance = activeLayaways.reduce(
      (sum, l) => sum + (Number(l.remainingBalance) || 0),
      0
    );

    const liquidatedLayaways = scopedLayaways.filter((l) => l.status === 'liquidado');
    const liquidatedLayawayUnits = liquidatedLayaways.reduce(
      (sum, l) => sum + l.items.reduce((itemSum, it) => itemSum + (Number(it.quantity) || 0), 0),
      0
    );

    const deliveredLayaways = scopedLayaways.filter((l) => l.status === 'entregado');
    const deliveredLayawayUnits = deliveredLayaways.reduce(
      (sum, l) => sum + l.items.reduce((itemSum, it) => itemSum + (Number(it.quantity) || 0), 0),
      0
    );

    const cancelledLayaways = scopedLayaways.filter((l) => l.status === 'cancelado');
    const cancelledLayawaysUnits = cancelledLayaways.reduce(
      (sum, l) => sum + l.items.reduce((itemSum, it) => itemSum + (Number(it.quantity) || 0), 0),
      0
    );
    const cancelledLayawaysTotal = cancelledLayaways.reduce(
      (sum, l) => sum + (Number(l.total) || 0),
      0
    );

    return {
      totalUnitsInStock,
      productsWithStockCount,
      todayCompletedSalesCount: todayCompletedSales.length,
      todaySalesRevenue,
      todaySoldUnits,
      reservedLayawayUnits,
      activeLayawaysCount: activeLayaways.length,
      activeLayawaysBalance,
      liquidatedLayawayUnits,
      liquidatedLayawaysCount: liquidatedLayaways.length,
      deliveredLayawayUnits,
      cancelledSalesCount: cancelledSales.length,
      cancelledSalesAmount,
      cancelledSalesUnits,
      cancelledLayawaysCount: cancelledLayaways.length,
      cancelledLayawaysUnits,
      cancelledLayawaysTotal,
      recentTodaySales: todayCompletedSales.slice(0, 6),
      recentCancelledSales: cancelledSales.slice(0, 6),
    };
  }, [products, sales, layaways, scopeBranchId, branchIds, todayStr]);

  const branchBreakdown = useMemo(() => {
    return branchList.map((branch) => {
      const stockUnits = products.reduce(
        (sum, p) => sum + Math.max(0, Number(p.stock?.[branch.id]) || 0),
        0
      );

      const branchSales = sales.filter((s) => s.branchId === branch.id);
      const branchTodaySales = branchSales.filter(
        (s) => s.status !== 'cancelada' && formatDateInputValue(s.createdAt) === todayStr
      );
      const branchTodayRevenue = branchTodaySales.reduce(
        (sum, s) => sum + (Number(s.total) || 0),
        0
      );
      const branchCancelledSalesCount = branchSales.filter(
        (s) => s.status === 'cancelada'
      ).length;

      const branchLayaways = layaways.filter((l) => l.branchId === branch.id);
      const branchReservedUnits = branchLayaways
        .filter((l) => l.status === 'activo')
        .reduce(
          (sum, l) =>
            sum + l.items.reduce((itemSum, it) => itemSum + (Number(it.quantity) || 0), 0),
          0
        );
      const branchLiquidatedUnits = branchLayaways
        .filter((l) => l.status === 'liquidado')
        .reduce(
          (sum, l) =>
            sum + l.items.reduce((itemSum, it) => itemSum + (Number(it.quantity) || 0), 0),
          0
        );
      const branchCancelledLayawaysCount = branchLayaways.filter(
        (l) => l.status === 'cancelado'
      ).length;

      return {
        branch,
        stockUnits,
        todaySalesCount: branchTodaySales.length,
        todayRevenue: branchTodayRevenue,
        reservedUnits: branchReservedUnits,
        liquidatedUnits: branchLiquidatedUnits,
        cancelledSalesCount: branchCancelledSalesCount,
        cancelledLayawaysCount: branchCancelledLayawaysCount,
      };
    });
  }, [branchList, products, sales, layaways, todayStr]);

  if (!profile || !isAdmin) return null;

  const companyName = branding.companyName?.trim() || 'Atelier Aurelia';
  const loadingAny = loadingProducts || loadingSales || loadingLayaways;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-zinc-100 tracking-tight">
            Dashboard Administrativo
          </h1>
          <p className="text-sm text-stone-600 dark:text-zinc-400 mt-1">
            {companyName} · Alcance activo:{' '}
            <span className="font-medium text-stone-900 dark:text-zinc-200">
              {scopeBranchId ? getBranchName(scopeBranchId) : 'General (Todas las sucursales)'}
            </span>{' '}
            · Fecha:{' '}
            <span className="font-mono-tabular">{todayStr}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => onNavigate('pos')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ShoppingBag className="w-3.5 h-3.5" />
            <span>Punto de Venta</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('layaways')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BookmarkCheck className="w-3.5 h-3.5" />
            <span>Apartados</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('inventory')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Package className="w-3.5 h-3.5" />
            <span>Inventario</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ClipboardList className="w-3.5 h-3.5" />
            <span>Logs</span>
          </button>
        </div>
      </div>

      {/* 6 Primary KPI Metrics */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {/* 1. Recuento de artículos */}
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-zinc-400">
              Recuento de artículos
            </span>
            <Package className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
          </div>
          <div>
            <p className="text-3xl font-bold font-mono-tabular text-stone-900 dark:text-zinc-100">
              {loadingProducts ? '—' : metrics.totalUnitsInStock.toLocaleString('es-MX')}
            </p>
            <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1 font-mono-tabular">
              {metrics.productsWithStockCount} modelo(s) con existencia · {products.length} SKU(s) en catálogo
            </p>
          </div>
        </div>

        {/* 2. Ventas del día hechas */}
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-zinc-400">
              Ventas del día hechas
            </span>
            <ShoppingBag className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
          </div>
          <div>
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <p className="text-3xl font-bold font-mono-tabular text-stone-900 dark:text-zinc-100">
                {loadingSales ? '—' : metrics.todayCompletedSalesCount}
              </p>
              <span className="text-sm font-semibold font-mono-tabular text-emerald-700 dark:text-emerald-400">
                {loadingSales ? '' : formatCurrency(metrics.todaySalesRevenue)}
              </span>
            </div>
            <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1 font-mono-tabular">
              {metrics.todaySoldUnits} artículo(s) vendido(s) hoy
            </p>
          </div>
        </div>

        {/* 3. Artículos apartados */}
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-zinc-400">
              Artículos apartados
            </span>
            <BookmarkCheck className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
          </div>
          <div>
            <p className="text-3xl font-bold font-mono-tabular text-stone-900 dark:text-zinc-100">
              {loadingLayaways ? '—' : metrics.reservedLayawayUnits}
            </p>
            <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1 font-mono-tabular">
              {metrics.activeLayawaysCount} apartado(s) activo(s) · Saldo{' '}
              {formatCurrency(metrics.activeLayawaysBalance)}
            </p>
          </div>
        </div>

        {/* 4. Artículos liquidados */}
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-zinc-400">
              Artículos liquidados
            </span>
            <CheckCircle2 className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
          </div>
          <div>
            <p className="text-3xl font-bold font-mono-tabular text-stone-900 dark:text-zinc-100">
              {loadingLayaways ? '—' : metrics.liquidatedLayawayUnits}
            </p>
            <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1 font-mono-tabular">
              {metrics.liquidatedLayawaysCount} apartado(s) listo(s) para entrega
              {metrics.deliveredLayawayUnits > 0
                ? ` · ${metrics.deliveredLayawayUnits} entregado(s)`
                : ''}
            </p>
          </div>
        </div>

        {/* 5. Ventas canceladas */}
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-zinc-400">
              Ventas canceladas
            </span>
            <Ban className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
          </div>
          <div>
            <p className="text-3xl font-bold font-mono-tabular text-stone-900 dark:text-zinc-100">
              {loadingSales ? '—' : metrics.cancelledSalesCount}
            </p>
            <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1 font-mono-tabular">
              {formatCurrency(metrics.cancelledSalesAmount)} · {metrics.cancelledSalesUnits} artículo(s) reintegrado(s)
            </p>
          </div>
        </div>

        {/* 6. Apartados cancelados */}
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-5 flex flex-col justify-between gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-500 dark:text-zinc-400">
              Apartados cancelados
            </span>
            <BookmarkX className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0" />
          </div>
          <div>
            <p className="text-3xl font-bold font-mono-tabular text-stone-900 dark:text-zinc-100">
              {loadingLayaways ? '—' : metrics.cancelledLayawaysCount}
            </p>
            <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1 font-mono-tabular">
              {metrics.cancelledLayawaysUnits} artículo(s) · {formatCurrency(metrics.cancelledLayawaysTotal)}
            </p>
          </div>
        </div>
      </section>

      {/* Branch Breakdown Table */}
      <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-200 dark:border-zinc-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
            <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
              Resumen comparativo por sucursal
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('catalog_branches')}
            className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline self-start sm:self-auto cursor-pointer"
          >
            Administrar sucursales y categorías
          </button>
        </div>

        {loadingAny ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-9 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-xs font-medium text-stone-500 dark:text-zinc-400">
                  <th className="py-3 px-4 whitespace-nowrap">Sucursal</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Artículos en stock</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Ventas del día</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Artículos apartados</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Artículos liquidados</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Ventas canceladas</th>
                  <th className="py-3 px-4 text-right whitespace-nowrap">Apartados cancelados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/80 text-sm">
                {branchBreakdown.map((row) => {
                  const isFocused = scopeBranchId === row.branch.id;
                  return (
                    <tr
                      key={row.branch.id}
                      className={`transition-colors ${
                        isFocused
                          ? 'bg-amber-50/50 dark:bg-amber-950/20'
                          : 'hover:bg-stone-50/80 dark:hover:bg-zinc-800/40'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="font-medium text-stone-900 dark:text-zinc-100">
                          {row.branch.name}
                          {isFocused ? (
                            <span className="ml-2 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                              · Activa
                            </span>
                          ) : null}
                        </div>
                        {row.branch.city && (
                          <div className="text-xs text-stone-500 dark:text-zinc-400">
                            {row.branch.city}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-stone-900 dark:text-zinc-100 whitespace-nowrap">
                        {row.stockUnits.toLocaleString('es-MX')} u.
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular whitespace-nowrap">
                        <span className="font-semibold text-stone-900 dark:text-zinc-100">
                          {row.todaySalesCount}
                        </span>
                        <span className="text-xs text-stone-500 dark:text-zinc-400 ml-1.5">
                          ({formatCurrency(row.todayRevenue)})
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-stone-800 dark:text-zinc-200 whitespace-nowrap">
                        {row.reservedUnits} u.
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-emerald-700 dark:text-emerald-400 font-medium whitespace-nowrap">
                        {row.liquidatedUnits} u.
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-stone-700 dark:text-zinc-300 whitespace-nowrap">
                        {row.cancelledSalesCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono-tabular text-stone-700 dark:text-zinc-300 whitespace-nowrap">
                        {row.cancelledLayawaysCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Today Sales & Cancellations Split Feed */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
              Últimas ventas de hoy
            </h2>
            <button
              type="button"
              onClick={() => onNavigate('pos')}
              className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer"
            >
              Ver en POS
            </button>
          </div>
          {metrics.recentTodaySales.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-stone-500 dark:text-zinc-400">
              No hay ventas completadas registradas el día de hoy en este alcance.
            </div>
          ) : (
            <div className="divide-y divide-stone-100 dark:divide-zinc-800/80">
              {metrics.recentTodaySales.map((s) => (
                <div
                  key={s.id}
                  className="px-5 py-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100">
                      {s.folio} · {s.branchName}
                    </p>
                    <p className="text-stone-500 dark:text-zinc-400 truncate mt-0.5">
                      {s.sellerName} · {s.paymentMethod} · {formatDateTime(s.createdAt)}
                    </p>
                  </div>
                  <span className="font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100 shrink-0">
                    {formatCurrency(s.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
              Ventas canceladas recientes
            </h2>
            <span className="text-xs font-mono-tabular text-stone-500 dark:text-zinc-400">
              Total: {metrics.cancelledSalesCount}
            </span>
          </div>
          {metrics.recentCancelledSales.length === 0 ? (
            <div className="px-5 py-10 text-center text-xs text-stone-500 dark:text-zinc-400">
              Sin ventas canceladas registradas en este alcance.
            </div>
          ) : (
            <div className="divide-y divide-stone-100 dark:divide-zinc-800/80">
              {metrics.recentCancelledSales.map((s) => (
                <div
                  key={s.id}
                  className="px-5 py-3 flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100">
                      {s.folio} · {s.branchName}
                    </p>
                    <p className="text-red-600 dark:text-red-400 truncate mt-0.5">
                      {s.cancellationReason || 'Cancelada en historial POS'}
                    </p>
                  </div>
                  <span className="font-mono-tabular line-through text-stone-500 dark:text-zinc-400 shrink-0">
                    {formatCurrency(s.total)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
