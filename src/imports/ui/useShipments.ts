import { useEffect, useState } from 'react';
import { store } from '../../lib/store';
import type { Shipment } from '../model';

// The history barely changes: load it once per visit.
let cache: Shipment[] | null = null;

export function useShipments(): { shipments: Shipment[] | null; error: string | null } {
  const [shipments, setShipments] = useState<Shipment[] | null>(cache);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    store()
      .listImportShipments()
      .then((s) => {
        cache = s;
        if (alive) setShipments(s);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);
  return { shipments, error };
}

export const shekels = (x: number) => `${Math.round(x).toLocaleString('he-IL')} ₪`;
