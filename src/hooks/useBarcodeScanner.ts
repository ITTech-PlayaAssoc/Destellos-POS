import { useEffect, useRef } from 'react';

interface UseBarcodeScannerOptions {
  enabled: boolean;
  onScan: (code: string) => void;
  maxInterKeyMs?: number;
  minLength?: number;
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (target.isContentEditable) return true;
  return Boolean(target.closest('[contenteditable="true"]'));
}

/**
 * Global HID USB/Bluetooth barcode scanner listener.
 * Distinguishes fast scanner keystroke bursts (< 50ms between characters ending in Enter)
 * from normal human typing, and avoids interfering when typing inside forms/inputs.
 */
export function useBarcodeScanner({
  enabled,
  onScan,
  maxInterKeyMs = 50,
  minLength = 3,
}: UseBarcodeScannerOptions): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = '';
    let lastKeyTime = 0;

    const reset = () => {
      buffer = '';
      lastKeyTime = 0;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.altKey || e.metaKey) {
        reset();
        return;
      }

      if (isEditableElement(e.target) || isEditableElement(document.activeElement)) {
        reset();
        return;
      }

      const now = performance.now();

      if (e.key === 'Enter') {
        if (buffer.length >= minLength && now - lastKeyTime <= maxInterKeyMs * 2.5) {
          const scannedCode = buffer.trim();
          reset();
          if (scannedCode.length >= minLength) {
            e.preventDefault();
            e.stopPropagation();
            onScanRef.current(scannedCode);
          }
          return;
        }
        reset();
        return;
      }

      if (e.key.length === 1) {
        if (lastKeyTime > 0 && now - lastKeyTime > maxInterKeyMs) {
          buffer = e.key;
        } else {
          buffer += e.key;
        }
        lastKeyTime = now;
        return;
      }

      if (
        e.key !== 'Shift' &&
        e.key !== 'CapsLock' &&
        e.key !== 'NumLock'
      ) {
        reset();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [enabled, maxInterKeyMs, minLength]);
}
