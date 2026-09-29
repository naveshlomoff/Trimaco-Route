// Distances and driving-time estimates from coordinates, without traffic.
// Roads run about 25% longer than the straight line, and short hops inside
// a city are slower than intercity driving.

import type { Place, Region } from './types';

export interface LatLng {
  lat: number;
  lng: number;
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const ROAD_FACTOR = 1.25;
/** Parking and walking in, per stop. */
export const STOP_OVERHEAD_MIN = 5;

export function roadKm(a: LatLng, b: LatLng): number {
  return haversineKm(a, b) * ROAD_FACTOR;
}

/** Estimated minutes to drive from a to b (no traffic). */
export function driveMinutes(a: LatLng, b: LatLng): number {
  const km = roadKm(a, b);
  if (km < 0.5) return 0;
  const kmh = km < 8 ? 28 : km < 30 ? 45 : 70;
  return STOP_OVERHEAD_MIN + (km / kmh) * 60;
}

// Rough centre of each region, for places with neither coordinates nor a known city.
const REGION_CENTRE: Record<Exclude<Region, 'unknown'>, LatLng> = {
  tlv: { lat: 32.075, lng: 34.8 },
  center: { lat: 31.95, lng: 34.85 },
  sharon: { lat: 32.24, lng: 34.88 },
  north: { lat: 32.75, lng: 35.2 },
  jerusalem: { lat: 31.78, lng: 35.2 },
  south: { lat: 31.45, lng: 34.72 },
};

/** Where a place is: its own coordinates, else its city's, else its region's centre. */
export function locate(place: Place, byName: Map<string, Place>): LatLng | null {
  if (place.lat != null && place.lng != null) return { lat: place.lat, lng: place.lng };
  const city = place.city ? byName.get(place.city) : undefined;
  if (city?.lat != null && city.lng != null) return { lat: city.lat, lng: city.lng };
  return place.region !== 'unknown' ? REGION_CENTRE[place.region] : null;
}
