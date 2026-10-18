// An invoice as kept in the database: the reading plus the check.
import type { Finding } from './check';
import { REQUEST_PREFIX, type ParsedInvoice } from './parse';

export interface StoredInvoice extends ParsedInvoice {
  id?: string;
  source: 'history' | 'upload';
  created_at?: string;
  created_by?: string | null;
  findings: Finding[];
  overcharge: number;
  status: 'ok' | 'flagged';
}

/** Database row ⇄ invoice. */
export function fromRow(r: Record<string, unknown>): StoredInvoice {
  return {
    id: r.id as string,
    source: r.source as StoredInvoice['source'],
    created_at: r.created_at as string,
    created_by: (r.created_by as string) ?? null,
    carrier: r.carrier as StoredInvoice['carrier'],
    invoiceNo: (r.invoice_no as string) ?? null,
    document: String(r.invoice_no ?? '').startsWith(REQUEST_PREFIX) ? 'request' : 'invoice',
    date: (r.invoice_date as string) ?? null,
    declarationNo: (r.declaration_no as string) ?? null,
    supplier: (r.supplier as string) ?? null,
    country: (r.country as string) ?? null,
    mode: (r.mode as StoredInvoice['mode']) ?? 'air',
    incoterms: (r.incoterms as string) ?? null,
    weightKg: (r.weight_kg as number) ?? null,
    chargeableKg: (r.chargeable_kg as number) ?? null,
    cbm: (r.cbm as number) ?? null,
    goodsValue: (r.goods_value as number) ?? null,
    lines: (r.lines as StoredInvoice['lines']) ?? [],
    subtotal: (r.subtotal as number) ?? null,
    total: (r.total as number) ?? null,
    findings: (r.findings as Finding[]) ?? [],
    overcharge: (r.overcharge as number) ?? 0,
    status: (r.status as StoredInvoice['status']) ?? 'ok',
  };
}

export function toRow(i: StoredInvoice): Record<string, unknown> {
  return {
    source: 'upload',
    carrier: i.carrier,
    invoice_no: i.invoiceNo,
    invoice_date: i.date,
    declaration_no: i.declarationNo,
    supplier: i.supplier,
    country: i.country,
    mode: i.mode,
    incoterms: i.incoterms,
    weight_kg: i.weightKg,
    chargeable_kg: i.chargeableKg,
    cbm: i.cbm,
    goods_value: i.goodsValue,
    lines: i.lines,
    subtotal: i.subtotal,
    total: i.total,
    findings: i.findings,
    overcharge: i.overcharge,
    status: i.status,
  };
}
