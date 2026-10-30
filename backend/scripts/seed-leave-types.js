const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function run() {
  const types = [
    { name: 'Earned Leave',  daysAllowed: 12, description: 'Earned leave - 1 per month after 20 working days. Max 12/year. Up to 7 days carry forward.' },
    { name: 'Casual Leave',  daysAllowed: 5,  description: 'Casual leave for personal reasons. Max 5/year.' },
    { name: 'Sick Leave',    daysAllowed: 7,  description: 'Sick leave. Doctor prescription required for >2 continuous days.' },
    { name: 'Event Leave', daysAllowed: 0, isUnlimited: true, description: 'Leave for attending events. Subject to approval; no fixed annual limit.' },
    { name: 'Client Visit Leave', daysAllowed: 0, isUnlimited: true, description: 'Leave for client visits. Subject to approval; no fixed annual limit.' },
  ];

  for (const t of types) {
    const existing = await p.leaveType.findUnique({ where: { name: t.name } });
    if (!existing) {
      const created = await p.leaveType.create({ data: t });
      console.log('Created:', created.name, 'id=', created.id);
    } else {
      await p.leaveType.update({ where: { id: existing.id }, data: { daysAllowed: t.daysAllowed, description: t.description, isUnlimited: t.isUnlimited ?? false } });
      console.log('Updated:', existing.name, 'id=', existing.id);
    }
  }

  const all = await p.leaveType.findMany();
  console.log('\nAll leave types:');
  all.forEach(t => console.log(' -', t.name, t.isUnlimited ? 'No annual limit' : t.daysAllowed + 'd', 'id=' + t.id));
  await p.$disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
