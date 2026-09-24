/**
 * Script to apply the settings field migration
 * This adds the missing 'settings' JSON field to the User table
 */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function applyMigration() {
  try {
    console.log('🔄 Applying settings field migration...');
    
    // Execute the ALTER TABLE command
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "settings" JSONB
    `);
    
    console.log('✅ Migration applied successfully!');
    console.log('✅ User table now has "settings" JSONB column');
    
    // Verify the column exists
    const result = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'User' AND column_name = 'settings'
    `;
    
    if (result.length > 0) {
      console.log('✅ Verified: settings column exists');
      console.log('   Type:', result[0].data_type);
      console.log('   Nullable:', result[0].is_nullable);
    } else {
      console.log('⚠️  Warning: Could not verify column (might already exist)');
    }
    
  } catch (error) {
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Settings column already exists, skipping migration');
    } else {
      console.error('❌ Migration failed:', error.message);
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Run the migration
applyMigration()
  .then(() => {
    console.log('\n🎉 Migration process completed!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 Migration process failed:', error);
    process.exit(1);
  });
