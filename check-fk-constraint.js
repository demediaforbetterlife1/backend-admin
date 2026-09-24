const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkConstraint() {
  try {
    // Query to check if FK constraint exists
    const result = await prisma.$queryRaw`
      SELECT constraint_name, table_name, constraint_type
      FROM information_schema.table_constraints
      WHERE table_name = 'agency_requests' 
      AND constraint_name = 'agency_requests_reviewedBy_fkey'
    `;
    
    console.log('FK Constraint Check Result:');
    console.log(JSON.stringify(result, null, 2));
    
    if (result.length > 0) {
      console.log('\n⚠️  FK constraint EXISTS - need to drop it');
      
      // Drop the constraint
      console.log('\nAttempting to drop FK constraint...');
      await prisma.$executeRaw`
        ALTER TABLE "agency_requests" DROP CONSTRAINT IF EXISTS "agency_requests_reviewedBy_fkey"
      `;
      console.log('✅ FK constraint dropped successfully');
      
      // Verify it's gone
      const verify = await prisma.$queryRaw`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'agency_requests' 
        AND constraint_name = 'agency_requests_reviewedBy_fkey'
      `;
      
      if (verify.length === 0) {
        console.log('✅ Verification: FK constraint successfully removed');
      } else {
        console.log('⚠️  WARNING: FK constraint still exists after drop attempt');
      }
    } else {
      console.log('\n✅ FK constraint does NOT exist - schema is correct');
    }
    
    // Verify reviewedBy column exists and is nullable
    const columnInfo = await prisma.$queryRaw`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'agency_requests'
      AND column_name = 'reviewedBy'
    `;
    
    console.log('\nreviewedBy column info:');
    console.log(JSON.stringify(columnInfo, null, 2));
    
  } catch (err) {
    console.error('Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

checkConstraint();
