import React, { useEffect, useMemo, useState } from 'react';
import {
  BookmarkCheck,
  BookUser,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  Settings,
  ShoppingBag,
  Sun,
  Tags,
  Users,
  X,
} from 'lucide-react';
import { customerService, inventoryService } from '../services/dataProvider';
import { getInitials } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { USER_ROLE_LABELS, type Customer, type Product } from '../types/boutique';
import { AdminDashboardView } from './AdminDashboardView';
import { CatalogBranchesAdminView } from './CatalogBranchesAdminView';
import { CustomersView } from './CustomersView';
import { InventoryView } from './InventoryView';
import { LayawaysView } from './LayawaysView';
import { PosView } from './PosView';
import { SettingsLogsView } from './SettingsLogsView';
import { UsersView } from './UsersView';

type ModuleTab =
  | 'dashboard'
  | 'pos'
  | 'layaways'
  | 'customers'
  | 'inventory'
  | 'catalog_branches'
  | 'users'
  | 'settings';

export function DashboardShell() {
  const {
    profile,
    branding,
    operatingScope,
    hasPermission,
    getBranchName,
    toggleTheme,
    logout,
  } = useAuth();
  const companyName = branding.companyName?.trim() || 'Atelier Aurelia';

  const [activeTab, setActiveTab] = useState<ModuleTab>('pos');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);

  const isAdmin = profile?.rol === 'admin';
  const canAccessPos = isAdmin || hasPermission('performSales');
  const canAccessLayaways = isAdmin || hasPermission('manageLayaways');
  const canAccessCustomers = isAdmin || hasPermission('manageCustomers');
  const canAccessInventory =
    isAdmin ||
    hasPermission('viewInventory') ||
    hasPermission('addProduct') ||
    hasPermission('restockInventory') ||
    hasPermission('discardStock');
  const canReadProducts = canAccessPos || canAccessLayaways || canAccessInventory || isAdmin;
  const canReadCustomers = canAccessPos || canAccessLayaways || canAccessCustomers;

  const navItems = useMemo(() => {
    const items: { id: ModuleTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [];
    if (isAdmin) {
      items.push({ id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard });
    }
    if (canAccessPos) {
      items.push({ id: 'pos', label: 'Punto de Venta', icon: ShoppingBag });
    }
    if (canAccessLayaways) {
      items.push({ id: 'layaways', label: 'Apartados', icon: BookmarkCheck });
    }
    if (canAccessCustomers) {
      items.push({ id: 'customers', label: 'Clientes (CRM)', icon: BookUser });
    }
    if (canAccessInventory) {
      items.push({ id: 'inventory', label: 'Inventario', icon: Package });
    }
    if (isAdmin) {
      items.push({
        id: 'catalog_branches',
        label: 'Categorías y Sucursales',
        icon: Tags,
      });
      items.push({ id: 'users', label: 'Usuarios', icon: Users });
    }
    items.push({
      id: 'settings',
      label: isAdmin ? 'Configuración y Logs' : 'Cuenta y Tema',
      icon: Settings,
    });
    return items;
  }, [canAccessPos, canAccessLayaways, canAccessCustomers, canAccessInventory, isAdmin]);

  useEffect(() => {
    if (!navItems.some((item) => item.id === activeTab)) {
      setActiveTab(navItems[0]?.id || 'settings');
    }
  }, [navItems, activeTab]);

  useEffect(() => {
    if (!profile || !canReadProducts) {
      setProducts([]);
      setLoadingProducts(false);
      return;
    }

    setLoadingProducts(true);
    const unsub = inventoryService.subscribeProducts(
      (list) => {
        setProducts(list);
        setLoadingProducts(false);
      },
      (err) => {
        setLoadingProducts(false);
        console.error(err);
      }
    );

    return () => unsub();
  }, [profile?.id, canReadProducts]);

  useEffect(() => {
    if (!profile || !canReadCustomers) {
      setCustomers([]);
      setLoadingCustomers(false);
      return;
    }

    setLoadingCustomers(true);
    const unsub = customerService.subscribeCustomers(
      (list) => {
        setCustomers(list);
        setLoadingCustomers(false);
      },
      (err) => {
        setLoadingCustomers(false);
        console.error(err);
      }
    );

    return () => unsub();
  }, [profile?.id, canReadCustomers]);

  if (!profile) return null;

  const activeNav = navItems.find((i) => i.id === activeTab) || navItems[0];
  const isDark = profile.modoOscuro;
  const roleLabel = USER_ROLE_LABELS[profile.rol];

  const handleSelectTab = (tab: ModuleTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <div className="min-h-screen flex bg-stone-50 dark:bg-zinc-950 text-stone-900 dark:text-zinc-100">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-r border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 no-print">
        <div className="h-16 px-5 flex items-center gap-2.5 border-b border-stone-200 dark:border-zinc-800">
          {branding.companyLogoUrl && (
            <img
              src={branding.companyLogoUrl}
              alt={companyName}
              referrerPolicy="no-referrer"
              className="h-8 w-8 rounded-md object-contain bg-white border border-stone-200 dark:border-zinc-700 p-0.5 shrink-0"
            />
          )}
          <span className="font-display text-2xl font-semibold tracking-tight text-stone-900 dark:text-zinc-50 truncate">
            {companyName}
          </span>
        </div>

        <nav className="flex-1 px-3 py-5 space-y-1" aria-label="Navegación principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? 'bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                    : 'text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800/70 hover:text-stone-900 dark:hover:text-zinc-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-stone-200 dark:border-zinc-800 space-y-2.5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-stone-100 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 flex items-center justify-center text-xs font-semibold shrink-0">
              {getInitials(profile.nombreCompleto)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-stone-900 dark:text-zinc-100 truncate">
                {profile.nombreCompleto}
              </p>
              <p className="text-[11px] text-stone-500 dark:text-zinc-400 truncate">
                <span className="font-mono-tabular">@{profile.usuario}</span> ·{' '}
                {isAdmin
                  ? operatingScope === 'general'
                    ? 'General'
                    : getBranchName(operatingScope)
                  : getBranchName(profile.sucursalAsignada)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-800 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <span>{isDark ? 'Modo Oscuro' : 'Modo Claro'}</span>
            {isDark ? (
              <Moon className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Sun className="w-3.5 h-3.5 text-amber-700" />
            )}
          </button>

          <button
            type="button"
            onClick={() => void logout()}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-800 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-red-50 hover:text-red-700 hover:border-red-200 dark:hover:bg-red-950/40 dark:hover:text-red-300 dark:hover:border-red-900/50 transition-colors cursor-pointer"
          >
            <span>Cerrar sesión / Cambiar</span>
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-black/50"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-50 w-72 max-w-[85vw] flex flex-col bg-white dark:bg-zinc-900 border-r border-stone-200 dark:border-zinc-800 h-full">
            <div className="h-16 px-5 flex items-center justify-between border-b border-stone-200 dark:border-zinc-800">
              <div className="flex items-center gap-2.5 min-w-0">
                {branding.companyLogoUrl && (
                  <img
                    src={branding.companyLogoUrl}
                    alt={companyName}
                    referrerPolicy="no-referrer"
                    className="h-7 w-7 rounded-md object-contain bg-white border border-stone-200 dark:border-zinc-700 p-0.5 shrink-0"
                  />
                )}
                <span className="font-display text-2xl font-semibold text-stone-900 dark:text-zinc-50 truncate">
                  {companyName}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <nav className="flex-1 p-3 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectTab(item.id)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      active
                        ? 'bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'text-stone-600 dark:text-zinc-400 hover:bg-stone-100 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-4 border-t border-stone-200 dark:border-zinc-800 space-y-2.5">
              <div className="text-xs">
                <p className="font-semibold text-stone-900 dark:text-zinc-100 truncate">
                  {profile.nombreCompleto}
                </p>
                <p className="text-stone-500 dark:text-zinc-400 truncate">
                  <span className="font-mono-tabular">@{profile.usuario}</span> · {roleLabel} ·{' '}
                  {isAdmin
                    ? operatingScope === 'general'
                      ? 'General'
                      : getBranchName(operatingScope)
                    : getBranchName(profile.sucursalAsignada)}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleTheme}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-800 text-xs font-medium text-stone-700 dark:text-zinc-300"
              >
                <span>{isDark ? 'Modo Oscuro' : 'Modo Claro'}</span>
                {isDark ? <Moon className="w-3.5 h-3.5" /> : <Sun className="w-3.5 h-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg border border-stone-200 dark:border-zinc-800 text-xs font-medium text-red-600 dark:text-red-400"
              >
                <span>Cerrar sesión / Cambiar</span>
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-4 sm:px-6 lg:px-8 border-b border-stone-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-900/90 backdrop-blur-xs flex items-center justify-between gap-4 no-print">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 -ml-2 rounded-lg text-stone-600 dark:text-zinc-300 hover:bg-stone-100 dark:hover:bg-zinc-800"
              aria-label="Abrir menú"
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-stone-400 dark:text-zinc-500 hidden sm:inline truncate max-w-48">
                {companyName}
              </span>
              <span className="text-stone-300 dark:text-zinc-700 hidden sm:inline" aria-hidden="true">
                /
              </span>
              <span className="font-medium text-stone-900 dark:text-zinc-100 truncate">
                {activeNav?.label}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs text-stone-500 dark:text-zinc-400 whitespace-nowrap shrink-0">
            <span>
              {isAdmin
                ? operatingScope === 'general'
                  ? 'General (Sistema entero)'
                  : `Operando: ${getBranchName(operatingScope)}`
                : getBranchName(profile.sucursalAsignada)}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-medium text-stone-800 dark:text-zinc-200">{roleLabel}</span>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1440px] w-full mx-auto">
          {activeTab === 'dashboard' && isAdmin && (
            <AdminDashboardView
              products={products}
              loadingProducts={loadingProducts}
              onNavigate={(tab) => setActiveTab(tab)}
            />
          )}
          {activeTab === 'pos' && canAccessPos && (
            <PosView
              products={products}
              loadingProducts={loadingProducts}
              customers={customers}
              onGoToInventory={canAccessInventory ? () => setActiveTab('inventory') : undefined}
            />
          )}
          {activeTab === 'layaways' && canAccessLayaways && (
            <LayawaysView products={products} customers={customers} />
          )}
          {activeTab === 'customers' && canAccessCustomers && (
            <CustomersView
              customers={customers}
              loading={loadingCustomers}
              onGoToLayaways={canAccessLayaways ? () => setActiveTab('layaways') : undefined}
            />
          )}
          {activeTab === 'inventory' && canAccessInventory && (
            <InventoryView products={products} loading={loadingProducts} />
          )}
          {activeTab === 'catalog_branches' && isAdmin && (
            <CatalogBranchesAdminView products={products} />
          )}
          {activeTab === 'users' && isAdmin && <UsersView />}
          {activeTab === 'settings' && <SettingsLogsView />}
        </main>
      </div>
    </div>
  );
}
