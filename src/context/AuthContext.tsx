import React, { createContext, useContext, useEffect, useState } from 'react';
import { persistApiToken, SESSION_STORAGE_KEY } from '../lib/sessionStorage';
import { authService } from '../services/dataProvider';
import {
  isValidUsername,
  normalizeUsername,
  truncateStr,
} from '../lib/utils';
import {
  DEFAULT_BRANCH_LIST,
  DEFAULT_BRANDING_CONFIG,
  DEFAULT_PRODUCT_CATEGORIES,
  DEFAULT_SELLER_PERMISSIONS,
  FIELD_LIMITS,
  type BranchId,
  type BranchInfo,
  type BranchesConfig,
  type BrandingConfig,
  type OperatingScope,
  type UserPermissions,
  type UserProfile,
} from '../types/boutique';

export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated';

interface StoredSession {
  userId: string;
  usuario: string;
}

interface InitialAdminInput {
  nombreCompleto: string;
  usuario: string;
  pin: string;
}

interface AuthContextValue {
  authStatus: AuthStatus;
  needsInitialAdmin: boolean;
  profile: UserProfile | null;
  branchList: BranchInfo[];
  branchIds: BranchId[];
  branches: Record<string, BranchInfo>;
  categories: string[];
  branding: BrandingConfig;
  operatingScope: OperatingScope;
  authError: string | null;
  isSubmittingAuth: boolean;
  clearAuthError: () => void;
  registerInitialAdmin: (input: InitialAdminInput) => Promise<boolean>;
  loginWithCredentials: (usuario: string, pin: string) => Promise<boolean>;
  logout: () => Promise<void>;
  toggleTheme: () => Promise<void>;
  setOperatingScope: (scope: OperatingScope) => Promise<void>;
  hasPermission: (perm: keyof UserPermissions) => boolean;
  getBranchName: (branchId: BranchId) => string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function normalizeBranchList(config?: BranchesConfig | null): BranchInfo[] {
  if (!config) return DEFAULT_BRANCH_LIST;
  if (Array.isArray(config.items) && config.items.length > 0) {
    return config.items.filter(
      (b): b is BranchInfo => Boolean(b && typeof b.id === 'string' && typeof b.name === 'string')
    );
  }
  const legacy: BranchInfo[] = [];
  if (config.branch_1) legacy.push(config.branch_1);
  if (config.branch_2) legacy.push(config.branch_2);
  if (config.branch_3) legacy.push(config.branch_3);
  return legacy.length > 0 ? legacy : DEFAULT_BRANCH_LIST;
}

const FALLBACK_BRANDING: BrandingConfig = {
  ...DEFAULT_BRANDING_CONFIG,
  updatedByUid: 'system',
};

const FALLBACK_CATEGORIES: string[] = [...DEFAULT_PRODUCT_CATEGORIES];

function readSession(): StoredSession | null {
  try {
    const raw =
      localStorage.getItem(SESSION_STORAGE_KEY) ||
      sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.userId === 'string' && parsed.userId.length > 0) {
      return {
        userId: parsed.userId,
        usuario: typeof parsed.usuario === 'string' ? parsed.usuario : '',
      };
    }
    return null;
  } catch {
    return null;
  }
}

function persistSession(session: StoredSession | null) {
  try {
    if (!session) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return;
    }
    const serialized = JSON.stringify(session);
    localStorage.setItem(SESSION_STORAGE_KEY, serialized);
    sessionStorage.setItem(SESSION_STORAGE_KEY, serialized);
  } catch {
    // Ignore storage quota errors
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [sessionUserId, setSessionUserId] = useState<string | null>(() => readSession()?.userId ?? null);
  const [usersChecked, setUsersChecked] = useState(false);
  const [needsInitialAdmin, setNeedsInitialAdmin] = useState(false);
  const [profileChecked, setProfileChecked] = useState(() => !readSession()?.userId);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [branchList, setBranchList] = useState<BranchInfo[]>(DEFAULT_BRANCH_LIST);
  const [categories, setCategories] = useState<string[]>(FALLBACK_CATEGORIES);
  const [branding, setBranding] = useState<BrandingConfig>(FALLBACK_BRANDING);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [fatalError, setFatalError] = useState<Error | null>(null);

  if (fatalError) {
    throw fatalError;
  }

  // Sync branding, branches & categories in real time
  useEffect(() => {
    const unsubBranding = authService.subscribeBranding(
      (nextBranding) => {
        setBranding(nextBranding);
      },
      (error) => {
        console.warn('Error escuchando identidad de empresa:', error.message);
      }
    );

    const unsubBranches = authService.subscribeBranches(
      (config) => {
        if (config) {
          setBranchList(normalizeBranchList(config));
        }
      },
      (error) => {
        console.warn('Error escuchando configuración de sucursales:', error.message);
      }
    );

    const unsubCategories = authService.subscribeCategories(
      (items) => {
        if (Array.isArray(items) && items.length > 0) {
          setCategories(items.filter((c) => typeof c === 'string' && c.trim().length > 0));
        }
      },
      (error) => {
        console.warn('Error escuchando configuración de categorías:', error.message);
      }
    );

    return () => {
      unsubBranding();
      unsubBranches();
      unsubCategories();
    };
  }, []);

  // Sync browser tab title
  useEffect(() => {
    const name = branding.companyName?.trim() || DEFAULT_BRANDING_CONFIG.companyName;
    document.title = `${name} — Sistema de Gestión de ventas`;
  }, [branding.companyName]);

  // Sync per-user dark mode preference
  useEffect(() => {
    if (profile?.modoOscuro) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [profile?.modoOscuro]);

  // Watch users collection to determine if initial Admin bootstrap is required
  useEffect(() => {
    const unsubUsers = authService.subscribeUsers(
      (usersList) => {
        setNeedsInitialAdmin(usersList.length === 0);
        setUsersChecked(true);
      },
      (error) => {
        setUsersChecked(true);
        setFatalError(error instanceof Error ? error : new Error(String(error)));
      }
    );

    return () => unsubUsers();
  }, []);

  // Watch active session user document in real time
  useEffect(() => {
    if (!sessionUserId) {
      setProfile(null);
      setProfileChecked(true);
      return;
    }

    setProfileChecked(false);
    const unsubProfile = authService.subscribeUserProfile(
      sessionUserId,
      (userData, invalidReason) => {
        if (!userData) {
          persistSession(null);
          persistApiToken(null);
          setSessionUserId(null);
          setProfile(null);
          if (invalidReason === 'inactive') {
            setAuthError('Tu cuenta ha sido desactivada por un administrador.');
          }
          setProfileChecked(true);
          return;
        }

        setProfile(userData);
        setProfileChecked(true);
      },
      (error) => {
        setProfileChecked(true);
        setFatalError(error instanceof Error ? error : new Error(String(error)));
      }
    );

    return () => unsubProfile();
  }, [sessionUserId]);

  const authStatus: AuthStatus =
    !usersChecked || !profileChecked
      ? 'loading'
      : profile
        ? 'authenticated'
        : 'unauthenticated';

  const branchIds = branchList.map((b) => b.id);
  const branches: Record<string, BranchInfo> = {};
  for (const b of branchList) {
    branches[b.id] = b;
  }

  const getBranchName = (branchId: BranchId): string => {
    const found = branches[branchId];
    if (found?.name) return found.name;
    const def = DEFAULT_BRANCH_LIST.find((b) => b.id === branchId);
    return def?.name || branchId;
  };

  const clearAuthError = () => setAuthError(null);

  const registerInitialAdmin = async ({
    nombreCompleto,
    usuario,
    pin,
  }: InitialAdminInput): Promise<boolean> => {
    setAuthError(null);
    const cleanName = truncateStr(nombreCompleto, FIELD_LIMITS.DISPLAY_NAME_MAX);
    const cleanUsuario = normalizeUsername(usuario);

    if (!cleanName) {
      setAuthError('Ingresa tu nombre completo.');
      return false;
    }
    if (!isValidUsername(cleanUsuario)) {
      setAuthError(
        'El usuario solo puede contener letras, números, puntos, guiones o guiones bajos.'
      );
      return false;
    }
    if (pin.trim().length < 4) {
      setAuthError('La contraseña o PIN debe tener al menos 4 caracteres.');
      return false;
    }

    setIsSubmittingAuth(true);
    try {
      const result = await authService.registerInitialAdmin({
        nombreCompleto: cleanName,
        usuario: cleanUsuario,
        pin,
        defaultBranchId: branchList[0]?.id || 'branch_1',
      });

      if (result.token) {
        persistApiToken(result.token);
      }
      persistSession({ userId: result.user.id, usuario: result.user.usuario });
      setSessionUserId(result.user.id);
      setProfile(result.user);
      return true;
    } catch (error) {
      setAuthError(
        error instanceof Error
          ? error.message
          : 'No se pudo completar el registro inicial del administrador.'
      );
      return false;
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const loginWithCredentials = async (usuario: string, pin: string): Promise<boolean> => {
    setAuthError(null);
    const cleanUsuario = normalizeUsername(usuario);

    if (!cleanUsuario || !pin) {
      setAuthError('Ingresa tu usuario y contraseña o PIN.');
      return false;
    }

    setIsSubmittingAuth(true);
    try {
      const result = await authService.loginWithCredentials({
        usuario: cleanUsuario,
        pin,
        resolveBranchName: getBranchName,
      });

      if (result.token) {
        persistApiToken(result.token);
      }
      persistSession({ userId: result.user.id, usuario: result.user.usuario });
      setSessionUserId(result.user.id);
      setProfile(result.user);
      return true;
    } catch (error) {
      setAuthError(
        error instanceof Error ? error.message : 'Ocurrió un error al validar tus credenciales.'
      );
      return false;
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const logout = async () => {
    const current = profile;
    persistSession(null);
    persistApiToken(null);
    setSessionUserId(null);
    setProfile(null);
    setAuthError(null);

    if (current) {
      try {
        const branchName = getBranchName(current.sucursalAsignada);
        await authService.logout(
          {
            id: current.id,
            nombreCompleto: current.nombreCompleto,
            usuario: current.usuario,
            sucursalAsignada: current.sucursalAsignada,
          },
          branchName
        );
      } catch (err) {
        console.warn('No se pudo registrar cierre de sesión en bitácora:', err);
      }
    }
  };

  const toggleTheme = async () => {
    if (!profile) return;
    const nextDark = !profile.modoOscuro;
    document.documentElement.classList.toggle('dark', nextDark);
    await authService.toggleTheme(profile.id, nextDark);
  };

  const rawScope = profile?.operatingScope || 'general';
  const operatingScope: OperatingScope =
    profile?.rol === 'admin'
      ? rawScope === 'general' || branchIds.includes(rawScope)
        ? rawScope
        : 'general'
      : branchIds.includes(profile?.sucursalAsignada || '')
        ? profile?.sucursalAsignada || branchIds[0] || 'branch_1'
        : branchIds[0] || 'branch_1';

  const setOperatingScope = async (scope: OperatingScope) => {
    if (!profile || profile.rol !== 'admin') return;
    await authService.setOperatingScope(profile.id, scope);
  };

  const hasPermission = (perm: keyof UserPermissions): boolean => {
    if (!profile || !profile.activo) return false;
    if (profile.rol === 'admin') return true;
    const rawVal = profile.permisos?.[perm];
    if (typeof rawVal === 'boolean') return rawVal;
    return DEFAULT_SELLER_PERMISSIONS[perm];
  };

  return (
    <AuthContext.Provider
      value={{
        authStatus,
        needsInitialAdmin,
        profile,
        branchList,
        branchIds,
        branches,
        categories,
        branding,
        operatingScope,
        authError,
        isSubmittingAuth,
        clearAuthError,
        registerInitialAdmin,
        loginWithCredentials,
        logout,
        toggleTheme,
        setOperatingScope,
        hasPermission,
        getBranchName,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
