'use client';
import { useSyncExternalStore } from 'react';

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (callback) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', callback);
      return () => m.removeEventListener('change', callback);
    },
    () => window.matchMedia(query).matches,
    () => false // SSR default
  );
}
