'use client';
import { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Wallet, Mail, Lock, User, Loader2 } from 'lucide-react';
import { useSettings } from '@/lib/store';
import { useT } from '@/hooks/use-t';
import { toast } from 'sonner';

export function AuthScreen({ onAuth }: { onAuth: () => void }) {
  const { lang, setLang } = useSettings();
  const { t } = useT();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  // Check if already logged in
  useEffect(() => {
    fetch('/api/auth/session')
      .then(r => r.json())
      .then(d => {
        if (d.data) onAuth();
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async () => {
    if (!email || !password) {
      toast.error(lang === 'ar' ? 'أدخل الإيميل وكلمة السر' : 'Enter email and password');
      return;
    }
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const body = mode === 'register'
        ? { email, password, name: name || undefined }
        : { email, password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      toast.success(lang === 'ar' ? 'تم تسجيل الدخول' : 'Welcome!');
      onAuth();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-600 to-blue-800 p-4">
      <div className="w-full max-w-sm space-y-4">
        {/* Logo */}
        <div className="text-center text-white mb-6">
          <div className="w-20 h-20 rounded-3xl bg-white/20 backdrop-blur-sm flex items-center justify-center mx-auto mb-3">
            <Wallet className="w-10 h-10 text-white" />
          </div>
          <h1 className="text-2xl font-bold">{t('appName')}</h1>
          <p className="text-sm text-blue-100">{t('tagline')}</p>
        </div>

        <Card className="p-6 space-y-4">
          {/* Tab toggle */}
          <div className="flex gap-1 bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
            <button
              onClick={() => setMode('login')}
              className={`flex-1 py-2 rounded text-sm font-medium transition ${mode === 'login' ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-500'}`}
            >
              {lang === 'ar' ? 'تسجيل دخول' : 'Login'}
            </button>
            <button
              onClick={() => setMode('register')}
              className={`flex-1 py-2 rounded text-sm font-medium transition ${mode === 'register' ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-500'}`}
            >
              {lang === 'ar' ? 'حساب جديد' : 'Register'}
            </button>
          </div>

          {/* Name (register only) */}
          {mode === 'register' && (
            <div className="space-y-1.5">
              <Label>{lang === 'ar' ? 'الاسم' : 'Name'}</Label>
              <div className="relative">
                <User className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input value={name} onChange={e => setName(e.target.value)} placeholder={lang === 'ar' ? 'اسمك' : 'Your name'} className="ps-9" />
              </div>
            </div>
          )}

          {/* Email */}
          <div className="space-y-1.5">
            <Label>{lang === 'ar' ? 'البريد الإلكتروني' : 'Email'}</Label>
            <div className="relative">
              <Mail className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="ps-9" />
            </div>
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <Label>{lang === 'ar' ? 'كلمة السر' : 'Password'}</Label>
            <div className="relative">
              <Lock className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="******" className="ps-9" onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
            </div>
          </div>

          <Button onClick={handleSubmit} disabled={loading} className="w-full h-12 bg-blue-600 hover:bg-blue-700">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
            {mode === 'login' ? (lang === 'ar' ? 'دخول' : 'Login') : (lang === 'ar' ? 'إنشاء حساب' : 'Register')}
          </Button>

          <p className="text-xs text-center text-slate-400">
            {lang === 'ar'
              ? 'كل إيميل له بياناته لوحده - بياناتك آمنة ومش مشتركة'
              : 'Each email has its own data - your data is private'}
          </p>
        </Card>

        {/* Language toggle */}
        <div className="flex justify-center gap-2">
          <button onClick={() => setLang('ar')} className={`px-3 py-1 rounded text-xs ${lang === 'ar' ? 'bg-white/20 text-white' : 'text-blue-100'}`}>عربي</button>
          <button onClick={() => setLang('en')} className={`px-3 py-1 rounded text-xs ${lang === 'en' ? 'bg-white/20 text-white' : 'text-blue-100'}`}>English</button>
        </div>
      </div>
    </div>
  );
}
