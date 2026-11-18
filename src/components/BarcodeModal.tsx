import { useMemo, useState } from 'react';
import { Barcode, Check, CheckCircle2, ChevronLeft, ChevronRight, Copy, Printer, X } from 'lucide-react';
import { formatCurrency } from '../lib/utils';
import {
  STICKER_SIZE_DIMENSIONS,
  triggerHardwarePrint,
  useHardware,
} from '../context/HardwareContext';
import type { Product } from '../types/boutique';
import { BarcodeGraphic } from './BarcodeGraphic';

export interface StickerBatchItem {
  product: Product;
  copies: number;
}

interface BarcodeModalProps {
  product?: Product | null;
  batchItems?: StickerBatchItem[];
  initialCopies?: number;
  justCreated?: boolean;
  isTestLabel?: boolean;
  onClose: () => void;
}

function getStickerBarcodeValue(product: Product): string {
  return (product.barcodeSKU || product.sku || '').trim();
}

export function BarcodeModal({
  product,
  batchItems,
  initialCopies = 1,
  justCreated = false,
  isTestLabel = false,
  onClose,
}: BarcodeModalProps) {
  const { hardware } = useHardware();
  const stickerDims = STICKER_SIZE_DIMENSIONS[hardware.stickerSize];
  const isBatchMode = Boolean(batchItems && batchItems.length > 0);

  const [copied, setCopied] = useState(false);
  const [copiesInput, setCopiesInput] = useState(String(Math.max(1, initialCopies)));
  const [batchMultiplierMode, setBatchMultiplierMode] = useState<'stock' | 'one_each'>('stock');
  const [previewIdx, setPreviewIdx] = useState(0);

  const parsedCopies = Math.min(500, Math.max(1, Math.floor(Number(copiesInput) || 1)));

  const resolvedBatch = useMemo<StickerBatchItem[]>(() => {
    if (isBatchMode && batchItems) {
      return batchItems.map((entry) => ({
        product: entry.product,
        copies:
          batchMultiplierMode === 'one_each'
            ? 1
            : Math.min(200, Math.max(1, Math.floor(entry.copies || 1))),
      }));
    }
    if (product) {
      return [{ product, copies: parsedCopies }];
    }
    return [];
  }, [isBatchMode, batchItems, batchMultiplierMode, product, parsedCopies]);

  const totalStickers = useMemo(
    () => resolvedBatch.reduce((sum, item) => sum + item.copies, 0),
    [resolvedBatch]
  );

  // Cap sequential DOM nodes at 1500 to prevent browser print lag on huge imports
  const expandedStickers = useMemo(() => {
    const out: Product[] = [];
    for (const entry of resolvedBatch) {
      for (let i = 0; i < entry.copies; i++) {
        out.push(entry.product);
        if (out.length >= 1500) return out;
      }
    }
    return out;
  }, [resolvedBatch]);

  const activePreviewProduct =
    resolvedBatch[Math.min(previewIdx, Math.max(0, resolvedBatch.length - 1))]?.product || product;

  if (!activePreviewProduct) return null;

  const activeBarcodeValue = getStickerBarcodeValue(activePreviewProduct);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeBarcodeValue);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handlePrint = () => {
    if (!isBatchMode) {
      setCopiesInput(String(parsedCopies));
    }
    triggerHardwarePrint('sticker', hardware);
  };

  const previewAspectClass =
    hardware.stickerSize === '50x30'
      ? 'aspect-[5/3] max-w-[310px]'
      : hardware.stickerSize === '40x20'
        ? 'aspect-[2/1] max-w-[260px]'
        : 'aspect-[2/1] max-w-[300px]';

  const isCompact40x20 = hardware.stickerSize === '40x20';
  const isTall50x30 = hardware.stickerSize === '50x30';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 sticker-print-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="barcode-modal-title"
    >
      {/* Interactive Modal Chrome (hidden during print) */}
      <div className="w-full max-w-md rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg overflow-hidden no-print">
        <div className="flex items-center justify-between px-6 py-4 border-b border-stone-200 dark:border-zinc-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <Barcode className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0" />
            <h2
              id="barcode-modal-title"
              className="text-base font-semibold text-stone-900 dark:text-zinc-100 truncate"
            >
              {isTestLabel
                ? 'Etiqueta de Calibración'
                : isBatchMode
                  ? `Imprimir Lote de Etiquetas (${resolvedBatch.length})`
                  : 'Imprimir Etiquetas / Stickers'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 hover:bg-stone-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
            aria-label="Cerrar modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {justCreated && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/40 px-4 py-2.5 flex items-center gap-2 text-xs text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Producto guardado. Etiqueta lista para imprimir y escanear en caja.</span>
            </div>
          )}

          {isTestLabel && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/30 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200">
              Etiqueta de prueba para verificar el tamaño{' '}
              <span className="font-mono-tabular font-semibold">{stickerDims.shortLabel}</span> y
              la lectura del escáner CODE128 en mostrador.
            </div>
          )}

          {/* Adhesive Sticker Live Preview */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-stone-500 dark:text-zinc-400">
              <span>Vista previa de etiqueta adhesiva (CODE128)</span>
              <span className="font-mono-tabular font-semibold text-stone-700 dark:text-zinc-300">
                {stickerDims.shortLabel}
              </span>
            </div>

            <div className="rounded-lg border border-dashed border-stone-300 dark:border-zinc-700 bg-stone-50 dark:bg-zinc-950 p-4 flex flex-col items-center gap-3">
              <div
                className={`w-full ${previewAspectClass} rounded-md border border-stone-300 bg-white px-3 py-2 text-black shadow-xs flex flex-col justify-between overflow-hidden`}
              >
                <div>
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={`${isCompact40x20 ? 'text-[11px]' : 'text-xs'} font-bold text-black truncate`}
                    >
                      {activePreviewProduct.name}
                    </p>
                    <p
                      className={`font-mono-tabular ${isCompact40x20 ? 'text-[11px]' : 'text-xs'} font-bold text-black shrink-0`}
                    >
                      {formatCurrency(activePreviewProduct.price)}
                    </p>
                  </div>
                  <p className="text-[10px] text-stone-700 truncate">
                    {!isCompact40x20 && activePreviewProduct.category
                      ? `${activePreviewProduct.category} · `
                      : ''}
                    T.{activePreviewProduct.size} · {activePreviewProduct.color}
                  </p>
                </div>

                <div className="flex items-center justify-center overflow-hidden">
                  <BarcodeGraphic
                    value={activeBarcodeValue}
                    width={1.55}
                    height={isCompact40x20 ? 28 : isTall50x30 ? 40 : 34}
                    fontSize={isCompact40x20 ? 9 : 10}
                    margin={1}
                    textMargin={1}
                    lineColor="#000000"
                    displayValue
                    className={`max-w-full ${isCompact40x20 ? 'max-h-[46px]' : isTall50x30 ? 'max-h-[66px]' : 'max-h-[56px]'} w-auto h-auto mx-auto`}
                  />
                </div>
              </div>

              {isBatchMode && resolvedBatch.length > 1 && (
                <div className="flex items-center justify-between w-full text-xs text-stone-600 dark:text-zinc-400">
                  <button
                    type="button"
                    onClick={() =>
                      setPreviewIdx((i) => (i - 1 + resolvedBatch.length) % resolvedBatch.length)
                    }
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-stone-300 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-900 cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Anterior</span>
                  </button>
                  <span className="font-mono-tabular">
                    Modelo {previewIdx + 1} de {resolvedBatch.length} (
                    {resolvedBatch[previewIdx]?.copies ?? 1} pza.)
                  </span>
                  <button
                    type="button"
                    onClick={() => setPreviewIdx((i) => (i + 1) % resolvedBatch.length)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-stone-300 dark:border-zinc-700 hover:bg-white dark:hover:bg-zinc-900 cursor-pointer"
                  >
                    <span>Siguiente</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Quantity Controls */}
          {isBatchMode ? (
            <div className="space-y-2">
              <label className="block text-xs font-medium text-stone-700 dark:text-zinc-300">
                Cantidad de etiquetas por producto importado
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setBatchMultiplierMode('stock')}
                  className={`px-3 py-2 rounded-lg border text-xs font-medium text-left transition-colors cursor-pointer ${
                    batchMultiplierMode === 'stock'
                      ? 'border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  Según stock ingresado
                </button>
                <button
                  type="button"
                  onClick={() => setBatchMultiplierMode('one_each')}
                  className={`px-3 py-2 rounded-lg border text-xs font-medium text-left transition-colors cursor-pointer ${
                    batchMultiplierMode === 'one_each'
                      ? 'border-stone-900 bg-stone-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-stone-300 dark:border-zinc-700 text-stone-700 dark:text-zinc-300 hover:bg-stone-50 dark:hover:bg-zinc-800'
                  }`}
                >
                  1 etiqueta por producto
                </button>
              </div>
              <p className="text-xs text-stone-500 dark:text-zinc-400">
                Total en cola de impresión:{' '}
                <span className="font-mono-tabular font-semibold text-stone-900 dark:text-zinc-100">
                  {Math.min(1500, totalStickers)}
                </span>{' '}
                etiqueta(s) ({stickerDims.shortLabel}).
                {totalStickers > 1500 && ' (Limitado a 1,500 por tiraje).'}
              </p>
            </div>
          ) : (
            <div>
              <label
                htmlFor="sticker-copies-input"
                className="block text-xs font-medium text-stone-700 dark:text-zinc-300 mb-1.5"
              >
                Cantidad de etiquetas a imprimir
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="sticker-copies-input"
                  type="number"
                  min={1}
                  max={500}
                  step={1}
                  value={copiesInput}
                  onChange={(e) => setCopiesInput(e.target.value)}
                  className="w-28 rounded-lg border border-stone-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm font-mono-tabular text-stone-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-amber-600/40"
                />
                <span className="text-xs text-stone-500 dark:text-zinc-400">
                  Se imprimirán{' '}
                  <span className="font-mono-tabular font-semibold text-stone-800 dark:text-zinc-200">
                    {parsedCopies}
                  </span>{' '}
                  {parsedCopies === 1 ? 'sticker en serie' : 'stickers en serie'} (
                  {stickerDims.shortLabel}).
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleCopy}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-800 dark:text-zinc-100 hover:bg-stone-50 dark:hover:bg-zinc-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'SKU copiado' : 'Copiar SKU'}</span>
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir Stickers</span>
            </button>
          </div>
        </div>
      </div>

      {/* Print-Only Sequential Roll Adhesive Labels */}
      <div className="hidden sticker-print-sheet" aria-hidden="true">
        {expandedStickers.map((item, index) => {
          const codeVal = getStickerBarcodeValue(item);
          return (
            <div key={`${item.id}-${index}`} className="sticker-print-item">
              <div>
                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className={`${
                      isCompact40x20 ? 'text-[6pt]' : 'text-[7.2pt]'
                    } font-bold leading-tight text-black truncate`}
                  >
                    {item.name}
                  </span>
                  <span
                    className={`font-mono-tabular ${
                      isCompact40x20 ? 'text-[6pt]' : 'text-[7.2pt]'
                    } font-bold leading-tight text-black shrink-0`}
                  >
                    {formatCurrency(item.price)}
                  </span>
                </div>
                <div
                  className={`${
                    isCompact40x20 ? 'text-[5.2pt]' : 'text-[6pt]'
                  } leading-tight text-black truncate`}
                >
                  {!isCompact40x20 && item.category ? `${item.category} · ` : ''}
                  T.{item.size} · {item.color}
                </div>
              </div>

              <div className="flex items-center justify-center overflow-hidden">
                <BarcodeGraphic
                  value={codeVal}
                  width={isCompact40x20 ? 1.5 : 1.6}
                  height={isCompact40x20 ? 20 : isTall50x30 ? 30 : 24}
                  fontSize={isCompact40x20 ? 7.5 : 8.5}
                  margin={0}
                  textMargin={1}
                  lineColor="#000000"
                  displayValue
                  className={`w-auto ${
                    isCompact40x20
                      ? 'max-w-[37.5mm] max-h-[11.5mm]'
                      : isTall50x30
                        ? 'max-w-[46mm] max-h-[18mm]'
                        : 'max-w-[46mm] max-h-[14mm]'
                  } h-auto mx-auto`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
