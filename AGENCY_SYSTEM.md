# Agency & Hosts System — Documentation

## How It Works

```
User registers  ──(inviteCode?)──▶  Agent gets commission credit
                                         │
                                    User sends gift
                                         │
                              ┌──────────┴──────────┐
                         Host earns 50%        Agent earns 10%
                         (commission)          (on invited user's gifts)
```

---

## Database Schema

```
users
  id, username, email, password, role, status, invited_by, created_at

agents
  id (→ users), invite_code, status, commission_rate,
  total_invites, active_invites, total_earnings, cycle_start

hosts
  id (→ users), status, commission_rate,
  total_room_time, total_gifts, total_earnings

invitations
  id, agent_id (→ agents), invitee_id (→ users)

gifts
  id, sender_id, receiver_id, room_id, amount, created_at

earnings                          ← ledger, one row per payout
  id, user_id, type, amount, ref_id (→ gifts), created_at

targets
  id, user_id, role, metric, goal, current, cycle, period

room_sessions
  id, host_id, room_id, started_at, ended_at, duration
```

---

## API Reference

### Auth
All protected routes require:
```
Authorization: Bearer <token>
```

---

### Users

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/users/register` | — | Register. Pass `inviteCode` to link to an agent |
| POST | `/api/users/login` | — | Returns JWT token |
| GET | `/api/users/me` | ✓ | Current user profile |

**Register body:**
```json
{ "username": "alice", "email": "alice@app.com", "password": "secret", "inviteCode": "ABC12345" }
```

---

### Agents

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/agents/apply` | user | Apply to become an agent |
| GET | `/api/agents/dashboard` | agent | Dashboard: invites, earnings, stats |
| GET | `/api/agents/invite-code` | agent | Get invite code + shareable link |
| GET | `/api/agents/targets` | agent | Monthly targets with progress % |
| GET | `/api/agents/earnings` | agent | Paginated commission history |

**Dashboard response:**
```json
{
  "agent": {
    "inviteCode": "ABC12345",
    "totalInvites": 12,
    "activeInvites": 10,
    "totalEarnings": 850.50,
    "commissionRate": 0.10
  },
  "monthlyEarnings": 320.00,
  "recentInvitees": [...]
}
```

**Targets response:**
```json
{
  "period": "2026-05",
  "targets": [
    { "metric": "invites",      "goal": 50,    "current": 12,   "progress": 24 },
    { "metric": "coins_earned", "goal": 10000, "current": 850,  "progress": 9  }
  ]
}
```

---

### Hosts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/hosts/apply` | user | Apply to become a host |
| GET | `/api/hosts/dashboard` | host | Dashboard: room time, gifts, earnings, rank |
| GET | `/api/hosts/targets` | host | Monthly targets with progress % |
| GET | `/api/hosts/earnings` | host | Paginated earnings history |
| POST | `/api/hosts/session/start` | host | Start tracking a room session |
| POST | `/api/hosts/session/end` | host | End session, updates room time |

**Session start body:** `{ "roomId": "room-uuid" }`
**Session end body:** `{ "sessionId": "session-uuid" }`

**Dashboard response:**
```json
{
  "host": {
    "totalRoomTimeHours": 42.5,
    "totalGifts": 15000,
    "totalEarnings": 7500,
    "commissionRate": 0.50
  },
  "stats": {
    "dailyGiftsCount": 5,
    "weeklyEarnings": 1200,
    "monthlyEarnings": 4800
  },
  "rank": 3
}
```

---

### Gifts

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/gifts/send` | user | Send gift → triggers host + agent earnings |
| GET | `/api/gifts/history` | user | Sender's gift history |

**Send body:** `{ "receiverId": "host-user-id", "amount": 500, "roomId": "room-123" }`

**Earnings formula:**
```
Host earns  = amount × host.commission_rate   (default 50%)
Agent earns = amount × agent.commission_rate  (default 10%, only if sender was invited by an agent)
```

---

### Rankings

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/rankings/agents?period=monthly` | — | Top agents leaderboard |
| GET | `/api/rankings/hosts?period=monthly` | — | Top hosts leaderboard |

`period` options: `monthly` · `weekly` · `alltime`

---

### Admin

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/applications` | admin | Pending agent & host applications |
| POST | `/api/admin/agents/:id/approve` | admin | Approve agent |
| POST | `/api/admin/agents/:id/reject` | admin | Reject agent |
| POST | `/api/admin/hosts/:id/approve` | admin | Approve host |
| POST | `/api/admin/hosts/:id/reject` | admin | Reject host |
| PATCH | `/api/admin/agents/:id/commission` | admin | Set agent commission rate |
| PATCH | `/api/admin/hosts/:id/commission` | admin | Set host commission rate |
| PATCH | `/api/admin/targets/:id` | admin | Override a target goal |
| POST | `/api/admin/users/:id/ban` | admin | Ban user |
| POST | `/api/admin/users/:id/unban` | admin | Unban user |
| GET | `/api/admin/analytics` | admin | Platform-wide stats |
| GET | `/api/admin/users` | admin | List all users (paginated, filterable) |

**Default admin credentials:** `admin@app.com` / `admin123`
> Change these immediately in production.

---

## Earnings Logic

```
Gift of 1000 coins sent by Charlie (invited by Alice the agent) to Bob the host:

  Bob   receives: 1000 × 0.50 = 500 coins  (host_commission)
  Alice receives: 1000 × 0.10 = 100 coins  (agent_commission)
```

Both entries are written atomically in a single DB transaction.

---

## Roles & Lifecycle

```
user  ──apply──▶  agent (pending)  ──admin approve──▶  agent (active)
user  ──apply──▶  host  (pending)  ──admin approve──▶  host  (active)
```

A user can be both an agent and a host simultaneously (separate tables).

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | `change_me_in_production` | JWT signing secret |
| `JWT_EXPIRES` | `7d` | Token expiry |
| `DB_PATH` | `./data/app.db` | SQLite file path |
| `APP_URL` | `https://yourapp.com` | Used in invite links |

Copy `.env.example` to `.env` and fill in values before deploying.
