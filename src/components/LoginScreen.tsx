import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, Lock, ShieldCheck, Store, User, UserPlus } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { FIELD_LIMITS } from '../types/boutique';
import quinceaneraHeroImg from '../assets/images/quinceanera_boutique_hero_1794617198152.jpg';

export function LoginScreen() {
  const {
    needsInitialAdmin,
    authError,
    isSubmittingAuth,
    clearAuthError,
    registerInitialAdmin,
    loginWithCredentials,
    branding,
  } = useAuth();

  const [imgError, setImgError] = useState(false);
  const [logoError, setLogoError] = useState(false);

  // Login / Initial Admin state
  const [nombreCompleto, setNombreCompleto] = useState('');
  const [usuario, setUsuario] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setLogoError(false);
  }, [branding.companyLogoUrl]);

  useEffect(() => {
    setLocalError(null);
    clearAuthError();
  }, [needsInitialAdmin]);

  const companyName = branding.companyName?.trim() || 'Atelier Aurelia';
  const showLogo = Boolean(branding.companyLogoUrl) && !logoError;
  const activeError = localError || authError;

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearAuthError();
    await loginWithCredentials(usuario, pin);
  };

  const handleBootstrapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearAuthError();

    if (pin !== confirmPin) {
      setLocalError('Las contraseñas o PIN no coinciden.');
      return;
    }

    await registerInitialAdmin({ nombreCompleto, usuario, pin });
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 bg-stone-50 dark:bg-zinc-950 text-stone-900 dark:text-zinc-100">
      {/* Left Hero Panel */}
      <div className="relative hidden lg:block overflow-hidden bg-stone-200 dark:bg-zinc-900">
        {!imgError ? (
          <img
            src={quinceaneraHeroImg}
            alt={`Showroom de vestidos de XV años — ${companyName}`}
            referrerPolicy="no-referrer"
            onError={() => setImgError(true)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center bg-gradient-to-br from-stone-200 via-stone-100 to-amber-50 dark:from-zinc-900 dark:via-zinc-950 dark:to-zinc-900 p-12">
            <Store className="w-16 h-16 text-stone-400 dark:text-zinc-600 mb-4" />
            <p className="font-display text-3xl text-stone-700 dark:text-zinc-300">
              {companyName}
            </p>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent flex flex-col justify-end p-12 text-white">
          <p className="text-xs tracking-wider uppercase text-amber-200 mb-2">
            Gestión Empresarial Boutique
          </p>
          <h2 className="font-display text-4xl font-semibold leading-tight max-w-md">
            Sistema de Gestión de ventas
          </h2>
        </div>
      </div>

      {/* Right Auth Panel */}
      <div className="flex flex-col justify-center items-center px-6 py-12 sm:px-12">
        <div className="w-full max-w-md">
          <div className="mb-8">
            <p className="text-xs font-medium tracking-wider uppercase text-amber-700 dark:text-amber-400 mb-3">
              {needsInitialAdmin ? 'Configuración Inicial' : 'Plataforma Interna'}
            </p>
            <div className="flex items-center gap-3.5">
              {showLogo && (
                <img
                  src={branding.companyLogoUrl}
                  alt={`Logo de ${companyName}`}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoError(true)}
                  className="h-12 w-12 rounded-lg object-contain border border-stone-200 dark:border-zinc-800 bg-white p-1 shrink-0"
                />
              )}
              <h1 className="font-display text-4xl font-semibold text-stone-900 dark:text-zinc-50 tracking-tight">
                {companyName}
              </h1>
            </div>
            <p className="mt-3 text-sm text-stone-600 dark:text-zinc-400 leading-relaxed">
              {needsInitialAdmin
                ? 'No hay usuarios registrados en el sistema. Crea la cuenta maestra de Administrador para comenzar.'
                : 'Ingresa tu usuario y contraseña o PIN para acceder al Punto de Venta e Inventario Multisucursal.'}
            </p>
          </div>

          <div className="rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-7 sm:p-8 shadow-sm">
            {activeError && (
              <div className="mb-5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                {activeError}
              </div>
            )}

            {needsInitialAdmin ? (
              <form onSubmit={handleBootstrapSubmit} className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-stone-100 dark:border-zinc-800">
                  <UserPlus className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                  <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100">
                    Registro de Administrador Inicial
                  </h2>
                </div>

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
                    placeholder="Ej. María Fernanda López"
                    className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3.5 py-2.5 text-sm text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                    Usuario de acceso *
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-stone-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      required
                      autoComplete="username"
                      maxLength={FIELD_LIMITS.USERNAME_MAX}
                      value={usuario}
                      onChange={(e) => setUsuario(e.target.value)}
                      placeholder="Ej. admin"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-10 pr-3.5 py-2.5 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                    Contraseña / PIN (mín. 4 caracteres) *
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-stone-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type={showPin ? 'text' : 'password'}
                      required
                      minLength={4}
                      autoComplete="new-password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="••••"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-10 pr-10 py-2.5 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
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

                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                    Confirmar Contraseña / PIN *
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-stone-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type={showPin ? 'text' : 'password'}
                      required
                      minLength={4}
                      autoComplete="new-password"
                      value={confirmPin}
                      onChange={(e) => setConfirmPin(e.target.value)}
                      placeholder="••••"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-10 pr-3.5 py-2.5 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmittingAuth}
                  className="w-full mt-2 flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 font-medium text-sm transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>
                    {isSubmittingAuth ? 'Registrando...' : 'Crear Administrador Inicial'}
                  </span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                    Usuario
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-stone-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      required
                      autoComplete="username"
                      maxLength={FIELD_LIMITS.USERNAME_MAX}
                      value={usuario}
                      onChange={(e) => setUsuario(e.target.value)}
                      placeholder="Ej. admin o laura.suc1"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-10 pr-3.5 py-2.5 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5">
                    Contraseña / PIN
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-stone-400 dark:text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type={showPin ? 'text' : 'password'}
                      required
                      autoComplete="current-password"
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="••••"
                      className="w-full rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 pl-10 pr-10 py-2.5 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
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

                <button
                  type="submit"
                  disabled={isSubmittingAuth}
                  className="w-full mt-2 flex items-center justify-center gap-2 px-5 py-3 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 font-medium text-sm transition-colors disabled:opacity-50 cursor-pointer"
                >
                  <span>{isSubmittingAuth ? 'Verificando...' : 'Iniciar Sesión'}</span>
                </button>
              </form>
            )}

            <div className="mt-6 pt-5 border-t border-stone-200 dark:border-zinc-800 flex items-center gap-2.5 text-xs text-stone-500 dark:text-zinc-400">
              <ShieldCheck className="w-4 h-4 shrink-0 text-stone-400 dark:text-zinc-500" />
              <span>Acceso protegido</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
