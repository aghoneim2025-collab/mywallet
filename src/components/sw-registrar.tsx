'use client';
import { useEffect } from 'react';
import { useSettings } from '@/lib/store';
import { toast } from 'sonner';

export function ServiceWorkerRegistrar() {
  const lang = useSettings(s => s.lang);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      // Unregister all existing service workers first (to clear old caches)
      navigator.serviceWorker.getRegistrations().then((regs) => {
        const old = regs.filter(r => r.active && !r.active.scriptURL.endsWith('/sw.js'));
        // If the active SW is from a previous version, force unregister to refresh
        return Promise.all(old.map(r => r.unregister()));
      }).then(() => {
        // Register the new SW
        return navigator.serviceWorker.register('/sw.js');
      }).then((reg) => {
        console.log('SW registered v3');
        // Force update if there's a new version
        if (reg.waiting) {
          reg.waiting.postMessage('SKIP_WAITING');
        }
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (nw) {
            nw.addEventListener('statechange', () => {
              if (nw.state === 'activated') {
                toast.info(lang === 'ar' ? 'تم تحديث التطبيق' : 'App updated');
                setTimeout(() => window.location.reload(), 1000);
              }
            });
          }
        });
      }).catch((err) => {
        console.warn('SW failed:', err);
      });
    }
  }, [lang]);

  useEffect(() => {
    const updateOnlineStatus = () => {
      if (!navigator.onLine) {
        toast.warning(lang === 'ar' ? 'أنت غير متصل - وضع عدم الاتصال' : 'Offline mode');
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
