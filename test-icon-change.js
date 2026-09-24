const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testIconChange() {
  console.log('Testing icon change simulation...\n');
  
  // Get current nav_home icon
  const currentIcon = await prisma.appIcon.findUnique({
    where: { key: 'nav_home' },
    select: { url: true, version: true }
  });
  
  console.log('Current nav_home icon:');
  console.log(`  URL: ${currentIcon.url}`);
  console.log(`  Version: ${currentIcon.version}`);
  
  // Simulate changing the icon
  const newUrl = 'https://cdn.jsdelivr.net/npm/@mdi/svg@7.2.96/svg/home-outline.svg';
  
  console.log('\nChanging icon to:', newUrl);
  
  await prisma.appIcon.update({
    where: { key: 'nav_home' },
    data: {
      url: newUrl,
      version: currentIcon.version + 1,
      updatedAt: new Date()
    }
  });
  
  // Verify the change
  const updatedIcon = await prisma.appIcon.findUnique({
    where: { key: 'nav_home' },
    select: { url: true, version: true }
  });
  
  console.log('\nUpdated nav_home icon:');
  console.log(`  URL: ${updatedIcon.url}`);
  console.log(`  Version: ${updatedIcon.version}`);
  
  // Test API response
  const response = await fetch('http://localhost:3000/api/icons');
  const data = await response.json();
  
  console.log('\nAPI response for nav_home:');
  console.log(`  URL: ${data.data.nav_home.url}`);
  console.log(`  Version: ${data.data.nav_home.version}`);
  
  // Revert to original
  console.log('\nReverting to original icon...');
  await prisma.appIcon.update({
    where: { key: 'nav_home' },
    data: {
      url: currentIcon.url,
      version: updatedIcon.version + 1,
      updatedAt: new Date()
    }
  });
  
  console.log('✓ Icon change test complete');
  await prisma.$disconnect();
}

testIconChange().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});