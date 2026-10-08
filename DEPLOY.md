# النشر على استضافة حقيقية

الطريقة الموصى بها: **Render** (خدمة ويب + PostgreSQL مُدار + شهادة HTTPS تلقائية). الملفات جاهزة: `Dockerfile` و`render.yaml`.
(نفس `Dockerfile` يعمل على Railway وFly.io وأي VPS.)

## 1) ارفعي المشروع إلى GitHub
مستودع **خاص** (Private). ملفات `.env` و`node_modules` مستثناة تلقائياً عبر `.gitignore`.

## 2) أنشئي الخدمة على Render
1. حساب على render.com ← **New → Blueprint** ← اختاري المستودع.
2. يقرأ `render.yaml` وينشئ: الخدمة + قاعدة PostgreSQL + قرص 5GB للصور.
3. املئي المتغيرات المطلوبة:
   - `PUBLIC_URL` = عنوان الموقع النهائي بـ https (مثال `https://www.fatimaalfahad.com`).
   - `SMTP_*` و`MAIL_FROM` و`ORDER_NOTIFY_EMAIL` = إعدادات البريد (Brevo / Resend / Gmail App Password...) وإيميل المتجر الذي تصله إشعارات الطلبات.
4. اضغطي Apply. أول تشغيل ينشئ الجداول تلقائياً.

## 3) تجهيز البيانات (مرة واحدة)
من تبويب **Shell** في خدمة Render:
```bash
npm run seed                                   # تحميل المنتجات الحالية (اختياري)
ADMIN_EMAIL=you@example.com npm run create-admin   # يطبع كلمة مرور المدير مرة واحدة — احفظيها
```
ثم ادخلي إلى `https://دومينك/admin` وغيّري كلمة المرور من Settings.

## 4) الدومين
Settings → Custom Domains → أضيفي الدومين واتبعي سجلات DNS. بعد التفعيل تأكدي أن `PUBLIC_URL` يطابقه.

## 5) قائمة فحص قبل الإطلاق
- [ ] `PUBLIC_URL` بـ https ويطابق الدومين (الكوكيز الآمنة تتطلب HTTPS).
- [ ] غيّرتِ كلمة مرور المدير وحذفتِ حساب التجربة إن وُجد.
- [ ] اختبرتِ طلباً حقيقياً ووصل إيميل التأكيد وإشعار المتجر.
- [ ] عبّأتِ الحقول الفارغة في الشروط والخصوصية (إيميل خدمة العملاء، الموقع، إنستغرام) وحدّثتِ نص الدفع ليذكر الواتساب.
- [ ] نسخ احتياطي: فعّلي Backups لقاعدة Render (خطة مدفوعة) — الصور على القرص `/data`.
- [ ] تحديث أسعار الصرف من Settings.

## ملاحظات
- لا تنشري مجلد `server/uploads` على Git؛ الصور تُدار من اللوحة وتُحفظ على القرص.
- خادم واحد كافٍ لهذا الحجم. عند التوسع لعدة خوادم يلزم Redis لتحديد المعدّل ومخزن ملفات مشترك (S3).
- VPS بديل: `docker build -t fatima .` ثم `docker run -p 3000:3000 -v fatima-data:/data --env-file server/.env fatima` خلف Nginx/Caddy مع HTTPS و`TRUST_PROXY=1`.
