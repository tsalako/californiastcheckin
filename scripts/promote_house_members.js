// TODO: Test. This may not work.
const { prisma } = require('../utils/db');

const emails = (process.env.HOUSE_MEMBER_EMAILS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

(async () => {
  for (const email of emails) {
    await prisma.user.updateMany({ where: { email }, data: { role: 'house' } });
    console.log(`Promoted ${email} -> role=house`);
  }
  process.exit(0);
})();
