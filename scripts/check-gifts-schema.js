const prisma = require('../src/prismaClient');

async function main() {
  const columns = await prisma.$queryRaw`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'gifts'
    ORDER BY ordinal_position
  `;
  
  console.log('Gifts table columns:');
  console.log(JSON.stringify(columns, null, 2));
}

main()
  .catch(e => console.error('Error:', e))
  .finally(() => prisma.$disconnect());
