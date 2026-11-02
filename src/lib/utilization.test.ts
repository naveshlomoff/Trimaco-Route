import { describe, expect, it } from 'vitest';
import type { DaySummary } from './store';
import type { Profile } from './types';
import { computeUtilization, startOfUse, utilizationText, type UtilizationReport } from './utilization';

const day = (date: string, source: DaySummary['source'], saved_by: string | null): DaySummary => ({
  date,
  saved_at: `${date}T13:30:00Z`,
  source,
  version: 1,
  saved_by,
});
const profile = (id: string, role: Profile['role']): Profile => ({ id, username: id, display_name: id, role });

describe('startOfUse', () => {
  const profiles = [profile('planner', 'planner'), profile('admin', 'admin')];

  it('starts at the first schedule a planner pasted, not at the history or an admin test', () => {
    const days = [
      day('2026-10-14', 'paste', 'planner'),
      day('2026-08-02', 'whatsapp_export', null),
      day('2026-10-01', 'paste', 'admin'),
      day('2026-10-12', 'paste', 'planner'),
    ];
    expect(startOfUse(days, profiles)).toBe('2026-10-12');
  });

  it('falls back to the first pasted day, and to nothing', () => {
    expect(startOfUse([day('2026-10-05', 'paste', 'admin')], profiles)).toBe('2026-10-05');
    expect(startOfUse([day('2026-08-02', 'whatsapp_export', null)], profiles)).toBeNull();
  });
});

describe('utilizationText', () => {
  it('gives each driver, the team and the months before', () => {
    const r: UtilizationReport = {
      from: '2026-10-12',
      to: '2026-11-02',
      drivers: [
        { workerId: 'a', name: 'דני', days: 14, utilization: 0.634, avgDayMin: 300, baseline: 0.58 },
        { workerId: 'b', name: 'רוני', days: 1, utilization: 0.4, avgDayMin: 190, baseline: null },
      ],
      team: { utilization: 0.61, baseline: 0.55 },
    };
    const text = utilizationText(r);
    expect(text).toContain('ניצולת נהגים 12.10–2.11');
    expect(text).toContain('דני: 63% (14 ימים בשטח) · לפני: 58%');
    expect(text).toContain('רוני: 40% (יום אחד בשטח)\n');
    expect(text).toContain('כל הצוות: 61% · לפני: 55%');
  });

  it('is empty without schedules', () => {
    const r = computeUtilization({ from: '2026-10-12', to: '2026-11-02', tasks: [], places: [], workers: [] });
    expect(r.drivers).toEqual([]);
    expect(r.team).toEqual({ utilization: null, baseline: null });
  });
});
