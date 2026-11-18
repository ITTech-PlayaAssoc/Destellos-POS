import { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import type { Product } from '../types/boutique';

export function sanitizeSkuValue(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .replace(/[^A-Za-z0-9\-_./]/g, '')
    .toUpperCase();
}

export function generateNextBoutiqueSku(existingProducts: Product[]): string {
  const existingSet = new Set(existingProducts.map((p) => p.sku.trim().toUpperCase()));
  let maxSeq = 0;

  for (const prod of existingProducts) {
    const match = /^BTQ-(\d{1,9})$/i.exec(prod.sku.trim());
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) {
        maxSeq = parsed;
      }
    }
  }

  let nextSeq = maxSeq + 1;
  let candidate = `BTQ-${String(nextSeq).padStart(6, '0')}`;
  while (existingSet.has(candidate)) {
    nextSeq += 1;
    candidate = `BTQ-${String(nextSeq).padStart(6, '0')}`;
  }
  return candidate;
}

interface BarcodeGraphicProps {
  value: string;
  width?: number;
  height?: number;
  fontSize?: number;
  margin?: number;
  textMargin?: number;
  displayValue?: boolean;
  lineColor?: string;
  className?: string;
}

export function BarcodeGraphic({
  value,
  width = 1.6,
  height = 44,
  fontSize = 11,
  margin = 4,
  textMargin = 2,
  displayValue = true,
  lineColor = '#000000',
  className = 'max-w-full h-auto mx-auto',
}: BarcodeGraphicProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [renderError, setRenderError] = useState(false);
  const cleanValue = value.trim();

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !cleanValue) {
      setRenderError(false);
      return;
    }

    try {
      JsBarcode(svg, cleanValue, {
        format: 'CODE128',
        lineColor,
        background: '#ffffff',
        width,
        height,
        displayValue,
        font: 'JetBrains Mono, ui-monospace, monospace',
        fontOptions: '600',
        fontSize,
        margin,
        textMargin,
      });
      setRenderError(false);
    } catch {
      while (svg.firstChild) {
        svg.removeChild(svg.firstChild);
      }
      setRenderError(true);
    }
  }, [cleanValue, width, height, fontSize, margin, textMargin, displayValue, lineColor]);

  if (!cleanValue) {
    return (
      <p className="text-xs text-stone-400 dark:text-zinc-500 py-3 text-center">
        Ingresa o genera un código para ver la vista previa CODE128.
      </p>
    );
  }

  if (renderError) {
    return (
      <p className="text-xs text-red-600 dark:text-red-400 py-3 text-center">
        El código contiene caracteres no compatibles con formato CODE128.
      </p>
    );
  }

  return (
    <svg
      ref={svgRef}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={`Código de barras CODE128 ${cleanValue}`}
    />
  );
}
