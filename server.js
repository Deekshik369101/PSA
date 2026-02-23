const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const app = express();
const prisma = new PrismaClient();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'psa-secret';
const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || 'psa-external-api-key-uipath-snowflake';

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access token required' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token' });
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Admin access required' });
  next();
}

function authenticateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey || apiKey !== EXTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing X-API-KEY header' });
  }
  next();
}

// ─── Auth Routes ──────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { username, password: hashed, role: role || 'USER' }
    });

    res.status(201).json({ id: user.id, username: user.username, role: user.role });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

// ─── User Routes ──────────────────────────────────────────────────────────────
app.get('/api/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const users = await prisma.user.findMany({
      select: { id: true, username: true, role: true, createdAt: true }
    });
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Schedule Routes ──────────────────────────────────────────────────────────
// GET schedules — admin sees all, user sees their own
app.get('/api/schedules', authenticateToken, async (req, res) => {
  try {
    const where = req.user.role === 'ADMIN' ? {} : { userId: req.user.id };
    const schedules = await prisma.schedule.findMany({
      where,
      include: { user: { select: { id: true, username: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create schedule (admin only)
app.post('/api/schedules', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId, projectTitle } = req.body;
    if (!userId || !projectTitle) return res.status(400).json({ error: 'userId and projectTitle required' });

    const schedule = await prisma.schedule.create({
      data: { userId: parseInt(userId), projectTitle, isAssigned: true },
      include: { user: { select: { id: true, username: true } } }
    });
    res.status(201).json(schedule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE a schedule (admin only)
app.delete('/api/schedules/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    await prisma.schedule.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Time Entry Routes ────────────────────────────────────────────────────────
// GET time entries for a schedule
app.get('/api/timeentries', authenticateToken, async (req, res) => {
  try {
    const { scheduleId, weekEnding } = req.query;
    const where = {};

    if (scheduleId) where.scheduleId = parseInt(scheduleId);
    if (weekEnding) where.weekEnding = new Date(weekEnding);

    // If user, restrict to their own schedules
    if (req.user.role !== 'ADMIN') {
      const userScheduleIds = (await prisma.schedule.findMany({
        where: { userId: req.user.id },
        select: { id: true }
      })).map(s => s.id);
      where.scheduleId = { in: userScheduleIds };
    }

    const entries = await prisma.timeEntry.findMany({
      where,
      include: { schedule: { include: { user: { select: { id: true, username: true } } } } },
      orderBy: { createdAt: 'desc' }
    });

    const parsed = entries.map(e => ({
      ...e,
      notes: JSON.parse(e.notes || '{}')
    }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create or update a time entry (upsert by scheduleId + weekEnding)
app.post('/api/timeentries', authenticateToken, async (req, res) => {
  try {
    const { scheduleId, weekEnding, mon, tue, wed, thu, fri, sat, sun, notes } = req.body;
    if (!scheduleId || !weekEnding) return res.status(400).json({ error: 'scheduleId and weekEnding required' });

    // Verify ownership
    const schedule = await prisma.schedule.findUnique({ where: { id: parseInt(scheduleId) } });
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    if (req.user.role !== 'ADMIN' && schedule.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const weekEndingDate = new Date(weekEnding);
    const notesStr = typeof notes === 'object' ? JSON.stringify(notes) : (notes || '{"mon":"","tue":"","wed":"","thu":"","fri":"","sat":"","sun":""}');

    const entry = await prisma.timeEntry.upsert({
      where: {
        scheduleId_weekEnding: {
          scheduleId: parseInt(scheduleId),
          weekEnding: weekEndingDate
        }
      },
      update: {
        mon: parseFloat(mon) || 0,
        tue: parseFloat(tue) || 0,
        wed: parseFloat(wed) || 0,
        thu: parseFloat(thu) || 0,
        fri: parseFloat(fri) || 0,
        sat: parseFloat(sat) || 0,
        sun: parseFloat(sun) || 0,
        notes: notesStr
      },
      create: {
        scheduleId: parseInt(scheduleId),
        weekEnding: weekEndingDate,
        mon: parseFloat(mon) || 0,
        tue: parseFloat(tue) || 0,
        wed: parseFloat(wed) || 0,
        thu: parseFloat(thu) || 0,
        fri: parseFloat(fri) || 0,
        sat: parseFloat(sat) || 0,
        sun: parseFloat(sun) || 0,
        notes: notesStr
      }
    });

    res.json({ ...entry, notes: JSON.parse(entry.notes) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH submit a time entry
app.patch('/api/timeentries/:id/submit', authenticateToken, async (req, res) => {
  try {
    const entry = await prisma.timeEntry.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { schedule: true }
    });
    if (!entry) return res.status(404).json({ error: 'Time entry not found' });
    if (req.user.role !== 'ADMIN' && entry.schedule.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const updated = await prisma.timeEntry.update({
      where: { id: parseInt(req.params.id) },
      data: { isSubmitted: true }
    });
    res.json({ ...updated, notes: JSON.parse(updated.notes) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update notes for a specific entry
app.patch('/api/timeentries/:id/notes', authenticateToken, async (req, res) => {
  try {
    const { notes } = req.body;
    const entry = await prisma.timeEntry.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { schedule: true }
    });
    if (!entry) return res.status(404).json({ error: 'Time entry not found' });
    if (req.user.role !== 'ADMIN' && entry.schedule.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (entry.isSubmitted) return res.status(400).json({ error: 'Cannot edit a submitted entry' });

    const notesStr = typeof notes === 'object' ? JSON.stringify(notes) : notes;
    const updated = await prisma.timeEntry.update({
      where: { id: parseInt(req.params.id) },
      data: { notes: notesStr }
    });
    res.json({ ...updated, notes: JSON.parse(updated.notes) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update hours only for an existing entry
app.patch('/api/timeentries/:id/hours', authenticateToken, async (req, res) => {
  try {
    const entry = await prisma.timeEntry.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { schedule: true }
    });
    if (!entry) return res.status(404).json({ error: 'Time entry not found' });
    if (req.user.role !== 'ADMIN' && entry.schedule.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (entry.isSubmitted) return res.status(400).json({ error: 'Cannot edit a submitted entry' });

    const validDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const { mon, tue, wed, thu, fri, sat, sun } = req.body;
    const update = {};
    if (mon !== undefined) update.mon = parseFloat(mon) || 0;
    if (tue !== undefined) update.tue = parseFloat(tue) || 0;
    if (wed !== undefined) update.wed = parseFloat(wed) || 0;
    if (thu !== undefined) update.thu = parseFloat(thu) || 0;
    if (fri !== undefined) update.fri = parseFloat(fri) || 0;
    if (sat !== undefined) update.sat = parseFloat(sat) || 0;
    if (sun !== undefined) update.sun = parseFloat(sun) || 0;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'At least one day field (mon–sun) is required' });
    }

    const updated = await prisma.timeEntry.update({
      where: { id: parseInt(req.params.id) },
      data: update
    });
    res.json({ ...updated, notes: JSON.parse(updated.notes) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH update a single day's note for an existing entry
app.patch('/api/timeentries/:id/notes/day', authenticateToken, async (req, res) => {
  try {
    const { day, text, mode } = req.body;
    if (!day || text === undefined) {
      return res.status(400).json({ error: '"day" and "text" are required' });
    }

    const validDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const dayKey = day.toLowerCase().substring(0, 3);
    if (!validDays.includes(dayKey)) {
      return res.status(400).json({ error: `Invalid day "${day}". Use: mon, tue, wed, thu, fri, sat, sun` });
    }

    const entry = await prisma.timeEntry.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { schedule: true }
    });
    if (!entry) return res.status(404).json({ error: 'Time entry not found' });
    if (req.user.role !== 'ADMIN' && entry.schedule.userId !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized' });
    }
    if (entry.isSubmitted) return res.status(400).json({ error: 'Cannot edit a submitted entry' });

    const currentNotes = JSON.parse(entry.notes || '{}');
    if (mode === 'append') {
      currentNotes[dayKey] = currentNotes[dayKey]
        ? `${currentNotes[dayKey]}\n${text}`
        : text;
    } else {
      currentNotes[dayKey] = text;
    }

    const updated = await prisma.timeEntry.update({
      where: { id: parseInt(req.params.id) },
      data: { notes: JSON.stringify(currentNotes) }
    });
    res.json({ ...updated, notes: JSON.parse(updated.notes) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET schedule names for a specific user (admin can query any user; user can only query themselves)
app.get('/api/users/:userId/schedules', authenticateToken, async (req, res) => {
  try {
    const targetId = parseInt(req.params.userId);
    if (req.user.role !== 'ADMIN' && req.user.id !== targetId) {
      return res.status(403).json({ error: 'Not authorized to view another user\'s schedules' });
    }

    // Verify user exists
    const user = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, username: true } });
    if (!user) return res.status(404).json({ error: `User with id ${targetId} not found` });

    const schedules = await prisma.schedule.findMany({
      where: { userId: targetId },
      select: { id: true, projectTitle: true, isAssigned: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ user, schedules });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── External API (UiPath / Snowflake) ───────────────────────────────────────
// PATCH /api/external/update-note
app.patch('/api/external/update-note', authenticateApiKey, async (req, res) => {
  try {
    const { entryId, day, text, mode } = req.body;
    // mode: 'replace' (default) or 'append'
    if (!entryId || !day || text === undefined) {
      return res.status(400).json({ error: 'entryId, day, and text are required' });
    }

    const validDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const dayKey = day.toLowerCase().substring(0, 3);
    if (!validDays.includes(dayKey)) {
      return res.status(400).json({ error: `Invalid day: ${day}. Use: monday, tuesday, wednesday, thursday, friday, saturday, sunday` });
    }

    const entry = await prisma.timeEntry.findUnique({ where: { id: parseInt(entryId) } });
    if (!entry) return res.status(404).json({ error: 'Time entry not found' });
    if (entry.isSubmitted) return res.status(400).json({ error: 'Cannot update a submitted entry' });

    const currentNotes = JSON.parse(entry.notes || '{}');
    if (mode === 'append') {
      currentNotes[dayKey] = currentNotes[dayKey]
        ? `${currentNotes[dayKey]}\n${text}`
        : text;
    } else {
      currentNotes[dayKey] = text;
    }

    const updated = await prisma.timeEntry.update({
      where: { id: parseInt(entryId) },
      data: { notes: JSON.stringify(currentNotes) }
    });

    res.json({ success: true, entryId: updated.id, updatedDay: dayKey, notes: JSON.parse(updated.notes) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/external/submit-timesheet
app.post('/api/external/submit-timesheet', authenticateApiKey, async (req, res) => {
  try {
    const { username, scheduleId, weekEnding, mon, tue, wed, thu, fri, sat, sun, notes } = req.body;
    if (!username || !scheduleId || !weekEnding) {
      return res.status(400).json({ error: 'username, scheduleId, and weekEnding are required' });
    }

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) return res.status(404).json({ error: `User '${username}' not found` });

    const schedule = await prisma.schedule.findFirst({
      where: { id: parseInt(scheduleId), userId: user.id }
    });
    if (!schedule) return res.status(404).json({ error: 'Schedule not found for this user' });

    const weekEndingDate = new Date(weekEnding);
    const notesStr = notes
      ? (typeof notes === 'object' ? JSON.stringify(notes) : notes)
      : '{"mon":"","tue":"","wed":"","thu":"","fri":"","sat":"","sun":""}';

    const entry = await prisma.timeEntry.upsert({
      where: {
        scheduleId_weekEnding: {
          scheduleId: parseInt(scheduleId),
          weekEnding: weekEndingDate
        }
      },
      update: {
        mon: parseFloat(mon) || 0,
        tue: parseFloat(tue) || 0,
        wed: parseFloat(wed) || 0,
        thu: parseFloat(thu) || 0,
        fri: parseFloat(fri) || 0,
        sat: parseFloat(sat) || 0,
        sun: parseFloat(sun) || 0,
        notes: notesStr,
        isSubmitted: true
      },
      create: {
        scheduleId: parseInt(scheduleId),
        weekEnding: weekEndingDate,
        mon: parseFloat(mon) || 0,
        tue: parseFloat(tue) || 0,
        wed: parseFloat(wed) || 0,
        thu: parseFloat(thu) || 0,
        fri: parseFloat(fri) || 0,
        sat: parseFloat(sat) || 0,
        sun: parseFloat(sun) || 0,
        notes: notesStr,
        isSubmitted: true
      }
    });

    res.json({
      success: true,
      message: 'Timesheet saved and submitted successfully',
      entry: { ...entry, notes: JSON.parse(entry.notes) }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Catch-all for SPA ────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start Server ─────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 PSA Time Entry Server running on http://localhost:${PORT}`);
  console.log(`📋 External API Key: ${EXTERNAL_API_KEY}`);
});
