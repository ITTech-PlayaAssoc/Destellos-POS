import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Barcode,
  ClipboardList,
  Globe,
  Image as ImageIcon,
  LogOut,
  Monitor,
  Moon,
  Printer,
  RotateCcw,
  Save,
  ScanBarcode,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import { authService, logService } from '../services/dataProvider';
import {
  formatDateInputValue,
  formatDateTime,
  getInitials,
  truncateStr,
} from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import {
  STICKER_SIZE_DIMENSIONS,
  TICKET_WIDTH_LABELS,
  useHardware,
  type PosScanActionOption,
  type StickerSizeOption,
  type TicketWidthOption,
} from '../context/HardwareContext';
import {
  ACTION_TYPE_LABELS,
  FIELD_LIMITS,
  USER_ROLE_LABELS,
  type ActionType,
  type AuditLog,
  type OperatingScope,
  type Product,
} from '../types/boutique';
import { ThermalTicketModal } from './ThermalTicketModal';
import { BarcodeModal } from './BarcodeModal';

export function SettingsLogsView() {
  const {
    profile,
    branchList,
    branding,
    operatingScope,
    setOperatingScope,
    toggleTheme,
    logout,
    getBranchName,
  } = useAuth();

  const { hardware, updateHardware, resetHardware } = useHardware();

  const isAdmin = profile?.rol === 'admin';
  const isGeneralScope = operatingScope === 'general';
  const [savingScope, setSavingScope] = useState(false);

  // Test hardware print modals
  const [showTestTicket, setShowTestTicket] = useState(false);
  const [showTestLabel, setShowTestLabel] = useState(false);

  // Branding editing state (Admin only)
  const [companyNameInput, setCompanyNameInput] = useState(branding.companyName);
  const [companyLogoInput, setCompanyLogoInput] = useState(branding.companyLogoUrl);
  const [savingBranding, setSavingBranding] = useState(false);
  const [brandingToast, setBrandingToast] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const logoFileInputRef = useRef<HTMLInputElement>(null);

  // Audit logs state (Admin only)
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [filterUser, setFilterUser] = useState('');
  const [filterBranch, setFilterBranch] = useState<string>('all');
  const [filterAction, setFilterAction] = useState<string>('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  useEffect(() => {
    setCompanyNameInput(branding.companyName);
    setCompanyLogoInput(branding.companyLogoUrl);
  }, [branding.companyName, branding.companyLogoUrl]);

  useEffect(() => {
    if (!isAdmin) return;
    setFilterBranch(operatingScope === 'general' ? 'all' : operatingScope);
  }, [isAdmin, operatingScope]);

  useEffect(() => {
    if (!isAdmin) return;
    setLoadingLogs(true);
    const unsub = logService.subscribeLogs(
      250,
      (list) => {
        setLogs(list);
        setLoadingLogs(false);
      },
      (err) => {
        setLoadingLogs(false);
        console.error(err);
      }
    );
    return () => unsub();
  }, [isAdmin]);

  const getLogUserIdentifier = (log: AuditLog): string =>
    log.userUsuario || log.userEmail || log.userUid || 'sistema';

  const uniqueUsersInLogs = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of logs) {
      const id = getLogUserIdentifier(l);
      if (!map.has(id)) {
        map.set(id, l.userName);
      }
    }
    return Array.from(map.entries()).map(([identifier, name]) => ({ identifier, name }));
  }, [logs]);

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (filterUser && getLogUserIdentifier(log) !== filterUser) return false;
      if (filterBranch !== 'all' && log.branchId !== filterBranch) return false;
      if (filterAction !== 'all' && log.actionType !== filterAction) return false;

      if (filterDateFrom || filterDateTo) {
        const logDate = formatDateInputValue(log.createdAt);
        if (!logDate) return false;
        if (filterDateFrom && logDate < filterDateFrom) return false;
        if (filterDateTo && logDate > filterDateTo) return false;
      }

      return true;
    });
  }, [logs, filterUser, filterBranch, filterAction, filterDateFrom, filterDateTo]);

  if (!profile) return null;

  const isDark = profile.modoOscuro;

  const handleLogoFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBrandingToast(null);

    if (!file.type.startsWith('image/')) {
      setBrandingToast({
        type: 'error',
        text: 'Selecciona un archivo de imagen válido (PNG, JPG, WebP o SVG).',
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) return;

      const img = new window.Image();
      img.onload = () => {
        const maxDim = 240;
        let width = img.width || maxDim;
        let height = img.height || maxDim;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.max(1, Math.round(width * ratio));
          height = Math.max(1, Math.round(height * ratio));
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL('image/png');
        if (dataUrl.length > FIELD_LIMITS.COMPANY_LOGO_MAX) {
          dataUrl = canvas.toDataURL('image/webp', 0.85);
        }
        if (dataUrl.length > FIELD_LIMITS.COMPANY_LOGO_MAX) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        }
        if (dataUrl.length > FIELD_LIMITS.COMPANY_LOGO_MAX) {
          setBrandingToast({
            type: 'error',
            text: 'La imagen es demasiado pesada incluso comprimida. Intenta con un archivo más pequeño o una URL.',
          });
          return;
        }
        setCompanyLogoInput(dataUrl);
      };
      img.onerror = () => {
        setBrandingToast({ type: 'error', text: 'No se pudo procesar la imagen seleccionada.' });
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    const cleanName = truncateStr(companyNameInput, FIELD_LIMITS.COMPANY_NAME_MAX);
    const cleanLogo = companyLogoInput.trim();

    if (!cleanName) {
      setBrandingToast({ type: 'error', text: 'El nombre de la empresa es obligatorio.' });
      return;
    }
    if (cleanLogo.length > FIELD_LIMITS.COMPANY_LOGO_MAX) {
      setBrandingToast({
        type: 'error',
        text: 'El logotipo excede el tamaño máximo permitido.',
      });
      return;
    }

    setSavingBranding(true);
    setBrandingToast(null);
    try {
      await authService.updateBranding(
        {
          companyName: cleanName,
          companyLogoUrl: cleanLogo,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );

      setBrandingToast({
        type: 'success',
        text: 'Nombre y logotipo de la empresa guardados en tiempo real.',
      });
      setTimeout(() => setBrandingToast(null), 4500);
    } catch (err) {
      setBrandingToast({
        type: 'error',
        text: err instanceof Error ? err.message : 'No se pudo guardar la identidad de la empresa.',
      });
    } finally {
      setSavingBranding(false);
    }
  };

  const clearLogFilters = () => {
    setFilterUser('');
    setFilterBranch('all');
    setFilterAction('all');
    setFilterDateFrom('');
    setFilterDateTo('');
  };

  const activeTestBranchId =
    operatingScope !== 'general'
      ? operatingScope
      : profile.sucursalAsignada || branchList[0]?.id || 'branch_1';

  const testCalibrationProduct: Product = {
    id: 'calibration-label-test',
    sku: 'PRUEBA-001-M-DOR',
    barcodeSKU: 'PRUEBA-001-M-DOR',
    name: 'Vestido Prueba Calibración',
    category: 'Prueba',
    size: 'M',
    color: 'Dorado',
    price: 4500,
    stock: { [activeTestBranchId]: 1 },
    createdByUid: profile.id,
  };

  return (
    <div className="space-y-8">
      <div className={showTestTicket || showTestLabel ? 'space-y-8 no-print' : 'space-y-8'}>
      <div>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-zinc-100 tracking-tight">
          Configuración y Bitácora
        </h1>
        <p className="text-sm text-stone-600 dark:text-zinc-400 mt-1">
          Preferencias de tu perfil, identidad de la boutique y registro de auditoría.
        </p>
      </div>

      {/* User Preferences & Account Section */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col justify-between space-y-5">
          <div className="space-y-5">
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              Cuenta Activa
            </h2>

            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-stone-100 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 flex items-center justify-center text-sm font-semibold text-stone-700 dark:text-zinc-200 shrink-0">
                {getInitials(profile.nombreCompleto)}
              </div>

              <div className="min-w-0">
                <p className="text-base font-semibold text-stone-900 dark:text-zinc-100 truncate">
                  {profile.nombreCompleto}
                </p>
                <p className="text-xs text-stone-500 dark:text-zinc-400 font-mono-tabular truncate">
                  @{profile.usuario}
                </p>
                <p className="text-xs text-stone-600 dark:text-zinc-300 mt-1">
                  Rol: <span className="font-medium">{USER_ROLE_LABELS[profile.rol]}</span>
                  <span className="mx-1.5" aria-hidden="true">
                    ·
                  </span>
                  Sucursal asignada:{' '}
                  <span className="font-medium">{getBranchName(profile.sucursalAsignada)}</span>
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-stone-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-stone-500 dark:text-zinc-400">
              Sesión interna persistida en este equipo.
            </span>
            <button
              type="button"
              onClick={() => void logout()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-800 dark:text-zinc-100 hover:bg-red-50 hover:text-red-700 hover:border-red-200 dark:hover:bg-red-950/40 dark:hover:text-red-300 dark:hover:border-red-900/50 transition-colors cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Cerrar sesión / Cambiar de usuario</span>
            </button>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 flex flex-col justify-between space-y-5">
          <div>
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              Apariencia Personal
            </h2>
            <p className="text-xs text-stone-500 dark:text-zinc-400 mt-1 leading-relaxed">
              Esta preferencia se guarda de forma individual en tu cuenta para conservar tu tema en cualquier equipo.
            </p>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={isDark}
            onClick={toggleTheme}
            className="flex items-center justify-between gap-4 rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50 dark:bg-zinc-950 p-4 hover:border-stone-300 dark:hover:border-zinc-700 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3 text-left">
              {isDark ? (
                <Moon className="w-5 h-5 text-amber-400 shrink-0" />
              ) : (
                <Sun className="w-5 h-5 text-amber-700 shrink-0" />
              )}
              <div>
                <p className="text-sm font-medium text-stone-900 dark:text-zinc-100">
                  {isDark ? 'Modo Oscuro activo' : 'Modo Claro activo'}
                </p>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Haz clic para cambiar a {isDark ? 'Modo Claro' : 'Modo Oscuro'}
                </p>
              </div>
            </div>

            <span
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                isDark ? 'bg-amber-600' : 'bg-stone-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isDark ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </span>
          </button>
        </div>
      </section>

      {/* Local Terminal Cash Register Hardware Configuration */}
      <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <Monitor className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Configuración de Hardware de Caja (Local)
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                Preferencias guardadas en este equipo para impresoras térmicas de tickets, rollos de etiquetas adhesivas y lector de código de barras.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={resetHardware}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors self-start sm:self-auto cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Restaurar valores</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Ticket Printer Width */}
          <div>
            <label
              htmlFor="hw-ticket-width"
              className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5"
            >
              Ancho de impresora de tickets
            </label>
            <select
              id="hw-ticket-width"
              value={hardware.ticketWidth}
              onChange={(e) =>
                updateHardware({ ticketWidth: e.target.value as TicketWidthOption })
              }
              className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
            >
              {(Object.keys(TICKET_WIDTH_LABELS) as TicketWidthOption[]).map((opt) => (
                <option key={opt} value={opt}>
                  {TICKET_WIDTH_LABELS[opt]}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-1.5">
              Aplica a tickets de venta, recibos de apartado/abono y reportes de corte de caja.
            </p>
          </div>

          {/* Adhesive Sticker Size */}
          <div>
            <label
              htmlFor="hw-sticker-size"
              className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5"
            >
              Tamaño de etiqueta adhesiva (Stickers)
            </label>
            <select
              id="hw-sticker-size"
              value={hardware.stickerSize}
              onChange={(e) =>
                updateHardware({ stickerSize: e.target.value as StickerSizeOption })
              }
              className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
            >
              {(Object.keys(STICKER_SIZE_DIMENSIONS) as StickerSizeOption[]).map((opt) => (
                <option key={opt} value={opt}>
                  {STICKER_SIZE_DIMENSIONS[opt].label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-1.5">
              Ajusta las dimensiones exactas @page del rollo térmico al imprimir etiquetas CODE128.
            </p>
          </div>

          {/* Global Barcode Scanner Mode */}
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 p-4 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <ScanBarcode className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-stone-900 dark:text-zinc-100">
                  Captura Global de Lector de Códigos
                </p>
                <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5 leading-relaxed">
                  Detecta escaneos rápidos USB/Bluetooth en Caja, Inventario y Apartados aunque el cursor no esté dentro del buscador.
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={hardware.globalScannerEnabled}
              onClick={() =>
                updateHardware({ globalScannerEnabled: !hardware.globalScannerEnabled })
              }
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                hardware.globalScannerEnabled ? 'bg-amber-600' : 'bg-stone-300 dark:bg-zinc-700'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  hardware.globalScannerEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* POS Scan Action */}
          <div>
            <label
              htmlFor="hw-pos-scan-action"
              className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5"
            >
              Acción al escanear en Punto de Venta (POS)
            </label>
            <select
              id="hw-pos-scan-action"
              value={hardware.posScanAction}
              onChange={(e) =>
                updateHardware({ posScanAction: e.target.value as PosScanActionOption })
              }
              className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
            >
              <option value="add_to_cart">Agregar al carrito automáticamente</option>
              <option value="show_detail">Mostrar detalle</option>
            </select>
            <p className="text-[11px] text-stone-500 dark:text-zinc-400 mt-1.5">
              Define si el lector suma la prenda directo al cobro o abre primero su ficha de verificación.
            </p>
          </div>
        </div>

        {/* Printer Calibration Test Buttons */}
        <div className="pt-4 border-t border-stone-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-stone-500 dark:text-zinc-400">
            Calibra las impresoras de esta sucursal antes de iniciar turno:
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowTestTicket(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-800 dark:text-zinc-100 hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir Ticket de Prueba</span>
            </button>
            <button
              type="button"
              onClick={() => setShowTestLabel(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-xs font-medium transition-colors cursor-pointer"
            >
              <Barcode className="w-3.5 h-3.5" />
              <span>Imprimir Etiqueta de Prueba</span>
            </button>
          </div>
        </div>
      </section>

      {/* Admin: Operating Scope Selector (Branch or General) */}
      {isAdmin && (
        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Globe className="w-5 h-5 text-amber-700 dark:text-amber-400" />
              <div>
                <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                  Sucursal de Operación / Modo General
                </h2>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Elige una sucursal específica para operarla en caja, inventario y bitácora, o selecciona «General» para aplicar cambios globales al sistema entero.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {(
              [
                {
                  id: 'general' as OperatingScope,
                  title: 'General (Sistema entero)',
                  subtitle: 'Identidad global y todas las sucursales',
                },
                ...branchList.map((b) => ({
                  id: b.id as OperatingScope,
                  title: b.name,
                  subtitle: b.city || 'Operación de sucursal',
                })),
              ]
            ).map((opt) => {
              const selected = operatingScope === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={savingScope}
                  onClick={async () => {
                    setSavingScope(true);
                    try {
                      await setOperatingScope(opt.id);
                    } finally {
                      setSavingScope(false);
                    }
                  }}
                  className={`rounded-lg border p-3.5 text-left transition-colors cursor-pointer disabled:opacity-60 ${
                    selected
                      ? 'border-stone-900 bg-stone-900 text-white dark:border-amber-500 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-stone-900 dark:text-zinc-100 hover:border-stone-300 dark:hover:border-zinc-700'
                  }`}
                >
                  <p className="text-sm font-semibold truncate">{opt.title}</p>
                  <p
                    className={`text-xs mt-0.5 truncate ${
                      selected
                        ? 'text-stone-300 dark:text-zinc-600'
                        : 'text-stone-500 dark:text-zinc-400'
                    }`}
                  >
                    {opt.subtitle}
                  </p>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Admin: Company Identity (Name & Logo) */}
      {isAdmin && !isGeneralScope && (
        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="text-xs text-stone-600 dark:text-zinc-400">
            Estás operando en{' '}
            <span className="font-semibold text-stone-900 dark:text-zinc-100">
              {getBranchName(operatingScope)}
            </span>
            . Para editar el nombre comercial o logotipo de la empresa, cambia al modo General.
          </div>
          <button
            type="button"
            onClick={() => setOperatingScope('general')}
            className="px-3.5 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-800 dark:text-zinc-100 hover:bg-stone-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
          >
            Cambiar a modo General
          </button>
        </section>
      )}

      {isAdmin && isGeneralScope && (
        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5">
          <div className="flex items-center gap-2.5">
            <ImageIcon className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Identidad de la Empresa
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                Personaliza el nombre comercial y el logotipo que aparecen en el inicio de sesión, barra lateral y tickets de venta.
              </p>
            </div>
          </div>

          {brandingToast && (
            <div
              className={`rounded-lg border px-4 py-2.5 text-sm ${
                brandingToast.type === 'success'
                  ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                  : 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
              }`}
            >
              {brandingToast.text}
            </div>
          )}

          <form onSubmit={handleSaveBranding} className="space-y-5">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              <div className="lg:col-span-5">
                <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                  Nombre de la empresa / boutique *
                </label>
                <input
                  type="text"
                  required
                  maxLength={FIELD_LIMITS.COMPANY_NAME_MAX}
                  value={companyNameInput}
                  onChange={(e) => setCompanyNameInput(e.target.value)}
                  placeholder="Ej. Casa Gala XV"
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                />
              </div>

              <div className="lg:col-span-7 space-y-2.5">
                <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300">
                  Logo de la empresa (archivo o URL)
                </label>
                <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
                  <div className="w-14 h-14 rounded-lg border border-stone-200 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 flex items-center justify-center shrink-0 overflow-hidden">
                    {companyLogoInput ? (
                      <img
                        src={companyLogoInput}
                        alt="Vista previa del logotipo"
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-contain p-1 bg-white"
                      />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-stone-400 dark:text-zinc-600" />
                    )}
                  </div>

                  <div className="flex-1 flex flex-col sm:flex-row gap-2">
                    <input
                      ref={logoFileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoFileSelect}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => logoFileInputRef.current?.click()}
                      className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-800 dark:text-zinc-100 hover:bg-stone-50 dark:hover:bg-zinc-800 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Subir imagen</span>
                    </button>

                    <input
                      type="text"
                      value={companyLogoInput.startsWith('data:image/') ? '' : companyLogoInput}
                      onChange={(e) => setCompanyLogoInput(e.target.value)}
                      placeholder={
                        companyLogoInput.startsWith('data:image/')
                          ? 'Imagen cargada desde archivo'
                          : 'O pega la URL del logotipo (https://...)'
                      }
                      className="flex-1 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                    />

                    {companyLogoInput && (
                      <button
                        type="button"
                        onClick={() => setCompanyLogoInput('')}
                        className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Quitar</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingBranding}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{savingBranding ? 'Guardando...' : 'Guardar identidad'}</span>
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Admin: Read-only Chronological Audit Logs */}
      {isAdmin && (
        <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
          <div className="p-6 border-b border-stone-200 dark:border-zinc-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ClipboardList className="w-5 h-5 text-amber-700 dark:text-amber-400" />
                <div>
                  <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                    Bitácora de Auditoría (Solo lectura)
                  </h2>
                  <p className="text-xs text-stone-500 dark:text-zinc-400">
                    Registro inmutable de inicios/cierres de sesión, altas, ajustes de stock, permisos, folios y ventas.
                  </p>
                </div>
              </div>

              {(filterUser ||
                filterBranch !== 'all' ||
                filterAction !== 'all' ||
                filterDateFrom ||
                filterDateTo) && (
                <button
                  type="button"
                  onClick={clearLogFilters}
                  className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline cursor-pointer self-start sm:self-auto"
                >
                  Limpiar filtros
                </button>
              )}
            </div>

            {/* Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-stone-500 dark:text-zinc-400 mb-1">
                  Usuario
                </label>
                <select
                  value={filterUser}
                  onChange={(e) => setFilterUser(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100"
                >
                  <option value="">Todos los usuarios</option>
                  {uniqueUsersInLogs.map((u) => (
                    <option key={u.identifier} value={u.identifier}>
                      {u.name} (@{u.identifier})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-stone-500 dark:text-zinc-400 mb-1">
                  Sucursal
                </label>
                <select
                  value={filterBranch}
                  onChange={(e) => setFilterBranch(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100"
                >
                  <option value="all">Todas las sucursales</option>
                  {branchList.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-stone-500 dark:text-zinc-400 mb-1">
                  Tipo de acción
                </label>
                <select
                  value={filterAction}
                  onChange={(e) => setFilterAction(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100"
                >
                  <option value="all">Todas las acciones</option>
                  {(Object.keys(ACTION_TYPE_LABELS) as ActionType[]).map((key) => (
                    <option key={key} value={key}>
                      {ACTION_TYPE_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-stone-500 dark:text-zinc-400 mb-1">
                  Fecha desde
                </label>
                <input
                  type="date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-mono-tabular text-stone-900 dark:text-zinc-100"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-stone-500 dark:text-zinc-400 mb-1">
                  Fecha hasta
                </label>
                <input
                  type="date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-mono-tabular text-stone-900 dark:text-zinc-100"
                />
              </div>
            </div>
          </div>

          {loadingLogs ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-10 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse" />
              ))}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-stone-500 dark:text-zinc-400">
              No hay registros de auditoría que coincidan con los filtros seleccionados.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-xs font-medium text-stone-500 dark:text-zinc-400">
                    <th className="py-3 px-4 whitespace-nowrap">Fecha y hora</th>
                    <th className="py-3 px-4">Usuario</th>
                    <th className="py-3 px-4 whitespace-nowrap">Sucursal</th>
                    <th className="py-3 px-4 whitespace-nowrap">Acción</th>
                    <th className="py-3 px-4">Descripción detallada</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/80 text-xs">
                  {filteredLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="hover:bg-stone-50/80 dark:hover:bg-zinc-800/40 transition-colors"
                    >
                      <td className="py-3 px-4 font-mono-tabular text-stone-600 dark:text-zinc-400 whitespace-nowrap align-top">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="py-3 px-4 align-top">
                        <div className="font-medium text-stone-900 dark:text-zinc-100">
                          {log.userName}
                        </div>
                        <div className="font-mono-tabular text-stone-500 dark:text-zinc-400">
                          @{log.userUsuario || log.userEmail || 'usuario'}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-stone-700 dark:text-zinc-300 whitespace-nowrap align-top">
                        {log.branchId === 'all' ? 'Todas' : getBranchName(log.branchId)}
                      </td>
                      <td className="py-3 px-4 font-medium text-stone-900 dark:text-zinc-100 whitespace-nowrap align-top">
                        {ACTION_TYPE_LABELS[log.actionType] || log.actionType}
                      </td>
                      <td className="py-3 px-4 text-stone-600 dark:text-zinc-300 leading-relaxed min-w-64 align-top">
                        {log.description}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      </div>

      {showTestTicket && (
        <ThermalTicketModal
          document={{
            type: 'test_ticket',
            branchId: activeTestBranchId,
            branchName: getBranchName(activeTestBranchId),
            operatorName: profile.nombreCompleto,
          }}
          onClose={() => setShowTestTicket(false)}
        />
      )}

      {showTestLabel && (
        <BarcodeModal
          product={testCalibrationProduct}
          initialCopies={1}
          isTestLabel
          onClose={() => setShowTestLabel(false)}
        />
      )}
    </div>
  );
}
