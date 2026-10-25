'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe, Palette, Coins, Bell, Info, Download, RefreshCw, Smartphone } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { useSettings } from '@/lib/store';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { Currency } from '@/lib/currency';
import { CategoriesManager } from '@/components/categories-manager';
import { DataTools } from '@/components/data-tools';

const CURRENCIES: Currency[] = ['EGP', 'SAR', 'USD', 'EUR', 'AED'];

export function SettingsScreen({ onLogout }: { onLogout?: () => void }) {
  const { t, lang } = useT();
  const { lang: curLang, setLang, baseCurrency, setBaseCurrency, theme, setTheme } = useSettings();
  const [notifications, setNotifications] = useState(true);
  const [installEvt, setInstallEvt] = useState<any>(null);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    const handler = (e: any) => {
      e.preventDefault();
      setInstallEvt(e);
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installEvt) {
      toast.info(lang === 'ar'
        ? 'استخدم قائمة المتصفح > Add to Home Screen'
        : 'Use browser menu > Add to Home Screen');
      return;
    }
    installEvt.prompt();
    await installEvt.userChoice;
    setCanInstall(false);
  };

  const handleReset = async () => {
    if (!confirm(t('confirmReset'))) return;
    try {
      const res = await fetch('/api/reset', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(lang === 'ar'
        ? `تم حذف ${data.deleted.transactions} معاملة و ${data.deleted.budgets} ميزانية`
        : `Deleted ${data.deleted.transactions} txns, ${data.deleted.budgets} budgets`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <div className="p-4 space-y-5">
      <header>
        <h1 className="text-2xl font-bold">{t('settings')}</h1>
        <p className="text-sm text-slate-500">{t('appName')}</p>
      </header>

      {/* Language */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <Globe className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold">{t('language')}</h2>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setLang('ar')}
            className={`p-3 rounded-xl border-2 transition ${curLang === 'ar' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-slate-200 dark:border-slate-800'}`}
          >
            <span className="text-2xl">🇪🇬</span>
            <p className="text-sm font-medium mt-1">{t('arabic')}</p>
          </button>
          <button
            onClick={() => setLang('en')}
            className={`p-3 rounded-xl border-2 transition ${curLang === 'en' ? 'border-blue-500 bg-blue-50 dark:bg-blue-950' : 'border-slate-200 dark:border-slate-800'}`}
          >
            <span className="text-2xl">🇬🇧</span>
            <p className="text-sm font-medium mt-1">{t('english')}</p>
          </button>
        </div>
      </Card>

      {/* Currency */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <Coins className="w-5 h-5 text-emerald-600" />
          <h2 className="font-semibold">{t('baseCurrency')}</h2>
        </div>
        <Select value={baseCurrency} onValueChange={(v: any) => setBaseCurrency(v)}>
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            {CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      {/* Appearance */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <Palette className="w-5 h-5 text-purple-600" />
          <h2 className="font-semibold">{t('appearance')}</h2>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['light', 'dark', 'system'] as const).map(th => (
            <button
              key={th}
              onClick={() => setTheme(th)}
              className={`p-3 rounded-xl border-2 transition text-sm font-medium ${theme === th ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300' : 'border-slate-200 dark:border-slate-800'}`}
            >
              {th === 'light' ? t('light') : th === 'dark' ? t('dark') : t('system')}
            </button>
          ))}
        </div>
      </Card>

      {/* Notifications */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-amber-600" />
            <div>
              <h2 className="font-semibold">{t('notifications')}</h2>
              <p className="text-xs text-slate-500">{lang === 'ar' ? 'تنبيهات الميزانية' : 'Budget alerts'}</p>
            </div>
          </div>
          <Switch checked={notifications} onCheckedChange={setNotifications} />
        </div>
      </Card>

      {/* Install App */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <Smartphone className="w-5 h-5 text-blue-600" />
          <h2 className="font-semibold">{t('installApp')}</h2>
        </div>
        <p className="text-xs text-slate-500 mb-3">{t('installHint')}</p>
        <Button onClick={handleInstall} className="w-full" disabled={!canInstall && !installEvt}>
          <Download className="w-4 h-4" /> {canInstall ? t('installNow') : (lang === 'ar' ? 'غير متاح الآن' : 'Not available now')}
        </Button>
      </Card>

      {/* Download APK - Native Android App */}
      <Card className="p-4 border-2 border-blue-200 dark:border-blue-900 bg-gradient-to-br from-blue-50 to-white dark:from-blue-950/30 dark:to-slate-900">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shrink-0">
            <Download className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold text-blue-900 dark:text-blue-100">
              {lang === 'ar' ? 'تحميل تطبيق Android (APK)' : 'Download Android App (APK)'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {lang === 'ar'
                ? 'حمّل ملف APK وثبّته على موبايلك بدون نشر على Google Play'
                : 'Download APK file and install on your phone without Google Play'}
            </p>
          </div>
        </div>
        <div className="text-xs text-slate-500 mb-3 space-y-1">
          <div className="flex items-center justify-between">
            <span>{lang === 'ar' ? 'الإصدار' : 'Version'}:</span>
            <span className="font-mono">1.0.0</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{lang === 'ar' ? 'الحجم' : 'Size'}:</span>
            <span className="font-mono">5.5 MB</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{lang === 'ar' ? 'يدعم' : 'Supports'}:</span>
            <span className="font-mono">Android 7.0+</span>
          </div>
        </div>
        <a
          href="/MyWallet.apk"
          download="MyWallet.apk"
          className="flex items-center justify-center gap-2 w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 transition text-white font-semibold text-base shadow-md"
        >
          <Download className="w-5 h-5" />
          {lang === 'ar' ? 'حمّل ملف APK الآن' : 'Download APK Now'}
        </a>
        <p className="text-[10px] text-slate-400 mt-2 text-center">
          {lang === 'ar'
            ? 'بعد التحميل: افتح الـ File Manager واضغط على الملف لتثبيته'
            : 'After download: open File Manager and tap the file to install'}
        </p>
      </Card>

      {/* Categories Management */}
      <CategoriesManager />

      {/* Excel Export/Import + Backup */}
      <DataTools />

      {/* Data Management */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <RefreshCw className="w-5 h-5 text-red-600" />
          <h2 className="font-semibold">{t('dataManagement')}</h2>
        </div>
        <Button variant="outline" onClick={handleReset} className="w-full text-red-600 border-red-200 hover:bg-red-50">
          {t('resetData')}
        </Button>
      </Card>

      {/* About */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <Info className="w-5 h-5 text-slate-500" />
          <h2 className="font-semibold">{t('about')}</h2>
        </div>
        <div className="text-xs text-slate-500 space-y-1">
          <p>{t('appName')} v1.0.0</p>
          <p>{t('tagline')}</p>
          <p>Next.js 16 + PWA + Prisma</p>
        </div>
      </Card>

      {/* Logout */}
      {onLogout && (
        <Card className="p-4">
          <Button
            variant="outline"
            onClick={async () => {
              await fetch('/api/auth/logout', { method: 'POST' });
              onLogout();
            }}
            className="w-full h-12 text-red-600 border-red-200 hover:bg-red-50"
          >
            {lang === 'ar' ? 'تسجيل الخروج' : 'Logout'}
          </Button>
        </Card>
      )}

      <div className="h-4" />
    </div>
  );
}
