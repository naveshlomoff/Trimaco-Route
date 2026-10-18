import { useMemo, useState } from 'react';
import { store } from '../../lib/store';
import {
  CONFIDENCE_LABELS,
  countriesOf,
  INCOTERMS,
  recommend,
  REGION_LABELS,
  suppliersOf,
  type Basis,
  type Estimate,
  type Recommendation,
} from '../model';
import { shekels, useShipments } from './useShipments';

const BASIS_LABELS: Record<Basis, string> = {
  rule: 'לפי הנוהל',
  lane: 'מהמדינה הזו',
  region: 'מהאזור',
  band: 'מכל העולם',
};

const CONFIDENCE_CHIP = { high: 'chip chip-ok', medium: 'chip chip-ok', low: 'chip chip-warn', very_low: 'chip chip-warn' } as const;

const num = (s: string): number | null => {
  const x = Number(s.replace(',', '.'));
  return s.trim() && Number.isFinite(x) && x > 0 ? x : null;
};

/** Stage A, before ordering: which carrier, and what it should cost. */
export function ImportsHome() {
  const { shipments, error } = useShipments();
  const [supplier, setSupplier] = useState('');
  const [country, setCountry] = useState('');
  const [weight, setWeight] = useState('');
  const [cbm, setCbm] = useState('');
  const [incoterms, setIncoterms] = useState('');
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [other, setOther] = useState('');

  const suppliers = useMemo(() => (shipments ? suppliersOf(shipments) : []), [shipments]);
  const countries = useMemo(() => (shipments ? countriesOf(shipments) : []), [shipments]);
  const weightKg = num(weight);

  const result: Recommendation | null = useMemo(() => {
    if (!shipments || !country || !weightKg) return null;
    return recommend({ country, weightKg, cbm: num(cbm), incoterms: incoterms || null, goodsValue: num(value) }, shipments);
  }, [shipments, country, weightKg, cbm, incoterms, value]);

  function pickSupplier(name: string) {
    setSupplier(name);
    setSaved(null);
    const known = suppliers.find((s) => s.name.toUpperCase() === name.trim().toUpperCase());
    if (known) setCountry(known.country);
  }

  async function choose(carrier: string, estimate: Estimate | undefined) {
    if (!result || !weightKg) return;
    setSaveError(null);
    try {
      await store().recordImportRequest({
        supplier: supplier.trim() || null,
        country,
        weight_kg: weightKg,
        cbm: num(cbm),
        incoterms: incoterms || null,
        goods_value: num(value),
        chargeable_kg: result.chargeableKg,
        kind: result.kind,
        recommended: result.best?.carrier ?? null,
        recommended_cost: result.best ? Math.round(result.best.cost) : null,
        confidence: result.best ? result.confidence : null,
        chosen: carrier,
        chosen_cost: estimate ? Math.round(estimate.cost) : null,
        notes: null,
      });
      setSaved(carrier);
      setOther('');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error) {
    return (
      <section className="card stack">
        <h1 className="h1">Trimaco Imports</h1>
        <p className="error">לא הצלחתי לטעון את היסטוריית המשלוחים: {error}</p>
        <p className="muted small">אם זו הפעם הראשונה, צריך להריץ ב-Supabase את הקובץ imports-setup.sql.</p>
      </section>
    );
  }

  return (
    <div className="stack-lg">
      <section className="card stack">
        <div>
          <h1 className="h1">משלוח אווירי חדש</h1>
          <p className="muted small">
            ממלאים את פרטי המשלוח ומקבלים המלצה על מוביל, לפי משלוחי העבר. בלי הצעות מחיר.
          </p>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>ספק</span>
            <input list="import-suppliers" value={supplier} onChange={(e) => pickSupplier(e.target.value)} placeholder="למשל ORTHOFIX" dir="ltr" />
            <datalist id="import-suppliers">
              {suppliers.map((s) => (
                <option key={s.name} value={s.name} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>מדינת מוצא</span>
            <select value={country} onChange={(e) => (setCountry(e.target.value), setSaved(null))}>
              <option value="">בוחרים מדינה</option>
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>משקל בפועל (ק״ג)</span>
            <input inputMode="decimal" value={weight} onChange={(e) => (setWeight(e.target.value), setSaved(null))} dir="ltr" />
          </label>
          <label className="field">
            <span>נפח (CBM), אם ידוע</span>
            <input inputMode="decimal" value={cbm} onChange={(e) => (setCbm(e.target.value), setSaved(null))} dir="ltr" placeholder="0.25" />
          </label>
          <label className="field">
            <span>תנאי מכר</span>
            <select value={incoterms} onChange={(e) => (setIncoterms(e.target.value), setSaved(null))}>
              <option value="">לא ידוע</option>
              {INCOTERMS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>שווי הסחורה (₪), לא חובה</span>
            <input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} dir="ltr" />
          </label>
        </div>
        {!shipments && <p className="muted">טוען את היסטוריית המשלוחים…</p>}
      </section>

      {result && <Result result={result} country={country} />}

      {result && (
        <section className="card stack-sm">
          <h2 className="h2">איזה מוביל הזמנת?</h2>
          <p className="muted small">כך נדע בתקופת הניסיון אם ההמלצות עוזרות.</p>
          <div className="row wrap">
            {result.options.map((o) => (
              <button
                key={o.carrier}
                className={o === result.best ? 'btn btn-primary btn-small' : 'btn btn-small'}
                onClick={() => void choose(o.carrier, o)}
              >
                {o.carrier}
              </button>
            ))}
            <input className="inline-input" value={other} onChange={(e) => setOther(e.target.value)} placeholder="מוביל אחר" />
            {other.trim() && (
              <button className="btn btn-small" onClick={() => void choose(other.trim(), undefined)}>
                שמירה
              </button>
            )}
          </div>
          {saved && <p className="notice notice-ok">נרשם: {saved}.</p>}
          {saveError && <p className="error">השמירה נכשלה: {saveError}</p>}
        </section>
      )}

      {shipments && (
        <p className="muted small">
          ההמלצה מבוססת על {shipments.filter((s) => s.mode === 'air').length} משלוחי אוויר מ-2026. עד 10 ק״ג: DHL, לפי
          הנוהל.
        </p>
      )}
    </div>
  );
}

function Result({ result, country }: { result: Recommendation; country: string }) {
  const { best, alternative } = result;
  const perKg = result.band === '50–100' || result.band === 'מעל 100';
  const basisText = (e: Estimate) =>
    e.basis === 'rule'
      ? `306 ₪ שחרור ועוד כ-65 ₪ לק״ג`
      : `${e.shipments.length === 1 ? 'משלוח אחד' : `${e.shipments.length} משלוחים`} של ${e.carrier} ${
          e.basis === 'lane' ? `מ${country}` : e.basis === 'region' ? `מ${REGION_LABELS[result.region]}` : 'מכל העולם'
        }, ${result.band} ק״ג`;

  return (
    <section className="card stack">
      {result.kind === 'no_data' || !best ? (
        <>
          <h2 className="h2">אין מספיק נתונים</h2>
          <p>
            אין משלוחים קודמים מ{country} או מהאזור שלה במשקל הזה. כדאי לבקש הצעת מחיר משני מובילים, ולרשום כאן במה
            בחרת.
          </p>
        </>
      ) : (
        <>
          <div className="row between wrap">
            <h2 className="h2">
              {result.kind === 'supplier_pays' ? 'לשחרור: ' : 'מומלץ: '}
              {best.carrier}
            </h2>
            <span className={CONFIDENCE_CHIP[result.confidence]}>רמת ביטחון: {CONFIDENCE_LABELS[result.confidence]}</span>
          </div>
          <div className="result-cost">
            <strong>כ-{shekels(best.cost)}</strong>
            <span className="muted">
              {' '}
              בטווח {shekels(best.low)} עד {shekels(best.high)}
              {perKg && result.kind === 'history' && `, כ-${shekels(best.cost / result.chargeableKg)} לק״ג`}
            </span>
          </div>
          <p className="muted small">
            {result.kind === 'express' ? 'עד 10 ק״ג, DHL אקספרס לפי הנוהל: ' : 'על סמך '}
            {basisText(best)}.
            {result.volumetric && ` משקל לחיוב: ${Math.round(result.chargeableKg * 10) / 10} ק״ג.`}
            {result.shareOfValue !== null && ` כ-${Math.round(result.shareOfValue * 1000) / 10}% משווי הסחורה.`}
          </p>
          {alternative && (
            <p>
              חלופה: <strong>{alternative.carrier}</strong>, כ-{shekels(alternative.cost)}
              {best.cost < alternative.cost && (
                <span className="chip chip-ok">חיסכון של כ-{shekels(alternative.cost - best.cost)}</span>
              )}
            </p>
          )}
        </>
      )}

      {result.warnings.length > 0 && (
        <ul className="advice">
          {result.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {result.options.length > 1 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>מוביל</th>
                <th>עלות צפויה</th>
                <th>טווח</th>
                <th>על סמך</th>
              </tr>
            </thead>
            <tbody>
              {result.options.map((o) => (
                <tr key={o.carrier}>
                  <td>{o.carrier}</td>
                  <td>{shekels(o.cost)}</td>
                  <td className="muted small">
                    {shekels(o.low)}–{shekels(o.high)}
                  </td>
                  <td className="muted small">
                    {o.basis === 'rule' ? BASIS_LABELS.rule : `${o.shipments.length} ${BASIS_LABELS[o.basis]}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {best && best.basis !== 'rule' && best.shipments.length > 0 && (
        <details>
          <summary className="link">המשלוחים שעליהם זה מבוסס</summary>
          <ul className="plain small">
            {best.shipments.map((s, i) => (
              <li key={s.id ?? i}>
                {s.month} · {s.supplier} · {s.country} · {Math.round((s.chargeable_kg ?? s.weight_kg ?? 0) * 10) / 10} ק״ג ·{' '}
                {shekels(result.kind === 'supplier_pays' ? s.inland + s.fees : s.freight + s.inland + s.fees)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
