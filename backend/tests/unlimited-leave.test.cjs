// Run after `npm run build`: node --test tests/unlimited-leave.test.cjs
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { prisma } = require('../dist/src/lib/prisma');
const router = require('../dist/src/routes/leaves').default;

// Exercise the actual route handlers with an isolated database double.
const originals = [];
function stub(model, method, implementation) {
  originals.push([model, method, prisma[model][method]]);
  prisma[model][method] = implementation;
}
function restore() {
  for (const [model, method, original] of originals.splice(0).reverse()) {
    prisma[model][method] = original;
  }
}
after(async () => { restore(); await prisma.$disconnect(); });

async function invoke(method, path, body = {}) {
  const route = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route;
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(data) { this.data = data; return this; },
  };
  await route.stack.at(-1).handle({ body, user: { id: 'user-1', role: 'HR' }, params: { id: 'request-1' } }, res);
  return res;
}

test('leave types expose the no-annual-limit policy', async () => {
  stub('leaveType', 'findMany', async () => [
    { id: 'event', name: 'Event Leave', daysAllowed: 0, isUnlimited: true, isActive: true },
    { id: 'client', name: 'Client Visit Leave', daysAllowed: 0, isUnlimited: true, isActive: true },
  ]);
  try {
    const res = await invoke('get', '/types');
    assert.deepEqual(res.data.map((type) => [type._id, type.isUnlimited]), [['event', true], ['client', true]]);
  } finally { restore(); }
});

for (const name of ['Event Leave', 'Client Visit Leave', 'Casual Leave']) {
  test(`${name}: submitting with zero balance follows its annual-limit policy`, async () => {
    const isUnlimited = name !== 'Casual Leave';
    const type = { id: 'type-1', name, daysAllowed: 0, isUnlimited, isActive: true };
    let created = false;
    stub('employee', 'findFirst', async () => ({ id: 'employee-1' }));
    stub('leaveType', 'findUnique', async () => type);
    stub('leaveType', 'findMany', async () => [type]);
    stub('leaveBalance', 'findUnique', async () => ({ remaining: 0 }));
    stub('leaveRequest', 'create', async ({ data }) => {
      created = true;
      return {
        ...data, id: 'request-1', status: 'Pending', createdAt: new Date(), leaveType: type,
        employee: { id: 'employee-1', employeeId: 'EMP001', user: { id: 'user-1', name: 'Test', email: 'test@example.com' } },
      };
    });
    try {
      const res = await invoke('post', '/', {
        leaveTypeId: type.id, fromDate: '2026-09-30', toDate: '2026-10-02', reason: 'Attending a work event',
      });
      assert.equal(res.statusCode, isUnlimited ? 201 : 400);
      assert.equal(created, isUnlimited);
      if (isUnlimited) assert.equal(res.data.request.status, 'Pending');
      else assert.match(res.data.message, /Insufficient/);
    } finally { restore(); }
  });
}

for (const isUnlimited of [true, false]) {
  test(`approval tracks usage ${isUnlimited ? 'without' : 'with'} an annual balance deduction`, async () => {
    let balanceUpdate;
    let attendanceUpdates = 0;
    stub('leaveRequest', 'findUnique', async () => ({
      id: 'request-1', status: 'Pending', employeeId: 'employee-1', leaveTypeId: 'type-1',
      totalDays: 1, fromDate: new Date('2026-09-30'), toDate: new Date('2026-09-30'),
      leaveType: { name: isUnlimited ? 'Event Leave' : 'Casual Leave', isUnlimited },
    }));
    stub('leaveRequest', 'update', async () => ({}));
    stub('leaveBalance', 'updateMany', async ({ data }) => { balanceUpdate = data; return { count: 1 }; });
    stub('attendanceLog', 'upsert', async () => { attendanceUpdates++; return {}; });
    try {
      const res = await invoke('put', '/:id/review', { status: 'Approved' });
      assert.equal(res.statusCode, 200);
      assert.deepEqual(balanceUpdate.used, { increment: 1 });
      assert.deepEqual(balanceUpdate.remaining, isUnlimited ? undefined : { decrement: 1 });
      assert.equal(attendanceUpdates, 1);
    } finally { restore(); }
  });
}
