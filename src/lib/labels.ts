import type { PlaceKind, Region, TaskType } from './types';

export const REGION_LABELS: Record<Region, string> = {
  tlv: 'ת"א וגוש דן',
  center: 'מרכז',
  sharon: 'שרון',
  north: 'צפון',
  jerusalem: 'ירושלים',
  south: 'דרום',
  unknown: 'אזור לא ידוע',
};

export const REGION_ORDER: Region[] = ['tlv', 'center', 'sharon', 'north', 'jerusalem', 'south', 'unknown'];

export const KIND_LABELS: Record<PlaceKind, string> = {
  hospital: 'בית חולים',
  clinic: 'מרפאה',
  customer: 'לקוח',
  city: 'עיר / יישוב',
  depot: 'מחסן טרימקו',
  other: 'אחר',
};

export const KIND_ORDER: PlaceKind[] = ['hospital', 'clinic', 'customer', 'city', 'other', 'depot'];

export const TYPE_LABELS: Record<TaskType, string> = {
  pickup: 'איסוף',
  delivery: 'אספקה',
  install: 'התקנה',
  rotation: 'גלגול רשתות',
  service: 'שירות',
  count: 'ספירה',
  completions: 'השלמות',
  check: "צ'ק",
  orders: 'הזמנות',
  sets_prep: 'הכנת רשתות',
  warehouse: 'מחסן',
  off: 'לא עובד היום',
};

export const FLAG_LABELS: Record<string, string> = {
  signed_doc: 'להחזיר תעודה חתומה',
  call_ahead: 'להתקשר קודם',
  uncertain: 'לא סופי',
  urgent: 'דחוף',
};
