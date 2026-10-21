# 📱 محفظتي (MyWallet) - تطبيق Android APK

## ✅ الملف جاهز

تم بناء تطبيق Android أصلي يحمل تطبيق محفظتي بداخل WebView. الملف جاهز للتثبيت على أي موبايل Android بدون الحاجة لرفعه على Google Play.

## 📦 معلومات التطبيق

| الخاصية | القيمة |
|---------|--------|
| **اسم الملف** | `MyWallet.apk` |
| **الحجم** | 5.5 ميجابايت |
| **Package ID** | `com.mywallet.app` |
| **الإصدار** | 1.0.0 (versionCode 1) |
| **minSdkVersion** | 24 (Android 7.0+) |
| **targetSdkVersion** | 34 (Android 14) |
| **الرابط الداخلي** | https://preview-chat-d940a26d-ab97-42dc-b29b-53491e59517a.space-z.ai/ |

## 🚀 طريقة التثبيت على الموبايل

### الطريقة الأولى: نقل مباشر

1. **حمّل ملف `MyWallet.apk`** من مجلد download إلى موبايلك (USB أو Bluetooth أو رفع على Drive)
2. على الموبايل افتح **File Manager** وحدد على ملف APK
3. هتظهر رسالة "For your security, your phone is not allowed to install unknown apps from this source"
4. اضغط **Settings** وفعّل **Allow from this source**
5. ارجع واضغط **Install**
6. لما يخلص افتح التطبيق من الـ Home Screen - هتلاقي أيقونة "محفظتي"

### الطريقة الثانية: عبر Google Drive / WhatsApp

1. ارفع ملف APK على Google Drive أو على نفسك في واتساب
2. على الموبايل افتح الرابط
3. لما يتحمل اضغط على الملف واتبع نفس الخطوات (4-6)

## 🎯 ميزات التطبيق

- ✅ يفتح التطبيق مباشرة بدون شريط المتصفح
- ✅ أيقونة مستقلة على الـ Home Screen باسم "محفظتي"
- ✅ يدعم RTL/LTR تلقائياً حسب لغة التطبيق
- ✅ Splash screen أزرق عند الفتح
- ✅ شريط status أزرق متناسق مع هوية التطبيق
- ✅ Swipe-to-refresh (اسحب لتحديث الصفحة)
- ✅ يفتح الروابط الخارجية في المتصفح تلقائياً
- ✅ اضغط Back مرتين للخروج من التطبيق
- ✅ يدعم Offline HTML لما الموبايل يكون بدون نت
- ✅ يدعم Cookies و Local Storage

## ⚠️ ملاحظات مهمة

1. **التطبيق يحتاج إنترنت** عند الاستخدام لأنه يحمل نسخة الويب من الـ preview link
2. **Service Worker** بيكاش الصفحات، فالتطبيق ممكن يفتح آخر مرة حتى لو شوية دقايق بدون نت
3. لإعادة بناء APK بتعديلات، شغّل:
   ```bash
   cd /home/z/my-project/android
   ./gradlew assembleDebug
   ```
   والـ APK الجديد هيتولّد في:
   `app/build/outputs/apk/debug/app-debug.apk`

## 🔐 التوقيع (Signing)

الـ APK الحالي **debug-signed** (مشفر بمفتاح debug الخاص بـ Android). هذا يكفي:
- للتثبيت على موبايلك الشخصي
- للاختبار
- للمشاركة مع أصحابك

**للنشر على Google Play** محتاج توقيع production (release-signed) - تحتاج keystore رسمي. أما للتثبيت المباشر فالـ debug كافي تماماً.

## 🛠️ البنية التقنية

```
android/
├── app/
│   ├── build.gradle
│   ├── proguard-rules.pro
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/mywallet/app/
│       │   ├── MainActivity.java      ← WebView host
│       │   └── NotificationService.java
│       └── res/
│           ├── drawable/splash_background.xml
│           ├── drawable/ic_splash.png
│           ├── mipmap-*/ic_launcher.png (5 أحجام)
│           ├── mipmap-*/ic_launcher_round.png (5 أحجام)
│           ├── values/strings.xml
│           ├── values/colors.xml
│           ├── values/themes.xml
│           └── xml/network_security_config.xml
├── gradle/wrapper/
│   ├── gradle-wrapper.jar
│   └── gradle-wrapper.properties
├── build.gradle
├── settings.gradle
├── gradle.properties
├── gradlew
└── local.properties
```

## 📞 الدعم

لو رفض الموبايل يثبّت الـ APK:
- **Xiaomi/Redmi**: Settings → Privacy protection → Special permissions → Install unknown apps
- **Samsung**: Settings → Apps → Special access → Install unknown apps
- **Huawei**: Settings → Security → More settings → Unknown sources
- **Oppo/Realme**: Settings → Security → Install unknown apps
- **Vivo**: Settings → More settings → Permissions → Install unknown apps

للأندرويد 8+: لازم تفعّل التثبيت من المصدر اللي حامل منه الملف (File Manager أو المتصفح)
