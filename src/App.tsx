import { AuthProvider, useAuth } from './context/AuthContext';
import { HardwareProvider } from './context/HardwareContext';
import { DashboardShell } from './components/DashboardShell';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginScreen } from './components/LoginScreen';

function AppContent() {
  const { authStatus, branding } = useAuth();
  const companyName = branding.companyName?.trim() || 'Atelier Aurelia';

  if (authStatus === 'loading') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-50 dark:bg-zinc-950 text-stone-900 dark:text-zinc-100 p-6">
        <p className="font-display text-3xl font-semibold tracking-tight mb-3">
          {companyName}
        </p>
        <div className="w-40 h-1 rounded-full bg-stone-200 dark:bg-zinc-800 overflow-hidden">
          <div className="h-full w-1/2 bg-stone-800 dark:bg-zinc-200 animate-pulse rounded-full" />
        </div>
        <p className="mt-3 text-xs text-stone-500 dark:text-zinc-400">
          Verificando sesión y permisos en tiempo real...
        </p>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    return <LoginScreen />;
  }

  return <DashboardShell />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <HardwareProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </HardwareProvider>
    </ErrorBoundary>
  );
}
