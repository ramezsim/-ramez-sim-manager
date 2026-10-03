# الأمان والنشر — Ramez SIM Manager

## نموذج الحماية
- كل موظف له حساب مستقل وبيانات مستقلة في صف واحد من `user_app_state` (`owner_id = auth.uid()`).
- الحماية على السيرفر (Supabase RLS)، وليست في JavaScript. الصلاحيات في الواجهة لإخفاء الأزرار فقط.
- `companies` قائمة مشتركة: يقرؤها كل من سجّل الدخول، ويعدّلها المدير العام فقط.
- الأدوار تتغير فقط عبر `admin_set_user_role()` التي تتحقق على السيرفر أن المستدعي مدير عام.
- الحفظ عبر `save_app_state(p_state, p_base_revision)`: الجهاز القديم لا يستطيع استبدال بيانات أحدث (تعارض بدل الكتابة).
- لا توجد بيانات عملاء ولا أسرار داخل ملفات الواجهة. المفتاح الموجود في `js/config.js` هو المفتاح العام (publishable) المصمم ليكون علنيًا.

## ترتيب النشر (مهم)
1. **Supabase → SQL Editor**: شغّل `supabase/migrations/20261003_01_security_hardening.sql` (آمن مع النسخة الحالية ويأخذ نسخة احتياطية داخل schema `private_backup`).
2. شغّل `supabase/tests/rls_tests.sql` — يجب أن تنتهي الرسالة بـ `RESULT: N passed, 0 failed` (كل ما ينشئه يُلغى تلقائيًا).
3. انشر الواجهة الجديدة (push إلى GitHub Pages أو Cloudflare Pages).
4. اطلب من كل الموظفين إغلاق الصفحة القديمة أو تحديثها على كل الأجهزة.
5. شغّل `supabase/migrations/20261003_02_lock_direct_state_writes.sql` ثم أعد تشغيل `rls_tests.sql`.

## إعدادات يدوية في لوحة Supabase
- Authentication → Sign In / Providers → **Allow new users to sign up = OFF** (إغلاق التسجيل العام).
- Authentication → URL Configuration → **Site URL** = رابط الموقع، وأضفه في **Redirect URLs** (لروابط استعادة كلمة المرور والدعوات).
- Authentication → Passwords: الحد الأدنى 8 أحرف، وفعّل **Leaked password protection** إن كانت متاحة في خطتك.
- إضافة موظف: Authentication → Users → **Invite user**، ثم حدّد صلاحيته من داخل التطبيق.

## الاستضافة
- GitHub Pages: الـ CSP يعمل عبر `<meta>`، لكن لا يمكن ضبط `frame-ancestors` و`X-Frame-Options` و`HSTS`.
- Cloudflare Pages (مُستحسن): ملف `_headers` يضيف كل الـ headers الحقيقية. لا يحتاج build: مجلد الإخراج = جذر المشروع.

## الاختبار محليًا
```
node tools/dev-server.mjs 8787
```
خادم محلي يحاكي Supabase (حسابات وهمية في `tools/mock-fixtures.json`) لاختبار الواجهة بدون لمس البيانات الحقيقية.
اختبارات RLS المحلية: انظر `supabase/tests/local_stub_insecure_baseline.sql` + `rls_tests.sql`.

## المكتبات الخارجية
مستضافة داخل `vendor/` مع `integrity` (SRI). لا يتم تحميل أي سكربت من CDN.
