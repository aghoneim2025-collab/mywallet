# MyWallet — قواعد المحاسبة المالية (Accounting Rules)

> **هذا المستند يحدد السلوك المالي الصحيح للتطبيق.** أي تنفيذ للكود
> يجب أن يلتزم بهذه القواعد. الاختبارات تتحقق منها.

---

## 1. مصدر أسعار الصرف (Exchange Rate Source)

### القاعدة
- **مصدر واحد موحد**: يتم تخزين أسعار الصرف في قاعدة البيانات (جدول `ExchangeRate`)،
  مرتبط بكل مستخدم (`userId`).
- **الخادم والواجهة يقرآن من نفس المصدر**. لا يوجد `localStorage` أو
  أسعار افتراضية مدمجة في الكود (بعد التهيئة الأولية).
- **الأسعار الافتراضية** تُستخدم فقط عند إنشاء مستخدم جديد (تُنسخ للجدول).
- المستخدم يمكنه تعديل الأسعار عبر `/api/exchange-rates` (يحدث DB).
- الواجهة تجلب الأسعار من `/api/exchange-rates` (يقرأ DB).

### التنفيذ
```
model ExchangeRate {
  id        String   @id @default(cuid())
  userId    String
  currency  Currency  // العملة الأجنبية (EGP, SAR, USD, EUR, AED)
  rateToEgp Float     // 1 وحدة من العملة = كم EGP
  updatedAt DateTime @updatedAt
  @@unique([userId, currency])
}
```

---

## 2. التقريب والدقة (Rounding & Precision)

### القاعدة
- **كل المبالغ تُخزن كأعداد صحيحة بالـ cents** (وحدة صغرى، 1/100 من العملة).
  - `100.50 EGP` → `10050` (cents)
  - `0.01 EGP` → `1` (cent)
- **التحويل بين العملات** يستخدم `Math.round(amount * rate)` لتفادي تراكم أخطاء Float.
- **العرض فقط** يستخدم `Float` (للتوافق مع الواجهة): `cents / 100`.
- **نوع الحقل في DB**: `BigInt` (SQLite يدعمه كـ `INTEGER` 64-bit).

### لماذا BigInt وليس Decimal؟
- SQLite لا يدعم `Decimal` أصليًا.
- BigInt أسرع وأبسط.
- أقصى قيمة: `9,223,372,036,854,775,807` cents = `92,233,720,368,547,775.77` عملة
  (أكثر من 92 كوادريليون) — كافٍ لأي تطبيق مالي شخصي.

### التنفيذ
```prisma
model Account {
  balanceCents BigInt @default(0)  // بالـ cents، ليس Float
}

model Transaction {
  amountCents BigInt  // المبلغ الأصلي بالعملة الأصلية
  sourceAmountCents BigInt?  // snapshot: المبلغ المطبق على حساب المصدر
  destAmountCents BigInt?   // snapshot: المبلغ المطبق على حساب الوجهة
  exchangeRateUsed Float?  // snapshot: السعر المستخدم
}
```

---

## 3. السماح بالسحب الزائد (Overdraft)

### القاعدة
- **افتراضيًا**: ممنوع. أي معاملة/تحويل يرفض إذا الرصيد غير كافٍ.
- **الاستثناء**: حسابات `LOAN` فقط (مسموح برصيد سالب).
- **الفحص ذريّ**: داخل `$transaction`، باستخدام `updateMany WHERE balance >= amount`.
  إذا `count === 0` → رفض المعاملة (HTTP 400).

### القاعدة الإضافية
- حسابات `EXTERNAL` (متابعة فقط) لا تشارك في حسابات الأصول/الخصوم.

---

## 4. تسوية معاملات Legacy (Legacy Reconciliation)

### القاعدة
- **بعد الترحيل**: كل المعاملات القديمة يجب أن تحتوي على snapshots
  (`sourceAmountCents`, `destAmountCents`, `exchangeRateUsed`).
- **الترحيل**: يتم بـ backfill script يستخدم:
  - للمعاملات بعملة الحساب نفسها: `sourceAmount = amount` (دائمًا صحيح).
  - للمعاملات متعددة العملات: يطلب من المستخدم إدخال السعر التاريخي يدويًا،
    أو يرفض المعاملة ويتركها للـ `?force=true` path.

### مسار `?force=true`
- **مسموح فقط** للمعاملات القديمة متعددة العملات بدون snapshot.
- **لا يعدل الرصيد** — يحذف السجل فقط.
- **يسجل في AuditLog** (جدول جديد) مع: userId, txId, timestamp, reason.
- **يرفض** للمعاملات العادية (لها snapshots).

### AuditLog
```
model AuditLog {
  id         String   @id @default(cuid())
  userId     String
  action     String   // 'force_delete', 'manual_balance_adjust', ...
  entityId   String   // txId or accountId
  details    String   // JSON string with context
  createdAt  DateTime @default(now())
}
```

---

## 5. معالجة الأخطاء (Error Handling)

### القاعدة
- **أي خطأ داخل `$transaction`**: يرمي `ValidationError`، الذي يُلتقط في
  `handleAuthError` ويرجع HTTP 400 برسالة واضحة.
- **لا يُسرب `err.message`** للعميل إذا كان Prisma error (يحتوي على أسماء
  الجداول/الأعمدة). فقط رسائلنا المخصصة (التي كتبناها) ترجع.
- **DB outage**: يرمي `DbUnavailableError` → HTTP 503، الواجهة تحتفظ بالـ token.

---

## 6. التحويلات الذرية (Atomic Transfers)

### القاعدة
- **كل المعاملات المالية داخل `$transaction` واحد**:
  - إنشاء معاملة
  - تحديث رصيد الحساب (مع فحص ذريّ للرصيد الكافي)
  - حفظ snapshot
- **لا قراءات خارج الـ transaction** (يمنع سباق البيانات).
- **Optimistic locking**: `updateMany WHERE id AND updatedAt = ?`.
  إذا `count === 0` → رفض (HTTP 400 "modified by another request").

---

## 7. التراجع Idempotent (Idempotent Reversal)

### القاعدة
- عند تعديل/حذف معاملة: استخدم snapshot (`sourceAmountCents`, `destAmountCents`).
- **لا تعد التحويل** بأسعار حالية — استخدم القيمة المطبقة فعلًا وقت الإنشاء.
- **سجلات Legacy بدون snapshot**: ترفض (مع رسالة توضح مسار التسوية اليدوي).

---

## 8. التواريخ (Dates)

### القاعدة
- **كل التواريخ UTC** (ISO 8601).
- `parseDate()` يقبل:
  - `YYYY-MM-DD` (تاريخ فقط) → يُحول لـ UTC midnight.
  - ISO 8601 كامل (مع وقت).
- **يرفض التواريخ المستحيلة**: `2024-02-30` (يتطابق السنة/الشهر/اليوم بعد التحويل).

---

## 9. التحقق من المدخلات (Input Validation)

### القاعدة
- كل المدخلات تمر عبر `lib/validate.ts`:
  - `parseMoney` →cents (يreject NaN, Infinity, سالب، > 1 تريليون).
  - `isCurrency`, `isAccountType` → فحص enum.
  - `parseDate` → فحص صيغة + roundtrip.
  - `parseString` → حدود طول.
- كل التحقق يرجع HTTP 400 برسالة واضحة.

---

## 10. المصادقة (Authentication)

### القاعدة
- **Cookie-only** (HttpOnly + SameSite=Strict + Secure + __Host- prefix في الإنتاج).
- **لا JWT في localStorage** (XSS-safe).
- **Server-side revocation**: جدول `RevokedToken` يحفظ SHA-256 hash للـ token.
- **Rate limiting**: in-memory token bucket (single-instance) — يـ documented
  أن الإنتاج يحتاج Redis.

---

## ملخص التنفيذ المطلوب

1. ترحيل الـ schema:
   - `Account.balance` → `balanceCents BigInt`
   - `Transaction.amount` → `amountCents BigInt`
   - `Transaction.sourceAmount/destAmount` → `sourceAmountCents/destAmountCents BigInt`
   - أضف `ExchangeRate` model
   - أضف `AuditLog` model
2. إعادة كتابة `lib/currency.ts` لقراءة الأسعار من DB.
3. إعادة كتابة API routes لاستخدام cents و snapshots.
4. كتابة test suite (`tests/financial-core.test.ts`):
   - إنشاء/تعديل/حذف معاملة (دخل + مصروف)
   - تحويل بين نفس العملة
   - تحويل بين عملات مختلفة
   - فشل خطوة داخل `$transaction` (rollback)
   - طلبات متزامنة (atomic balance deduction)
   - معاملة بدون snapshot (legacy rejection)
5. تشغيل الاختبارات + البناء، تقديم نتيجة واحدة مجمّعة.

---

## الحالة الحالية: غير مكتمل

هذا المستند يحدد الهدف. التنفيذ الفعلي سيلي.
