// Ratios shown on the dashboard. Definitions: docs/01-spec.md §6. Null means "no data" (shown as —), never 0%.
export type Kpis = {
  events: number;
  unclosed_events?: number;
  attendances: number;
  unique_attendees: number;
  preregistered: number;
  preregistered_attended: number;
  walk_ins: number;
  cancelled: number;
  new_attendees: number;
  returning_attendees: number;
  friend_new: number;
  feedback_count: number;
  avg_rating: number | null;
  self_checkins: number;
  goals: { avg_attendance: number; show_rate: number; return_rate: number; friend_share: number; avg_rating: number };
};

export const ratio = (num: number, den: number): number | null => (den > 0 ? num / den : null);

export function derived(k: Kpis) {
  return {
    avgAttendance: ratio(k.attendances, k.events),
    showRate: ratio(k.preregistered_attended, k.preregistered),
    returnRate: ratio(k.returning_attendees, k.unique_attendees),
    friendShare: ratio(k.friend_new, k.new_attendees),
    avgRating: k.avg_rating == null ? null : Number(k.avg_rating),
    selfCheckinShare: ratio(k.self_checkins, k.attendances),
  };
}

export const pct = (v: number | null | undefined, digits = 0): string =>
  v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(digits)}%`;

export const num = (v: number | null | undefined, digits = 0): string =>
  v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('he-IL', { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** Goal progress: 1 = met. Null when there is no data. */
export const progress = (value: number | null, goal: number): number | null =>
  value == null || !goal ? null : Math.max(0, Math.min(1.5, value / goal));
