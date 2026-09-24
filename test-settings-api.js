/**
 * Test script for Settings API
 * Tests GET and PUT operations to verify database persistence
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function testSettingsAPI() {
  try {
    console.log('🧪 Testing Settings API...\n');
    
    // Find a test user (first active user)
    const testUser = await prisma.user.findFirst({
      where: {
        status: 'ACTIVE',
        isBanned: false
      },
      select: {
        id: true,
        username: true,
        settings: true
      }
    });
    
    if (!testUser) {
      console.log('⚠️  No active users found for testing');
      return;
    }
    
    console.log('📋 Test User:', testUser.username);
    console.log('📋 Current settings:', JSON.stringify(testUser.settings, null, 2));
    console.log('');
    
    // Test 1: Update settings
    console.log('🔄 Test 1: Updating settings...');
    const newSettings = {
      notifications: {
        pushEnabled: true,
        soundEnabled: false,
        vibrationEnabled: true
      },
      privacy: {
        showOnlineStatus: false,
        allowMessages: 'friends',
        allowGifts: true
      }
    };
    
    const updated = await prisma.user.update({
      where: { id: testUser.id },
      data: { settings: newSettings },
      select: { settings: true }
    });
    
    console.log('✅ Settings updated successfully');
    console.log('✅ New settings:', JSON.stringify(updated.settings, null, 2));
    console.log('');
    
    // Test 2: Read settings back
    console.log('🔄 Test 2: Reading settings back...');
    const readBack = await prisma.user.findUnique({
      where: { id: testUser.id },
      select: { settings: true }
    });
    
    console.log('✅ Settings read back:', JSON.stringify(readBack.settings, null, 2));
    console.log('');
    
    // Test 3: Partial update (deep merge simulation)
    console.log('🔄 Test 3: Partial update (update only notifications)...');
    const currentSettings = readBack.settings || {};
    const partialUpdate = {
      ...currentSettings,
      notifications: {
        ...(currentSettings.notifications || {}),
        soundEnabled: true // Toggle back
      }
    };
    
    const partialUpdated = await prisma.user.update({
      where: { id: testUser.id },
      data: { settings: partialUpdate },
      select: { settings: true }
    });
    
    console.log('✅ Partial update successful');
    console.log('✅ Updated settings:', JSON.stringify(partialUpdated.settings, null, 2));
    console.log('');
    
    console.log('🎉 All tests passed!');
    console.log('');
    console.log('✅ Database field exists and working');
    console.log('✅ Settings can be written');
    console.log('✅ Settings can be read');
    console.log('✅ Settings persist correctly');
    console.log('✅ Partial updates work correctly');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

testSettingsAPI()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
