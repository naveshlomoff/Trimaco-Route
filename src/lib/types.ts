export type Region = 'center' | 'tlv' | 'sharon' | 'jerusalem' | 'south' | 'north' | 'unknown';
export type PlaceKind = 'hospital' | 'clinic' | 'customer' | 'city' | 'depot' | 'other';
export type Role = 'admin' | 'planner' | 'pending' | 'blocked';

export interface Worker {
  id: string;
  name: string;
  aliases: string[];
  can_drive: boolean;
  can_lift: boolean;
  can_assemble: boolean;
  is_technical: boolean;
  work_days: number[];
  active: boolean;
  sort_order: number;
}

export interface Place {
  id: string;
  name: string;
  aliases: string[];
  region: Region;
  kind: PlaceKind;
  city: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  notes: string | null;
}

export type TaskType =
  | 'pickup'
  | 'delivery'
  | 'install'
  | 'rotation'
  | 'service'
  | 'count'
  | 'completions'
  | 'check'
  | 'orders'
  | 'sets_prep'
  | 'warehouse'
  | 'off'; // day off, sick, reserve duty

/** How the location of a line was recognised. */
export type PlaceMatch =
  | 'exact' // the location text is a known name/alias
  | 'prefix' // starts with a known name ("רעננה אחוזה 301")
  | 'contains' // a known multi-word name appears inside the line
  | 'inhouse' // warehouse / orders prep / factory work
  | 'unknown' // there is a location text but it is not in the catalog
  | 'none'; // the line names no location at all

export interface PlaceCandidate {
  placeId: string;
  name: string;
  score: number;
}

export interface ParsedTask {
  workerId: string | null;
  workerLabel: string;
  seq: number;
  rawLine: string;
  locationText: string | null;
  description: string;
  match: PlaceMatch;
  placeId: string | null;
  candidates: PlaceCandidate[];
  types: TaskType[];
  isField: boolean;
  windowStart: string | null;
  windowEnd: string | null;
  address: string | null;
  flags: string[];
  /** Line of the message this task came from; null when it came from the worker's heading. */
  lineIndex: number | null;
  /** "+ ..." lines merged into this task. */
  extraLines: number[];
  /** The line also held tasks at other places ("איכילוב ..., באר שבע ..."). */
  sharedLine: boolean;
  /** The sub-heading line the task sits under ("אספקת הזמנות PRO:"), if any. */
  contextLine: number | null;
}

export interface ParsedSection {
  workerId: string | null;
  workerName: string;
  label: string;
  tasks: ParsedTask[];
  headingLine: number;
  /** Last line of the message that belongs to this worker. */
  lastLine: number;
}

export interface VehicleNote {
  workerId: string | null;
  text: string;
}

export type DateHint =
  | { kind: 'today' }
  | { kind: 'tomorrow' }
  | { kind: 'weekday'; weekday: number }
  | { kind: 'explicit'; day: number; month: number; year: number | null }
  | { kind: 'none' };

export interface ParsedDay {
  intro: string[];
  dateHint: DateHint;
  sections: ParsedSection[];
  vehicle: VehicleNote[];
  notes: string[];
  /** 'addendum': a few lines added to a day already sent ("מוסיפה לסידור של היום"). */
  kind: 'full' | 'addendum';
}

/** Rows as stored in Supabase. */
export interface DayRow {
  date: string;
  raw_text: string;
  intro: string | null;
  vehicle_notes: string[];
  notes: string[];
  source: 'paste' | 'whatsapp_export';
  message_sent_at: string | null;
  saved_by: string | null;
  saved_at: string;
  version: number;
}

export interface TaskRow {
  id: string;
  date: string;
  worker_id: string | null;
  worker_label: string;
  seq: number;
  place_id: string | null;
  location_text: string | null;
  description: string | null;
  task_types: TaskType[];
  is_field: boolean;
  window_start: string | null;
  window_end: string | null;
  address: string | null;
  flags: string[];
  raw_line: string;
}

/** What the planner did with a suggestion on the paste screen. */
export type AdviceDecisionKind = 'accepted' | 'declined' | 'ignored';

/** One suggestion shown for a day: which stop, between which drivers, and the answer. */
export interface AdviceDecision {
  date: string;
  place_id: string;
  place_name: string;
  from_worker: string;
  to_worker: string;
  saved_min: number;
  saved_km: number;
  decision: AdviceDecisionKind;
  decided_by?: string | null;
  decided_at?: string;
}

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  created_at?: string;
}

/** Short code shown on a waiting device, so the admin approves the right one. */
export function deviceCode(profileId: string): string {
  return profileId.replace(/-/g, '').slice(0, 4).toUpperCase();
}
