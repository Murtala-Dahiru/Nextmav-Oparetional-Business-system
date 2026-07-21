
const { PrismaClient } = require('/home/z/my-project/.next/standalone/node_modules/@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:/home/z/my-project/db/custom.db' } } });
(async () => {
  try {
    const result = await prisma.expense.findMany({orderBy:{createdAt:"desc"},include:{owner:{select:{id:true,firstName:true,lastName:true,email:true}}}});
    const total = Array.isArray(result) ? result.length : 1;
    const data = Array.isArray(result) ? result : [result];
    console.log(JSON.stringify({ data, meta: { total, page: 1, pageSize: 20, totalPages: 1 } }));
  } catch(e) {
    console.error(JSON.stringify({ error: e.message }));
  }
  await prisma.$disconnect();
})();
