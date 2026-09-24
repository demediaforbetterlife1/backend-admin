/**
 * End-to-end auth verification script.
 * Usage: node scripts/test-auth-e2e.js [baseUrl]
 */
const { PrismaClient } = require('@prisma/client');

const BASE = (process.argv[2] || 'http://localhost:3000') + '/api/auth';
const prisma = new PrismaClient();

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.error(`❌ ${name}${detail ? `: ${detail}` : ''}`);
    failed++;
  }
}

async function post(path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

async function get(path, token) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  const json = await res.json();
  return { status: res.status, json };
}

async function main() {
  const suffix = Math.floor(Math.random() * 1e9);
  const username = `e2e_user_${suffix}`;
  const email = `${username}@test.com`;
  const password = 'SecurePass1';

  // Register
  const reg = await post('/register/user', { username, email, password });
  assert('Register user', reg.status === 201 && reg.json.success, JSON.stringify(reg.json));
  const { accessToken, refreshToken, userId } = reg.json.data;

  // /me
  const me = await get('/me', accessToken);
  assert('/me returns user', me.status === 200 && me.json.data.userId === userId);
  assert('/me has ACTIVE status', me.json.data.status === 'ACTIVE');

  // Refresh
  const ref = await post('/refresh', { refreshToken });
  assert('Token refresh', ref.status === 200 && ref.json.data.accessToken);
  const newRefresh = ref.json.data.refreshToken;

  // Logout
  const out = await post('/logout', { refreshToken: newRefresh });
  assert('Logout', out.status === 200 && out.json.success);

  // Login
  const login = await post('/login', { email, password });
  assert('Login', login.status === 200 && login.json.data.accessToken);

  // Account status
  const status = await get(`/status/${userId}`);
  assert('Account status active', status.json.data.active === true);

  // OTP
  const phone = `+1202555${String(suffix).slice(-4)}`;
  const otpSend = await post('/send-otp', { phone, role: 'USER' });
  assert('Send OTP', otpSend.status === 200 && otpSend.json.success, JSON.stringify(otpSend.json));

  const otpRow = await prisma.otpCode.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
  });
  assert('OTP saved in PostgreSQL', !!otpRow?.code);

  if (otpRow?.code) {
    const otpVerify = await post('/verify-otp', { phone, code: otpRow.code, role: 'USER' });
    assert('Verify OTP login', otpVerify.status === 200 && otpVerify.json.data.accessToken);
  }

  // Agent registration
  const agentName = `e2e_agent_${suffix}`;
  const agentReg = await post('/register/agent', {
    username: agentName,
    email: `${agentName}@test.com`,
    password,
  });
  assert('Agent self-registration', agentReg.status === 201 && agentReg.json.data.role === 'AGENT');

  // Prisma user exists
  const dbUser = await prisma.user.findUnique({ where: { id: userId } });
  assert('User persisted in PostgreSQL', !!dbUser && dbUser.email === email);

  const refreshCount = await prisma.refreshToken.count({ where: { userId } });
  assert('Refresh token stored', refreshCount > 0);

  await prisma.$disconnect();

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
