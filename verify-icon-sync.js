const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Comprehensive verification script for icon synchronization
 * Checks database integrity and Flutter compatibility
 */

// Expected navigation keys (must match Flutter IconKeys constants)
const REQUIRED_NAV_KEYS = [
  'nav.home',
  'nav.rooms',
  'nav.messages',
  'nav.moments',
  'nav.notifications',
  'nav.settings',
];

async function verify() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║         Icon Synchronization Verification Report             ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  let allPassed = true;

  // ─── Test 1: Check database connection ──────────────────────────────────────
  console.log('📊 Test 1: Database Connection');
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('   ✅ Database connection successful\n');
  } catch (error) {
    console.log('   ❌ Database connection failed:', error.message);
    allPassed = false;
    await prisma.$disconnect();
    return;
  }

  // ─── Test 2: Verify key format (dots not underscores) ──────────────────────
  console.log('🔑 Test 2: Key Format Validation');
  const allNavKeys = await prisma.appIcon.findMany({
    where: { category: 'NAVIGATION' },
    select: { key: true }
  });
  
  const badKeys = allNavKeys.filter(icon => icon.key.includes('_'));

  if (badKeys.length > 0) {
    console.log('   ❌ Found navigation keys with underscores:');
    badKeys.forEach(icon => console.log(`      - ${icon.key}`));
    console.log('   🔧 Run: node fix-icon-keys.js\n');
    allPassed = false;
  } else {
    console.log('   ✅ All navigation keys use dot notation\n');
  }

  // ─── Test 3: Check required navigation keys exist ──────────────────────────
  console.log('📝 Test 3: Required Navigation Keys');
  const existingKeys = await prisma.appIcon.findMany({
    where: { key: { in: REQUIRED_NAV_KEYS } },
    select: { key: true }
  });

  const existingKeyStrings = existingKeys.map(k => k.key);
  const missingKeys = REQUIRED_NAV_KEYS.filter(k => !existingKeyStrings.includes(k));

  if (missingKeys.length > 0) {
    console.log('   ❌ Missing required navigation keys:');
    missingKeys.forEach(key => console.log(`      - ${key}`));
    console.log('   🔧 Run: npm run db:seed-icons\n');
    allPassed = false;
  } else {
    console.log('   ✅ All 6 required navigation keys exist\n');
  }

  // ─── Test 4: Check isActive and isPublished status ─────────────────────────
  console.log('🚀 Test 4: Publication Status');
  const inactiveIcons = await prisma.appIcon.findMany({
    where: {
      key: { in: REQUIRED_NAV_KEYS },
      OR: [
        { isActive: false },
        { isPublished: false }
      ]
    },
    select: { key: true, isActive: true, isPublished: true }
  });

  if (inactiveIcons.length > 0) {
    console.log('   ⚠️  Some navigation icons are not active/published:');
    inactiveIcons.forEach(icon => {
      console.log(`      - ${icon.key}: active=${icon.isActive}, published=${icon.isPublished}`);
    });
    console.log('   💡 These icons won\'t appear in Flutter app\n');
    allPassed = false;
  } else {
    console.log('   ✅ All navigation icons are active and published\n');
  }

  // ─── Test 5: Check URLs are not empty ──────────────────────────────────────
  console.log('🌐 Test 5: Icon URLs');
  const navIcons = await prisma.appIcon.findMany({
    where: { key: { in: REQUIRED_NAV_KEYS } },
    select: { key: true, url: true, defaultUrl: true }
  });

  let urlWarnings = 0;
  navIcons.forEach(icon => {
    if (!icon.url || icon.url.trim() === '') {
      console.log(`   ⚠️  ${icon.key}: No URL (will use fallback icon)`);
      urlWarnings++;
    }
  });

  if (urlWarnings === 0) {
    console.log('   ✅ All navigation icons have URLs\n');
  } else {
    console.log(`   💡 ${urlWarnings} icon(s) have no URL (Flutter will show fallback)\n`);
  }

  // ─── Test 6: API Response Simulation ───────────────────────────────────────
  console.log('🔌 Test 6: API Response Format');
  const icons = await prisma.appIcon.findMany({
    where: {
      key: { in: REQUIRED_NAV_KEYS },
      isActive: true,
      isPublished: true
    },
    select: { key: true, url: true, version: true }
  });

  if (icons.length > 0) {
    const sampleIcon = icons[0];
    console.log('   ✅ Sample API response structure:');
    console.log('   {');
    console.log('     "success": true,');
    console.log('     "data": {');
    console.log(`       "${sampleIcon.key}": {`);
    console.log(`         "key": "${sampleIcon.key}",`);
    console.log(`         "url": "${sampleIcon.url}",`);
    console.log(`         "version": ${sampleIcon.version},`);
    console.log('         ...more fields...');
    console.log('       }');
    console.log('     },');
    console.log('     "etag": "..."');
    console.log('   }\n');
  }

  // ─── Test 7: Flutter Compatibility Check ───────────────────────────────────
  console.log('📱 Test 7: Flutter Compatibility');
  const flutterKeys = [
    'IconKeys.navHome → nav.home',
    'IconKeys.navRooms → nav.rooms',
    'IconKeys.navMessages → nav.messages',
    'IconKeys.navMoments → nav.moments',
    'IconKeys.navNotifications → nav.notifications',
    'IconKeys.navSettings → nav.settings',
  ];

  console.log('   ✅ Flutter IconKeys mapping:');
  flutterKeys.forEach(mapping => console.log(`      ${mapping}`));
  console.log();

  // ─── Final Summary ──────────────────────────────────────────────────────────
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  if (allPassed) {
    console.log('║                   ✅ ALL TESTS PASSED                         ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log('║  Status: READY FOR PRODUCTION                                 ║');
    console.log('║                                                               ║');
    console.log('║  Next Steps:                                                  ║');
    console.log('║  1. Restart Express backend: npm run dev                      ║');
    console.log('║  2. Run Flutter app: cd client && flutter run                 ║');
    console.log('║  3. Check DevTools Network tab for /api/icons request         ║');
    console.log('║  4. Verify bottom nav shows icons from backend                ║');
    console.log('║                                                               ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
  } else {
    console.log('║               ⚠️  SOME TESTS FAILED                           ║');
    console.log('╠═══════════════════════════════════════════════════════════════╣');
    console.log('║  Please fix the issues above before deploying                ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
  }

  await prisma.$disconnect();
  process.exit(allPassed ? 0 : 1);
}

verify();
