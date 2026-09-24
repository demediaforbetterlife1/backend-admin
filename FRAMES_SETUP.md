# Profile Frames & Entrances Setup Guide

## نظام الإطارات والمداخل المميزة

تم إضافة نظام كامل للإطارات والمداخل المميزة للبروفايل يشمل:

### ✨ الميزات المضافة

1. **إطارات البروفايل (Profile Frames)**
   - إطار ذهبي خاص للمضيف (Host)
   - إطارات VIP حسب المستوى
   - إطارات SVIP فاخرة
   - إطارات خاصة للشراء بالعملات

2. **المداخل المميزة (Entrances)**
   - تأثيرات دخول مميزة
   - أصوات خاصة عند الدخول
   - جزيئات متحركة (sparkles, fireworks, etc.)

3. **الشارات والتيجان (Badges & Crowns)**
   - تاج ذهبي للمضيف في المقعد الأول
   - شارات VIP/SVIP/AGENT
   - إطار ذهبي تلقائي للمضيف

### 📝 الخطوات المطلوبة

#### 1. تحديث قاعدة البيانات

```bash
# من مجلد backend
cd voicechat_app/backend

# تشغيل migration
npx prisma migrate dev --name add_frames_sortorder_fields

# أو تشغيل مباشرة
npx prisma db push
```

#### 2. إضافة البيانات الافتراضية

```bash
# تشغيل seed script
node scripts/seed-default-frames.js
```

#### 3. إعادة تشغيل السيرفر

```bash
# إيقاف السيرفر الحالي (Ctrl+C)
# ثم تشغيله مرة أخرى
npm start
```

### 🎯 API Endpoints الجديدة

#### Frames Endpoints

```
GET    /api/frames              # جلب جميع الإطارات المتاحة
GET    /api/frames/my           # جلب إطارات المستخدم
POST   /api/frames/:id/purchase # شراء إطار
POST   /api/frames/:id/activate # تفعيل إطار
POST   /api/frames/deactivate   # إلغاء تفعيل الإطار
```

#### Entrances Endpoints

```
GET    /api/entrances              # جلب جميع المداخل المتاحة
GET    /api/entrances/my           # جلب مداخل المستخدم
POST   /api/entrances/:id/purchase # شراء مدخل
POST   /api/entrances/:id/activate # تفعيل مدخل
POST   /api/entrances/deactivate   # إلغاء تفعيل المدخل
```

### 📦 البيانات المرسلة في Socket Events

عند انضمام مستخدم للروم، يتم إرسال:

```javascript
{
  "userId": "user123",
  "username": "محمد",
  "avatar": "https://...",
  "seatIndex": 0,
  "role": "speaker",
  "vipTier": "VIP_1",
  
  // بيانات الإطار
  "frameUrl": "https://i.imgur.com/golden-host-frame.png",
  "frameName": "Golden Host Frame",
  
  // بيانات الشارة
  "badge": "HOST",  // يمكن أن تكون: HOST, VIP, SVIP, AGENT, null
  "isHost": true,
  "showCrown": true,
  "showGoldenFrame": true,
  
  // بيانات المدخل (إن وجد)
  "hasEntrance": true,
  "entranceName": "VIP Sparkles",
  "entranceAnimationUrl": "https://...",
  "entranceSoundUrl": "https://...",
  "entranceParticleType": "sparkle"
}
```

### 🎨 عرض الإطارات في Flutter

في تطبيق Flutter، يجب:

1. **عرض الإطار حول الأفاتار**
   ```dart
   Stack(
     children: [
       // الأفاتار
       CircleAvatar(
         backgroundImage: NetworkImage(user.avatar),
       ),
       // الإطار
       if (user.frameUrl != null)
         Image.network(user.frameUrl),
       // التاج (للمضيف فقط)
       if (user.showCrown)
         Positioned(
           top: -10,
           child: Icon(Icons.crown, color: Colors.amber),
         ),
     ],
   )
   ```

2. **عرض الشارة**
   ```dart
   if (user.badge != null)
     Container(
       padding: EdgeInsets.all(4),
       decoration: BoxDecoration(
         color: getBadgeColor(user.badge),
         borderRadius: BorderRadius.circular(4),
       ),
       child: Text(user.badge),
     )
   ```

3. **تشغيل تأثير الدخول**
   ```dart
   if (user.hasEntrance) {
     // تشغيل الأنيميشن من entranceAnimationUrl
     // تشغيل الصوت من entranceSoundUrl
     // عرض الجزيئات حسب entranceParticleType
   }
   ```

### ⚠️ ملاحظات مهمة

1. **روابط الأصول (Assets)**
   - الروابط في seed script هي placeholders
   - يجب استبدالها بروابط حقيقية للصور والأنيميشن
   - يُفضل رفع الأصول على CDN أو Firebase Storage

2. **المضيف والمقعد الأول**
   - المضيف يظهر دائماً في `seatIndex: 0`
   - يحصل تلقائياً على:
     - `badge: "HOST"`
     - `showCrown: true`
     - `showGoldenFrame: true`
   - حتى لو لم يشتري إطار خاص

3. **الإطار الذهبي للمضيف**
   - مضاف تلقائياً من Backend
   - لا يحتاج Flutter لمعالجة خاصة
   - فقط عرض `frameUrl` إن وجد

4. **الترتيب في الروم**
   ```
   المقعد 0: المضيف (تاج + إطار ذهبي)
   المقاعد 1-19: المشاركين (حسب الوصول)
   ```

### 🔧 التخصيص والتطوير

#### إضافة إطارات جديدة

```javascript
await prisma.frame.create({
  data: {
    id: 'frame-custom-1',
    name: 'Custom Frame',
    nameAr: 'إطار مخصص',
    imageUrl: 'https://...',
    previewUrl: 'https://...',
    tier: 'NONE',
    coinPrice: 5000,
    isActive: true,
    sortOrder: 100,
  }
});
```

#### إضافة مداخل جديدة

```javascript
await prisma.entrance.create({
  data: {
    id: 'entrance-custom-1',
    name: 'Custom Entrance',
    nameAr: 'دخول مخصص',
    animationUrl: 'https://...',
    previewUrl: 'https://...',
    soundUrl: 'https://...',
    particleType: 'custom',
    tier: 'VIP_1',
    coinPrice: 0,
    isActive: true,
    sortOrder: 100,
  }
});
```

### 🐛 استكشاف الأخطاء

**الإطار لا يظهر؟**
- تأكد من تفعيله: `POST /api/frames/:id/activate`
- تحقق من `isActive: true` في المقعد

**التاج لا يظهر للمضيف؟**
- تأكد من `seatIndex === 0`
- تحقق من `isOwner: true` في البيانات

**الصور لا تُحمّل؟**
- استبدل روابط placeholder بروابط حقيقية
- تأكد من CORS على CDN

### 📚 الملفات المضافة/المعدلة

```
✅ backend/src/services/frames.service.js        (جديد)
✅ backend/src/routes/frames.routes.js           (جديد)
✅ backend/scripts/seed-default-frames.js        (جديد)
✅ backend/src/utils/room.serializer.js          (معدل)
✅ backend/src/socket/room.socket.js             (معدل)
✅ backend/src/routes/room.routes.js             (معدل)
✅ backend/prisma/schema.prisma                  (معدل)
✅ backend/index.js                              (معدل)
```

### ✅ الاختبار

```bash
# 1. تسجيل دخول مستخدم
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+201234567890","password":"123456"}'

# 2. جلب الإطارات المتاحة
curl http://localhost:3000/api/frames \
  -H "Authorization: Bearer YOUR_TOKEN"

# 3. شراء إطار
curl -X POST http://localhost:3000/api/frames/frame-golden-host/purchase \
  -H "Authorization: Bearer YOUR_TOKEN"

# 4. تفعيل الإطار
curl -X POST http://localhost:3000/api/frames/frame-golden-host/activate \
  -H "Authorization: Bearer YOUR_TOKEN"

# 5. إنشاء روم واختبار ظهور الإطار
curl -X POST http://localhost:3000/api/rooms \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Room"}'
```

---

## 🎉 النظام جاهز!

النظام الآن يدعم:
- ✅ إطارات البروفايل القابلة للشراء
- ✅ مداخل مميزة بتأثيرات وأصوات
- ✅ تاج وإطار ذهبي تلقائي للمضيف
- ✅ شارات VIP/SVIP/AGENT
- ✅ تكامل كامل مع Socket.IO
- ✅ API endpoints جاهزة

فقط استبدل روابط الأصول بروابط حقيقية وابدأ الاستخدام! 🚀
