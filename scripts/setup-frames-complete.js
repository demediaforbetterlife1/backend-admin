#!/usr/bin/env node
/**
 * Complete Frames Setup Script
 * 
 * يقوم بكل شيء دفعة واحدة:
 * 1. إنشاء الإطارات SVG
 * 2. إضافتها لقاعدة البيانات
 * 3. التحقق من النجاح
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  🎨 نظام الإطارات والمداخل - إعداد كامل');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

// ═══════════════════════════════════════════════════════════════════════
// SVG Frames (Inline)
// ═══════════════════════════════════════════════════════════════════════

function svgToDataUrl(svg) {
  const cleaned = svg.trim().replace(/\s+/g, ' ');
  const base64 = Buffer.from(cleaned).toString('base64');
  return `data:image/svg+xml;base64,${base64}`;
}

const frames = {
  goldenHost: svgToDataUrl(`
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="goldGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#FFA500;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#FFD700;stop-opacity:1" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
          <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <circle cx="100" cy="100" r="95" fill="none" stroke="url(#goldGradient)" stroke-width="8" opacity="0.6" filter="url(#glow)"/>
      <circle cx="100" cy="100" r="90" fill="none" stroke="url(#goldGradient)" stroke-width="10"/>
      <circle cx="100" cy="100" r="75" fill="none" stroke="url(#goldGradient)" stroke-width="2" opacity="0.5"/>
      <path d="M100,10 L103,20 L113,20 L105,26 L108,36 L100,30 L92,36 L95,26 L87,20 L97,20 Z" fill="url(#goldGradient)" opacity="0.8"/>
    </svg>
  `),

  vipSilver: svgToDataUrl(`
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="silverGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#C0C0C0;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#E8E8E8;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#C0C0C0;stop-opacity:1" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="90" fill="none" stroke="url(#silverGradient)" stroke-width="8"/>
      <circle cx="100" cy="100" r="75" fill="none" stroke="url(#silverGradient)" stroke-width="3" opacity="0.5"/>
      <text x="100" y="25" font-family="Arial" font-size="16" font-weight="bold" fill="url(#silverGradient)" text-anchor="middle">VIP</text>
    </svg>
  `),

  vipGold: svgToDataUrl(`
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="goldGradient2" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#FFD700;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#FFA500;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#FFD700;stop-opacity:1" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="92" fill="none" stroke="url(#goldGradient2)" stroke-width="6"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="url(#goldGradient2)" stroke-width="4" opacity="0.6"/>
      <text x="100" y="25" font-family="Arial" font-size="18" font-weight="bold" fill="url(#goldGradient2)" text-anchor="middle">VIP</text>
    </svg>
  `),

  svipDiamond: svgToDataUrl(`
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="diamondGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#9C27B0;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#E91E63;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#9C27B0;stop-opacity:1" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="94" fill="none" stroke="url(#diamondGradient)" stroke-width="10"/>
      <circle cx="100" cy="100" r="80" fill="none" stroke="url(#diamondGradient)" stroke-width="6" opacity="0.7"/>
      <path d="M100,30 L110,50 L100,70 L90,50 Z" fill="url(#diamondGradient)" opacity="0.8"/>
      <text x="100" y="190" font-family="Arial" font-size="16" font-weight="bold" fill="url(#diamondGradient)" text-anchor="middle">SVIP</text>
    </svg>
  `),

  specialStars: svgToDataUrl(`
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="starsGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#4CAF50;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#8BC34A;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#4CAF50;stop-opacity:1" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="88" fill="none" stroke="url(#starsGradient)" stroke-width="6"/>
      <path d="M100,20 L103,30 L113,30 L105,36 L108,46 L100,40 L92,46 L95,36 L87,30 L97,30 Z" fill="url(#starsGradient)"/>
    </svg>
  `),

  specialFire: svgToDataUrl(`
    <svg width="200" height="200" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fireGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:#FF5722;stop-opacity:1" />
          <stop offset="50%" style="stop-color:#FF9800;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#FFC107;stop-opacity:1" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r="90" fill="none" stroke="url(#fireGradient)" stroke-width="8"/>
      <path d="M100,30 Q90,50 100,70 Q110,50 100,30" fill="url(#fireGradient)" opacity="0.8"/>
    </svg>
  `),
};

// ═══════════════════════════════════════════════════════════════════════
// Seed Database
// ═══════════════════════════════════════════════════════════════════════

async function setupFrames() {
  console.log('📦 Step 1/3: Creating SVG frames...');
  console.log('   ✓ Golden Host Frame (ذهبي للمضيف)');
  console.log('   ✓ VIP Silver Frame (فضي VIP)');
  console.log('   ✓ VIP Gold Frame (ذهبي VIP)');
  console.log('   ✓ SVIP Diamond Frame (ماسي SVIP)');
  console.log('   ✓ Special Stars Frame (نجوم)');
  console.log('   ✓ Special Fire Frame (نار)');
  console.log('');

  console.log('💾 Step 2/3: Adding frames to database...');

  const framesData = [
    {
      id: 'frame-golden-host',
      name: 'Golden Host Frame',
      nameAr: 'إطار المضيف الذهبي',
      imageUrl: frames.goldenHost,
      previewUrl: frames.goldenHost,
      tier: 'NONE',
      coinPrice: 0,
      isActive: true,
      sortOrder: 1,
    },
    {
      id: 'frame-vip-silver',
      name: 'VIP Silver Frame',
      nameAr: 'إطار VIP فضي',
      imageUrl: frames.vipSilver,
      previewUrl: frames.vipSilver,
      tier: 'VIP',
      coinPrice: 0,
      isActive: true,
      sortOrder: 2,
    },
    {
      id: 'frame-vip-gold',
      name: 'VIP Gold Frame',
      nameAr: 'إطار VIP ذهبي',
      imageUrl: frames.vipGold,
      previewUrl: frames.vipGold,
      tier: 'VIP',
      coinPrice: 0,
      isActive: true,
      sortOrder: 3,
    },
    {
      id: 'frame-svip-diamond',
      name: 'SVIP Diamond Frame',
      nameAr: 'إطار SVIP ماسي',
      imageUrl: frames.svipDiamond,
      previewUrl: frames.svipDiamond,
      tier: 'SVIP_1',
      coinPrice: 0,
      isActive: true,
      sortOrder: 4,
    },
    {
      id: 'frame-special-stars',
      name: 'Special Frame - Stars',
      nameAr: 'إطار خاص - النجوم',
      imageUrl: frames.specialStars,
      previewUrl: frames.specialStars,
      tier: 'NONE',
      coinPrice: 5000,
      isActive: true,
      sortOrder: 5,
    },
    {
      id: 'frame-special-fire',
      name: 'Special Frame - Fire',
      nameAr: 'إطار خاص - النار',
      imageUrl: frames.specialFire,
      previewUrl: frames.specialFire,
      tier: 'NONE',
      coinPrice: 8000,
      isActive: true,
      sortOrder: 6,
    },
  ];

  try {
    for (const frame of framesData) {
      await prisma.frame.upsert({
        where: { id: frame.id },
        update: frame,
        create: frame,
      });
      console.log(`   ✓ ${frame.nameAr}`);
    }
    console.log('');

    console.log('✅ Step 3/3: Verification...');
    const count = await prisma.frame.count({ where: { isActive: true } });
    console.log(`   ✓ Total active frames: ${count}`);
    console.log('');

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  ✅ نظام الإطارات جاهز!');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('🎯 النتيجة:');
    console.log('   ✅ المضيف يظهر بإطار ذهبي وتاج في المقعد الأول');
    console.log('   ✅ أعضاء VIP/SVIP لديهم إطارات مجانية');
    console.log('   ✅ إطارات خاصة قابلة للشراء');
    console.log('');
    console.log('📡 API Endpoints:');
    console.log('   GET  /api/frames         - جلب جميع الإطارات');
    console.log('   GET  /api/frames/my      - إطاراتي');
    console.log('   POST /api/frames/:id/purchase  - شراء إطار');
    console.log('   POST /api/frames/:id/activate  - تفعيل إطار');
    console.log('');
    console.log('🚀 التشغيل:');
    console.log('   npm start');
    console.log('');
    console.log('💡 ملاحظة:');
    console.log('   الإطارات تعمل فوراً كـ SVG data URLs');
    console.log('   لا تحتاج رفع على CDN!');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('  ❌ حدث خطأ');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('');
    console.error('Error:', error.message);
    console.error('');
    throw error;
  }
}

// Run
setupFrames()
  .then(() => {
    prisma.$disconnect();
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    prisma.$disconnect();
    process.exit(1);
  });
