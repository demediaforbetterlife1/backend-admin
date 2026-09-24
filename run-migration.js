const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

const prisma = new PrismaClient();

async function runMigration() {
  try {
    console.log('📦 Reading migration SQL...');
    const migrationPath = path.join(__dirname, 'prisma', 'migrations', '20260831000001_add_agency_system', 'migration.sql');
    const sqlContent = fs.readFileSync(migrationPath, 'utf-8');
    
    // Split by semicolons, filter out comments and empty lines
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'))
      .filter(s => !s.match(/^\/\*/) && !s.match(/^\*\//));
    
    console.log(`🚀 Executing ${statements.length} migration statements...`);
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.length === 0) continue;
      
      console.log(`  [${i + 1}/${statements.length}] Executing statement...`);
      try {
        await prisma.$executeRawUnsafe(statement + ';');
        console.log(`  ✓ Success`);
      } catch (err) {
        // Some statements might already exist (like enum values), that's okay
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          console.log(`  ⚠ Already exists (skipped)`);
        } else {
          console.error(`  ✗ Failed:`, err.message);
          throw err;
        }
      }
    }
    
    console.log('\n✅ Migration completed successfully!');
    console.log('📊 Verifying tables...');
    
    // Verify tables exist
    const agenciesCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM agencies`;
    const membershipsCount = await prisma.$queryRaw`SELECT COUNT(*) as count FROM agency_memberships`;
    
    console.log(`✓ agencies table: ${agenciesCount[0].count} rows`);
    console.log(`✓ agency_memberships table: ${membershipsCount[0].count} rows`);
    
    // Check migrated data
    const migratedAgencies = await prisma.$queryRaw`
      SELECT a.id, a.name, u.username 
      FROM agencies a 
      JOIN users u ON a."ownerId" = u.id 
      LIMIT 5
    `;
    
    if (migratedAgencies.length > 0) {
      console.log('\n📋 Sample migrated agencies:');
      migratedAgencies.forEach(a => {
        console.log(`  - ${a.name} (owner: ${a.username})`);
      });
    } else {
      console.log('\n⚠ No existing agencies found to migrate');
    }
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMigration();
