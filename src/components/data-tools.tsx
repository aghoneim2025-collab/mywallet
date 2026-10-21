'use client';
import { useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Upload, FileSpreadsheet, Database, Cloud, Loader2 } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { downloadFile } from '@/lib/api';
import { toast } from 'sonner';

export function DataTools() {
  const { t, lang } = useT();
  const excelImportRef = useRef<HTMLInputElement>(null);
  const backupImportRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState<'excel' | 'backup' | null>(null);

  const handleExcelExport = async () => {
    try {
      const month = new Date().toISOString().slice(0, 7);
      await downloadFile(`/api/excel?action=export&month=${month}`, `mywallet-${month}.xlsx`);
      toast.success(lang === 'ar' ? 'تم تصدير Excel' : 'Excel exported');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleExcelImport = async (file: File) => {
    setImporting('excel');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/excel?action=import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message || `${data.imported} imported`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setImporting(null);
      if (excelImportRef.current) excelImportRef.current.value = '';
    }
  };

  const handleBackupExport = async () => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      await downloadFile('/api/backup?action=export', `mywallet-backup-${date}.json`);
      toast.success(lang === 'ar' ? 'تم تحميل ملف الباك أب' : 'Backup downloaded');
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleBackupImport = async (file: File) => {
    if (!confirm(lang === 'ar'
      ? 'استيراد الباك أب هيمسح كل البيانات الحالية. متأكد؟'
      : 'Restoring backup will overwrite ALL current data. Continue?')) return;
    setImporting('backup');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/backup?action=import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const { accounts, categories, transactions, budgets } = data.imported;
      toast.success(
        lang === 'ar'
          ? `تم الاستيراد: ${accounts} حساب، ${categories} فئة، ${transactions} معاملة، ${budgets} ميزانية`
          : `Restored: ${accounts} acc, ${categories} cat, ${transactions} tx, ${budgets} budget`
      );
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setImporting(null);
      if (backupImportRef.current) backupImportRef.current.value = '';
    }
  };

  return (
    <>
      {/* Excel export/import */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 dark:bg-green-950 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="w-5 h-5 text-green-600" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold">
              {lang === 'ar' ? 'Excel (تصدير/استيراد)' : 'Excel (Export/Import)'}
            </h2>
            <p className="text-xs text-slate-500">
              {lang === 'ar'
                ? 'متوافق مع ملفات Money Manager - استورد معاملاتك القديمة'
                : 'Compatible with Money Manager files'}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Button onClick={handleExcelExport} variant="outline" className="w-full h-11">
            <Download className="w-4 h-4" />
            {lang === 'ar' ? 'تصدير كل المعاملات Excel' : 'Export all to Excel'}
          </Button>

          <input
            ref={excelImportRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleExcelImport(f);
            }}
          />
          <Button
            onClick={() => excelImportRef.current?.click()}
            variant="outline"
            className="w-full h-11"
            disabled={importing === 'excel'}
          >
            {importing === 'excel' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {lang === 'ar' ? 'استيراد من Excel' : 'Import from Excel'}
          </Button>
        </div>
      </Card>

      {/* Backup */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center shrink-0">
            <Database className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold">
              {lang === 'ar' ? 'النسخة الاحتياطية (Backup)' : 'Backup & Restore'}
            </h2>
            <p className="text-xs text-slate-500">
              {lang === 'ar'
                ? 'حمّل كل بياناتك كملف JSON وارفعها على Google Drive أو احتفظ بها على موبايلك'
                : 'Download all data as JSON, upload to Google Drive or keep on phone'}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Button onClick={handleBackupExport} className="w-full h-11 bg-blue-600 hover:bg-blue-700">
            <Download className="w-4 h-4" />
            {lang === 'ar' ? 'تحميل النسخة الاحتياطية' : 'Download Backup'}
          </Button>

          <input
            ref={backupImportRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) handleBackupImport(f);
            }}
          />
          <Button
            onClick={() => backupImportRef.current?.click()}
            variant="outline"
            className="w-full h-11"
            disabled={importing === 'backup'}
          >
            {importing === 'backup' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            {lang === 'ar' ? 'استعادة من نسخة احتياطية' : 'Restore from Backup'}
          </Button>
        </div>

        {/* Google Drive instructions */}
        <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-1.5">
            <Cloud className="w-3.5 h-3.5 text-blue-500" />
            <span className="text-xs font-semibold">
              {lang === 'ar' ? 'للرفع على Google Drive يدوياً:' : 'To upload to Google Drive manually:'}
            </span>
          </div>
          <ol className="text-[11px] text-slate-600 dark:text-slate-400 space-y-1 ps-4 list-decimal">
            <li>{lang === 'ar' ? 'حمّل ملف الباك أب من الزر فوق' : 'Download the backup file from the button above'}</li>
            <li>{lang === 'ar' ? 'افتح تطبيق Google Drive على موبايلك' : 'Open Google Drive app on your phone'}</li>
            <li>{lang === 'ar' ? 'اضغط زر + واختار "Upload"' : 'Tap + and select "Upload"'}</li>
            <li>{lang === 'ar' ? 'اختار ملف الـ JSON من الـ Downloads' : 'Pick the JSON file from Downloads'}</li>
            <li>{lang === 'ar' ? 'لاستعادته لاحقاً: حمّله من Drive واستورده من زر الاستعادة' : 'To restore later: download from Drive and use Restore button'}</li>
          </ol>
        </div>
      </Card>
    </>
  );
}
