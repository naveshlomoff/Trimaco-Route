import { useEffect, useState } from 'react';
import type { DayAdvice, Move } from '../lib/advisor';
import { MoveText } from './Advice';

/** A suggestion Adi accepted: the message before it, so the last one can be undone. */
export interface Applied {
  move: Move;
  before: string;
  /** The giver had nothing else and now has "מחסן". */
  freed: boolean;
}

/** Older browsers, and in-app browsers that block the clipboard API. */
function legacyCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

export const moveKey =(m: { placeId: string; from: string; to: string }) => `${m.placeId}|${m.from}|${m.to}`;

interface Props {
  advice: DayAdvice;
  applied: Applied[];
  canApply: (m: Move) => boolean;
  onAccept: (m: Move) => void;
  onDecline: (m: Move) => void;
  onUndo: () => void;
  /** The message as it is now, to copy and send to the group. */
  text: string;
  workerName: (id: string) => string;
}

/** The paste screen's "הצעות לשיפור": accept or skip each, then copy the updated message. */
export function Suggestions({ advice, applied, canApply, onAccept, onDecline, onUndo, text, workerName }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [showText, setShowText] = useState(false);

  useEffect(() => setCopied(false), [text]);

  const open = advice.moves;
  if (open.length === 0 && applied.length === 0) {
    return (
      <section className="card">
        <p className="muted small">המנוע בדק את הסידור מול המרחקים ולא מצא נסיעה שאפשר לחסוך.</p>
      </section>
    );
  }

  async function copy() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      ok = legacyCopy(text);
    }
    setCopied(ok);
    setCopyFailed(!ok);
  }

  const freed = advice.freed.map(workerName);
  const savedMin = applied.reduce((s, a) => s + a.move.savedMin, 0);

  return (
    <section className="card stack">
      <div>
        <h2 className="h2">הצעות לשיפור</h2>
        <p className="muted small">
          לפי המרחקים על המפה, בלי פקקים. מי שמקבל עצירה נשאר בתוך 9:00–17:00, ועצירה עם שעה קבועה לא זזה. ההחלטה
          שלך: אפשר להעביר או לדלג.
        </p>
      </div>

      {open.length > 0 && (
        <ul className="suggestions">
          {open.map((m) => (
            <li key={moveKey(m)} className="stack-sm">
              <div>
                <MoveText m={m} />
              </div>
              {!canApply(m) && (
                <p className="muted small">
                  בהודעה הזו {m.placeName} כתוב באותה שורה עם עוד מקומות, אז את השינוי עושים בהודעה עצמה (חזרה לעריכה).
                </p>
              )}
              <div className="row">
                {canApply(m) && (
                  <button className="btn btn-primary btn-small" onClick={() => onAccept(m)}>
                    להעביר
                  </button>
                )}
                <button className="btn btn-small" onClick={() => onDecline(m)}>
                  לא הפעם
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {open.length > 0 && freed.length > 0 && (
        <p className="muted small">
          {open.length === 1 ? 'אם מעבירים' : 'אם מעבירים את כולן'},{' '}
          {freed.length === 1
            ? `${freed[0]} נשאר בלי עצירות בשטח ופנוי למחסן.`
            : `${freed.join(' ו')} נשארים בלי עצירות בשטח ופנויים למחסן.`}
        </p>
      )}

      {applied.length > 0 && (
        <div className="stack-sm">
          <h3 className="h3">מה השתנה בהודעה</h3>
          <ul className="advice">
            {applied.map((a, i) => (
              <li key={i}>
                {a.move.placeName} עבר מ{a.move.fromName} ל{a.move.toName}
                {a.freed ? `, ו${a.move.fromName} במחסן` : ''}.{' '}
                {i === applied.length - 1 && (
                  <button className="link" onClick={onUndo}>
                    ביטול
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="notice notice-ok">
            ההודעה עודכנה (חוסך כ-{savedMin} דק׳ נהיגה). מעתיקים אותה ושולחים לקבוצה במקום הקודמת.
          </p>
          <div className="row wrap">
            <button className="btn btn-primary" onClick={() => void copy()}>
              {copied ? 'הועתק ✓' : 'העתקת ההודעה המעודכנת'}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowText(!showText)}>
              {showText ? 'הסתרת ההודעה' : 'הצגת ההודעה'}
            </button>
          </div>
          {copyFailed && <p className="muted small">לא הצלחתי להעתיק לבד. לוחצים לחיצה ארוכה על ההודעה ובוחרים "העתק".</p>}
          {(showText || copyFailed) && (
            <textarea className="paste-box" readOnly value={text} rows={12} onFocus={(e) => e.target.select()} />
          )}
          {copied && <p className="muted small">אחרי השליחה לקבוצה, לוחצים למטה על "שמירת הסידור".</p>}
        </div>
      )}
    </section>
  );
}
