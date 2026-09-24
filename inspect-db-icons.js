const { PrismaClient } = require('@prisma/client');
const http = require('http');
const https = require('https');

const prisma = new PrismaClient();

console.log('\n╔══════════════════════════════════════════════════════════════╗');
console.log('║  ROOT CAUSE INVESTIGATION: Bottom Navigation Icons          ║');
console.log('╚══════════════════════════════════════════════════════════════╝\n');

const BOTTOM_NAV_KEYS = ['nav.home', 'nav.rooms', 'nav.moments', 'nav.profile'];

async function testUrl(url) {
  return new Promise((resolve) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          contentType: res.headers['content-type'],
          contentLength: res.headers['content-length'],
          body: data.substring(0, 200)
        });
      });
    });
    req.on('error', (err) => resolve({ status: 'ERROR', error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 'TIMEOUT' }); });
  });
}

(async () => {
  try {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('STEP 1: DATABASE INSPECTION');
    console.log('══════════════════════════════════════════════════════════════\n');

    const icons = await prisma.appIcon.findMany({
      where: { key: { in: BOTTOM_NAV_KEYS } },
      orderBy: { key: 'asc' }
    });

    console.log(`Found ${icons.length} navigation icons in database\n`);

    for (const icon of icons) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`📌 ${icon.key}`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`ID:            ${icon.id}`);
      console.log(`Display Name:  ${icon.displayName}`);
      console.log(`Category:      ${icon.category}`);
      console.log(`URL:           ${icon.url}`);
      console.log(`Default URL:   ${icon.defaultUrl || 'N/A'}`);
      console.log(`MIME Type:     ${icon.mimeType || 'N/A'}`);
      console.log(`Version:       ${icon.version}`);
      console.log(`Published:     ${icon.isPublished}`);
      console.log(`Active:        ${icon.isActive}`);
      console.log(`Pending:       ${icon.isPending}`);
      console.log(`Storage Path:  ${icon.storagePath || 'N/A'}`);
      console.log(`Updated:       ${icon.updatedAt}`);
      console.log('');
    }

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('STEP 2: API ENDPOINT TEST (/api/icons)');
    console.log('══════════════════════════════════════════════════════════════\n');

    const apiResponse = await new Promise((resolve, reject) => {
      http.get('http://localhost:3000/api/icons', (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
      }).on('error', reject);
    });

    console.log(`Status: ${apiResponse.status}\n`);

    if (apiResponse.data.data) {
      for (const key of BOTTOM_NAV_KEYS) {
        const iconData = apiResponse.data.data[key];
        if (iconData) {
          console.log(`${key}:`);
          console.log(`  URL from API: ${iconData.url}`);
          console.log(`  Version: ${iconData.version}`);
          console.log('');
        } else {
          console.log(`${key}: ❌ NOT FOUND IN API RESPONSE`);
        }
      }
    }

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log('STEP 3: URL ACCESSIBILITY TEST');
    console.log('══════════════════════════════════════════════════════════════\n');

    for (const icon of icons) {
      console.log(`Testing: ${icon.key}`);
      console.log(`URL: ${icon.url}`);
      
      const result = await testUrl(icon.url);
      
      if (result.status === 200) {
        console.log(`✅ Status: ${result.status}`);
        console.log(`   Content-Type: ${result.contentType}`);
        console.log(`   Size: ${result.contentLength} bytes`);
      } else if (result.status === 'ERROR') {
        console.log(`❌ ERROR: ${result.error}`);
      } else if (result.status === 'TIMEOUT') {
        console.log(`⏱️  TIMEOUT`);
      } else {
        console.log(`❌ Status: ${result.status}`);
        if (result.body) {
          console.log(`   Response: ${result.body}`);
        }
      }
      console.log('');
    }

    console.log('══════════════════════════════════════════════════════════════');
    console.log('STEP 4: URL FORMAT ANALYSIS');
    console.log('══════════════════════════════════════════════════════════════\n');

    for (const icon of icons) {
      const url = icon.url;
      console.log(`${icon.key}:`);
      
      try {
        const parsed = new URL(url);
        console.log(`  Protocol: ${parsed.protocol}`);
        console.log(`  Host: ${parsed.host}`);
        console.log(`  Port: ${parsed.port || '(default)'}`);
        console.log(`  Path: ${parsed.pathname}`);
        console.log(`  Valid URL: ✅`);
      } catch (e) {
        console.log(`  Invalid URL: ❌ ${e.message}`);
      }
      console.log('');
    }

    console.log('══════════════════════════════════════════════════════════════');
    console.log('SUMMARY');
    console.log('══════════════════════════════════════════════════════════════\n');

    const issues = [];
    
    // Check for missing icons
    const missingKeys = BOTTOM_NAV_KEYS.filter(k => !icons.find(i => i.key === k));
    if (missingKeys.length > 0) {
      issues.push(`Missing from database: ${missingKeys.join(', ')}`);
    }

    // Check for unpublished icons
    const unpublished = icons.filter(i => !i.isPublished);
    if (unpublished.length > 0) {
      issues.push(`Unpublished: ${unpublished.map(i => i.key).join(', ')}`);
    }

    // Check for inactive icons
    const inactive = icons.filter(i => !i.isActive);
    if (inactive.length > 0) {
      issues.push(`Inactive: ${inactive.map(i => i.key).join(', ')}`);
    }

    if (issues.length === 0) {
      console.log('✅ All database records look correct');
    } else {
      console.log('⚠️  Issues found:');
      issues.forEach(issue => console.log(`   - ${issue}`));
    }

    console.log('\n══════════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    await prisma.$disconnect();
  }
})();
