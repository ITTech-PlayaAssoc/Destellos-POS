import React, { useEffect, useState } from 'react';
import {
  Edit3,
  Eye,
  EyeOff,
  Plus,
  Shield,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { authService } from '../services/dataProvider';
import {
  formatDateTime,
  getInitials,
  hashPin,
  isValidUsername,
  normalizeUsername,
  toMillis,
  truncateStr,
} from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import {
  DEFAULT_SELLER_PERMISSIONS,
  FIELD_LIMITS,
  FULL_ADMIN_PERMISSIONS,
  USER_ROLE_LABELS,
  type BranchId,
  type UserPermissions,
  type UserProfile,
  type UserRole,
} from '../types/boutique';

const PERMISSION_LABELS: { key: keyof UserPermissions; label: string; desc: string }[] = [
  {
    key: 'viewInventory',
    label: 'Ver inventario',
    desc: 'Permite consultar el catálogo y existencias de su sucursal.',
  },
  {
    key: 'addProduct',
    label: 'Alta de productos',
    desc: 'Permite registrar nuevos SKU en el catálogo.',
  },
  {
    key: 'restockInventory',
    label: 'Agregar / rellenar stock',
    desc: 'Permite registrar entradas de mercancía en su sucursal.',
  },
  {
    key: 'discardStock',
    label: 'Descartar / mermar stock',
    desc: 'Permite dar de baja existencias con motivo obligatorio.',
  },
  {
    key: 'performSales',
    label: 'Realizar ventas (POS)',
    desc: 'Permite operar la caja y emitir tickets en su sucursal.',
  },
  {
    key: 'viewOtherBranchesStock',
    label: 'Ver stock de otras sucursales',
    desc: 'Muestra columnas de existencias de las otras 2 sucursales.',
  },
  {
    key: 'manageCustomers',
    label: 'Clientes (CRM)',
    desc: 'Permite consultar, registrar y editar expedientes de clientes y datos fiscales.',
  },
  {
    key: 'manageLayaways',
    label: 'Apartados y abonos',
    desc: 'Permite crear apartados, recibir abonos libres y marcar entregas.',
  },
  {
    key: 'cancelLayaways',
    label: 'Cancelar apartados',
    desc: 'Permite cancelar apartados activos y devolver las prendas al stock.',
  },
];

export function UsersView() {
  const { profile, getBranchName } = useAuth();

  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalMode, setModalMode] = useState<
    { type: 'create' } | { type: 'edit'; user: UserProfile } | null
  >(null);

  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!profile || profile.rol !== 'admin') return;

    const unsubUsers = authService.subscribeUsers(
      (list) => {
        const sorted = [...list].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setUsers(sorted);
        setLoading(false);
      },
      (err) => {
        setLoading(false);
        console.error(err);
      }
    );

    return () => unsubUsers();
  }, [profile?.id, profile?.rol]);

  if (!profile || profile.rol !== 'admin') return null;

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const handleQuickTogglePermission = async (
    target: UserProfile,
    permKey: keyof UserPermissions
  ) => {
    if (target.rol === 'admin') return;
    const currentPerms: UserPermissions = {
      ...DEFAULT_SELLER_PERMISSIONS,
      ...(target.permisos || {}),
    };
    const nextValue = !currentPerms[permKey];
    const nextPerms: UserPermissions = {
      ...currentPerms,
      [permKey]: nextValue,
    };

    const permMeta = PERMISSION_LABELS.find((p) => p.key === permKey);
    try {
      await authService.toggleUserPermission(
        {
          targetUser: target,
          nextPermissions: nextPerms,
          permLabel: permMeta?.label || permKey,
          enabled: nextValue,
          branchName: getBranchName(target.sucursalAsignada),
        },
        {
          id: profile.id,
          nombreCompleto: profile.nombreCompleto,
          usuario: profile.usuario,
          sucursalAsignada: profile.sucursalAsignada,
        }
      );
      notify(`Permiso actualizado para ${target.nombreCompleto}.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo actualizar el permiso.');
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);

    if (target.id === profile.id) return;

    try {
      await authService.deleteUser(target.id);
      notify(`Usuario @${target.usuario} eliminado del sistema.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo eliminar el usuario.');
    }
  };

  const isOnlyInitialAdmin = users.length <= 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-zinc-100 tracking-tight">
            Usuarios y Control de Acceso
          </h1>
          <p className="text-sm text-stone-600 dark:text-zinc-400 mt-1">
            Administra cuentas internas, restablece contraseñas o PIN, asigna sucursales y configura permisos por vendedor.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setModalMode({ type: 'create' })}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <UserPlus className="w-4 h-4" />
          <span>Nuevo Usuario</span>
        </button>
      </div>

      {toast && (
        <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-300">
          {toast}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-md bg-stone-100 dark:bg-zinc-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-stone-200 dark:border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-stone-500 dark:text-zinc-400" />
                <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                  Cuentas Registradas ({users.length})
                </h2>
              </div>
            </div>

            <div className="divide-y divide-stone-100 dark:divide-zinc-800">
              {users.map((u) => {
                const isSelf = u.id === profile.id;
                const isTargetAdmin = u.rol === 'admin';
                return (
                  <div key={u.id} className="p-5 space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-stone-100 dark:bg-zinc-800 border border-stone-200 dark:border-zinc-700 flex items-center justify-center text-xs font-semibold text-stone-700 dark:text-zinc-200 shrink-0">
                          {getInitials(u.nombreCompleto)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-stone-900 dark:text-zinc-100 truncate">
                              {u.nombreCompleto}
                            </span>
                            {isSelf && (
                              <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                                · Tu cuenta
                              </span>
                            )}
                            {!u.activo && (
                              <span className="text-xs text-red-600 dark:text-red-400 font-medium">
                                · Suspendido
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-stone-500 dark:text-zinc-400 mt-0.5 truncate">
                            <span className="font-mono-tabular font-medium text-stone-700 dark:text-zinc-300">
                              @{u.usuario}
                            </span>
                            <span className="mx-1.5" aria-hidden="true">
                              ·
                            </span>
                            <span>{USER_ROLE_LABELS[u.rol]}</span>
                            <span className="mx-1.5" aria-hidden="true">
                              ·
                            </span>
                            <span>{getBranchName(u.sucursalAsignada)}</span>
                            <span className="mx-1.5" aria-hidden="true">
                              ·
                            </span>
                            <span>Último acceso: {formatDateTime(u.lastLoginAt)}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setModalMode({ type: 'edit', user: u })}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Editar usuario / PIN</span>
                        </button>
                        {!isSelf && (
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(u)}
                            className="p-1.5 rounded-lg text-stone-400 hover:text-red-600 hover:bg-red-50 dark:text-zinc-500 dark:hover:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
                            aria-label={`Eliminar a ${u.nombreCompleto}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    {isTargetAdmin ? (
                      <div className="flex items-center gap-2 text-xs text-stone-500 dark:text-zinc-400 pl-0 md:pl-13">
                        <Shield className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                        <span>
                          Acceso total habilitado en los 4 módulos y las 3 sucursales.
                        </span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1 md:pl-13">
                        {PERMISSION_LABELS.map((perm) => {
                          const enabled =
                            (u.permisos?.[perm.key] ?? DEFAULT_SELLER_PERMISSIONS[perm.key]) === true;
                          return (
                            <button
                              key={perm.key}
                              type="button"
                              role="switch"
                              aria-checked={enabled}
                              onClick={() => handleQuickTogglePermission(u, perm.key)}
                              className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 dark:border-zinc-800 bg-stone-50/70 dark:bg-zinc-950/50 px-3 py-2 text-left hover:border-stone-300 dark:hover:border-zinc-700 transition-colors cursor-pointer"
                            >
                              <span className="text-xs font-medium text-stone-800 dark:text-zinc-200 truncate">
                                {perm.label}
                              </span>
                              <span
                                className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                                  enabled
                                    ? 'bg-stone-900 dark:bg-amber-600'
                                    : 'bg-stone-300 dark:bg-zinc-700'
                                }`}
                              >
                                <span
                                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                                    enabled ? 'translate-x-4.5' : 'translate-x-1'
                                  }`}
                                />
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {isOnlyInitialAdmin && (
            <div className="rounded-xl border border-dashed border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-6 py-10 text-center">
              <p className="text-sm font-medium text-stone-900 dark:text-zinc-100">
                Aún no has dado de alta vendedores u otros administradores
              </p>
              <p className="mt-1.5 text-xs text-stone-500 dark:text-zinc-400 max-w-md mx-auto">
                Crea cuentas internas con su usuario, contraseña o PIN inicial, sucursal asignada y permisos granulares de caja e inventario.
              </p>
              <button
                type="button"
                onClick={() => setModalMode({ type: 'create' })}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-stone-300 dark:border-zinc-700 text-xs font-medium text-stone-800 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Registrar primer colaborador</span>
              </button>
            </div>
          )}
        </div>
      )}

      {modalMode && (
        <UserFormModal
          mode={modalMode}
          existingUsers={users}
          onClose={() => setModalMode(null)}
          onSaved={(msg) => notify(msg)}
        />
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-6 shadow-lg">
            <h3 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
              Eliminar acceso de usuario
            </h3>
            <p className="mt-2 text-sm text-stone-600 dark:text-zinc-400">
              ¿Deseas eliminar la cuenta{' '}
              <span className="font-mono-tabular font-medium text-stone-900 dark:text-zinc-100">
                @{deleteTarget.usuario}
              </span>{' '}
              ({deleteTarget.nombreCompleto})? Ya no podrá iniciar sesión en el sistema.
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
                onClick={handleDeleteConfirm}
                className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 text-sm font-medium cursor-pointer"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface UserFormModalProps {
  mode: { type: 'create' } | { type: 'edit'; user: UserProfile };
  existingUsers: UserProfile[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

function UserFormModal({ mode, existingUsers, onClose, onSaved }: UserFormModalProps) {
  const { profile, branches, branchIds, getBranchName } = useAuth();

  const isCreate = mode.type === 'create';
  const targetUser = mode.type === 'edit' ? mode.user : null;

  const [nombreCompleto, setNombreCompleto] = useState(targetUser?.nombreCompleto || '');
  const [usuario, setUsuario] = useState(targetUser?.usuario || '');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [rol, setRol] = useState<UserRole>(targetUser?.rol || 'vendedor');
  const [sucursalAsignada, setSucursalAsignada] = useState<BranchId>(
    targetUser?.sucursalAsignada || branchIds[0] || 'branch_1'
  );
  const [activo, setActivo] = useState(targetUser ? targetUser.activo : true);
  const [permisos, setPermisos] = useState<UserPermissions>({
    ...DEFAULT_SELLER_PERMISSIONS,
    ...(targetUser?.permisos || {}),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  const isEditingSelf = targetUser?.id === profile.id;

  const handleRoleChange = (nextRole: UserRole) => {
    setRol(nextRole);
    if (nextRole === 'admin') {
      setPermisos(FULL_ADMIN_PERMISSIONS);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanName = truncateStr(nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX);
    const cleanUsuario = normalizeUsername(usuario);
    const cleanPin = pin.trim();

    if (!cleanName) {
      setError('Ingresa el nombre completo del colaborador.');
      return;
    }
    if (!isValidUsername(cleanUsuario)) {
      setError(
        'El usuario de acceso solo puede contener letras, números, puntos, guiones o guiones bajos.'
      );
      return;
    }
    if (isCreate && cleanPin.length < 4) {
      setError('La contraseña o PIN inicial debe tener al menos 4 caracteres.');
      return;
    }
    if (!isCreate && cleanPin.length > 0 && cleanPin.length < 4) {
      setError('La nueva contraseña o PIN debe tener al menos 4 caracteres.');
      return;
    }

    const duplicate = existingUsers.find(
      (u) => normalizeUsername(u.usuario) === cleanUsuario && u.id !== targetUser?.id
    );
    if (duplicate) {
      setError(`El usuario "@${cleanUsuario}" ya está en uso por ${duplicate.nombreCompleto}.`);
      return;
    }

    const finalPerms = rol === 'admin' ? FULL_ADMIN_PERMISSIONS : permisos;

    setSaving(true);
    try {
      const actor = {
        id: profile.id,
        nombreCompleto: profile.nombreCompleto,
        usuario: profile.usuario,
        sucursalAsignada: profile.sucursalAsignada,
      };
      const branchName = getBranchName(sucursalAsignada);

      if (isCreate) {
        const pinHash = await hashPin(cleanPin);
        await authService.createUser(
          {
            nombreCompleto: cleanName,
            usuario: cleanUsuario,
            pinHash,
            rol,
            sucursalAsignada,
            permisos: finalPerms,
            activo,
          },
          actor,
          branchName
        );
        onSaved(`Usuario @${cleanUsuario} creado correctamente.`);
      } else if (targetUser) {
        const nextHash = cleanPin.length >= 4 ? await hashPin(cleanPin) : targetUser.pinHash;
        await authService.updateUser(
          {
            targetUser,
            nombreCompleto: cleanName,
            usuario: cleanUsuario,
            pinHash: nextHash,
            rol: isEditingSelf ? targetUser.rol : rol,
            sucursalAsignada,
            activo: isEditingSelf ? true : activo,
            permisos: isEditingSelf ? FULL_ADMIN_PERMISSIONS : finalPerms,
            isEditingSelf,
          },
          actor,
          branchName
        );
        onSaved(`Perfil de @${cleanUsuario} actualizado.`);
      }

      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el usuario.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-xl rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800">
          <h2 className="text-base font-semibold text-stone-900 dark:text-zinc-100">
            {isCreate ? 'Crear Nuevo Usuario' : 'Editar Usuario, Contraseña y Permisos'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer"
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
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Nombre completo *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.DISPLAY_NAME_MAX}
                value={nombreCompleto}
                onChange={(e) => setNombreCompleto(e.target.value)}
                placeholder="Ej. Laura Martínez"
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Usuario de acceso *
              </label>
              <input
                type="text"
                required
                maxLength={FIELD_LIMITS.USERNAME_MAX}
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                placeholder="Ej. laura.suc1"
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
              {isCreate
                ? 'Contraseña / PIN inicial (mín. 4 caracteres) *'
                : 'Restablecer Contraseña / PIN (opcional — dejar vacío para conservar actual)'}
            </label>
            <div className="relative">
              <input
                type={showPin ? 'text' : 'password'}
                required={isCreate}
                minLength={isCreate ? 4 : undefined}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder={isCreate ? '••••' : 'Solo si deseas cambiar la contraseña o PIN'}
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 pr-10 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
              />
              <button
                type="button"
                onClick={() => setShowPin((v) => !v)}
                className="p-1.5 text-stone-400 hover:text-stone-700 dark:text-zinc-500 dark:hover:text-zinc-200 absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
                aria-label={showPin ? 'Ocultar contraseña' : 'Mostrar contraseña'}
              >
                {showPin ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Rol en el sistema *
              </label>
              <select
                value={rol}
                disabled={isEditingSelf}
                onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100 disabled:opacity-60"
              >
                <option value="vendedor">Vendedor</option>
                <option value="admin">Administrador</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                Sucursal asignada *
              </label>
              <select
                value={sucursalAsignada}
                onChange={(e) => setSucursalAsignada(e.target.value as BranchId)}
                className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm text-stone-900 dark:text-zinc-100"
              >
                {branchIds.map((bId) => (
                  <option key={bId} value={bId}>
                    {branches[bId]?.name || bId}
                  </option>
                ))}
                {sucursalAsignada && !branchIds.includes(sucursalAsignada) && (
                  <option value={sucursalAsignada}>
                    {getBranchName(sucursalAsignada)} (inactiva)
                  </option>
                )}
              </select>
            </div>
          </div>

          {!isEditingSelf && (
            <div className="flex items-center justify-between rounded-lg border border-stone-200 dark:border-zinc-800 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-stone-900 dark:text-zinc-100">
                  Cuenta activa
                </p>
                <p className="text-xs text-stone-500 dark:text-zinc-400">
                  Desactívala para suspender el acceso inmediatamente sin borrar el historial.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={activo}
                onClick={() => setActivo((v) => !v)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                  activo ? 'bg-stone-900 dark:bg-amber-600' : 'bg-stone-300 dark:bg-zinc-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    activo ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          )}

          {rol === 'vendedor' && (
            <div className="pt-2 border-t border-stone-200 dark:border-zinc-800 space-y-2.5">
              <p className="text-xs font-semibold text-stone-800 dark:text-zinc-200">
                Permisos granulares del Vendedor
              </p>
              <div className="space-y-2">
                {PERMISSION_LABELS.map((perm) => {
                  const enabled = permisos[perm.key];
                  return (
                    <button
                      key={perm.key}
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() =>
                        setPermisos((prev) => ({
                          ...prev,
                          [perm.key]: !prev[perm.key],
                        }))
                      }
                      className="w-full flex items-center justify-between gap-4 rounded-lg border border-stone-200 dark:border-zinc-800 px-3.5 py-2.5 text-left hover:bg-stone-50 dark:hover:bg-zinc-800/40 transition-colors cursor-pointer"
                    >
                      <div>
                        <p className="text-xs font-medium text-stone-900 dark:text-zinc-100">
                          {perm.label}
                        </p>
                        <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                          {perm.desc}
                        </p>
                      </div>
                      <span
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                          enabled
                            ? 'bg-stone-900 dark:bg-amber-600'
                            : 'bg-stone-300 dark:bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            enabled ? 'translate-x-4.5' : 'translate-x-1'
                          }`}
                        />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
              {saving ? 'Guardando...' : isCreate ? 'Crear usuario' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
