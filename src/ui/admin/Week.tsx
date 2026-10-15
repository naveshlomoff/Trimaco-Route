import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../appContext';
import { formatDayShort, fromISODate, toISODate } from '../../lib/dates';
import { store, type DaySummary } from '../../lib/store';
import type { AdviceDecision, Profile, TaskRow } from '../../lib/types';
import { addDays, BASELINE_DAYS, computeWeek, hoursLabel, weekStart, weekText, type DayStatus } from '../../lib/week';
import { copyText } from '../clipboard';
import { Tile } from '../components';

const STATUS: Record<DayStatus, { label: string; chip: string }> = {
  saved: { label: 'הודבק', chip: 'chip chip-ok' },
  missing: { label: 'לא הודבק', chip: 'chip chip-warn' },
  upcoming: { label: 'עוד לא', chip: 'chip chip-muted' },
};
const DECISION = {
  accepted: { label: 'הועבר', chip: 'chip chip-ok' },
  declined: { label: 'נדחה', chip: 'chip chip-warn' },
  ignored: { label: 'בלי תשובה', chip: 'chip chip-muted' },
} as const;

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const dm = (iso: string) => `${fromISODate(iso).getDate()}.${fromISODate(iso).getMonth() + 1}`;

/** The weekly summary: what was pasted, what was suggested and done, and the drivers' load. */
export function Week({ date }: { date?: string }) {
  const { workers, places } = useApp();
  const today = toISODate(new Date());
  const start = weekStart(date ?? today);
  const end = addDays(start, 6);
  const [data, setData] = useState<{ days: DaySummary[]; tasks: TaskRow[]; decisions: AdviceDecision[] } | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    setCopied(null);
    Promise.all([
      store().daysBetween(start, end),
      store().tasksBetween(addDays(start, -BASELINE_DAYS), end),
      store()
        .listAdvice(start, end)
        .catch(() => [] as AdviceDecision[]),
    ])
      .then(([days, tasks, decisions]) => alive && setData({ days, tasks, decisions }))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [start, end]);

  useEffect(() => {
    store()
      .listProfiles()
      .then(setProfiles)
      .catch(() => undefined);
  }, []);

  const report = useMemo(
    () => (data ? computeWeek({ start, today, ...data, places, workers }) : null),
    [data, start, today, places, workers],
  );
  const person = (id: string | null | undefined) => profiles.find((p) => p.id === id)?.display_name ?? '';
  const workerName = (id: string) => workers.find((w) => w.id === id)?.name ?? id;

  async function copy() {
    if (report) setCopied(await copyText(weekText(report)));
  }

  return (
    <div className="stack-lg">
      <section className="stack-sm">
        <div className="row between wrap">
          <h1 className="h1">
            סיכום שבועי <span className="muted">{`${dm(start)}–${dm(addDays(start, 4))}`}</span>
          </h1>
          <div className="row">
            <a className="btn btn-small" href={`#/admin/week/${addDays(start, -7)}`}>
              שבוע קודם
            </a>
            {addDays(start, 7) <= today && (
              <a className="btn btn-small" href={`#/admin/week/${addDays(start, 7)}`}>
                שבוע הבא
              </a>
            )}
          </div>
        </div>
        <p className="muted small">
          אילו סידורים הודבקו, מה המנוע הציע ומה נעשה עם זה, וכמה הנהגים היו עמוסים. זמני הנסיעה הם הערכה לפי מרחק,
          בלי פקקים.
        </p>
      </section>

      {error && <p className="error">{error}</p>}
      {!report && !error && <p className="muted">טוען…</p>}

      {report && (
        <>
          <section className="tiles">
            <Tile label="סידורים שהודבקו" value={`${report.pasted} מתוך ${report.due}`} />
            <Tile label="הצעות שהוצגו" value={report.shown} />
            <Tile
              label="הועברו"
              value={report.accepted}
              hint={
                report.accepted + report.declined
                  ? `${Math.round((100 * report.accepted) / (report.accepted + report.declined))}% מההצעות שנענו`
                  : undefined
              }
            />
            <Tile label="נהיגה שנחסכה" value={report.savedMin ? hoursLabel(report.savedMin) : '–'} hint="מההצעות שהועברו" />
          </section>

          <section className="card stack">
            <div className="row between wrap">
              <h2 className="h2">לשליחה ללירז</h2>
              <button className="btn btn-primary btn-small" onClick={() => void copy()}>
                {copied ? 'הועתק ✓' : 'העתקת הסיכום'}
              </button>
            </div>
            <pre className="week-text">{weekText(report)}</pre>
            {copied === false && <p className="muted small">לא הצלחתי להעתיק לבד. מסמנים את הטקסט ומעתיקים.</p>}
          </section>

          <section className="card stack">
            <h2 className="h2">הסידורים של השבוע</h2>
            <ul className="overlaps">
              {report.days.map((d) => (
                <li key={d.date}>
                  {d.day ? (
                    <a href={`#/day/${d.date}`} className="overlap-date">
                      {formatDayShort(d.date)}
                    </a>
                  ) : (
                    <span className="overlap-date">{formatDayShort(d.date)}</span>
                  )}
                  <span className={STATUS[d.status].chip}>{STATUS[d.status].label}</span>
                  <span className="overlap-body muted small">
                    {d.day?.source === 'whatsapp_export'
                      ? 'יובא מהווטסאפ'
                      : d.day
                        ? [person(d.day.saved_by), new Date(d.day.saved_at).toLocaleString('he-IL', { weekday: 'short', hour: '2-digit', minute: '2-digit' })]
                            .filter(Boolean)
                            .join(' · ')
                        : d.status === 'missing'
                          ? 'אולי נשכח, או שלא היה סידור ביום הזה'
                          : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card stack">
            <h2 className="h2">הצעות והחלטות</h2>
            {report.decisions.length === 0 && <p className="muted">לא הוצגו הצעות השבוע.</p>}
            {report.decisions.length > 0 && (
              <ul className="overlaps">
                {report.decisions.map((d) => (
                  <li key={`${d.date}|${d.place_id}|${d.from_worker}|${d.to_worker}`}>
                    <span className="overlap-date">{formatDayShort(d.date)}</span>
                    <span className={DECISION[d.decision].chip}>{DECISION[d.decision].label}</span>
                    <span className="overlap-body">
                      <strong>{d.place_name}</strong>: מ{workerName(d.from_worker)} ל{workerName(d.to_worker)}, כ-{d.saved_min} דק׳
                      {person(d.decided_by) && <span className="muted"> · {person(d.decided_by)}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {report.open.days > 0 && (
              <p className="notice">
                בסידורים שנשמרו השבוע המנוע עדיין רואה חיסכון של כ-{hoursLabel(report.open.savedMin)} נהיגה, ב
                {report.open.days === 1 ? 'יום אחד' : `-${report.open.days} ימים`}. אלה הצעות שלא נלקחו, או סידורים שהודבקו
                אחרי השליחה לקבוצה.
              </p>
            )}
          </section>

          <section className="card stack">
            <h2 className="h2">ניצולת השבוע</h2>
            {report.drivers.length === 0 ? (
              <p className="muted">אין עדיין סידורים שמורים בשבוע הזה.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>נהג</th>
                      <th>ימים בשטח</th>
                      <th>השבוע</th>
                      <th>3 החודשים שלפני</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.drivers.map((d) => (
                      <tr key={d.workerId}>
                        <td>{d.name}</td>
                        <td>{d.days}</td>
                        <td>
                          <span className="bar">
                            <span style={{ width: `${Math.min(100, Math.round(d.utilization * 100))}%` }} />
                          </span>{' '}
                          {pct(d.utilization)}
                        </td>
                        <td>{pct(d.baseline)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>כל הצוות</strong>
                      </td>
                      <td />
                      <td>
                        <strong>{pct(report.team.utilization)}</strong>
                      </td>
                      <td>{pct(report.team.baseline)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">ניצולת = נהיגה + זמן בעצירות, חלקי 9:00–17:00, בימים שהנהג יצא לשטח.</p>
          </section>
        </>
      )}
    </div>
  );
}
