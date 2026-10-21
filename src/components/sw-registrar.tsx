'use client';
import { useEffect } from 'react';
import { useSettings } from '@/lib/store';
import { toast } from 'sonner';

export function ServiceWorkerRegistrar() {
  const lang = useSettings(s => s.lang);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => {
          console.log('SW registered');
        })
        .catch((err) => {
          console.warn('SW failed:', err);
        });
    }
  }, []);

  // online/offline indicator
  useEffect(() => {
    const updateOnlineStatus = () => {
      if (!navigator.onLine) {
        toast.warning(lang === 'ar' ? 'أنت غير متصل - وضع عدم الاتصال' : 'Offline mode');
      } else if (navigator.onLine) {
        // don't toast on every reconnect, only first
      }
    };
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, [lang]);

  return null;
}
