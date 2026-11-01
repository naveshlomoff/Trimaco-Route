import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../appContext';
import { fromISODate, toISODate } from '../../lib/dates';
import { computeSavings, moneyOf, pastedDays, perYear, shekels, type Amount } from '../../lib/savings';
import { computeShadow } from '../../lib/shadow';
import { store, type DaySummary } from '../../lib/store';
import type { AdviceDecision, TaskRow } from '../../lib/types';
import { addDays, BASELINE_DAYS, hoursLabel, teamUtilization } from '../../lib/week';
import { loadRates } from './Savings';

const dm = (iso: string) => `${fromISODate(iso).getDate()}.${fromISODate(iso).getMonth() + 1}`;
const dmy = (iso: string) => `${dm(iso)}.${fromISODate(iso).getFullYear()}`;
const hours = (min: number) => `${Math.round(min / 6) / 10} שעות`;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const plus = (a: Amount, b: Amount): Amount => ({
  count: a.count + b.count,
  min: a.min + b.min,
  km: a.km + b.km,
  money: a.money + b.money,
});

interface Data {
  decisions: AdviceDecision[];
  days: DaySummary[];
  tasks: TaskRow[];
}

/** One A4 page of what the suggestions saved and could still save, to save as PDF and share. */
export function SavingsReport() {
  const { workers, places } = useApp();
  const today = toISODate(new Date());
  const [rates] = useState(loadRates);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const decisions = await store().listAdvice('2026-01-01', today);
      const from = decisions.map((d) => d.date).sort()[0] ?? today;
      const [days, tasks] = await Promise.all([
        store().daysBetween(from, today),
        store().tasksBetween(addDays(from, -BASELINE_DAYS), today),
      ]);
      if (alive) setData({ decisions, days, tasks });
    })().catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [today]);

  const view = useMemo(() => {
    if (!data) return null;
    const r = computeSavings({ ...data, rates, today });
    if (!r.from) return { r, extra: null };
    const from = r.from;
    const now = computeShadow(
      data.tasks.filter((t) => t.date >= from),
      places,
      workers,
    );
    const before = computeShadow(
      data.tasks.filter((t) => t.date < from),
      places,
      workers,
    );
    return {
      r,
      extra: {
        pasted: pastedDays(
          from,
          today,
          data.days.map((d) => d.date),
        ),
        // the driving left in the final schedules, plus what the accepted suggestions took out
        driveMin: now.driveMin ? now.driveMin + r.accepted.min : 0,
        utilization: teamUtilization(now.drivers),
        baseline: teamUtilization(before.drivers),
      },
    };
  }, [data, rates, today, places, workers]);

  const workerName = (id: string) => workers.find((w) => w.id === id)?.name ?? id;

  if (error) return <p className="error">{error}</p>;
  if (!view) return <p className="muted">מכין את הדוח…</p>;
  const { r, extra } = view;
  if (!r.from || !extra) return <p className="notice">עוד לא הוצגו הצעות לשיפור, אין מה לסכם.</p>;

  const missed = plus(r.declined, r.ignored);
  const year = perYear(r.accepted.money, r);
  const yearAll = perYear(r.accepted.money + missed.money, r);
  const answered = r.accepted.count + r.declined.count;
  const shown = r.accepted.count + missed.count;
  // the week that just started, with nothing in it yet, is left out
  const weeks = r.weeks.filter((w, i) => i < r.weeks.length - 1 || w.accepted.count + w.declined.count + w.ignored.count > 0);
  const top = Math.max(1, ...weeks.map((w) => Math.max(w.accepted.money, w.declined.money + w.ignored.money)));
  const biggest = [...r.declinedList]
    .sort((a, b) => moneyOf(b.saved_min, b.saved_km, rates) - moneyOf(a.saved_min, a.saved_km, rates))
    .slice(0, 4);

  return (
    <div className="stack">
      <div className="row between wrap no-print">
        <a className="btn btn-small" href="#/admin/savings">
          חזרה
        </a>
        <button className="btn btn-primary" onClick={() => window.print()}>
          שמירה כ-PDF
        </button>
      </div>
      <p className="muted small no-print">
        במחשב: בחלון ההדפסה בוחרים "שמירה כ-PDF". באייפון: בחלון ההדפסה לוחצים על כפתור השיתוף ובוחרים "שמירה בקבצים" או שולחים
        ישר בוואטסאפ.
      </p>

      <article className="rep">
        <header className="rep-head">
          <div>
            <div className="rep-title">Trimaco Route · סיכום חיסכון</div>
            <div className="rep-sub">ההצעות לשיפור סידור העבודה של עדי, מאז שעלו לאוויר</div>
          </div>
          <div className="rep-dates">
            {dmy(r.from)}–{dmy(r.to)}
            <br />
            {Math.round(r.weeksElapsed)} שבועות
          </div>
        </header>

        <section className="rep-kpis">
          <div className="rep-kpi rep-ok">
            <div className="rep-kpi-label">נחסך עד היום</div>
            <div className="rep-kpi-value">{shekels(r.accepted.money)}</div>
            <div className="rep-kpi-sub">
              {r.accepted.count} הצעות שהועברו · {hours(r.accepted.min)} נהיגה · {r.accepted.km} ק״מ
            </div>
          </div>
          <div className="rep-kpi rep-warn">
            <div className="rep-kpi-label">היה אפשר לחסוך עוד</div>
            <div className="rep-kpi-value">{shekels(missed.money)}</div>
            <div className="rep-kpi-sub">
              {r.declined.count} נדחו
              {r.ignored.count ? ` · ${r.ignored.count} בלי תשובה` : ''} · {hours(missed.min)} · {missed.km} ק״מ
            </div>
          </div>
        </section>

        {year !== null && yearAll !== null && (
          <section className="rep-year">
            <div className="rep-year-title">
              בקצב שנתי
              <div className="rep-year-note">
                מה שנחסך עד היום, לשבוע, כפול 52. הערכה גסה שמתחדדת עם כל שבוע
              </div>
            </div>
            <div className="rep-year-num">
              <div className="rep-year-value">{shekels(year)}</div>
              <div className="rep-year-label">בקצב של היום</div>
            </div>
            <div className="rep-year-num">
              <div className="rep-year-value">{shekels(yearAll)}</div>
              <div className="rep-year-label">אם כל ההצעות היו מועברות</div>
            </div>
          </section>
        )}

        <section className="rep-block">
          <h2 className="rep-h">לפי שבוע</h2>
          <div className="rep-chart">
            {weeks.map((w) => {
              const lost = w.declined.money + w.ignored.money;
              return (
                <div key={w.start} className="rep-week">
                  <div className="rep-bars">
                    <div className="rep-bar rep-bar-ok" style={{ height: `${(70 * w.accepted.money) / top}px` }}>
                      <span>{w.accepted.money ? Math.round(w.accepted.money) : ''}</span>
                    </div>
                    <div className="rep-bar rep-bar-warn" style={{ height: `${(70 * lost) / top}px` }}>
                      <span>{lost ? Math.round(lost) : ''}</span>
                    </div>
                  </div>
                  <div className="rep-week-label">{dm(w.start)}</div>
                </div>
              );
            })}
          </div>
          <div className="rep-legend">
            <span className="rep-dot rep-bar-ok" /> נחסך (₪) <span className="rep-dot rep-bar-warn" /> היה אפשר עוד (₪)
          </div>
        </section>

        <section className="rep-block">
          <h2 className="rep-h">עוד נתונים</h2>
          <ul className="rep-facts">
            <li>
              <b>סידורים שהודבקו:</b> {extra.pasted.pasted} מתוך {extra.pasted.due} ימי עבודה (
              {extra.pasted.due ? pct(extra.pasted.pasted / extra.pasted.due) : '–'})
            </li>
            <li>
              <b>הצעות שהוצגו:</b> {shown}. מתוך אלה שנענו, {answered ? pct(r.accepted.count / answered) : '–'} הועברו
            </li>
            {extra.driveMin > 0 && (
              <li>
                <b>נהיגה בתקופה:</b> כ-{hours(extra.driveMin)}. החיסכון הוא{' '}
                {extra.driveMin ? pct(r.accepted.min / extra.driveMin) : '–'} ממנה, ועם כל ההצעות היה{' '}
                {extra.driveMin ? pct((r.accepted.min + missed.min) / extra.driveMin) : '–'}
              </li>
            )}
            {extra.utilization !== null && (
              <li>
                <b>ניצולת הצוות:</b> {pct(extra.utilization)} מיום העבודה
                {extra.baseline !== null ? ` (3 החודשים שלפני: ${pct(extra.baseline)})` : ''}
              </li>
            )}
            <li>
              <b>בממוצע לשבוע:</b> נחסכו {shekels(r.accepted.money / Math.max(r.weeksElapsed, 1))}, ועוד{' '}
              {shekels(missed.money / Math.max(r.weeksElapsed, 1))} היו אפשריים
            </li>
          </ul>
        </section>

        {r.declinedList.length > 0 && (
          <section className="rep-block">
            <h2 className="rep-h">ההצעות הגדולות שנדחו</h2>
            <table className="rep-table">
              <tbody>
                {biggest.map((d) => (
                  <tr key={`${d.date}|${d.place_id}|${d.from_worker}|${d.to_worker}`}>
                    <td>{dm(d.date)}</td>
                    <td>{d.place_name}</td>
                    <td>
                      מ{workerName(d.from_worker)} ל{workerName(d.to_worker)}
                    </td>
                    <td>
                      {hoursLabel(d.saved_min)}, {d.saved_km} ק״מ
                    </td>
                    <td>
                      <b>{shekels(moneyOf(d.saved_min, d.saved_km, rates))}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="rep-note">שווה לשאול את עדי למה נדחו: אם יש סיבה שהמנוע לא יודע, אפשר ללמד אותו.</p>
          </section>
        )}

        <footer className="rep-foot">
          איך זה חושב: כל הצעה נשמרת עם הנהיגה שהיא חוסכת, דקות וק״מ לפי מרחק ובלי פקקים, כך שבפועל החיסכון בזמן כנראה גדול יותר.
          הכסף: {rates.perKm} ₪ לק״מ (דלק ובלאי) ו-{rates.perHour} ₪ לשעת נהג (כולל עלות מעביד). מתוך הסכום שנחסך,{' '}
          {shekels(r.accepted.km * rates.perKm)} הם דלק ובלאי והשאר זמן נהג שהתפנה. הופק ב-{dmy(today)}.
        </footer>
      </article>
    </div>
  );
}
