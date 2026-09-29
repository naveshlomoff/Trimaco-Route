import type { DayAdvice } from '../lib/advisor';

export function fmtHm(min: number): string {
  const m = Math.round(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

export function stopsLabel(n: number): string {
  return n === 1 ? 'עצירה אחת' : `${n} עצירות`;
}

/** The advisor's suggestions for one day, in plain Hebrew. */
export function AdviceMoves({ advice, workerName }: { advice: DayAdvice; workerName: (id: string) => string }) {
  if (advice.moves.length === 0) {
    return <p className="muted">אין הצעה ליום הזה: לפי המנוע, כל נהג כבר נוסע לאזור שלו.</p>;
  }
  const freed = advice.freed.map(workerName);
  return (
    <div className="stack-sm">
      <ul className="advice">
        {advice.moves.map((m, i) => (
          <li key={i}>
            <strong>{m.placeName}</strong>: להעביר מ{m.fromName} ל{m.toName}.{' '}
            {m.nearName && (
              <span className="muted">
                {m.toName} כבר ב{m.nearName}
                {m.nearKm ? `, ${m.nearKm} ק"מ משם` : ', באותו מקום'}.
              </span>
            )}{' '}
            <span className="chip chip-ok">חוסך כ-{m.savedMin} דק׳ נהיגה</span>
          </li>
        ))}
      </ul>
      {freed.length > 0 && (
        <p className="notice notice-ok">
          {freed.length === 1
            ? `${freed[0]} נשאר בלי עצירות בשטח, ופנוי למחסן.`
            : `${freed.join(' ו')} נשארים בלי עצירות בשטח, ופנויים למחסן.`}
        </p>
      )}
    </div>
  );
}
