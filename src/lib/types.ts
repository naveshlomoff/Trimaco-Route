export type Region = 'center' | 'tlv' | 'sharon' | 'jerusalem' | 'south' | 'north' | 'unknown';
export type PlaceKind = 'hospital' | 'clinic' | 'customer' | 'city' | 'depot' | 'other';
export type Role = 'admin' | 'planner' | 'pending';

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
  | 'warehouse';

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
}

export interface ParsedSection {
  workerId: string | null;
  workerName: string;
  label: string;
  tasks: ParsedTask[];
}

export interface VehicleNote {
  workerId: string | null;
  text: string;
}

export type DateHint =
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

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  role: Role;
}
