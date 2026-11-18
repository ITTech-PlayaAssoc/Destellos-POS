import React, { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Check,
  Edit3,
  FolderPlus,
  Plus,
  Save,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import { inventoryService } from '../services/dataProvider';
import { generateId, truncateStr } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { FIELD_LIMITS, type BranchInfo, type Product } from '../types/boutique';

interface CatalogBranchesAdminViewProps {
  products: Product[];
}

function getNextBranchId(existing: BranchInfo[]): string {
  let maxNum = 0;
  for (const b of existing) {
    const match = /^branch_(\d+)$/.exec(b.id);
    if (match) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > maxNum) maxNum = n;
    }
  }
  const candidate = `branch_${Math.max(maxNum + 1, existing.length + 1)}`;
  if (!existing.some((b) => b.id === candidate)) return candidate;
  return generateId('branch');
}

export function CatalogBranchesAdminView({ products }: CatalogBranchesAdminViewProps) {
  const {
    profile,
    branchList,
    categories,
    operatingScope,
    setOperatingScope,
  } = useAuth();

  // Category state
  const [newCategoryName, setNewCategoryName] = useState('');
  const [editingCategoryIndex, setEditingCategoryIndex] = useState<number | null>(null);
  const [editingCategoryValue, setEditingCategoryValue] = useState('');
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [savingCategories, setSavingCategories] = useState(false);
  const [categoryFeedback, setCategoryFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Branch state
  const [branchDrafts, setBranchDrafts] = useState<BranchInfo[]>(branchList);
  const [showAddBranchForm, setShowAddBranchForm] = useState(false);
  const [newBranch, setNewBranch] = useState({
    name: '',
    city: '',
    address: '',
    phone: '',
  });
  const [removingBranchId, setRemovingBranchId] = useState<string | null>(null);
  const [savingBranches, setSavingBranches] = useState(false);
  const [branchFeedback, setBranchFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  useEffect(() => {
    setBranchDrafts(branchList);
  }, [branchList]);

  const productCountByCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      map.set(p.category, (map.get(p.category) || 0) + 1);
    }
    return map;
  }, [products]);

  const productStockCountByBranch = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      if (!p.stock) continue;
      for (const [bId, qty] of Object.entries(p.stock)) {
        if ((Number(qty) || 0) > 0) {
          map.set(bId, (map.get(bId) || 0) + Number(qty));
        }
      }
    }
    return map;
  }, [products]);

  if (!profile || profile.rol !== 'admin') return null;

  const showCategoryToast = (type: 'success' | 'error', text: string) => {
    setCategoryFeedback({ type, text });
    setTimeout(() => {
      setCategoryFeedback((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const showBranchToast = (type: 'success' | 'error', text: string) => {
    setBranchFeedback({ type, text });
    setTimeout(() => {
      setBranchFeedback((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const persistCategories = async (
    nextItems: string[],
    auditDescription: string,
    renamed?: { from: string; to: string }
  ) => {
    setSavingCategories(true);
    setCategoryFeedback(null);
    try {
      const affectedProductIds =
        renamed && renamed.from !== renamed.to
          ? products.filter((p) => p.category === renamed.from).map((p) => p.id)
          : undefined;

      await inventoryService.updateCategories(
        {
          items: nextItems,
          auditDescription,
          renamed,
          affectedProductIds,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );
      return true;
    } catch (err) {
      showCategoryToast(
        'error',
        err instanceof Error ? err.message : 'No se pudieron guardar las categorías.'
      );
      return false;
    } finally {
      setSavingCategories(false);
    }
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = truncateStr(newCategoryName, FIELD_LIMITS.CATEGORY_MAX);
    if (!clean) {
      showCategoryToast('error', 'Ingresa un nombre válido para la categoría.');
      return;
    }
    if (categories.length >= 50) {
      showCategoryToast('error', 'Se alcanzó el límite máximo de 50 categorías.');
      return;
    }
    if (categories.some((c) => c.toLowerCase() === clean.toLowerCase())) {
      showCategoryToast('error', `La categoría "${clean}" ya existe.`);
      return;
    }

    const next = [...categories, clean];
    const ok = await persistCategories(
      next,
      `Alta de categoría "${clean}" en el catálogo (${next.length} categorías activas).`
    );
    if (ok) {
      setNewCategoryName('');
      showCategoryToast('success', `Categoría "${clean}" agregada correctamente.`);
    }
  };

  const handleSaveRenameCategory = async (index: number) => {
    const oldName = categories[index];
    const cleanNew = truncateStr(editingCategoryValue, FIELD_LIMITS.CATEGORY_MAX);
    if (!oldName || !cleanNew) {
      showCategoryToast('error', 'El nombre de la categoría no puede estar vacío.');
      return;
    }
    if (cleanNew === oldName) {
      setEditingCategoryIndex(null);
      setEditingCategoryValue('');
      return;
    }
    if (
      categories.some(
        (c, idx) => idx !== index && c.toLowerCase() === cleanNew.toLowerCase()
      )
    ) {
      showCategoryToast('error', `Ya existe otra categoría llamada "${cleanNew}".`);
      return;
    }

    const next = categories.map((c, idx) => (idx === index ? cleanNew : c));
    const affectedCount = productCountByCategory.get(oldName) || 0;
    const ok = await persistCategories(
      next,
      `Renombrado de categoría "${oldName}" a "${cleanNew}" (${affectedCount} producto(s) actualizados).`,
      { from: oldName, to: cleanNew }
    );
    if (ok) {
      setEditingCategoryIndex(null);
      setEditingCategoryValue('');
      showCategoryToast(
        'success',
        affectedCount > 0
          ? `Categoría actualizada a "${cleanNew}" junto con ${affectedCount} producto(s).`
          : `Categoría actualizada a "${cleanNew}".`
      );
    }
  };

  const handleDeleteCategory = async (catName: string) => {
    if (categories.length <= 1) {
      showCategoryToast('error', 'Debe existir al menos una categoría activa en el sistema.');
      setDeletingCategory(null);
      return;
    }

    const usedCount = productCountByCategory.get(catName) || 0;
    if (usedCount > 0) {
      showCategoryToast(
        'error',
        `No se puede eliminar "${catName}" porque tiene ${usedCount} producto(s) asignado(s). Renómbrala o cambia primero la categoría de esos productos.`
      );
      setDeletingCategory(null);
      return;
    }

    const next = categories.filter((c) => c !== catName);
    const ok = await persistCategories(
      next,
      `Eliminación de categoría "${catName}" (${next.length} categorías activas restantes).`
    );
    setDeletingCategory(null);
    if (ok) {
      showCategoryToast('success', `Categoría "${catName}" eliminada.`);
    }
  };

  const persistBranches = async (nextItems: BranchInfo[], auditDescription: string) => {
    if (nextItems.length < 1) {
      showBranchToast('error', 'El sistema debe contar con al menos una sucursal activa.');
      return false;
    }
    if (nextItems.length > 30) {
      showBranchToast('error', 'Se alcanzó el límite máximo de 30 sucursales.');
      return false;
    }

    const sanitizedList: BranchInfo[] = nextItems.map((b, idx) => ({
      id: b.id,
      name: truncateStr(b.name || `Sucursal ${idx + 1}`, FIELD_LIMITS.BRANCH_NAME_MAX),
      city: truncateStr(b.city || '', FIELD_LIMITS.BRANCH_CITY_MAX),
      address: truncateStr(b.address || '', FIELD_LIMITS.BRANCH_ADDRESS_MAX),
      phone: truncateStr(b.phone || '', FIELD_LIMITS.BRANCH_PHONE_MAX),
    }));

    setSavingBranches(true);
    setBranchFeedback(null);
    try {
      await inventoryService.updateBranches(
        {
          items: sanitizedList,
          auditDescription,
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );
      return true;
    } catch (err) {
      showBranchToast(
        'error',
        err instanceof Error ? err.message : 'No se pudieron guardar las sucursales.'
      );
      return false;
    } finally {
      setSavingBranches(false);
    }
  };

  const handleSaveBranches = async (e: React.FormEvent) => {
    e.preventDefault();
    const emptyName = branchDrafts.find((b) => !b.name.trim());
    if (emptyName) {
      showBranchToast('error', 'Todas las sucursales deben tener un nombre comercial.');
      return;
    }

    const summary = branchDrafts
      .map((b, i) => `${i + 1}) ${b.name.trim()} (${b.city.trim() || 'Sin ciudad'})`)
      .join(', ');
    const ok = await persistBranches(
      branchDrafts,
      `Actualización de sucursales activas (${branchDrafts.length}): ${summary}.`
    );
    if (ok) {
      showBranchToast(
        'success',
        'Sucursales actualizadas y sincronizadas en tiempo real.'
      );
    }
  };

  const handleAddBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = truncateStr(newBranch.name, FIELD_LIMITS.BRANCH_NAME_MAX);
    if (!cleanName) {
      showBranchToast('error', 'Ingresa el nombre comercial de la nueva sucursal.');
      return;
    }
    if (
      branchDrafts.some((b) => b.name.trim().toLowerCase() === cleanName.toLowerCase())
    ) {
      showBranchToast('error', `Ya existe una sucursal con el nombre "${cleanName}".`);
      return;
    }

    const nextId = getNextBranchId(branchDrafts);
    const created: BranchInfo = {
      id: nextId,
      name: cleanName,
      city: truncateStr(newBranch.city, FIELD_LIMITS.BRANCH_CITY_MAX),
      address: truncateStr(newBranch.address, FIELD_LIMITS.BRANCH_ADDRESS_MAX),
      phone: truncateStr(newBranch.phone, FIELD_LIMITS.BRANCH_PHONE_MAX),
    };

    const nextList = [...branchDrafts, created];
    const ok = await persistBranches(
      nextList,
      `Alta de nueva sucursal "${created.name}" (${created.id}${created.city ? `, ${created.city}` : ''}). Total sucursales: ${nextList.length}.`
    );
    if (ok) {
      setNewBranch({ name: '', city: '', address: '', phone: '' });
      setShowAddBranchForm(false);
      showBranchToast('success', `Sucursal "${created.name}" agregada al sistema.`);
    }
  };

  const handleRemoveBranch = async (branch: BranchInfo) => {
    if (branchDrafts.length <= 1) {
      showBranchToast('error', 'Debe permanecer al menos una sucursal activa.');
      setRemovingBranchId(null);
      return;
    }

    const nextList = branchDrafts.filter((b) => b.id !== branch.id);
    const ok = await persistBranches(
      nextList,
      `Baja de sucursal "${branch.name}" (${branch.id}). Sucursales activas restantes: ${nextList.length}.`
    );
    setRemovingBranchId(null);
    if (ok) {
      if (operatingScope === branch.id) {
        await setOperatingScope('general');
      }
      showBranchToast('success', `Sucursal "${branch.name}" eliminada de la lista activa.`);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900 dark:text-zinc-100 tracking-tight">
          Categorías y Sucursales
        </h1>
        <p className="text-sm text-stone-600 dark:text-zinc-400 mt-1">
          Administración exclusiva del Administrador para personalizar las categorías de catálogo y gestionar las sucursales activas del sistema.
        </p>
      </div>

      {/* Section 1: Category Management */}
      <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Tag className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Administración de Categorías
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                Agrega, renombra o elimina categorías utilizadas en Inventario y Punto de Venta.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono-tabular text-stone-500 dark:text-zinc-400">
            {categories.length} / 50 categorías
          </span>
        </div>

        {categoryFeedback && (
          <div
            className={`rounded-lg border px-4 py-2.5 text-xs ${
              categoryFeedback.type === 'success'
                ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                : 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
            }`}
          >
            {categoryFeedback.text}
          </div>
        )}

        <form onSubmit={handleAddCategory} className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            maxLength={FIELD_LIMITS.CATEGORY_MAX}
            value={newCategoryName}
            onChange={(e) => setNewCategoryName(e.target.value)}
            placeholder="Nueva categoría (ej. Ramos y Tocados, Vestidos de Noche, Velos...)"
            className="flex-1 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 py-2 text-sm text-stone-900 dark:text-zinc-100 placeholder:text-stone-400 dark:placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
          />
          <button
            type="submit"
            disabled={savingCategories || !newCategoryName.trim()}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium transition-colors disabled:opacity-45 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <FolderPlus className="w-4 h-4" />
            <span>Agregar Categoría</span>
          </button>
        </form>

        <div className="overflow-x-auto rounded-lg border border-stone-200 dark:border-zinc-800">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="border-b border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/60 text-xs font-medium text-stone-500 dark:text-zinc-400">
                <th className="py-3 px-4">Categoría</th>
                <th className="py-3 px-4 text-right whitespace-nowrap">Productos asociados</th>
                <th className="py-3 px-4 text-right whitespace-nowrap">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100 dark:divide-zinc-800/80">
              {categories.map((cat, idx) => {
                const count = productCountByCategory.get(cat) || 0;
                const isEditing = editingCategoryIndex === idx;
                const isConfirmingDelete = deletingCategory === cat;

                return (
                  <tr
                    key={cat}
                    className="hover:bg-stone-50/70 dark:hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="py-3 px-4">
                      {isEditing ? (
                        <div className="flex items-center gap-2 max-w-md">
                          <input
                            type="text"
                            autoFocus
                            maxLength={FIELD_LIMITS.CATEGORY_MAX}
                            value={editingCategoryValue}
                            onChange={(e) => setEditingCategoryValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleSaveRenameCategory(idx);
                              } else if (e.key === 'Escape') {
                                setEditingCategoryIndex(null);
                                setEditingCategoryValue('');
                              }
                            }}
                            className="flex-1 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-1.5 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                          />
                        </div>
                      ) : (
                        <span className="font-medium text-stone-900 dark:text-zinc-100">
                          {cat}
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right font-mono-tabular text-xs text-stone-600 dark:text-zinc-400 whitespace-nowrap">
                      {count} producto(s)
                    </td>

                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {isEditing ? (
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={savingCategories}
                            onClick={() => void handleSaveRenameCategory(idx)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900 text-xs font-medium cursor-pointer"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Guardar</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCategoryIndex(null);
                              setEditingCategoryValue('');
                            }}
                            className="p-1.5 rounded-md border border-stone-200 dark:border-zinc-700 text-stone-600 dark:text-zinc-300 cursor-pointer"
                            aria-label="Cancelar edición"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : isConfirmingDelete ? (
                        <div className="inline-flex items-center gap-2">
                          <span className="text-xs text-red-700 dark:text-red-400">
                            ¿Confirmar baja?
                          </span>
                          <button
                            type="button"
                            disabled={savingCategories}
                            onClick={() => void handleDeleteCategory(cat)}
                            className="px-2.5 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium cursor-pointer"
                          >
                            Eliminar
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeletingCategory(null)}
                            className="px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 cursor-pointer"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setDeletingCategory(null);
                              setEditingCategoryIndex(idx);
                              setEditingCategoryValue(cat);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-100 dark:hover:bg-zinc-800 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Renombrar</span>
                          </button>
                          <button
                            type="button"
                            disabled={categories.length <= 1 || count > 0}
                            title={
                              categories.length <= 1
                                ? 'Debe existir al menos una categoría'
                                : count > 0
                                  ? `Tiene ${count} producto(s) asociado(s)`
                                  : 'Eliminar categoría'
                            }
                            onClick={() => setDeletingCategory(cat)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-stone-200 dark:border-zinc-700 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Quitar</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Section 2: Dynamic Branch Management (Moved from Settings + Add/Remove) */}
      <section className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Building2 className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
                Gestión de Sucursales ({branchDrafts.length})
              </h2>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                Añade nuevas sucursales, edita sus datos comerciales o retira puntos de venta en tiempo real.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddBranchForm((v) => !v)}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            {showAddBranchForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{showAddBranchForm ? 'Cancelar alta' : 'Añadir Sucursal'}</span>
          </button>
        </div>

        {branchFeedback && (
          <div
            className={`rounded-lg border px-4 py-2.5 text-xs ${
              branchFeedback.type === 'success'
                ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                : 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-300'
            }`}
          >
            {branchFeedback.text}
          </div>
        )}

        {showAddBranchForm && (
          <form
            onSubmit={handleAddBranch}
            className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 p-5 space-y-4"
          >
            <p className="text-xs font-semibold text-stone-900 dark:text-zinc-100">
              Registrar Nueva Sucursal
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                  Nombre comercial *
                </label>
                <input
                  type="text"
                  required
                  maxLength={FIELD_LIMITS.BRANCH_NAME_MAX}
                  value={newBranch.name}
                  onChange={(e) => setNewBranch((p) => ({ ...p, name: e.target.value }))}
                  placeholder={`Ej. Sucursal ${branchDrafts.length + 1}`}
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                  Ciudad
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.BRANCH_CITY_MAX}
                  value={newBranch.city}
                  onChange={(e) => setNewBranch((p) => ({ ...p, city: e.target.value }))}
                  placeholder="Ej. Monterrey"
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                  Dirección
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.BRANCH_ADDRESS_MAX}
                  value={newBranch.address}
                  onChange={(e) => setNewBranch((p) => ({ ...p, address: e.target.value }))}
                  placeholder="Calle y número"
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                  Teléfono
                </label>
                <input
                  type="text"
                  maxLength={FIELD_LIMITS.BRANCH_PHONE_MAX}
                  value={newBranch.phone}
                  onChange={(e) => setNewBranch((p) => ({ ...p, phone: e.target.value }))}
                  placeholder="Ej. 81 0000 0000"
                  className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddBranchForm(false)}
                className="px-3.5 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={savingBranches}
                className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500 text-white text-xs font-medium disabled:opacity-50 cursor-pointer"
              >
                {savingBranches ? 'Agregando...' : 'Crear Sucursal'}
              </button>
            </div>
          </form>
        )}

        <form onSubmit={handleSaveBranches} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
            {branchDrafts.map((branch, index) => {
              const branchStockUnits = productStockCountByBranch.get(branch.id) || 0;
              const isConfirmingRemove = removingBranchId === branch.id;

              return (
                <div
                  key={branch.id}
                  className="rounded-lg border border-stone-200 dark:border-zinc-800 bg-stone-50/50 dark:bg-zinc-950/50 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-stone-600 dark:text-zinc-400">
                        Sucursal {index + 1} ·{' '}
                        <span className="font-mono-tabular">{branch.id}</span>
                      </p>
                      <p className="text-[11px] text-stone-500 dark:text-zinc-400 font-mono-tabular">
                        Stock registrado: {branchStockUnits} u.
                      </p>
                    </div>

                    {isConfirmingRemove ? (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          disabled={savingBranches}
                          onClick={() => void handleRemoveBranch(branch)}
                          className="px-2.5 py-1 rounded-md bg-red-600 hover:bg-red-700 text-white text-[11px] font-medium cursor-pointer"
                        >
                          Quitar
                        </button>
                        <button
                          type="button"
                          onClick={() => setRemovingBranchId(null)}
                          className="px-2 py-1 rounded-md border border-stone-300 dark:border-zinc-700 text-[11px] text-stone-700 dark:text-zinc-200 cursor-pointer"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={branchDrafts.length <= 1 || savingBranches}
                        title={
                          branchDrafts.length <= 1
                            ? 'Debe existir al menos una sucursal'
                            : 'Quitar sucursal'
                        }
                        onClick={() => setRemovingBranchId(branch.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-stone-200 dark:border-zinc-700 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Quitar</span>
                      </button>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                      Nombre comercial *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={FIELD_LIMITS.BRANCH_NAME_MAX}
                      value={branch.name}
                      onChange={(e) =>
                        setBranchDrafts((prev) =>
                          prev.map((item) =>
                            item.id === branch.id ? { ...item, name: e.target.value } : item
                          )
                        )
                      }
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                      Ciudad
                    </label>
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.BRANCH_CITY_MAX}
                      value={branch.city}
                      onChange={(e) =>
                        setBranchDrafts((prev) =>
                          prev.map((item) =>
                            item.id === branch.id ? { ...item, city: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Ej. Guadalajara"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                      Dirección
                    </label>
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.BRANCH_ADDRESS_MAX}
                      value={branch.address}
                      onChange={(e) =>
                        setBranchDrafts((prev) =>
                          prev.map((item) =>
                            item.id === branch.id ? { ...item, address: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Calle y número"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1">
                      Teléfono
                    </label>
                    <input
                      type="text"
                      maxLength={FIELD_LIMITS.BRANCH_PHONE_MAX}
                      value={branch.phone}
                      onChange={(e) =>
                        setBranchDrafts((prev) =>
                          prev.map((item) =>
                            item.id === branch.id ? { ...item, phone: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Ej. 33 0000 0000"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100"
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingBranches}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium transition-colors disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>{savingBranches ? 'Guardando...' : 'Guardar Cambios de Sucursales'}</span>
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
