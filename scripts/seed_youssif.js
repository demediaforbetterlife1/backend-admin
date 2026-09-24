/**
 * One-shot seed script — run with:  node scripts/seed_youssif.js
 *
 * Creates youssif1 as an approved host, simulates 2 h of room time,
 * and sends 5 gifts so targets and earnings show real numbers.
 */

'use strict';

const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db      = require('../src/db');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currentMonthPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function upsertTarget(userId, metric, goal, current) {
  const period = currentMonthPeriod();
  const existing = db.prepare(
    `SELECT id FROM targets WHERE user_id = ? AND metric = ? AND period = ?`
  ).get(userId, metric, period);

  if (existing) {
    db.prepare(`UPDATE targets SET current = ?, goal = ? WHERE id = ?`)
      .run(current, goal, existing.id);
  } else {
    db.prepare(`
      INSERT INTO targets (id, user_id, role, metric, goal, current, cycle, period)
      VALUES (?, ?, 'host', ?, ?, ?, 'monthly', ?)
    `).run(uuidv4(), userId, metric, goal, current, period);
  }
}

// ---------------------------------------------------------------------------
// 1. Create or update youssif1
// ---------------------------------------------------------------------------

const EMAIL    = 'youssifdeveloper999@gmail.com';
const USERNAME = 'youssif1';
const PASSWORD = 'yoyoyo2322';

let youssif = db.prepare(`SELECT * FROM users WHERE email = ?`).get(EMAIL);

if (!youssif) {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const id   = uuidv4();
  db.prepare(`
    INSERT INTO users (id, username, email, password, role, status)
    VALUES (?, ?, ?, ?, 'host', 'active')
  `).run(id, USERNAME, EMAIL, hash);
  youssif = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  console.log(`✅  Created user: ${USERNAME}  (${youssif.id})`);
} else {
  // Ensure role is host and status is active
  db.prepare(`UPDATE users SET role = 'host', status = 'active' WHERE id = ?`)
    .run(youssif.id);
  console.log(`ℹ️   User already exists: ${USERNAME}  (${youssif.id})`);
}

const YOUSSIF_ID = youssif.id;

// ---------------------------------------------------------------------------
// 2. Create or update hosts record (approved, 50% commission)
// ---------------------------------------------------------------------------

const adminUser = db.prepare(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`).get();
const ADMIN_ID  = adminUser?.id ?? null;

const hostRow = db.prepare(`SELECT id FROM hosts WHERE id = ?`).get(YOUSSIF_ID);
if (!hostRow) {
  db.prepare(`
    INSERT INTO hosts (id, status, commission_rate, total_room_time, total_gifts, total_earnings, approved_at, approved_by)
    VALUES (?, 'active', 0.50, 0, 0, 0, unixepoch(), ?)
  `).run(YOUSSIF_ID, ADMIN_ID);
  console.log(`✅  Host record created (active, 50% commission)`);
} else {
  db.prepare(`
    UPDATE hosts SET status = 'active', commission_rate = 0.50, approved_at = unixepoch(), approved_by = ?
    WHERE id = ?
  `).run(ADMIN_ID, YOUSSIF_ID);
  console.log(`ℹ️   Host record updated to active`);
}

// ---------------------------------------------------------------------------
// 3. Simulate a 2-hour room session
// ---------------------------------------------------------------------------

const TWO_HOURS = 7200; // seconds
const now       = Math.floor(Date.now() / 1000);

// Check if we already have a completed session for this host
const existingSession = db.prepare(
  `SELECT id FROM room_sessions WHERE host_id = ? AND ended_at IS NOT NULL LIMIT 1`
).get(YOUSSIF_ID);

if (!existingSession) {
  const sessionId = uuidv4();
  db.prepare(`
    INSERT INTO room_sessions (id, host_id, room_id, started_at, ended_at, duration)
    VALUES (?, ?, 'room-youssif-001', ?, ?, ?)
  `).run(sessionId, YOUSSIF_ID, now - TWO_HOURS, now, TWO_HOURS);

  db.prepare(`UPDATE hosts SET total_room_time = total_room_time + ? WHERE id = ?`)
    .run(TWO_HOURS, YOUSSIF_ID);

  console.log(`✅  Room session recorded: 2 hours`);
} else {
  console.log(`ℹ️   Room session already exists`);
}

// ---------------------------------------------------------------------------
// 4. Send 5 gifts from a test sender → youssif1
// ---------------------------------------------------------------------------

// Create or reuse a gifter account
let gifter = db.prepare(`SELECT * FROM users WHERE username = 'gifter_test'`).get();
if (!gifter) {
  const hash = bcrypt.hashSync('pass1234', 10);
  const id   = uuidv4();
  db.prepare(`
    INSERT INTO users (id, username, email, password, role, status)
    VALUES (?, 'gifter_test', 'gifter_test@test.com', ?, 'user', 'active')
  `).run(id, hash);
  gifter = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
  console.log(`✅  Gifter account created`);
}

const GIFT_AMOUNTS = [500, 1000, 750, 2000, 300];
const HOST_COMMISSION = 0.50;

const hostRecord = db.prepare(`SELECT commission_rate FROM hosts WHERE id = ?`).get(YOUSSIF_ID);
const commRate   = hostRecord?.commission_rate ?? HOST_COMMISSION;

let totalGiftVol  = 0;
let totalHostCut  = 0;
let giftsInserted = 0;

for (const amount of GIFT_AMOUNTS) {
  // Avoid duplicate gifts in repeated runs by checking existing count
  const existingGifts = db.prepare(
    `SELECT COUNT(*) AS cnt FROM gifts WHERE sender_id = ? AND receiver_id = ? AND amount = ?`
  ).get(gifter.id, YOUSSIF_ID, amount);

  if (existingGifts.cnt > 0) {
    console.log(`ℹ️   Gift of ${amount} coins already exists, skipping`);
    continue;
  }

  const giftId  = uuidv4();
  const hostCut = +(amount * commRate).toFixed(4);

  db.prepare(`
    INSERT INTO gifts (id, sender_id, receiver_id, room_id, amount, created_at)
    VALUES (?, ?, ?, 'room-youssif-001', ?, unixepoch())
  `).run(giftId, gifter.id, YOUSSIF_ID, amount);

  db.prepare(`
    INSERT INTO earnings (id, user_id, type, amount, ref_id, created_at)
    VALUES (?, ?, 'host_commission', ?, ?, unixepoch())
  `).run(uuidv4(), YOUSSIF_ID, hostCut, giftId);

  totalGiftVol += amount;
  totalHostCut += hostCut;
  giftsInserted++;
}

if (giftsInserted > 0) {
  // Update host totals
  db.prepare(`
    UPDATE hosts
    SET total_gifts    = total_gifts    + ?,
        total_earnings = total_earnings + ?
    WHERE id = ?
  `).run(totalGiftVol, totalHostCut, YOUSSIF_ID);
  console.log(`✅  ${giftsInserted} gifts sent  |  volume: ${totalGiftVol} coins  |  host earned: ${totalHostCut} coins`);
}

// ---------------------------------------------------------------------------
// 5. Sync targets from live data
// ---------------------------------------------------------------------------

const period = currentMonthPeriod();

const liveHost = db.prepare(
  `SELECT total_room_time, total_earnings, total_gifts FROM hosts WHERE id = ?`
).get(YOUSSIF_ID);

const periodGifts = db.prepare(`
  SELECT COUNT(*) AS cnt
  FROM gifts
  WHERE receiver_id = ? AND created_at >= unixepoch(? || '-01')
`).get(YOUSSIF_ID, period);

const periodEarnings = db.prepare(`
  SELECT COALESCE(SUM(amount), 0) AS total
  FROM earnings
  WHERE user_id = ? AND type = 'host_commission'
    AND created_at >= unixepoch(? || '-01')
`).get(YOUSSIF_ID, period);

const hoursLive = +(liveHost.total_room_time / 3600).toFixed(4);

upsertTarget(YOUSSIF_ID, 'active_hours',   100,   hoursLive);
upsertTarget(YOUSSIF_ID, 'coins_earned',   10000, periodEarnings.total);
upsertTarget(YOUSSIF_ID, 'gifts_received', 50,    periodGifts.cnt);

console.log(`\n📊  Final state for youssif1:`);
console.log(`    Room time  : ${hoursLive} hours`);
console.log(`    Gifts recv : ${periodGifts.cnt} gifts`);
console.log(`    Earnings   : ${periodEarnings.total} coins`);

// ---------------------------------------------------------------------------
// 6. Print targets with progress
// ---------------------------------------------------------------------------

const targets = db.prepare(
  `SELECT * FROM targets WHERE user_id = ? AND period = ? ORDER BY metric`
).all(YOUSSIF_ID, period);

console.log(`\n🎯  Targets (${period}):`);
for (const t of targets) {
  const pct = t.goal > 0 ? Math.min(100, Math.round((t.current / t.goal) * 100)) : 0;
  const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
  console.log(`    ${t.metric.padEnd(16)} [${bar}] ${pct}%  (${t.current}/${t.goal})`);
}

console.log(`\n✅  Seed complete. Login: ${EMAIL} / ${PASSWORD}`);
