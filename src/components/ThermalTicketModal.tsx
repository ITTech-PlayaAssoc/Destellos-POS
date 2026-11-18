import { CheckCircle2, Printer, X } from 'lucide-react';
import { formatCurrency, formatDateTime } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import {
  TICKET_WIDTH_LABELS,
  triggerHardwarePrint,
  useHardware,
} from '../context/HardwareContext';
import type {
  BranchId,
  CashRegisterShift,
  Layaway,
  LayawayPayment,
  Sale,
} from '../types/boutique';

export type ThermalDocument =
  | {
      type: 'sale';
      sale: Sale & { issuedLocallyAt?: Date };
    }
  | {
      type: 'layaway_payment';
      payment: LayawayPayment & { issuedLocallyAt?: Date };
      layaway?: Layaway | null;
    }
  | {
      type: 'cash_closure';
      shift: CashRegisterShift & { openedLocallyAt?: Date; closedLocallyAt?: Date };
    }
  | {
      type: 'test_ticket';
      branchId: BranchId;
      branchName: string;
      operatorName: string;
    };

interface ThermalTicketModalProps {
  document: ThermalDocument;
  onClose: () => void;
  closeLabel?: string;
}

export function ThermalTicketModal({
  document,
  onClose,
  closeLabel = 'Cerrar',
}: ThermalTicketModalProps) {
  const { branding, branches } = useAuth();
  const { hardware } = useHardware();

  const companyName = branding.companyName?.trim() || 'Atelier Aurelia';
  const widthMode = hardware.ticketWidth;
  const isMini58 = widthMode === '58mm';
  const isA4 = widthMode === 'a4';

  const branchId =
    document.type === 'sale'
      ? document.sale.branchId
      : document.type === 'layaway_payment'
        ? document.payment.branchId
        : document.type === 'cash_closure'
          ? document.shift.branchId
          : document.branchId;

  const branchName =
    document.type === 'sale'
      ? document.sale.branchName
      : document.type === 'layaway_payment'
        ? document.payment.branchName
        : document.type === 'cash_closure'
          ? document.shift.branchName
          : document.branchName;

  const branchInfo = branches[branchId];

  const modalTitle =
    document.type === 'sale'
      ? `Ticket de Venta — ${document.sale.folio}`
      : document.type === 'layaway_payment'
        ? `Recibo de Abono — ${document.payment.receiptFolio}`
        : document.type === 'cash_closure'
          ? `Comprobante de Cierre — ${document.shift.folio}`
          : `Ticket de Prueba (${TICKET_WIDTH_LABELS[widthMode]})`;

  const printButtonLabel =
    document.type === 'cash_closure'
      ? 'Imprimir Corte'
      : document.type === 'layaway_payment'
        ? 'Imprimir Recibo'
        : 'Imprimir Ticket';

  const previewWidthClass = isMini58
    ? 'max-w-[230px] text-[10px]'
    : isA4
      ? 'max-w-[540px] text-xs'
      : 'max-w-[304px] text-[11px]';

  // Layaway calculation helpers
  const layawayTotal =
    document.type === 'layaway_payment'
      ? document.layaway?.total ??
        (document.payment.isInitialDeposit
          ? document.payment.balanceBefore
          : Math.max(document.payment.balanceBefore, document.payment.amount + document.payment.balanceAfter))
      : 0;
  const layawayTotalPaid =
    document.type === 'layaway_payment'
      ? document.layaway?.totalPaid ?? Math.max(0, layawayTotal - document.payment.balanceAfter)
      : 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 ticket-print-overlay"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-xl border border-stone-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-xl overflow-hidden max-h-[92vh] flex flex-col ticket-print-shell">
        {/* Interactive Modal Header (hidden during print) */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-stone-200 dark:border-zinc-800 no-print">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 min-w-0">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-stone-900 dark:text-zinc-100 truncate">
                {modalTitle}
              </h2>
              <p className="text-[11px] text-stone-500 dark:text-zinc-400">
                Formato térmico configurado: {TICKET_WIDTH_LABELS[widthMode]}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100 cursor-pointer shrink-0"
            aria-label="Cerrar vista previa"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Thermal Paper Preview & Print Sheet */}
        <div className="overflow-y-auto p-5 bg-stone-50 dark:bg-zinc-950/60 flex justify-center ticket-print-scroll">
          <div
            className={`ticket-print-area w-full ${previewWidthClass} bg-white text-black border border-stone-300 rounded-md p-4 shadow-xs font-mono-tabular leading-snug`}
          >
            {/* Common Boutique Header */}
            <div className="text-center border-b border-dashed border-black pb-2.5 space-y-0.5">
              {branding.companyLogoUrl && (
                <img
                  src={branding.companyLogoUrl}
                  alt={companyName}
                  referrerPolicy="no-referrer"
                  className={`${isMini58 ? 'h-8 max-w-24' : 'h-10 max-w-32'} w-auto mx-auto mb-1 object-contain`}
                />
              )}
              <p className={`${isMini58 ? 'text-base' : 'text-lg'} font-display font-bold text-black tracking-tight`}>
                {companyName}
              </p>
              <p className="font-bold text-black">{branchName}</p>
              {branchInfo?.address && <p className="text-[10px] text-black">{branchInfo.address}</p>}
              {(branchInfo?.city || branchInfo?.phone) && (
                <p className="text-[10px] text-black">
                  {[branchInfo?.city, branchInfo?.phone].filter(Boolean).join(' · Tel. ')}
                </p>
              )}

              {document.type === 'sale' && document.sale.status === 'cancelada' && (
                <p className="mt-1 py-1 border border-black font-bold uppercase tracking-wider">
                  TICKET CANCELADO
                </p>
              )}
              {document.type === 'layaway_payment' && (
                <p className="font-bold uppercase tracking-wider pt-1">
                  {document.payment.isInitialDeposit
                    ? 'ANTICIPO DE APARTADO'
                    : 'ABONO A APARTADO'}
                </p>
              )}
              {document.type === 'cash_closure' && (
                <p className="font-bold uppercase tracking-wider pt-1">CORTE DE CAJA</p>
              )}
              {document.type === 'test_ticket' && (
                <p className="font-bold uppercase tracking-wider pt-1">
                  TICKET DE PRUEBA ({widthMode.toUpperCase()})
                </p>
              )}
            </div>

            {/* ================= SALE DOCUMENT ================= */}
            {document.type === 'sale' && (
              <>
                <div className="py-2 border-b border-dashed border-black space-y-0.5">
                  <div className="flex justify-between gap-2">
                    <span>Folio:</span>
                    <span className="font-bold">{document.sale.folio}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Fecha:</span>
                    <span>
                      {formatDateTime(document.sale.createdAt || document.sale.issuedLocallyAt)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Atendió:</span>
                    <span className="text-right truncate">{document.sale.sellerName}</span>
                  </div>
                  {document.sale.customerName && (
                    <div className="flex justify-between gap-2">
                      <span>Cliente:</span>
                      <span className="text-right font-bold truncate">
                        {document.sale.customerName}
                      </span>
                    </div>
                  )}
                  {document.sale.status === 'cancelada' && document.sale.cancellationReason && (
                    <div className="pt-1 font-bold">
                      Motivo cancelación: {document.sale.cancellationReason}
                    </div>
                  )}
                </div>

                <div className="py-2 border-b border-dashed border-black">
                  {isMini58 ? (
                    <div className="space-y-2">
                      {document.sale.items.map((item, idx) => (
                        <div key={idx} className="border-b border-dotted border-black/40 pb-1 last:border-b-0 last:pb-0">
                          <div className="font-bold">{item.name}</div>
                          <div className="text-[9px]">
                            {item.sku} · {item.size} · {item.color}
                          </div>
                          <div className="flex justify-between">
                            <span>
                              {item.quantity} × {formatCurrency(item.unitPrice)}
                            </span>
                            <span className="font-bold">{formatCurrency(item.lineTotal)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-black">
                          <th className="pb-1 font-bold">Artículo</th>
                          <th className="pb-1 text-center font-bold">Cant</th>
                          <th className="pb-1 text-right font-bold">Importe</th>
                        </tr>
                      </thead>
                      <tbody>
                        {document.sale.items.map((item, idx) => (
                          <tr key={idx} className="border-b border-dotted border-black/30 last:border-b-0">
                            <td className="py-1 pr-1.5 align-top">
                              <div className="font-bold">{item.name}</div>
                              <div className="text-[9.5px]">
                                {item.sku} · {item.size} · {item.color}
                              </div>
                              <div className="text-[9.5px]">
                                P.U. {formatCurrency(item.unitPrice)}
                              </div>
                            </td>
                            <td className="py-1 text-center align-top">{item.quantity}</td>
                            <td className="py-1 text-right font-bold align-top whitespace-nowrap">
                              {formatCurrency(item.lineTotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                <div className="pt-2 space-y-1">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{formatCurrency(document.sale.subtotal)}</span>
                  </div>
                  {document.sale.discountAmount > 0 && (
                    <div className="flex justify-between">
                      <span>Descuento</span>
                      <span>-{formatCurrency(document.sale.discountAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold pt-1 border-t border-black">
                    <span>TOTAL</span>
                    <span>{formatCurrency(document.sale.total)}</span>
                  </div>
                  <div className="pt-1 flex justify-between">
                    <span>Método de pago</span>
                    <span className="font-bold">{document.sale.paymentMethod}</span>
                  </div>
                  {document.sale.paymentMethod === 'Tarjeta' && document.sale.cardReference && (
                    <div className="flex justify-between">
                      <span>Autorización</span>
                      <span>{document.sale.cardReference}</span>
                    </div>
                  )}
                  {document.sale.paymentMethod === 'Transferencia' &&
                    document.sale.transferReference && (
                      <div className="flex justify-between">
                        <span>Rastreo</span>
                        <span>{document.sale.transferReference}</span>
                      </div>
                    )}
                  {document.sale.paymentMethod === 'Efectivo' && (
                    <>
                      <div className="flex justify-between">
                        <span>Recibido</span>
                        <span>{formatCurrency(document.sale.cashReceived)}</span>
                      </div>
                      <div className="flex justify-between font-bold">
                        <span>Cambio</span>
                        <span>{formatCurrency(document.sale.changeGiven)}</span>
                      </div>
                    </>
                  )}
                </div>

                <div className="mt-3 pt-2.5 border-t border-dashed border-black text-center text-[10px]">
                  <p className="font-bold">¡Gracias por su preferencia!</p>
                  <p className="mt-0.5">Conserve este ticket para cualquier aclaración.</p>
                </div>
              </>
            )}

            {/* ================= LAYAWAY RECEIPT DOCUMENT ================= */}
            {document.type === 'layaway_payment' && (
              <>
                <div className="py-2 border-b border-dashed border-black space-y-0.5">
                  <div className="flex justify-between gap-2">
                    <span>Recibo:</span>
                    <span className="font-bold">{document.payment.receiptFolio}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Apartado:</span>
                    <span className="font-bold">{document.payment.layawayFolio}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Fecha:</span>
                    <span>
                      {formatDateTime(
                        document.payment.createdAt || document.payment.issuedLocallyAt
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Cliente:</span>
                    <span className="text-right font-bold truncate">
                      {document.payment.customerName}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Atendió:</span>
                    <span className="text-right truncate">{document.payment.sellerName}</span>
                  </div>
                </div>

                {document.layaway?.items && document.layaway.items.length > 0 && (
                  <div className="py-2 border-b border-dashed border-black space-y-1">
                    <p className="font-bold uppercase text-[10px]">Prendas apartadas:</p>
                    {document.layaway.items.map((it, idx) => (
                      <div key={idx} className="flex justify-between gap-1 text-[10px]">
                        <span className="truncate">
                          {it.quantity}× {it.name} ({it.size})
                        </span>
                        <span className="shrink-0">{formatCurrency(it.lineTotal)}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="py-2.5 space-y-1">
                  <div className="flex justify-between">
                    <span>Total del apartado</span>
                    <span className="font-bold">{formatCurrency(layawayTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Saldo anterior</span>
                    <span>{formatCurrency(document.payment.balanceBefore)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold pt-1 border-t border-black">
                    <span>ABONO ACTUAL</span>
                    <span>{formatCurrency(document.payment.amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total abonado</span>
                    <span className="font-bold">{formatCurrency(layawayTotalPaid)}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t border-dotted border-black">
                    <span>SALDO RESTANTE</span>
                    <span>{formatCurrency(document.payment.balanceAfter)}</span>
                  </div>

                  <div className="pt-2 border-t border-dashed border-black space-y-0.5">
                    <div className="flex justify-between">
                      <span>Método de pago</span>
                      <span className="font-bold">{document.payment.paymentMethod}</span>
                    </div>
                    {document.payment.reference && (
                      <div className="flex justify-between">
                        <span>Referencia</span>
                        <span>{document.payment.reference}</span>
                      </div>
                    )}
                    {document.payment.paymentMethod === 'Efectivo' && (
                      <>
                        <div className="flex justify-between">
                          <span>Recibido</span>
                          <span>{formatCurrency(document.payment.cashReceived)}</span>
                        </div>
                        <div className="flex justify-between font-bold">
                          <span>Cambio</span>
                          <span>{formatCurrency(document.payment.changeGiven)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-2 pt-2.5 border-t border-dashed border-black text-center text-[10px]">
                  <p className="font-bold">
                    {document.payment.balanceAfter === 0
                      ? '¡Apartado liquidado! Listo para entrega.'
                      : 'Apartado sin intereses ni plazos forzosos.'}
                  </p>
                  <p className="mt-0.5">Conserve este comprobante para futuros abonos o entrega.</p>
                </div>
              </>
            )}

            {/* ================= CASH REGISTER CLOSURE ================= */}
            {document.type === 'cash_closure' && (
              <>
                <div className="py-2 border-b border-dashed border-black space-y-0.5">
                  <div className="flex justify-between gap-2">
                    <span>Folio:</span>
                    <span className="font-bold">{document.shift.folio}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Apertura:</span>
                    <span>
                      {formatDateTime(document.shift.openedAt || document.shift.openedLocallyAt)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Cierre:</span>
                    <span>
                      {formatDateTime(document.shift.closedAt || document.shift.closedLocallyAt)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Abrió:</span>
                    <span className="text-right truncate">{document.shift.openedByName}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Cerró:</span>
                    <span className="text-right truncate">
                      {document.shift.closedByName || document.shift.openedByName}
                    </span>
                  </div>
                </div>

                <div className="py-2 border-b border-dashed border-black space-y-0.5">
                  <p className="font-bold">VENTAS DIRECTAS ({document.shift.directSalesCount || 0})</p>
                  <div className="flex justify-between">
                    <span>Efectivo</span>
                    <span>{formatCurrency(document.shift.directSalesCash || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tarjeta</span>
                    <span>{formatCurrency(document.shift.directSalesCard || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Transferencia</span>
                    <span>{formatCurrency(document.shift.directSalesTransfer || 0)}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-0.5">
                    <span>Subtotal ventas</span>
                    <span>{formatCurrency(document.shift.directSalesTotal || 0)}</span>
                  </div>
                </div>

                <div className="py-2 border-b border-dashed border-black space-y-0.5">
                  <p className="font-bold">
                    ABONOS APARTADOS ({document.shift.layawayPaymentsCount || 0})
                  </p>
                  <div className="flex justify-between">
                    <span>Efectivo</span>
                    <span>{formatCurrency(document.shift.layawayCash || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Tarjeta</span>
                    <span>{formatCurrency(document.shift.layawayCard || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Transferencia</span>
                    <span>{formatCurrency(document.shift.layawayTransfer || 0)}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-0.5">
                    <span>Subtotal abonos</span>
                    <span>{formatCurrency(document.shift.layawayTotal || 0)}</span>
                  </div>
                </div>

                <div className="py-2 space-y-1">
                  <div className="flex justify-between">
                    <span>Total Tarjeta</span>
                    <span>{formatCurrency(document.shift.totalCard || 0)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Total Transferencia</span>
                    <span>{formatCurrency(document.shift.totalTransfer || 0)}</span>
                  </div>
                  <div className="flex justify-between font-bold pt-1 border-t border-black">
                    <span>INGRESOS TURNO</span>
                    <span>{formatCurrency(document.shift.grandTotalIncome || 0)}</span>
                  </div>

                  <div className="pt-1.5 mt-1 border-t border-dashed border-black space-y-0.5">
                    <div className="flex justify-between">
                      <span>Fondo inicial</span>
                      <span>{formatCurrency(document.shift.openingFund || 0)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Efectivo esperado</span>
                      <span>{formatCurrency(document.shift.expectedCashTotal || 0)}</span>
                    </div>
                    <div className="flex justify-between font-bold">
                      <span>Efectivo contado</span>
                      <span>{formatCurrency(document.shift.countedCash || 0)}</span>
                    </div>
                    <div className="flex justify-between font-bold pt-1 border-t border-black">
                      <span>
                        {(document.shift.difference || 0) === 0
                          ? 'CUADRE EXACTO'
                          : (document.shift.difference || 0) > 0
                            ? 'SOBRANTE'
                            : 'FALTANTE'}
                      </span>
                      <span>{formatCurrency(document.shift.difference || 0)}</span>
                    </div>
                  </div>
                </div>

                {document.shift.observations && (
                  <div className="pt-2 border-t border-dashed border-black text-[10px]">
                    <p className="font-bold">Observaciones:</p>
                    <p className="mt-0.5">{document.shift.observations}</p>
                  </div>
                )}

                <div className="mt-3 pt-2.5 border-t border-dashed border-black text-center text-[10px]">
                  <p>Firma de conformidad</p>
                  <div className="mt-6 border-t border-black w-40 mx-auto pt-1 font-bold">
                    {document.shift.closedByName || document.shift.openedByName}
                  </div>
                </div>
              </>
            )}

            {/* ================= HARDWARE CALIBRATION TEST TICKET ================= */}
            {document.type === 'test_ticket' && (
              <>
                <div className="py-2 border-b border-dashed border-black space-y-0.5">
                  <div className="flex justify-between gap-2">
                    <span>Folio prueba:</span>
                    <span className="font-bold">TEST-CALIBRACION</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Fecha:</span>
                    <span>{formatDateTime(new Date())}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Ancho papel:</span>
                    <span className="font-bold">{TICKET_WIDTH_LABELS[widthMode]}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span>Operador:</span>
                    <span className="truncate">{document.operatorName}</span>
                  </div>
                </div>

                <div className="py-2 border-b border-dashed border-black space-y-1">
                  <p className="font-bold text-center">--- PRUEBA DE ALINEACIÓN ---</p>
                  <p className="text-center tracking-tight overflow-hidden">
                    {isMini58 ? '12345678901234567890123456' : '1234567890123456789012345678901234'}
                  </p>
                  <div className="flex justify-between pt-1">
                    <span>1× Artículo de prueba (M)</span>
                    <span className="font-bold">{formatCurrency(1000)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>1× Tiara de prueba</span>
                    <span className="font-bold">{formatCurrency(450)}</span>
                  </div>
                </div>

                <div className="pt-2 space-y-1">
                  <div className="flex justify-between text-sm font-bold">
                    <span>TOTAL PRUEBA</span>
                    <span>{formatCurrency(1450)}</span>
                  </div>
                </div>

                <div className="mt-3 pt-2.5 border-t border-dashed border-black text-center text-[10px]">
                  <p className="font-bold">Impresión térmica calibrada correctamente.</p>
                  <p className="mt-0.5">Sin comprobante fiscal.</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-4 border-t border-stone-200 dark:border-zinc-800 flex gap-3 no-print">
          <button
            type="button"
            onClick={() => triggerHardwarePrint('ticket', hardware)}
            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-stone-300 dark:border-zinc-700 text-sm font-medium text-stone-700 dark:text-zinc-200 hover:bg-stone-50 dark:hover:bg-zinc-800 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            <span>{printButtonLabel}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-4 py-2.5 rounded-lg bg-stone-900 text-white hover:bg-stone-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-200 text-sm font-medium cursor-pointer"
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
