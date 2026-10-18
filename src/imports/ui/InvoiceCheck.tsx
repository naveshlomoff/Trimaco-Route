import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../appContext';
import { store } from '../../lib/store';
import { copyText } from '../../ui/clipboard';
import { checkInvoice, feeNorms, letterFor, type Report } from '../invoice/check';
import { pdfLines, type PdfJs } from '../invoice/extract';
import { docName, goodsInvoiceOf, ITEM_LABELS, parseInvoices, type InvoiceLine, type Item, type ParsedInvoice } from '../invoice/parse';
import type { StoredInvoice } from '../invoice/stored';
import { countriesOf, INCOTERMS } from '../model';
import { shekels, useShipments } from './useShipments';

/** pdf.js only when a PDF is opened: it is big. */
async function readPdf(file: File): Promise<string[][]> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfLines(pdfjs as unknown as PdfJs, new Uint8Array(await file.arrayBuffer()));
}

const STATUS = {
  ok: { label: 'תקין', chip: 'chip chip-ok' },
  over: { label: 'חריגה', chip: 'chip chip-warn' },
  check: { label: 'לבדיקה', chip: 'chip chip-muted' },
} as const;

const num = (s: string): number | null => {
  const x = Number(s.replace(/,/g, ''));
  return s.trim() && Number.isFinite(x) ? x : null;
};

/** Stage A, after the shipment: the carrier's invoice against what it usually charges. */
export function InvoiceCheck() {
  const { profile } = useApp();
  const { shipments } = useShipments();
  const [history, setHistory] = useState<StoredInvoice[] | null>(null);
  const [found, setFound] = useState<ParsedInvoice[] | null>(null);
  const [draft, setDraft] = useState<ParsedInvoice | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [letter, setLetter] = useState('');
  const [copied, setCopied] = useState<boolean | null>(null);
  const [manual, setManual] = useState(false);
  /** The PDF has no text at all: a scan of paper. */
  const [scanned, setScanned] = useState(false);
  /** Total Care's Dutch company billing the goods themselves: not a shipping invoice. */
  const [goods, setGoods] = useState<ReturnType<typeof goodsInvoiceOf>>(null);

  useEffect(() => {
    store()
      .listImportInvoices()
      .then(setHistory)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const countries = useMemo(() => (shipments ? countriesOf(shipments) : []), [shipments]);
  // the invoice itself is never its own yardstick
  const yardstick = useMemo(
    () => (history ?? []).filter((h) => !(draft && h.carrier === draft.carrier && h.invoiceNo === draft.invoiceNo)),
    [history, draft],
  );
  const report: Report | null = useMemo(
    () => (draft && shipments ? checkInvoice(draft, yardstick, shipments) : null),
    [draft, yardstick, shipments],
  );
  // the fixed fees need 3 earlier invoices of the carrier in the same mode
  const noFeeNorms = useMemo(
    () => !!draft && !manual && feeNorms(yardstick, draft.carrier, draft.mode).size === 0,
    [draft, manual, yardstick],
  );
  const already = history?.find((h) => draft && h.carrier === draft.carrier && h.invoiceNo === draft.invoiceNo);

  useEffect(() => {
    if (draft && report) setLetter(letterFor(draft, report, profile.display_name));
    setCopied(null);
  }, [draft, report, profile.display_name]);

  async function open(file: File | undefined) {
    if (!file) return;
    setError(null);
    setSaved(false);
    setManual(false);
    setScanned(false);
    setReading(true);
    try {
      const pages = await readPdf(file);
      setScanned(pages.every((p) => p.length === 0));
      setGoods(goodsInvoiceOf(pages));
      const invoices = parseInvoices(pages);
      setFound(invoices);
      setDraft(invoices.length === 1 ? withKnownCountry(invoices[0]) : null);
    } catch (e) {
      setError(`לא הצלחתי לקרוא את הקובץ: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReading(false);
    }
  }

  // KRIEF sometimes leaves the origin empty: take the supplier's usual country
  function withKnownCountry(inv: ParsedInvoice): ParsedInvoice {
    if (inv.country || !inv.supplier || !history) return inv;
    const key = inv.supplier.slice(0, 5).toUpperCase();
    const same = history.find((h) => h.country && h.supplier?.toUpperCase().startsWith(key));
    return same ? { ...inv, country: same.country } : inv;
  }

  function edit(patch: Partial<ParsedInvoice>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setSaved(false);
  }

  async function save() {
    if (!draft || !report) return;
    setError(null);
    try {
      const inv: StoredInvoice = {
        ...draft,
        source: 'upload',
        findings: report.findings,
        overcharge: report.overcharge,
        status: report.status,
      };
      await store().saveImportInvoice(inv);
      setHistory((h) => [inv, ...(h ?? []).filter((x) => !(x.carrier === inv.carrier && x.invoiceNo === inv.invoiceNo))]);
      setSaved(true);
    } catch (e) {
      setError(`השמירה נכשלה: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div className="stack-lg">
      <section className="card stack">
        <div>
          <h1 className="h1">בדיקת חשבונית</h1>
          <p className="muted small">
            מעלים את החשבונית של המוביל (PDF). הכלי קורא את הסעיפים ומשווה למה שאותו מוביל חייב בעבר. כרגע נקראות
            אוטומטית חשבוניות ובקשות תשלום של KRIEF ושל טוטל קר, וחשבוניות של מעיין. לשאר אפשר להזין את הסכומים ידנית.
          </p>
        </div>
        <div className="row wrap">
          <label className="btn btn-primary">
            בחירת PDF
            <input type="file" accept="application/pdf" hidden onChange={(e) => void open(e.target.files?.[0])} />
          </label>
          <button
            className="btn btn-ghost"
            onClick={() => {
              setManual(true);
              setFound(null);
              setSaved(false);
              setDraft(emptyManual());
            }}
          >
            הזנה ידנית
          </button>
        </div>
        {reading && <p className="muted">קורא את החשבונית…</p>}
        {error && <p className="error">{error}</p>}
        {history === null && !error && <p className="muted small">טוען את החשבוניות הקודמות…</p>}
        {found && found.length === 0 && scanned && (
          <p className="notice">
            הקובץ הוא סריקה (תמונה של נייר), ואין בו טקסט שאפשר לקרוא. עדיף להעלות את ה-PDF המקורי שהמוביל שלח במייל.
            אם אין, אפשר ללחוץ "הזנה ידנית".
          </p>
        )}
        {found && found.length === 0 && goods && (
          <p className="notice">
            זו חשבונית של {goods.issuer} (החברה ההולנדית של טוטל קר) על הסחורה עצמה, שמשולמת לספק דרכם. היא לא על
            המשלוח, ולכן אין בה מה להשוות.
            {goods.fees.length > 0 &&
              ` מעבר לסחורה יש בה ${goods.fees.map((f) => `${f.label} ${f.amount.toLocaleString('he-IL')} ${f.currency}`).join(' ו')}.`}{' '}
            את המשלוח בודקים בבקשת התשלום או בחשבונית המס של טוטל קר.
          </p>
        )}
        {found && found.length === 0 && !scanned && !goods && (
          <p className="notice">
            לא מצאתי בקובץ חשבונית או בקשת תשלום של KRIEF, טוטל קר או מעיין. אולי זה מוביל אחר. אפשר ללחוץ "הזנה ידנית".
          </p>
        )}
        {found && found.length > 1 && (
          <div className="stack-sm">
            <p>בקובץ יש {found.length} חשבוניות. איזו לבדוק?</p>
            <div className="row wrap">
              {found.map((f, i) => (
                <button
                  key={i}
                  className={draft?.invoiceNo === f.invoiceNo ? 'btn btn-primary btn-small' : 'btn btn-small'}
                  onClick={() => (setDraft(withKnownCountry(f)), setSaved(false))}
                >
                  {f.carrier} · {docName(f)}
                  {f.supplier ? ` · ${f.supplier}` : ''}
                </button>
              ))}
            </div>
          </div>
        )}
      </section>

      {draft && manual && <ManualLines draft={draft} onChange={(d) => setDraft(d)} />}

      {draft && (
        <section className="card stack">
          <div className="row between wrap">
            <h2 className="h2">
              {draft.carrier}
              {draft.invoiceNo ? ` · ${docName(draft)}` : ''}
            </h2>
            {draft.date && <span className="muted small">{draft.date.split('-').reverse().join('.')}</span>}
          </div>
          {draft.document === 'request' && (
            <p className="notice">
              זו בקשת תשלום של {draft.carrier}: הערכה של הסכומים לפני החשבונית הסופית. טוב לבדוק אותה לפני שמשלמים, וכדאי
              לבדוק גם את החשבונית הסופית כשתגיע.
            </p>
          )}
          <p className="muted small">מה שנקרא מהמסמך. מה שחסר או שגוי אפשר לתקן כאן, והבדיקה מתעדכנת.</p>
          <div className="form-grid">
            <label className="field">
              <span>ספק</span>
              <input value={draft.supplier ?? ''} onChange={(e) => edit({ supplier: e.target.value || null })} dir="ltr" />
            </label>
            <label className="field">
              <span>ארץ מוצא</span>
              <select value={draft.country ?? ''} onChange={(e) => edit({ country: e.target.value || null })}>
                <option value="">לא ידוע</option>
                {countries.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>תנאי מכר</span>
              <select value={draft.incoterms ?? ''} onChange={(e) => edit({ incoterms: e.target.value || null })}>
                <option value="">לא ידוע</option>
                {[...new Set([...INCOTERMS, ...(draft.incoterms ? [draft.incoterms] : [])])].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>משקל בפועל (ק״ג)</span>
              <input inputMode="decimal" value={draft.weightKg ?? ''} onChange={(e) => edit({ weightKg: num(e.target.value) })} dir="ltr" />
            </label>
            <label className="field">
              <span>משקל לחיוב (ק״ג)</span>
              <input
                inputMode="decimal"
                value={draft.chargeableKg ?? ''}
                onChange={(e) => edit({ chargeableKg: num(e.target.value) })}
                dir="ltr"
                placeholder="אם מופיע"
              />
            </label>
            <label className="field">
              <span>נפח (CBM)</span>
              <input inputMode="decimal" value={draft.cbm ?? ''} onChange={(e) => edit({ cbm: num(e.target.value) })} dir="ltr" />
            </label>
          </div>
          {draft.mode === 'sea' && <p className="notice">זה משלוח ימי. הבדיקה משווה עמלות קבועות בלבד, בלי מחיר הובלה.</p>}
          {noFeeNorms && (
            <p className="notice">
              עוד אין מספיק חשבוניות קודמות של {draft.carrier} במשלוח {draft.mode === 'sea' ? 'ימי' : 'אווירי'} כדי להשוות את
              העמלות (צריך לפחות 3). כל בדיקה שנשמרת מצטרפת להשוואה, כך שהבדיקה תשתפר עם הזמן.
            </p>
          )}
        </section>
      )}

      {draft && report && (
        <section className="card stack">
          <div className="row between wrap">
            <h2 className="h2">{report.status !== 'ok' ? 'מה נמצא' : noFeeNorms ? 'לא נמצאו חריגות' : 'הכול תקין'}</h2>
            {report.overcharge > 0 && <span className="chip chip-warn">חריגה אפשרית של כ-{shekels(report.overcharge)}</span>}
          </div>
          {report.incomplete && (
            <p className="notice">
              הסעיפים שנקראו לא מסתכמים לסכום החשבונית לפני מע״מ{draft.subtotal !== null ? ` (${shekels(draft.subtotal)})` : ''}.
              כדאי לבדוק מול החשבונית שלא חסר סעיף.
            </p>
          )}
          {report.findings.length > 0 && (
            <ul className="advice">
              {report.findings.map((f, i) => (
                <li key={i}>
                  <span className={STATUS[f.status].chip}>{STATUS[f.status].label}</span> {f.text}
                </li>
              ))}
            </ul>
          )}
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>סעיף</th>
                  <th>חויב</th>
                  <th>צפוי</th>
                  <th>הפרש</th>
                  <th>מצב</th>
                </tr>
              </thead>
              <tbody>
                {report.rows.map((r, i) => (
                  <tr key={i} className={r.line.item === 'tax' ? 'muted' : ''}>
                    <td>
                      {r.line.label}
                      {r.note && <div className="muted small">{r.note}</div>}
                    </td>
                    <td>{shekels(r.line.amount)}</td>
                    <td>{r.expected !== null ? shekels(r.expected) : '–'}</td>
                    <td>{r.diff ? shekels(r.diff) : '–'}</td>
                    <td>{r.line.item === 'tax' ? <span className="muted small">מיסים</span> : <span className={STATUS[r.status].chip}>{STATUS[r.status].label}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.findings.length > 0 && (
            <div className="stack-sm">
              <h3 className="h3">טיוטת מכתב למוביל</h3>
              <textarea className="paste-box" rows={10} value={letter} onChange={(e) => setLetter(e.target.value)} />
              <div className="row">
                <button className="btn btn-small" onClick={() => void copyText(letter).then(setCopied)}>
                  {copied ? 'הועתק ✓' : 'העתקת המכתב'}
                </button>
                {copied === false && <span className="muted small">לא הצלחתי להעתיק לבד. מסמנים ומעתיקים.</span>}
              </div>
            </div>
          )}

          <div className="row wrap">
            {already?.source === 'history' ? (
              <p className="muted small">החשבונית הזו כבר נמצאת בחשבוניות של 2026, אז אין מה לשמור.</p>
            ) : (
              <button className="btn btn-primary" onClick={() => void save()} disabled={!draft.invoiceNo}>
                {saved ? 'נשמר ✓' : already ? 'עדכון הבדיקה' : 'שמירת הבדיקה'}
              </button>
            )}
            {!draft.invoiceNo && <span className="muted small">כדי לשמור צריך מספר חשבונית.</span>}
          </div>
        </section>
      )}
    </div>
  );
}

const MANUAL_ITEMS: Item[] = ['freight', 'inland', 'broker_fee', 'global_gate', 'terminal', 'cyber', 'other'];

function emptyManual(): ParsedInvoice {
  return {
    carrier: 'KRIEF',
    invoiceNo: null,
    date: null,
    declarationNo: null,
    supplier: null,
    country: null,
    mode: 'air',
    incoterms: null,
    weightKg: null,
    chargeableKg: null,
    cbm: null,
    goodsValue: null,
    lines: [],
    subtotal: null,
    total: null,
  };
}

/** For carriers the tool can't read yet: the invoice's main sums by hand. */
function ManualLines({ draft, onChange }: { draft: ParsedInvoice; onChange: (d: ParsedInvoice) => void }) {
  const amountOf = (item: Item) => draft.lines.find((l) => l.item === item)?.amount ?? null;
  function set(item: Item, value: number | null) {
    const lines: InvoiceLine[] = draft.lines.filter((l) => l.item !== item);
    if (value) lines.push({ item, label: ITEM_LABELS[item], amount: value });
    const sum = lines.reduce((s, l) => s + l.amount, 0);
    onChange({ ...draft, lines, subtotal: sum });
  }
  return (
    <section className="card stack">
      <h2 className="h2">הזנה ידנית</h2>
      <div className="form-grid">
        <label className="field">
          <span>מוביל</span>
          <input
            list="manual-carriers"
            value={draft.carrier}
            onChange={(e) => onChange({ ...draft, carrier: e.target.value as ParsedInvoice['carrier'] })}
          />
          <datalist id="manual-carriers">
            {['KRIEF', 'מעיין', 'טוטל קר', 'אוריין', 'אורנר', 'DHL', 'UPS'].map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="field">
          <span>מספר חשבונית</span>
          <input value={draft.invoiceNo ?? ''} onChange={(e) => onChange({ ...draft, invoiceNo: e.target.value || null })} dir="ltr" />
        </label>
        {MANUAL_ITEMS.map((item) => (
          <label key={item} className="field">
            <span>{ITEM_LABELS[item]} (₪)</span>
            <input
              inputMode="decimal"
              value={amountOf(item) ?? ''}
              onChange={(e) => set(item, num(e.target.value))}
              dir="ltr"
            />
          </label>
        ))}
      </div>
    </section>
  );
}
