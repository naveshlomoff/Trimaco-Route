import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../appContext';
import { formatDayShort, fromISODate, toISODate } from '../../lib/dates';
import { computeSavings, DEFAULT_RATES, moneyOf, perYear, savingsText, shekels, type Amount, type Rates } from '../../lib/savings';
import { store } from '../../lib/store';
import type { AdviceDecision } from '../../lib/types';
import { hoursLabel } from '../../lib/week';
import type { ImportRequest } from '../../imports/model';
import { copyText } from '../clipboard';
import { Tile } from '../components';

const RATES_KEY = 'trimaco.savings.rates';
const dm = (iso: string) => `${fromISODate(iso).getDate()}.${fromISODate(iso).getMonth() + 1}`;

function loadRates(): Rates {
  try {
    const r = JSON.parse(localStorage.getItem(RATES_KEY) ?? 'null');
    if (r && r.perKm >= 0 && r.perHour >= 0) return r;
  } catch {
    // no storage: the defaults
  }
  return DEFAULT_RATES;
}

const detail = (a: Amount) => `${a.count === 1 ? 'הצעה אחת' : `${a.count} הצעות`} · ${a.min ? hoursLabel(a.min) : '0 דק׳'} נהיגה · ${a.km} ק״מ`;

/** Since the suggestions went live: what they saved, and what the declined ones would have. */
export function Savings() {
  const { workers } = useApp();
  const today = toISODate(new Date());
  const [data, setData] = useState<{ decisions: AdviceDecision[]; requests: ImportRequest[]; invoices: { overcharge: number }[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [rates, setRates] = useState<Rates>(loadRates);
  const [copied, setCopied] = useState<boolean | null>(null);

  useEffect(() => {
    Promise.all([
      store().listAdvice('2026-01-01', today),
      store()
        .listImportRequests(1000)
        .catch(() => [] as ImportRequest[]),
      store()
        .listImportInvoices()
        .then((all) => all.filter((i) => i.source === 'upload'))
        .catch(() => []),
    ])
      .then(([decisions, requests, invoices]) => setData({ decisions, requests, invoices }))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [today]);

  const report = useMemo(() => (data ? computeSavings({ ...data, rates, today }) : null), [data, rates, today]);
  const workerName = (id: string) => workers.find((w) => w.id === id)?.name ?? id;

  function setRate(key: keyof Rates, value: string) {
    const x = Number(value);
    if (!Number.isFinite(x) || x < 0) return;
    const next = { ...rates, [key]: x };
    setRates(next);
    setCopied(null);
    try {
      localStorage.setItem(RATES_KEY, JSON.stringify(next));
    } catch {
      // kept for this visit only
    }
  }

  const year = report ? perYear(report.accepted.money, report) : null;
  const yearAll = report ? perYear(report.accepted.money + report.declined.money + report.ignored.money, report) : null;

  return (
    <div className="stack-lg">
      <section className="stack-sm">
        <div className="row between wrap">
          <h1 className="h1">
            סיכום חיסכון{' '}
            {report?.from && <span className="muted">{`${dm(report.from)}–${dm(report.to)}`}</span>}
          </h1>
          <a className="btn btn-small" href="#/admin/week">
            סיכום שבועי
          </a>
        </div>
        <p className="muted small">
          כל הצעה לשיפור נשמרת עם הנהיגה שהיא חוסכת (דקות וק״מ, הערכה לפי מרחק בלי פקקים). כאן זה מתורגם לכסף לפי
          התעריפים שלמטה: הועברו זה מה שנחסך, נדחו זה מה שהיה אפשר לחסוך עוד.
        </p>
      </section>

      {error && <p className="error">{error}</p>}
      {!report && !error && <p className="muted">טוען…</p>}
      {report && !report.from && <p className="notice">עוד לא הוצגו הצעות לשיפור.</p>}

      {report?.from && (
        <>
          <section className="tiles">
            <Tile label="נחסך (הצעות שהועברו)" value={shekels(report.accepted.money)} hint={detail(report.accepted)} />
            <Tile label="היה אפשר לחסוך עוד (נדחו)" value={shekels(report.declined.money)} hint={detail(report.declined)} />
            {report.ignored.count > 0 && (
              <Tile label="הצעות בלי תשובה" value={shekels(report.ignored.money)} hint={detail(report.ignored)} />
            )}
          </section>

          {year !== null && yearAll !== null && (
            <p className="notice">
              בקצב של {Math.round(report.weeksElapsed)} השבועות האלה: כ-{shekels(year)} בשנה מההצעות שהועברו, וכ-
              {shekels(yearAll)} בשנה אם כל ההצעות היו מועברות. זו הערכה גסה.
            </p>
          )}

          <section className="card stack">
            <h2 className="h2">התעריפים לחישוב</h2>
            <div className="form-grid">
              <label className="field">
                <span>₪ לק״מ (דלק ובלאי של רכב מסחרי)</span>
                <input inputMode="decimal" defaultValue={rates.perKm} onChange={(e) => setRate('perKm', e.target.value)} dir="ltr" />
              </label>
              <label className="field">
                <span>₪ לשעת נהג (כולל עלות מעביד)</span>
                <input inputMode="decimal" defaultValue={rates.perHour} onChange={(e) => setRate('perHour', e.target.value)} dir="ltr" />
              </label>
            </div>
            <p className="muted small">
              ברירת המחדל היא הערכה ({DEFAULT_RATES.perKm} ₪ לק״מ, {DEFAULT_RATES.perHour} ₪ לשעה). כדאי לעדכן לפי
              המספרים של טרימקו, והסכומים מתעדכנים מיד. מתוך הסכום, הדלק והבלאי הם{' '}
              {shekels(report.accepted.km * rates.perKm)} בחיסכון ו-{shekels(report.declined.km * rates.perKm)} בהצעות
              שנדחו, והשאר זמן נהג שהתפנה.
            </p>
          </section>

          <section className="card stack">
            <div className="row between wrap">
              <h2 className="h2">לשליחה</h2>
              <button className="btn btn-primary btn-small" onClick={() => void copyText(savingsText(report, rates)).then(setCopied)}>
                {copied ? 'הועתק ✓' : 'העתקת הסיכום'}
              </button>
            </div>
            <pre className="week-text">{savingsText(report, rates)}</pre>
            {copied === false && <p className="muted small">לא הצלחתי להעתיק לבד. מסמנים את הטקסט ומעתיקים.</p>}
          </section>

          <section className="card stack">
            <h2 className="h2">לפי שבוע</h2>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>שבוע</th>
                    <th>נחסך</th>
                    <th>היה אפשר עוד</th>
                    {report.ignored.count > 0 && <th>בלי תשובה</th>}
                  </tr>
                </thead>
                <tbody>
                  {report.weeks.map((w) => (
                    <tr key={w.start}>
                      <td>
                        <a href={`#/admin/week/${w.start}`}>{dm(w.start)}</a>
                      </td>
                      <td>
                        {shekels(w.accepted.money)} <span className="muted small">({w.accepted.count})</span>
                      </td>
                      <td>
                        {shekels(w.declined.money)} <span className="muted small">({w.declined.count})</span>
                      </td>
                      {report.ignored.count > 0 && (
                        <td>
                          {shekels(w.ignored.money)} <span className="muted small">({w.ignored.count})</span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {report.declinedList.length > 0 && (
            <section className="card stack">
              <div>
                <h2 className="h2">ההצעות שנדחו</h2>
                <p className="muted small">מהגדולה לקטנה. כדאי לשאול את עדי למה, אולי יש סיבה שהמנוע לא יודע.</p>
              </div>
              <ul className="overlaps">
                {report.declinedList.map((d) => (
                  <li key={`${d.date}|${d.place_id}|${d.from_worker}|${d.to_worker}`}>
                    <a href={`#/day/${d.date}`} className="overlap-date">
                      {formatDayShort(d.date)}
                    </a>
                    <span className="chip chip-warn">{shekels(moneyOf(d.saved_min, d.saved_km, rates))}</span>
                    <span className="overlap-body">
                      {d.place_name}: מ{workerName(d.from_worker)} ל{workerName(d.to_worker)}
                      <span className="muted"> · {hoursLabel(d.saved_min)}, {d.saved_km} ק״מ</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {report && report.imports.choices > 0 && (
        <section className="card stack-sm">
          <h2 className="h2">Trimaco Imports</h2>
          <p>
            נרשמו {report.imports.choices} בחירות מוביל
            {report.imports.withAdvice > 0 && `, ההמלצה נבחרה ב-${report.imports.followed} מתוך ${report.imports.withAdvice}`}.
          </p>
          {report.imports.missedCount > 0 && (
            <p>
              ב-{report.imports.missedCount} משלוחים נבחר מוביל יקר מהמומלץ: הפרש מוערך של כ-{shekels(report.imports.missed)}.
            </p>
          )}
          {report.imports.flagged > 0 && (
            <p>
              בבדיקת החשבוניות נמצאו חריגות אפשריות של כ-{shekels(report.imports.overcharge)} ב-{report.imports.flagged}{' '}
              חשבוניות. זה חיסכון רק אם המוביל מזכה.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
