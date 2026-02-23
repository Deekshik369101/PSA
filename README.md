# PSA Time Entry System

A professional time tracking application for PSA (Professional Services Automation) with a clean HTML/CSS/JS frontend and a Node.js/Express backend with SQLite via Prisma ORM.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** v18+ — [Download here](https://nodejs.org/en/download) (LTS recommended)

### One-command setup
```bash
# Windows — double-click or run in terminal:
setup.bat
```

Or manually:
```bash
npm install
npx prisma migrate dev --name init
node prisma/seed.js
npm start
```

Then open → **http://localhost:3000**

---

## 🔑 Default Credentials

| Role  | Username   | Password  |
|-------|------------|-----------|
| ADMIN | `admin`    | `admin123`|
| USER  | `jsmith`   | `user123` |
| USER  | `mjohnson` | `user123` |

---

## 📁 Project Structure

```
PSA/
├── public/
│   ├── index.html       # Single-page UI (login, admin panel, tables, modals)
│   ├── style.css        # PSA-inspired purple/gray design
│   └── app.js           # Vanilla JS — auth, DOM, copy-selected, API calls
├── prisma/
│   ├── schema.prisma    # Data models: User, Schedule, TimeEntry
│   └── seed.js          # Demo users and schedules
├── server.js            # Express server — all routes
├── .env                 # DB URL, JWT secret, API key
├── setup.bat            # Windows one-click setup
└── package.json
```

---

## 🖥️ Application Features

### User Screen
- **My Schedules** (bottom table): All tasks assigned to you
- **Select** one or more rows → click **Copy Selected** → rows appear in top table
- **Time Entry** (top table): Enter hours per day (Mon–Sun) with inline inputs
- **Notes icon**: Opens modal with per-day (Mon–Fri) text areas
- **Save**: Persists to database
- **Submit**: Locks entries (cannot be edited after submission)

### Admin Screen
- **Create & Assign Task**: Create a project and assign it to any user
- **Register New User**: Create USER or ADMIN accounts
- **Delete schedules** with the trash icon

---

## 🔌 External API (UiPath / Snowflake)

All external routes require the `X-API-KEY` header:
```
X-API-KEY: psa-external-api-key-uipath-snowflake
```
*(Change this in `.env` → `EXTERNAL_API_KEY`)*

### PATCH `/api/external/update-note`
Update or append notes for a specific day on an existing time entry.

**Request Body:**
```json
{
  "entryId": 1,
  "day": "wednesday",
  "text": "Completed data migration validation",
  "mode": "replace"
}
```
- `day`: Full name or 3-letter (monday/mon, tuesday/tue, etc.)
- `mode`: `"replace"` (default) or `"append"`

**Response:**
```json
{
  "success": true,
  "entryId": 1,
  "updatedDay": "wed",
  "notes": { "mon": "", "tue": "", "wed": "Completed data migration validation", ... }
}
```

---

### POST `/api/external/submit-timesheet`
Programmatically create AND submit a full week of hours for a user.

**Request Body:**
```json
{
  "username": "jsmith",
  "scheduleId": 1,
  "weekEnding": "2026-02-27",
  "mon": 8,
  "tue": 8,
  "wed": 7.5,
  "thu": 8,
  "fri": 8,
  "sat": 0,
  "sun": 0,
  "notes": {
    "mon": "Kickoff meeting",
    "tue": "Development",
    "wed": "Code review",
    "thu": "Testing",
    "fri": "Deployment",
    "sat": "",
    "sun": ""
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Timesheet saved and submitted successfully",
  "entry": { "id": 5, "isSubmitted": true, ... }
}
```

---

## 🔐 JWT Auth API

### POST `/api/auth/login`
```json
{ "username": "jsmith", "password": "user123" }
```
Returns: `{ "token": "Bearer ...", "user": { "id", "username", "role" } }`

Use the token in subsequent requests:
```
Authorization: Bearer <token>
```

---

## ⚙️ Configuration (`.env`)
```env
DATABASE_URL="file:./dev.db"
JWT_SECRET="change-this-in-production"
EXTERNAL_API_KEY="change-this-to-a-secure-key"
PORT=3000
```

---

## 🛠️ NPM Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start the server |
| `npm run db:migrate` | Run Prisma migrations |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio (visual DB editor) |
