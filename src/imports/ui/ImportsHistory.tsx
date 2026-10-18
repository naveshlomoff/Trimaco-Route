import { useEffect, useMemo, useState } from 'react';
import { store } from '../../lib/store';
import type { Profile } from '../../lib/types';
import { docName } from '../invoice/parse';
import type { StoredInvoice } from '../invoice/stored';
import type { ImportRequest } from '../model';
import { shekels, useShipments } from './useShipments';

/** The carrier choices recorded in the trial, and the shipments the recommendations come from. */
export function ImportsHistory() {
  const { shipments, error } = useShipments();
  const [requests, setRequests] = useState<ImportRequest[] | null>(null);
  const [checked, setChecked] = useState<StoredInvoice[] | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [carrier, setCarrier] = useState('');
  const [country, setCountry] = useState('');

  useEffect(() => {
    store()
      .listImportRequests(200)
      .then(setRequests)
      .catch(() => setRequests([]));
    store()
      .listImportInvoices()
      .then((all) => setChecked(all.filter((i) => i.source === 'upload')))
      .catch(() => setChecked([]));
    store()
      .listProfiles()
      .then(setProfiles)
      .catch(() => undefined);
  }, []);

  const person = (id: string | null | undefined) => profiles.find((p) => p.id === id)?.display_name ?? '';
  const followed = requests ? requests.filter((r) => r.recommended && r.chosen === r.recommended).length : 0;
  const withAdvice = requests ? requests.filter((r) => r.recommended).length : 0;
  const air = useMemo(() => (shipments ?? []).filter((s) => s.mode === 'air'), [shipments]);
  const carriers = [...new Set(air.map((s) => s.carrier))].sort();
  const countries = [...new Set(air.map((s) => s.country))].sort((a, b) => a.localeCompare(b, 'he'));
  const shown = air
    .filter((s) => (!carrier || s.carrier === carrier) && (!country || s.country === country))
    .sort((a, b) => (b.month ?? '').localeCompare(a.month ?? ''));

  return (
    <div className="stack-lg">
      <section className="card stack">
        <div>
          <h1 className="h1">הבחירות שנרשמו</h1>
          <p className="muted small">כל פעם שנלחץ "איזה מוביל הזמנת" במסך ההמלצה.</p>
        </div>
        {requests === null && <p className="muted">טוען…</p>}
        {requests?.length === 0 && <p className="muted">עוד לא נרשמו בחירות.</p>}
        {requests && requests.length > 0 && (
          <>
            {withAdvice > 0 && (
              <p>
                ההמלצה נבחרה ב-{followed} מתוך {withAdvice} משלוחים ({Math.round((100 * followed) / withAdvice)}%).
              </p>
            )}
            <ul className="overlaps">
              {requests.map((r) => (
                <li key={r.id}>
                  <span className="overlap-date">{r.created_at ? new Date(r.created_at).toLocaleDateString('he-IL') : ''}</span>
                  <span className={r.recommended && r.chosen !== r.recommended ? 'chip chip-warn' : 'chip chip-ok'}>{r.chosen}</span>
                  <span className="overlap-body">
                    {r.supplier ? `${r.supplier} · ` : ''}
                    {r.country} · {Math.round(r.chargeable_kg * 10) / 10} ק״ג
                    {r.recommended && r.chosen !== r.recommended && (
                      <span className="muted"> · ההמלצה הייתה {r.recommended}</span>
                    )}
                    {person(r.created_by) && <span className="muted"> · {person(r.created_by)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card stack">
        <div>
          <h2 className="h2">חשבוניות שנבדקו</h2>
          <p className="muted small">כל חשבונית שנשמרה במסך "בדיקת חשבונית".</p>
        </div>
        {checked === null && <p className="muted">טוען…</p>}
        {checked?.length === 0 && <p className="muted">עוד לא נשמרו בדיקות.</p>}
        {checked && checked.length > 0 && (
          <>
            {checked.some((c) => c.overcharge > 0) && (
              <p>
                חריגות אפשריות שנמצאו: כ-{shekels(checked.reduce((s, c) => s + c.overcharge, 0))}
                {checked.filter((c) => c.overcharge > 0).length === 1
                  ? ' בחשבונית אחת.'
                  : ` ב-${checked.filter((c) => c.overcharge > 0).length} חשבוניות.`}
              </p>
            )}
            <ul className="overlaps">
              {checked.map((c) => (
                <li key={`${c.carrier}|${c.invoiceNo}`}>
                  <span className="overlap-date">{c.date ? c.date.split('-').reverse().join('.') : ''}</span>
                  <span className={c.status === 'ok' ? 'chip chip-ok' : 'chip chip-warn'}>
                    {c.status === 'ok' ? 'תקין' : c.overcharge > 0 ? `חריגה ${shekels(c.overcharge)}` : 'לבדיקה'}
                  </span>
                  <span className="overlap-body">
                    {c.carrier} · {docName(c)}
                    {c.supplier ? ` · ${c.supplier}` : ''}
                    {person(c.created_by) && <span className="muted"> · {person(c.created_by)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card stack">
        <div>
          <h2 className="h2">משלוחי אוויר מ-2026</h2>
          <p className="muted small">מתוך הניתוח של לירז. העלויות בש״ח, בלי מע״מ ומיסים.</p>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row wrap">
          <select value={carrier} onChange={(e) => setCarrier(e.target.value)}>
            <option value="">כל המובילים</option>
            {carriers.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">כל המדינות</option>
            {countries.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <span className="muted small">{shown.length} משלוחים</span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>חודש</th>
                <th>ספק</th>
                <th>מדינה</th>
                <th>מוביל</th>
                <th>ק״ג לחיוב</th>
                <th>הובלה</th>
                <th>טיפול</th>
                <th>סה״כ</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s, i) => (
                <tr key={s.id ?? i} className={s.in_comparison ? '' : 'muted'}>
                  <td>{s.month}</td>
                  <td dir="ltr">{s.supplier}</td>
                  <td>{s.country}</td>
                  <td>{s.carrier}</td>
                  <td>{Math.round((s.chargeable_kg ?? s.weight_kg ?? 0) * 10) / 10}</td>
                  <td>{s.freight_billed ? shekels(s.freight) : 'הספק'}</td>
                  <td>{shekels(s.inland + s.fees)}</td>
                  <td>{shekels(s.freight + s.inland + s.fees)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
