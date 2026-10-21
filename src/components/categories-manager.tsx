'use client';
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Pencil, Trash2, Tag } from 'lucide-react';
import { useT } from '@/hooks/use-t';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { getIcon } from '@/lib/icons';
import * as LucideIcons from 'lucide-react';
import { cn } from '@/lib/utils';

interface Category {
  id: string;
  nameAr: string;
  nameEn: string;
  type: string;
  icon: string;
  color: string;
  isDefault: boolean;
}

const ICONS = ['tag', 'shopping-cart', 'car', 'home', 'heart-pulse', 'graduation-cap',
  'plane', 'gift', 'banknote', 'laptop', 'trending-up', 'coffee', 'utensils', 'pizza',
  'smartphone', 'tv', 'music', 'book', 'dumbbell', 'pill', 'wrench', 'zap', 'droplet',
  'fuel', 'tshirt', 'baby', 'dog', 'bus', 'taxi', 'train', 'wallet', 'landmark',
  'piggy-bank', 'credit-card', 'btc', 'diamond', 'crown', 'star'];

const COLORS = ['#EF4444', '#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#06B6D4',
  '#EC4899', '#14B8A6', '#F97316', '#84CC16', '#A855F7', '#0EA5E9',
  '#6366F1', '#22C55E', '#EAB308', '#64748B'];

export function CategoriesManager() {
  const { t, lang } = useT();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<{ open: boolean; cat?: Category | null; type: 'EXPENSE' | 'INCOME' }>({
    open: false, type: 'EXPENSE',
  });

  const load = async () => {
    setLoading(true);
    try {
      const r = await api<{ data: Category[] }>('/api/categories');
      setCategories(r.data);
    } catch (e: any) {
      toast.error(e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const expenseCats = categories.filter(c => c.type === 'EXPENSE');
  const incomeCats = categories.filter(c => c.type === 'INCOME');

  const handleDelete = async (cat: Category) => {
    if (!confirm(lang === 'ar' ? `حذف فئة "${cat.nameAr}"؟` : `Delete "${cat.nameEn}"?`)) return;
    try {
      await api(`/api/categories/${cat.id}`, { method: 'DELETE' });
      toast.success(lang === 'ar' ? 'تم الحذف' : 'Deleted');
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleSave = async (data: any) => {
    try {
      await api('/api/categories', {
        method: 'POST',
        body: JSON.stringify(data),
      });
      toast.success(lang === 'ar' ? 'تم الحفظ' : 'Saved');
      setModal(m => ({ ...m, open: false }));
      load();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-purple-100 dark:bg-purple-950 flex items-center justify-center shrink-0">
          <Tag className="w-5 h-5 text-purple-600" />
        </div>
        <div className="flex-1">
          <h2 className="font-semibold">
            {lang === 'ar' ? 'إدارة الفئات' : 'Categories'}
          </h2>
          <p className="text-xs text-slate-500">
            {lang === 'ar' ? 'أضف أو عدّل أو احذف فئات الدخل والمصروف' : 'Add, edit or delete income & expense categories'}
          </p>
        </div>
      </div>

      <Tabs defaultValue="EXPENSE" className="w-full">
        <TabsList className="grid grid-cols-2 w-full mb-3">
          <TabsTrigger value="EXPENSE" className="text-red-600">
            {t('expense')} ({expenseCats.length})
          </TabsTrigger>
          <TabsTrigger value="INCOME" className="text-emerald-600">
            {t('income')} ({incomeCats.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="EXPENSE">
          <CategoryList
            cats={expenseCats}
            loading={loading}
            onAdd={() => setModal({ open: true, type: 'EXPENSE' })}
            onEdit={cat => setModal({ open: true, cat, type: 'EXPENSE' })}
            onDelete={handleDelete}
          />
        </TabsContent>

        <TabsContent value="INCOME">
          <CategoryList
            cats={incomeCats}
            loading={loading}
            onAdd={() => setModal({ open: true, type: 'INCOME' })}
            onEdit={cat => setModal({ open: true, cat, type: 'INCOME' })}
            onDelete={handleDelete}
          />
        </TabsContent>
      </Tabs>

      <CategoryModal
        key={modal.cat?.id || 'new'}
        open={modal.open}
        onOpenChange={o => setModal(m => ({ ...m, open: o }))}
        initial={modal.cat}
        type={modal.type}
        onSave={handleSave}
      />
    </Card>
  );
}

function CategoryList({ cats, loading, onAdd, onEdit, onDelete }: {
  cats: Category[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (cat: Category) => void;
  onDelete: (cat: Category) => void;
}) {
  const { t, lang } = useT();

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {cats.map(c => {
        const Icon = getIcon(c.icon);
        return (
          <div key={c.id} className="flex items-center gap-3 p-2 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0"
              style={{ background: c.color }}
            >
              <Icon className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {lang === 'ar' ? c.nameAr : c.nameEn}
              </p>
              <p className="text-xs text-slate-400">{lang === 'ar' ? c.nameEn : c.nameAr}</p>
            </div>
            {c.isDefault && (
              <span className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-full">
                {lang === 'ar' ? 'افتراضي' : 'default'}
              </span>
            )}
            <button onClick={() => onEdit(c)} className="p-1.5 text-slate-400 hover:text-blue-600">
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => onDelete(c)}
              className="p-1.5 text-slate-400 hover:text-red-500"
              disabled={c.isDefault}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        );
      })}

      <Button
        onClick={onAdd}
        variant="outline"
        className="w-full mt-2 border-dashed"
      >
        <Plus className="w-4 h-4" /> {lang === 'ar' ? 'إضافة فئة جديدة' : 'Add new category'}
      </Button>
    </div>
  );
}

function CategoryModal({
  open, onOpenChange, initial, type, onSave,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initial?: Category | null;
  type: 'EXPENSE' | 'INCOME';
  onSave: (data: any) => void;
}) {
  const { t, lang } = useT();
  const [nameAr, setNameAr] = useState(initial?.nameAr || '');
  const [nameEn, setNameEn] = useState(initial?.nameEn || '');
  const [icon, setIcon] = useState(initial?.icon || 'tag');
  const [color, setColor] = useState(initial?.color || COLORS[0]);

  const submit = () => {
    if (!nameAr || !nameEn) {
      toast.error(lang === 'ar' ? 'أدخل الاسمين' : 'Enter both names');
      return;
    }
    onSave({
      id: initial?.id,
      nameAr, nameEn, type,
      icon, color,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initial
              ? (lang === 'ar' ? 'تعديل فئة' : 'Edit Category')
              : (lang === 'ar' ? 'إضافة فئة' : 'Add Category')} ({type === 'EXPENSE' ? t('expense') : t('income')})
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto">
          {/* Preview */}
          <div className="flex justify-center py-2">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-white"
              style={{ background: color }}
            >
              {(() => {
                const I = (LucideIcons as any)[icon] || LucideIcons.Tag;
                return <I className="w-7 h-7" />;
              })()}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label>{lang === 'ar' ? 'بالعربي' : 'Arabic'}</Label>
              <Input value={nameAr} onChange={e => setNameAr(e.target.value)} placeholder="مثال: كحالة" />
            </div>
            <div className="space-y-1.5">
              <Label>{lang === 'ar' ? 'بالإنجليزي' : 'English'}</Label>
              <Input value={nameEn} onChange={e => setNameEn(e.target.value)} placeholder="e.g. Health" />
            </div>
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <Label>{lang === 'ar' ? 'اللون' : 'Color'}</Label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={cn(
                    'w-8 h-8 rounded-full border-2 transition',
                    color === c ? 'border-slate-900 dark:border-white scale-110' : 'border-transparent'
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          {/* Icon */}
          <div className="space-y-1.5">
            <Label>{lang === 'ar' ? 'الأيقونة' : 'Icon'}</Label>
            <div className="grid grid-cols-8 gap-1.5 max-h-44 overflow-y-auto p-1 border border-slate-200 dark:border-slate-800 rounded-lg">
              {ICONS.map(i => {
                const I = (LucideIcons as any)[i] || LucideIcons.Tag;
                const sel = icon === i;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIcon(i)}
                    className={cn(
                      'aspect-square rounded-lg flex items-center justify-center transition border-2',
                      sel
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-600'
                        : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-800'
                    )}
                    style={sel ? { color } : undefined}
                  >
                    <I className="w-4 h-4" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('cancel')}</Button>
          <Button onClick={submit}>{t('save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
