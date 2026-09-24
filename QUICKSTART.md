# Agency & Hosts System — Quick Start

## Installation

```bash
cd backend
npm install
```

## Run

```bash
npm start
```

Server starts on `http://localhost:3000`

---

## Test Flow

### 1. Register a user with an invite code

```bash
curl -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "email": "alice@test.com",
    "password": "pass1234"
  }'
```

Response:
```json
{ "userId": "...", "token": "..." }
```

### 2. Apply to become an agent

```bash
curl -X POST http://localhost:3000/api/agents/apply \
  -H "Authorization: Bearer <alice_token>"
```

Response:
```json
{ "message": "Application submitted", "inviteCode": "ABC12345" }
```

### 3. Admin approves the agent

Login as admin:
```bash
curl -X POST http://localhost:3000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "admin@app.com", "password": "admin123" }'
```

Approve:
```bash
curl -X POST http://localhost:3000/api/admin/agents/<alice_id>/approve \
  -H "Authorization: Bearer <admin_token>"
```

### 4. Register a second user with Alice's invite code

```bash
curl -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "bob",
    "email": "bob@test.com",
    "password": "pass1234",
    "inviteCode": "ABC12345"
  }'
```

### 5. Bob applies as host, admin approves

```bash
curl -X POST http://localhost:3000/api/hosts/apply \
  -H "Authorization: Bearer <bob_token>"

curl -X POST http://localhost:3000/api/admin/hosts/<bob_id>/approve \
  -H "Authorization: Bearer <admin_token>"
```

### 6. Register Charlie (invited by Alice)

```bash
curl -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "charlie",
    "email": "charlie@test.com",
    "password": "pass1234",
    "inviteCode": "ABC12345"
  }'
```

### 7. Charlie sends a gift to Bob

```bash
curl -X POST http://localhost:3000/api/gifts/send \
  -H "Authorization: Bearer <charlie_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "receiverId": "<bob_id>",
    "amount": 1000,
    "roomId": "room-123"
  }'
```

Response:
```json
{
  "giftId": "...",
  "amount": 1000,
  "hostEarned": 500,
  "message": "Gift sent successfully"
}
```

**Behind the scenes:**
- Bob (host) earns 500 coins (50% commission)
- Alice (agent) earns 100 coins (10% commission, because Charlie was invited by Alice)

### 8. Check Alice's agent dashboard

```bash
curl http://localhost:3000/api/agents/dashboard \
  -H "Authorization: Bearer <alice_token>"
```

Response:
```json
{
  "agent": {
    "inviteCode": "ABC12345",
    "totalInvites": 2,
    "totalEarnings": 100
  },
  "monthlyEarnings": 100,
  "recentInvitees": [...]
}
```

### 9. Check Bob's host dashboard

```bash
curl http://localhost:3000/api/hosts/dashboard \
  -H "Authorization: Bearer <bob_token>"
```

Response:
```json
{
  "host": {
    "totalGifts": 1000,
    "totalEarnings": 500
  },
  "stats": { ... },
  "rank": 1
}
```

### 10. View rankings

```bash
curl http://localhost:3000/api/rankings/hosts?period=monthly
curl http://localhost:3000/api/rankings/agents?period=monthly
```

### 11. Admin analytics

```bash
curl http://localhost:3000/api/admin/analytics \
  -H "Authorization: Bearer <admin_token>"
```

Response:
```json
{
  "users": { "total": 4, "newLast7Days": 3 },
  "agents": { "active": 1, "pending": 0 },
  "hosts": { "active": 1, "pending": 0 },
  "gifts": { "count": 1, "volume": 1000 },
  "earnings": { "total": 600 }
}
```

---

## Default Admin

- **Email:** `admin@app.com`
- **Password:** `admin123`

> ⚠️ Change this immediately in production!

---

## Database

SQLite file is created at `backend/data/app.db` on first run.

To reset:
```bash
rm -rf backend/data/app.db
npm start  # recreates with fresh schema + default admin
```

---

## Next Steps

- Integrate with your Flutter client
- Add real payment processing
- Set up production database (PostgreSQL)
- Configure JWT secret in `.env`
- Add email notifications for approvals
- Build admin dashboard UI
