import React from 'react';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message || 'Ocurrió un error inesperado en la aplicación.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error capturado por ErrorBoundary:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      let parsedError: { error?: string; operationType?: string; path?: string } | null = null;
      try {
        parsedError = JSON.parse(this.state.errorMessage);
      } catch {
        parsedError = null;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-stone-50 dark:bg-zinc-950 p-6">
          <div className="w-full max-w-lg rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 shadow-sm">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-semibold text-stone-900 dark:text-zinc-100">
                Error de operación en el sistema
              </h1>
            </div>
            <p className="text-sm text-stone-600 dark:text-zinc-400 leading-relaxed mb-4">
              {parsedError?.error
                ? `No se pudo completar la operación (${parsedError.operationType || 'lectura/escritura'} en ${parsedError.path || 'Firestore'}): ${parsedError.error}`
                : this.state.errorMessage}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Recargar aplicación</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
