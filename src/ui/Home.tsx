import { useEffect, useState } from 'react';
import { navigate, useApp } from '../appContext';
import { formatDayLong } from '../lib/dates';
import { writeDraft } from '../lib/draft';
import { store, type DaySummary } from '../lib/store';

export function Home() {
  const { demo } = useApp();
  const [text, setText] = useState('');
  const [days, setDays] = useState<DaySummary[] | null>(null);
  const [samples, setSamples] = useState<string[]>([]);
  const [pasteFailed, setPasteFailed] = useState(false);

  useEffect(() => {
    store()
      .listDays(30)
      .then(setDays)
      .catch(() => setDays([]));
  }, []);

  useEffect(() => {
    if (import.meta.env.DEV && demo) void import('../dev/demo').then((m) => setSamples(m.demoSamples()));
  }, [demo]);

  async function pasteFromClipboard() {
    try {
      const t = await navigator.clipboard.readText();
      if (t.trim()) setText(t);
    } catch {
      setPasteFailed(true);
    }
  }

  function next() {
    writeDraft({ text });
    navigate('/review');
  }

  return (
    <div className="stack-lg">
      <section className="card stack">
        <div>
          <h1 className="h1">סידור חדש</h1>
          <p className="muted">מעתיקים את הודעת הסידור מהווטסאפ ומדביקים כאן, כמו שהיא.</p>
        </div>
        <textarea
          className="paste-box"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'שלום לכולם,\nסידור צוות לוגיסטיקה למחר:\n…'}
          rows={9}
        />
        {pasteFailed && <p className="muted small">לא הצלחתי לקרוא מהלוח. לוחצים לחיצה ארוכה בתיבה ובוחרים "הדבק".</p>}
        <div className="row">
          <button className="btn btn-primary" disabled={!text.trim()} onClick={next}>
            המשך
          </button>
          {!text && (
            <button className="btn" onClick={() => void pasteFromClipboard()}>
              הדבקה
            </button>
          )}
          {text && (
            <button className="btn btn-ghost" onClick={() => setText('')}>
              ניקוי
            </button>
          )}
          {samples.map((s, i) => (
            <button key={i} className="btn btn-ghost btn-small" onClick={() => setText(s)}>
              דוגמה {i + 1}
            </button>
          ))}
        </div>
      </section>

      <section className="stack">
        <h2 className="h2">סידורים אחרונים</h2>
        {days === null && <p className="muted">טוען…</p>}
        {days?.length === 0 && <p className="muted">עוד לא נשמר אף סידור.</p>}
        {days && days.length > 0 && (
          <ul className="list card flush">
            {days.map((d) => (
              <li key={d.date}>
                <a className="list-link" href={`#/day/${d.date}`}>
                  <span>{formatDayLong(d.date)}</span>
                  <span className="muted small">
                    {d.source === 'whatsapp_export' ? 'יובא מהווטסאפ' : 'הודבק'}
                    {d.version > 1 ? ` · עודכן ${d.version - 1}×` : ''}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
