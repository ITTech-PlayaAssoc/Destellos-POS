import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

export type TicketWidthOption = '80mm' | '58mm' | 'a4';
export type StickerSizeOption = '50x25' | '50x30' | '40x20';
export type PosScanActionOption = 'add_to_cart' | 'show_detail';

export interface HardwareSettings {
  ticketWidth: TicketWidthOption;
  stickerSize: StickerSizeOption;
  globalScannerEnabled: boolean;
  posScanAction: PosScanActionOption;
}

export const DEFAULT_HARDWARE_SETTINGS: HardwareSettings = {
  ticketWidth: '80mm',
  stickerSize: '50x25',
  globalScannerEnabled: true,
  posScanAction: 'add_to_cart',
};

export const TICKET_WIDTH_LABELS: Record<TicketWidthOption, string> = {
  '80mm': '80mm (Estándar)',
  '58mm': '58mm (Mini térmica)',
  a4: 'Carta / A4',
};

export const STICKER_SIZE_DIMENSIONS: Record<
  StickerSizeOption,
  { widthMm: number; heightMm: number; label: string; shortLabel: string }
> = {
  '50x25': {
    widthMm: 50,
    heightMm: 25,
    label: '50mm x 25mm (Estándar ropa/accesorios)',
    shortLabel: '50mm × 25mm',
  },
  '50x30': {
    widthMm: 50,
    heightMm: 30,
    label: '50mm x 30mm',
    shortLabel: '50mm × 30mm',
  },
  '40x20': {
    widthMm: 40,
    heightMm: 20,
    label: '40mm x 20mm (Joyería/Tiaras)',
    shortLabel: '40mm × 20mm',
  },
};

const HARDWARE_STORAGE_KEY = 'boutique_terminal_hardware_v1';

function readStoredHardwareSettings(): HardwareSettings {
  if (typeof window === 'undefined') return DEFAULT_HARDWARE_SETTINGS;
  try {
    const raw = window.localStorage.getItem(HARDWARE_STORAGE_KEY);
    if (!raw) return DEFAULT_HARDWARE_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<HardwareSettings>;
    return {
      ticketWidth:
        parsed.ticketWidth === '58mm' || parsed.ticketWidth === '80mm' || parsed.ticketWidth === 'a4'
          ? parsed.ticketWidth
          : DEFAULT_HARDWARE_SETTINGS.ticketWidth,
      stickerSize:
        parsed.stickerSize === '50x25' ||
        parsed.stickerSize === '50x30' ||
        parsed.stickerSize === '40x20'
          ? parsed.stickerSize
          : DEFAULT_HARDWARE_SETTINGS.stickerSize,
      globalScannerEnabled:
        typeof parsed.globalScannerEnabled === 'boolean'
          ? parsed.globalScannerEnabled
          : DEFAULT_HARDWARE_SETTINGS.globalScannerEnabled,
      posScanAction:
        parsed.posScanAction === 'add_to_cart' || parsed.posScanAction === 'show_detail'
          ? parsed.posScanAction
          : DEFAULT_HARDWARE_SETTINGS.posScanAction,
    };
  } catch {
    return DEFAULT_HARDWARE_SETTINGS;
  }
}

export function triggerHardwarePrint(
  mode: 'ticket' | 'sticker',
  settings: HardwareSettings
): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const styleId = 'boutique-dynamic-page-rule';
  let styleEl = document.getElementById(styleId) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = styleId;
    document.head.appendChild(styleEl);
  }

  if (mode === 'sticker') {
    const dims = STICKER_SIZE_DIMENSIONS[settings.stickerSize];
    styleEl.textContent = `@media print { @page { size: ${dims.widthMm}mm ${dims.heightMm}mm; margin: 0; } }`;
  } else {
    if (settings.ticketWidth === '58mm') {
      styleEl.textContent = `@media print { @page { size: 58mm auto; margin: 2mm; } }`;
    } else if (settings.ticketWidth === '80mm') {
      styleEl.textContent = `@media print { @page { size: 80mm auto; margin: 3mm; } }`;
    } else {
      styleEl.textContent = `@media print { @page { size: letter portrait; margin: 12mm; } }`;
    }
  }

  document.documentElement.dataset.printMode = mode;
  window.print();
}

interface HardwareContextValue {
  hardware: HardwareSettings;
  updateHardware: (patch: Partial<HardwareSettings>) => void;
  resetHardware: () => void;
}

const HardwareContext = createContext<HardwareContextValue | null>(null);

export function HardwareProvider({ children }: { children: React.ReactNode }) {
  const [hardware, setHardware] = useState<HardwareSettings>(() => readStoredHardwareSettings());

  useEffect(() => {
    document.documentElement.dataset.ticketWidth = hardware.ticketWidth;
    document.documentElement.dataset.stickerSize = hardware.stickerSize;
    try {
      window.localStorage.setItem(HARDWARE_STORAGE_KEY, JSON.stringify(hardware));
    } catch {
      // Ignore storage quota errors
    }
  }, [hardware]);

  const updateHardware = useCallback((patch: Partial<HardwareSettings>) => {
    setHardware((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetHardware = useCallback(() => {
    setHardware(DEFAULT_HARDWARE_SETTINGS);
  }, []);

  return (
    <HardwareContext.Provider value={{ hardware, updateHardware, resetHardware }}>
      {children}
    </HardwareContext.Provider>
  );
}

export function useHardware(): HardwareContextValue {
  const ctx = useContext(HardwareContext);
  if (!ctx) {
    throw new Error('useHardware debe utilizarse dentro de HardwareProvider.');
  }
  return ctx;
}
