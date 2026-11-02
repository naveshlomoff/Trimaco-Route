import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../appContext';
import { fromISODate, toISODate } from '../../lib/dates';
import { store, type DaySummary } from '../../lib/store';
import type { Profile, TaskRow } from '../../lib/types';
import { computeUtilization, startOfUse, utilizationText } from '../../lib/utilization';
import { hoursLabel } from '../../lib/week';
import { copyText } from '../clipboard';
import { Tile } from '../components';

const pct = (x: number | null) => (x === null ? '–' : `${Math.round(x * 100)}%`);
const dm = (iso: string) => `${fromISODate(iso).getDate()}.${fromISODate(iso).getMonth() + 1}`;

/** Each driver's load since Adi started pasting the schedule, next to the months before. */
export function Drivers() {
  const { workers, places } = useApp();
  const today = toISODate(new Date());
  const [data, setData] = useState<{ days: DaySummary[]; profiles: Profile[]; tasks: TaskRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([store().daysBetween('2026-01-01', today), store().listProfiles(), store().tasksBetween('2026-01-01', today)])
      .then(([days, profiles, tasks]) => alive && setData({ days, profiles, tasks }))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [today]);

  const start = useMemo(() => (data ? startOfUse(data.days, data.profiles) : null), [data]);
  const from = chosen ?? start;
  const report = useMemo(
    () => (data && from ? computeUtilization({ from, to: today, tasks: data.tasks, places, workers }) : null),
    [data, from, today, places, workers],
  );

  return (
    <div className="stack-lg">
      <section className="stack-sm">
        <div className="row between wrap">
          <h1 className="h1">ניצולת נהגים {report && <span className="muted">{`${dm(report.from)}–${dm(report.to)}`}</span>}</h1>
          <a className="btn btn-small" href="#/admin/week">
            סיכום שבועי
          </a>
        </div>
        <p className="muted small">
          כמה מיום העבודה כל נהג היה בדרכים או אצל לקוח, מאז שעדי התחילה להדביק את הסידור ועד היום, ולידו 3 החודשים שלפני
          (מההיסטוריה של הווטסאפ). זמני הנסיעה הם הערכה לפי מרחק, בלי פקקים.
        </p>
      </section>

      {error && <p className="error">{error}</p>}
      {!data && !error && <p className="muted">טוען…</p>}
      {data && !from && <p className="notice">עוד לא הודבקו סידורים באפליקציה.</p>}

      {report && (
        <>
          <section className="card stack-sm">
            <label className="field">
              <span>מתאריך</span>
              <input
                type="date"
                value={report.from}
                max={today}
                onChange={(e) => {
                  setChosen(e.target.value || null);
                  setCopied(null);
                }}
                dir="ltr"
              />
            </label>
            <p className="muted small">
              {report.from === start
                ? `${dm(report.from)} הוא היום הראשון שעדי הדביקה. אפשר לבחור תאריך אחר.`
                : start && (
                    <button className="link" onClick={() => setChosen(null)}>
                      חזרה ליום הראשון שעדי הדביקה ({dm(start)})
                    </button>
                  )}
            </p>
          </section>

          <section className="tiles">
            <Tile label="ניצולת הצוות" value={pct(report.team.utilization)} hint={`${dm(report.from)}–${dm(report.to)}`} />
            <Tile label="3 החודשים שלפני" value={pct(report.team.baseline)} hint="מההיסטוריה של הווטסאפ" />
          </section>

          <section className="card stack">
            <h2 className="h2">לפי נהג</h2>
            {report.drivers.length === 0 ? (
              <p className="muted">אין סידורים שמורים בתקופה הזו.</p>
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>נהג</th>
                      <th>ניצולת</th>
                      <th>לפני</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.drivers.map((d) => (
                      <tr key={d.workerId}>
                        <td>
                          {d.name}
                          <div className="muted small" style={{ whiteSpace: 'normal' }}>
                            {d.days} ימים · יום של {hoursLabel(d.avgDayMin)}
                          </div>
                        </td>
                        <td>
                          <span className="bar">
                            <span style={{ width: `${Math.min(100, Math.round(d.utilization * 100))}%` }} />
                          </span>{' '}
                          <strong>{pct(d.utilization)}</strong>
                        </td>
                        <td>{pct(d.baseline)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td>
                        <strong>כל הצוות</strong>
                      </td>
                      <td>
                        <strong>{pct(report.team.utilization)}</strong>
                      </td>
                      <td>{pct(report.team.baseline)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">
              ניצולת = נהיגה + זמן בעצירות, חלקי 9:00–17:00, בימים שהנהג יצא לשטח. מתחת לשם: כמה ימים יצא לשטח, וכמה זמן לקח יום
              כזה בממוצע. לפני = 3 החודשים שלפני.
            </p>
          </section>

          {report.drivers.length > 0 && (
            <section className="card stack">
              <div className="row between wrap">
                <h2 className="h2">לשליחה</h2>
                <button
                  className="btn btn-primary btn-small"
                  onClick={() => void copyText(utilizationText(report)).then(setCopied)}
                >
                  {copied ? 'הועתק ✓' : 'העתקת הסיכום'}
                </button>
              </div>
              <pre className="week-text">{utilizationText(report)}</pre>
              {copied === false && <p className="muted small">לא הצלחתי להעתיק לבד. מסמנים את הטקסט ומעתיקים.</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
