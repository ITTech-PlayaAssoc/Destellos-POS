import React, { useState } from 'react';
import { ChevronDown, ChevronUp, FileText, UserPlus, X } from 'lucide-react';
import { customerService } from '../services/dataProvider';
import { truncateStr } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import {
  CFDI_USAGES,
  FIELD_LIMITS,
  FISCAL_REGIMES,
  type BranchId,
  type Customer,
  type CustomerFiscalData,
} from '../types/boutique';

interface CustomerQuickModalProps {
  editingCustomer?: Customer | null;
  activeBranch?: BranchId;
  onClose: () => void;
  onSaved: (customer: Customer, isEdit: boolean) => void;
}

export function CustomerQuickModal({
  editingCustomer = null,
  activeBranch,
  onClose,
  onSaved,
}: CustomerQuickModalProps) {
  const { profile, operatingScope, getBranchName } = useAuth();
  const isEdit = Boolean(editingCustomer);

  const [nombreCompleto, setNombreCompleto] = useState(editingCustomer?.nombreCompleto || '');
  const [telefono, setTelefono] = useState(editingCustomer?.telefono || '');
  const [email, setEmail] = useState(editingCustomer?.email || '');
  const [fechaEvento, setFechaEvento] = useState(editingCustomer?.fechaEvento || '');
  const [notas, setNotas] = useState(editingCustomer?.notas || '');

  const existingFiscal = editingCustomer?.datosFiscales;
  const hasExistingFiscal = Boolean(
    existingFiscal?.rfc ||
      existingFiscal?.razonSocial ||
      existingFiscal?.codigoPostal ||
      existingFiscal?.regimenFiscal ||
      existingFiscal?.usoCfdi
  );
  const [showFiscal, setShowFiscal] = useState(hasExistingFiscal);
  const [rfc, setRfc] = useState(existingFiscal?.rfc || '');
  const [razonSocial, setRazonSocial] = useState(existingFiscal?.razonSocial || '');
  const [codigoPostal, setCodigoPostal] = useState(existingFiscal?.codigoPostal || '');
  const [regimenFiscal, setRegimenFiscal] = useState(existingFiscal?.regimenFiscal || '');
  const [usoCfdi, setUsoCfdi] = useState(existingFiscal?.usoCfdi || '');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  const logBranchId: BranchId =
    activeBranch ||
    (operatingScope !== 'general' ? operatingScope : profile.sucursalAsignada);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = truncateStr(nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX);
    const cleanPhone = truncateStr(telefono, FIELD_LIMITS.PHONE_MAX);
    const cleanEmail = truncateStr(email, FIELD_LIMITS.EMAIL_MAX);
    const cleanEventDate = truncateStr(fechaEvento, FIELD_LIMITS.EVENT_DATE_MAX);
    const cleanNotes = truncateStr(notas, FIELD_LIMITS.NOTES_MAX);

    if (!cleanName) {
      setError('El nombre completo del cliente es obligatorio.');
      return;
    }
    if (!cleanPhone) {
      setError('El teléfono / WhatsApp es obligatorio para dar seguimiento.');
      return;
    }

    const fiscalData: CustomerFiscalData = {
      rfc: truncateStr(rfc.toUpperCase().replace(/\s+/g, ''), FIELD_LIMITS.RFC_MAX),
      razonSocial: truncateStr(razonSocial, FIELD_LIMITS.RAZON_SOCIAL_MAX),
      codigoPostal: truncateStr(codigoPostal.replace(/\s+/g, ''), FIELD_LIMITS.CP_MAX),
      regimenFiscal: truncateStr(regimenFiscal, FIELD_LIMITS.REGIMEN_MAX),
      usoCfdi: truncateStr(usoCfdi, FIELD_LIMITS.CFDI_MAX),
    };

    setSaving(true);
    try {
      const branchName = getBranchName(logBranchId);
      const actor = {
        id: profile.id,
        nombreCompleto: profile.nombreCompleto,
        usuario: profile.usuario,
        sucursalAsignada: profile.sucursalAsignada,
      };
      const formPayload = {
        nombreCompleto: cleanName,
        telefono: cleanPhone,
        email: cleanEmail,
        fechaEvento: cleanEventDate,
        notas: cleanNotes,
        datosFiscales: fiscalData,
      };

      if (isEdit && editingCustomer) {
        const updated = await customerService.updateCustomer(
          editingCustomer,
          formPayload,
          logBranchId,
          branchName,
          actor
        );
        onSaved(updated, true);
      } else {
        const created = await customerService.createCustomer(
          formPayload,
          logBranchId,
          branchName,
          actor
        );
        onSaved(created, false);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'No se pudo guardar el expediente del cliente.'
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
      <div className="w-full max-w-xl rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <UserPlus className="w-4 h-4 text-amber-700 dark:text-amber-400" />
            <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              {isEdit ? 'Editar Expediente de Cliente' : 'Registrar Nuevo Cliente'}
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

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-2.5 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Nombre completo *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.DISPLAY_NAME_MAX}
                value={nombreCompleto}
                onChange={(e) => setNombreCompleto(e.target.value)}
                placeholder="Ej. Valeria Mendoza López"
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Teléfono / WhatsApp *
              </label>
              <input
                type="tel"
                required
                maxLength={FIELD_LIMITS.PHONE_MAX}
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder="Ej. 33 1234 5678"
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Fecha del evento (opcional, XV años)
              </label>
              <input
                type="date"
                value={fechaEvento}
                onChange={(e) => setFechaEvento(e.target.value)}
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
              Correo electrónico (opcional)
            </label>
            <input
              type="email"
              maxLength={FIELD_LIMITS.EMAIL_MAX}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cliente@correo.com"
              className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
              Notas de seguimiento (tallas, medidas, preferencias)
            </label>
            <textarea
              rows={2}
              maxLength={FIELD_LIMITS.NOTES_MAX}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Ej. Prefiere tonos champagne / ajuste de corsé pendiente..."
              className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
            />
          </div>

          {/* Collapsible Optional Fiscal Data */}
          <div className="rounded-lg border border-stone-200 dark:border-zinc-800 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowFiscal((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-stone-50 dark:bg-zinc-950/70 text-xs font-medium text-stone-800 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
            >
              <span className="inline-flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                <span>Datos Fiscales para Facturación (opcional)</span>
              </span>
              {showFiscal ? (
                <ChevronUp className="w-4 h-4 text-stone-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-stone-500" />
              )}
            </button>

            {showFiscal && (
              <div className="p-4 space-y-3 border-t border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                      RFC
                    </label>
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.RFC_MAX}
                      value={rfc}
                      onChange={(e) => setRfc(e.target.value.toUpperCase())}
                      placeholder="Ej. XAXX010101000"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-mono-tabular text-stone-900 dark:text-zinc-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                      Código Postal fiscal
                    </label>
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.CP_MAX}
                      value={codigoPostal}
                      onChange={(e) => setCodigoPostal(e.target.value)}
                      placeholder="Ej. 44100"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs font-mono-tabular text-stone-900 dark:text-zinc-100"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                    Razón Social / Nombre fiscal
                  </label>
                  <input
                    type="text"
                    maxLength={FIELD_LIMITS.RAZON_SOCIAL_MAX}
                    value={razonSocial}
                    onChange={(e) => setRazonSocial(e.target.value)}
                    placeholder="Ej. Valeria Mendoza López"
                    className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                      Régimen Fiscal
                    </label>
                    <select
                      value={regimenFiscal}
                      onChange={(e) => setRegimenFiscal(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100"
                    >
                      <option value="">Sin especificar</option>
                      {FISCAL_REGIMES.filter(Boolean).map((reg) => (
                        <option key={reg} value={reg}>
                          {reg}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                      Uso de CFDI
                    </label>
                    <select
                      value={usoCfdi}
                      onChange={(e) => setUsoCfdi(e.target.value)}
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-xs text-stone-900 dark:text-zinc-100"
                    >
                      <option value="">Sin especificar</option>
                      {CFDI_USAGES.filter(Boolean).map((uso) => (
                        <option key={uso} value={uso}>
                          {uso}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
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
              {saving ? 'Guardando...' : isEdit ? 'Guardar cambios' : 'Registrar cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
