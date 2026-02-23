/* ═══════════════════════════════════════════════════════════════════════════
   PSA Time Entry System — Frontend Application Logic
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
    token: null,
    user: null,
    schedules: [],
    entryRows: [],       // rows in the time-entry table
    currentEntryId: null,
    isSubmitted: false,
    notesTarget: null,   // { rowIndex, entryId, projectTitle }
    weekEnding: null
};

// ── API Helper ────────────────────────────────────────────────────────────────
async function api(method, path, body) {
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (state.token) opts.headers['Authorization'] = `Bearer ${state.token}`;
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, type = 'success', duration = 3500) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-times-circle' : 'fa-exclamation-triangle';
    toast.innerHTML = `<i class="fas ${icon}"></i><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('removing');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

// ── Confirm dialog ────────────────────────────────────────────────────────────
function confirm(title, message) {
    return new Promise(resolve => {
        document.getElementById('confirm-modal-title').innerHTML = `<i class="fas fa-exclamation-triangle"></i> ${title}`;
        document.getElementById('confirm-modal-message').textContent = message;
        document.getElementById('confirm-modal').classList.remove('hidden');

        function cleanup(result) {
            document.getElementById('confirm-modal').classList.add('hidden');
            document.getElementById('confirm-ok-btn').removeEventListener('click', onOk);
            document.getElementById('confirm-cancel-btn').removeEventListener('click', onCancel);
            resolve(result);
        }
        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);
        document.getElementById('confirm-ok-btn').addEventListener('click', onOk);
        document.getElementById('confirm-cancel-btn').addEventListener('click', onCancel);
    });
}

// ── Week Ending Helpers ───────────────────────────────────────────────────────
function getNextFriday() {
    const d = new Date();
    const day = d.getDay();           // 0=Sun,1=Mon,...,5=Fri,6=Sat
    const daysUntilFriday = (5 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + daysUntilFriday);
    return d.toISOString().split('T')[0];
}

function formatWeekDisplay(dateStr) {
    if (!dateStr) return 'No week selected';
    const d = new Date(dateStr + 'T00:00:00');
    const opts = { month: 'short', day: 'numeric', year: 'numeric' };
    // Week starts Monday (fri - 4 days)
    const monday = new Date(d);
    monday.setDate(d.getDate() - 4);
    return `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${d.toLocaleDateString('en-US', opts)}`;
}

// ── Auth ─────────────────────────────────────────────────────────────────────
document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing In...';
    document.getElementById('login-error').classList.add('hidden');

    try {
        const data = await api('POST', '/api/auth/login', {
            username: document.getElementById('login-username').value.trim(),
            password: document.getElementById('login-password').value
        });

        state.token = data.token;
        state.user = data.user;

        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
        document.getElementById('current-user-name').textContent = data.user.username;
        document.getElementById('user-role-badge').textContent = data.user.role;

        if (data.user.role === 'ADMIN') {
            // Admin view: show admin panel + admin schedules table; hide user time-entry content
            document.getElementById('admin-panel').classList.remove('hidden');
            document.getElementById('admin-content').classList.remove('hidden');
            document.getElementById('user-content').classList.add('hidden');
            document.getElementById('week-selector-wrap').classList.add('hidden');
            loadUsers();
            loadAdminSchedules();
        } else {
            // User view: show time-entry/schedules; hide admin sections
            document.getElementById('admin-panel').classList.add('hidden');
            document.getElementById('admin-content').classList.add('hidden');
            document.getElementById('user-content').classList.remove('hidden');
            document.getElementById('week-selector-wrap').classList.remove('hidden');

            // Set default week ending to next Friday
            const weekInput = document.getElementById('week-ending-input');
            weekInput.value = getNextFriday();
            state.weekEnding = weekInput.value;
            updateWeekLabel();

            loadSchedules();
        }
    } catch (err) {
        const el = document.getElementById('login-error');
        el.textContent = err.message;
        el.classList.remove('hidden');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Sign In';
    }
});

document.getElementById('logout-btn').addEventListener('click', () => {
    state.token = null;
    state.user = null;
    state.schedules = [];
    state.entryRows = [];
    document.getElementById('app').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('login-password').value = '';
    document.getElementById('admin-panel').classList.add('hidden');
    document.getElementById('admin-content').classList.add('hidden');
    document.getElementById('user-content').classList.remove('hidden');
    clearTimeEntryTable();
});

// ── Week selector ─────────────────────────────────────────────────────────────
document.getElementById('week-ending-input').addEventListener('change', function () {
    state.weekEnding = this.value;
    updateWeekLabel();
});

function updateWeekLabel() {
    const label = document.getElementById('entry-week-label');
    label.textContent = state.weekEnding ? formatWeekDisplay(state.weekEnding) : 'Select a week';
}

// ── Admin Panel toggle ────────────────────────────────────────────────────────
document.getElementById('toggle-admin-panel').addEventListener('click', () => {
    const body = document.getElementById('admin-panel-body');
    const chevron = document.getElementById('admin-panel-chevron');
    body.classList.toggle('hidden');
    chevron.className = body.classList.contains('hidden') ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
});

// ── Load Users (admin only) ───────────────────────────────────────────────────
async function loadUsers() {
    try {
        const users = await api('GET', '/api/users');
        const select = document.getElementById('assign-user-select');
        select.innerHTML = '<option value="">— Select User —</option>';
        users.filter(u => u.role === 'USER').forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.username;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('Failed to load users:', err.message);
    }
}

// ── Register User (admin) ─────────────────────────────────────────────────────
document.getElementById('register-user-form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    try {
        await api('POST', '/api/auth/register', {
            username: document.getElementById('new-username').value.trim(),
            password: document.getElementById('new-password').value,
            role: document.getElementById('new-role').value
        });
        showToast(`User "${document.getElementById('new-username').value}" created successfully`);
        document.getElementById('register-user-form').reset();
        loadUsers();
    } catch (err) {
        showToast(err.message, 'error');
    } finally {
        btn.disabled = false;
    }
});

// ── Create Task (admin) ───────────────────────────────────────────────────────
document.getElementById('create-task-form').addEventListener('submit', async e => {
    e.preventDefault();
    const errEl = document.getElementById('admin-error');
    const successEl = document.getElementById('admin-success');
    errEl.classList.add('hidden');
    successEl.classList.add('hidden');
    const btn = e.target.querySelector('button');
    btn.disabled = true;

    try {
        const schedule = await api('POST', '/api/schedules', {
            userId: document.getElementById('assign-user-select').value,
            projectTitle: document.getElementById('task-title-input').value.trim()
        });
        successEl.textContent = `✓ Task "${schedule.projectTitle}" assigned to ${schedule.user.username}`;
        successEl.classList.remove('hidden');
        document.getElementById('create-task-form').reset();
        loadAdminSchedules();              // refresh the admin overview table
        setTimeout(() => successEl.classList.add('hidden'), 4000);
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    } finally {
        btn.disabled = false;
    }
});

// ═══════════════════════════════════════════════ ADMIN OVERVIEW TABLE

async function loadAdminSchedules() {
    const tbody = document.getElementById('admin-schedules-body');
    const loading = document.getElementById('admin-schedules-loading');
    const errEl = document.getElementById('admin-schedules-error');

    loading.classList.remove('hidden');
    errEl.classList.add('hidden');
    tbody.innerHTML = '';

    try {
        const schedules = await api('GET', '/api/schedules');
        state.schedules = schedules;
        renderAdminSchedules(schedules);
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    } finally {
        loading.classList.add('hidden');
    }
}

function renderAdminSchedules(schedules) {
    const tbody = document.getElementById('admin-schedules-body');
    const badge = document.getElementById('admin-schedule-count-badge');
    badge.textContent = `${schedules.length} schedule${schedules.length !== 1 ? 's' : ''}`;
    tbody.innerHTML = '';

    if (!schedules.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--gray-400);">
            <i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:10px;"></i>No schedules found.
        </td></tr>`;
        return;
    }

    schedules.forEach((s, idx) => {
        const tr = document.createElement('tr');
        const createdDate = new Date(s.createdAt).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        });
        tr.innerHTML = `
            <td style="color:var(--gray-400);font-size:0.8rem;">${idx + 1}</td>
            <td class="project-cell">${escHtml(s.projectTitle)}</td>
            <td>
                <span style="display:inline-flex;align-items:center;gap:6px;">
                    <i class="fas fa-user" style="color:var(--brand-purple);font-size:0.8rem;"></i>
                    <strong>${escHtml(s.user?.username || '—')}</strong>
                </span>
            </td>
            <td>
                <span class="status-chip status-assigned">
                    <i class="fas fa-check-circle"></i> Active
                </span>
            </td>
            <td style="color:var(--gray-500);font-size:0.82rem;">${createdDate}</td>
            <td>
                <button class="btn btn-ghost btn-sm admin-delete-btn" data-id="${s.id}" data-title="${escHtml(s.projectTitle)}" title="Delete schedule">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Delete buttons
    tbody.querySelectorAll('.admin-delete-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            const id = e.currentTarget.dataset.id;
            const title = e.currentTarget.dataset.title;
            const ok = await confirm('Delete Schedule', `Delete "${title}"? This will also remove all associated time entries.`);
            if (!ok) return;
            try {
                await api('DELETE', `/api/schedules/${id}`);
                showToast('Schedule deleted');
                loadAdminSchedules();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    });
}

// Admin search filter
document.getElementById('admin-schedule-search').addEventListener('input', function () {
    const q = this.value.toLowerCase();
    const filtered = state.schedules.filter(s =>
        s.projectTitle.toLowerCase().includes(q) ||
        (s.user && s.user.username.toLowerCase().includes(q))
    );
    renderAdminSchedules(filtered);
});

document.getElementById('admin-refresh-btn').addEventListener('click', loadAdminSchedules);

// ═══════════════════════════════════════════════ SCHEDULES (BOTTOM TABLE)

async function loadSchedules() {
    const tbody = document.getElementById('schedules-body');
    const loading = document.getElementById('schedules-loading');
    const errEl = document.getElementById('schedules-error');

    loading.classList.remove('hidden');
    errEl.classList.add('hidden');
    tbody.innerHTML = '';

    try {
        const schedules = await api('GET', '/api/schedules');
        state.schedules = schedules;
        renderSchedules(schedules);
    } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
    } finally {
        loading.classList.add('hidden');
    }
}

function renderSchedules(schedules) {
    const tbody = document.getElementById('schedules-body');
    const badge = document.getElementById('schedule-count-badge');
    badge.textContent = `${schedules.length} task${schedules.length !== 1 ? 's' : ''}`;
    tbody.innerHTML = '';

    if (!schedules.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:32px;color:var(--gray-400);">
      <i class="fas fa-inbox" style="font-size:2rem;display:block;margin-bottom:10px;"></i>No schedules assigned yet.
    </td></tr>`;
        return;
    }

    schedules.forEach((s, idx) => {
        const alreadyCopied = state.entryRows.some(r => r.scheduleId === s.id);
        const tr = document.createElement('tr');
        tr.dataset.scheduleId = s.id;
        if (alreadyCopied) tr.classList.add('row-copied');

        tr.innerHTML = `
      <td><input type="checkbox" class="sched-checkbox" data-id="${s.id}" ${alreadyCopied ? 'disabled' : ''} /></td>
      <td style="color:var(--gray-400);font-size:0.8rem;">${idx + 1}</td>
      <td class="project-cell">
        ${escHtml(s.projectTitle)}
        ${s.user ? `<small>User: ${escHtml(s.user.username)}</small>` : ''}
      </td>
      <td>
        <span class="status-chip status-assigned">
          <i class="fas fa-check-circle"></i> Active
        </span>
      </td>
      <td style="color:var(--gray-500);font-size:0.82rem;">Admin</td>
      <td>
        ${state.user && state.user.role === 'ADMIN' ? `
        <button class="btn btn-ghost btn-sm delete-schedule-btn" data-id="${s.id}" title="Delete schedule">
          <i class="fas fa-trash-alt"></i>
        </button>` : ''}
      </td>
    `;
        tbody.appendChild(tr);
    });

    // Checkbox change → update selection count
    document.querySelectorAll('.sched-checkbox').forEach(cb => {
        cb.addEventListener('change', updateSelectionCount);
    });

    // Delete buttons
    document.querySelectorAll('.delete-schedule-btn').forEach(btn => {
        btn.addEventListener('click', async e => {
            const id = e.currentTarget.dataset.id;
            const sched = state.schedules.find(s => s.id === parseInt(id));
            const ok = await confirm('Delete Schedule', `Delete "${sched?.projectTitle}"? This will also delete all associated time entries.`);
            if (!ok) return;
            try {
                await api('DELETE', `/api/schedules/${id}`);
                showToast('Schedule deleted');
                loadSchedules();
                // Remove from entry table if present
                removeEntryRowByScheduleId(parseInt(id));
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    });
}

function updateSelectionCount() {
    const checked = document.querySelectorAll('.sched-checkbox:checked').length;
    document.getElementById('selection-count').textContent = `${checked} selected`;
}

// Select all
document.getElementById('select-all-schedules').addEventListener('change', function () {
    document.querySelectorAll('.sched-checkbox:not(:disabled)').forEach(cb => {
        cb.checked = this.checked;
    });
    updateSelectionCount();
});

// Search filter
document.getElementById('schedule-search').addEventListener('input', function () {
    const q = this.value.toLowerCase();
    const filtered = state.schedules.filter(s =>
        s.projectTitle.toLowerCase().includes(q) ||
        (s.user && s.user.username.toLowerCase().includes(q))
    );
    renderSchedules(filtered);
});

document.getElementById('refresh-schedules-btn').addEventListener('click', loadSchedules);

// ═══════════════════════════════════════════════ COPY SELECTED → TIME ENTRY

document.getElementById('copy-selected-btn').addEventListener('click', () => {
    const checked = [...document.querySelectorAll('.sched-checkbox:checked')];
    if (!checked.length) {
        showToast('Please select at least one schedule.', 'warning');
        return;
    }
    if (!state.weekEnding) {
        showToast('Please select a week ending date first.', 'warning');
        return;
    }

    checked.forEach(cb => {
        const schedId = parseInt(cb.dataset.id);
        if (state.entryRows.some(r => r.scheduleId === schedId)) return; // already added

        const sched = state.schedules.find(s => s.id === schedId);
        if (!sched) return;

        const rowData = {
            scheduleId: sched.id,
            projectTitle: sched.projectTitle,
            entryId: null,
            mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0,
            notes: { mon: '', tue: '', wed: '', thu: '', fri: '', sat: '', sun: '' },
            isSubmitted: false
        };
        state.entryRows.push(rowData);
        addTimeEntryRow(rowData, state.entryRows.length - 1);
    });

    // Uncheck all
    document.querySelectorAll('.sched-checkbox').forEach(cb => { cb.checked = false; });
    document.getElementById('select-all-schedules').checked = false;
    updateSelectionCount();
    markCopiedSchedules();
    updateEntryButtons();
    updateTotalsRow();
});

function markCopiedSchedules() {
    document.querySelectorAll('[data-schedule-id]').forEach(tr => {
        const id = parseInt(tr.dataset.scheduleId);
        const isCopied = state.entryRows.some(r => r.scheduleId === id);
        tr.classList.toggle('row-copied', isCopied);
        const cb = tr.querySelector('.sched-checkbox');
        if (cb) cb.disabled = isCopied;
    });
}

// ═══════════════════════════════════════════════ TIME ENTRY TABLE

function clearTimeEntryTable() {
    state.entryRows = [];
    state.currentEntryId = null;
    state.isSubmitted = false;
    const tbody = document.getElementById('time-entry-body');
    tbody.innerHTML = `<tr class="empty-row"><td colspan="11">
    <div class="empty-state">
      <i class="fas fa-arrow-down"></i>
      <p>Select schedules below and click <strong>Copy Selected</strong> to add rows here.</p>
    </div>
  </td></tr>`;
    document.getElementById('totals-row').classList.add('hidden');
    updateEntryButtons();
}

function addTimeEntryRow(rowData, rowIndex) {
    const tbody = document.getElementById('time-entry-body');

    // Remove empty placeholder
    const emptyRow = tbody.querySelector('.empty-row');
    if (emptyRow) emptyRow.remove();

    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const tr = document.createElement('tr');
    tr.dataset.rowIndex = rowIndex;
    if (rowData.isSubmitted) tr.classList.add('submitted-row');

    const rowTotal = days.reduce((s, d) => s + (rowData[d] || 0), 0);

    tr.innerHTML = `
    <td class="project-cell">
      ${escHtml(rowData.projectTitle)}
      ${rowData.isSubmitted ? '<br><span class="status-chip status-submitted" style="margin-top:4px;"><i class="fas fa-lock"></i> Submitted</span>' : ''}
    </td>
    ${days.map(d => `
      <td>
        <input type="number" class="hours-input day-input"
          data-day="${d}" data-row="${rowIndex}"
          value="${rowData[d] > 0 ? rowData[d] : ''}"
          min="0" max="24" step="0.5"
          placeholder="0"
          ${rowData.isSubmitted ? 'disabled' : ''}
          ${rowData[d] > 0 ? 'class="hours-input day-input has-value"' : ''}
        />
      </td>
    `).join('')}
    <td class="total-cell-value" id="row-total-${rowIndex}">${rowTotal > 0 ? rowTotal.toFixed(1) : '—'}</td>
    <td>
      <button class="btn-notes ${hasNotes(rowData.notes) ? 'has-notes' : ''}"
        data-row="${rowIndex}" title="View / edit notes">
        <i class="fas fa-sticky-note"></i>
      </button>
    </td>
    <td>
      <button class="btn btn-ghost btn-icon remove-row-btn" data-row="${rowIndex}" title="Remove row" ${rowData.isSubmitted ? 'disabled' : ''}>
        <i class="fas fa-times"></i>
      </button>
    </td>
  `;

    // Fix: re-apply class to inputs with value
    days.forEach(d => {
        const inp = tr.querySelector(`[data-day="${d}"]`);
        if (rowData[d] > 0) inp.classList.add('has-value');
    });

    tbody.appendChild(tr);

    // Events: hour inputs
    tr.querySelectorAll('.day-input').forEach(inp => {
        inp.addEventListener('input', () => {
            const ri = parseInt(inp.dataset.row);
            const day = inp.dataset.day;
            const val = parseFloat(inp.value) || 0;
            state.entryRows[ri][day] = val;
            inp.classList.toggle('has-value', val > 0);
            updateRowTotal(ri);
            updateTotalsRow();
        });
    });

    // Notes button
    tr.querySelector('.btn-notes').addEventListener('click', () => openNotesModal(rowIndex));

    // Remove row button
    tr.querySelector('.remove-row-btn').addEventListener('click', () => {
        removeEntryRow(rowIndex);
    });

    document.getElementById('totals-row').classList.remove('hidden');
}

function removeEntryRow(rowIndex) {
    const schedId = state.entryRows[rowIndex]?.scheduleId;
    state.entryRows.splice(rowIndex, 1);
    rebuildTimeEntryTable();
    if (schedId) {
        // Re-enable the checkbox in the schedule table
        const cb = document.querySelector(`.sched-checkbox[data-id="${schedId}"]`);
        if (cb) { cb.disabled = false; cb.checked = false; }
        const row = document.querySelector(`[data-schedule-id="${schedId}"]`);
        if (row) row.classList.remove('row-copied');
    }
    updateTotalsRow();
    updateEntryButtons();
}

function removeEntryRowByScheduleId(schedId) {
    const idx = state.entryRows.findIndex(r => r.scheduleId === schedId);
    if (idx !== -1) {
        state.entryRows.splice(idx, 1);
        rebuildTimeEntryTable();
        updateTotalsRow();
        updateEntryButtons();
    }
}

function rebuildTimeEntryTable() {
    const tbody = document.getElementById('time-entry-body');
    tbody.innerHTML = '';
    if (!state.entryRows.length) {
        clearTimeEntryTable();
        return;
    }
    state.entryRows.forEach((rowData, i) => addTimeEntryRow(rowData, i));
}

function updateRowTotal(rowIndex) {
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const total = days.reduce((s, d) => s + (state.entryRows[rowIndex][d] || 0), 0);
    const cell = document.getElementById(`row-total-${rowIndex}`);
    if (cell) cell.textContent = total > 0 ? total.toFixed(1) : '—';
}

function updateTotalsRow() {
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    let grandTotal = 0;
    days.forEach(d => {
        const dayTotal = state.entryRows.reduce((s, r) => s + (r[d] || 0), 0);
        const cell = document.getElementById(`total-${d}`);
        if (cell) cell.textContent = dayTotal > 0 ? dayTotal.toFixed(1) : '0.0';
        grandTotal += dayTotal;
    });
    const allCell = document.getElementById('total-all');
    if (allCell) allCell.textContent = grandTotal.toFixed(1);
}

function hasNotes(notes) {
    if (!notes) return false;
    const n = typeof notes === 'string' ? JSON.parse(notes) : notes;
    return Object.values(n).some(v => v && v.trim() !== '');
}

function updateEntryButtons() {
    const hasRows = state.entryRows.length > 0;
    document.getElementById('save-btn').disabled = !hasRows || state.isSubmitted;
    document.getElementById('submit-btn').disabled = !hasRows || state.isSubmitted;

    const badge = document.getElementById('submission-status-badge');
    if (state.isSubmitted) {
        badge.className = 'submission-badge badge-submitted';
        badge.textContent = '✓ Submitted';
        badge.classList.remove('hidden');
    } else if (hasRows) {
        badge.className = 'submission-badge badge-pending';
        badge.textContent = '● Draft';
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// ── Clear entries button ──────────────────────────────────────────────────────
document.getElementById('clear-entries-btn').addEventListener('click', async () => {
    if (!state.entryRows.length) return;
    const ok = await confirm('Clear Time Entries', 'Remove all rows from the time entry table? Unsaved changes will be lost.');
    if (!ok) return;
    clearTimeEntryTable();
    markCopiedSchedules();
});

// ═══════════════════════════════════════════════ SAVE & SUBMIT

document.getElementById('save-btn').addEventListener('click', saveTimeEntries);
document.getElementById('submit-btn').addEventListener('click', async () => {
    const ok = await confirm('Submit Timesheet', 'Submitting will lock all entries for this week. This action cannot be undone. Continue?');
    if (!ok) return;
    await saveTimeEntries(true);
});

async function saveTimeEntries(andSubmit = false) {
    if (!state.weekEnding) {
        showToast('Please select a week ending date.', 'warning');
        return;
    }
    if (!state.entryRows.length) {
        showToast('No time entry rows to save.', 'warning');
        return;
    }

    const btn = andSubmit ? document.getElementById('submit-btn') : document.getElementById('save-btn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${andSubmit ? 'Submitting...' : 'Saving...'}`;

    try {
        let lastEntryId = null;

        for (let i = 0; i < state.entryRows.length; i++) {
            const row = state.entryRows[i];
            const saved = await api('POST', '/api/timeentries', {
                scheduleId: row.scheduleId,
                weekEnding: state.weekEnding,
                mon: row.mon, tue: row.tue, wed: row.wed, thu: row.thu,
                fri: row.fri, sat: row.sat, sun: row.sun,
                notes: row.notes
            });
            state.entryRows[i].entryId = saved.id;
            lastEntryId = saved.id;

            if (andSubmit) {
                await api('PATCH', `/api/timeentries/${saved.id}/submit`);
                state.entryRows[i].isSubmitted = true;
            }
        }

        if (andSubmit) {
            state.isSubmitted = true;
            showToast('Timesheet submitted successfully! All entries are now locked.', 'success', 5000);
            rebuildTimeEntryTable();
        } else {
            showToast('Time entries saved successfully!');
        }

        state.currentEntryId = lastEntryId;
        updateEntryButtons();
    } catch (err) {
        showToast(`Failed to save: ${err.message}`, 'error');
    } finally {
        const label = andSubmit ? '<i class="fas fa-paper-plane"></i> Submit' : '<i class="fas fa-save"></i> Save';
        btn.innerHTML = label;
        updateEntryButtons();
    }
}

// ═══════════════════════════════════════════════ NOTES MODAL

function openNotesModal(rowIndex) {
    const row = state.entryRows[rowIndex];
    if (!row) return;

    state.notesTarget = { rowIndex };
    document.getElementById('modal-project-title').textContent = row.projectTitle;

    const days = ['mon', 'tue', 'wed', 'thu', 'fri'];
    days.forEach(d => {
        const ta = document.getElementById(`note-${d}`);
        ta.value = row.notes?.[d] || '';
        ta.disabled = row.isSubmitted;
    });

    document.getElementById('save-notes-btn').disabled = row.isSubmitted;
    document.getElementById('notes-modal').classList.remove('hidden');
}

document.getElementById('close-modal-btn').addEventListener('click', closeNotesModal);
document.getElementById('cancel-notes-btn').addEventListener('click', closeNotesModal);

document.getElementById('notes-modal').addEventListener('click', e => {
    if (e.target === document.getElementById('notes-modal')) closeNotesModal();
});

function closeNotesModal() {
    document.getElementById('notes-modal').classList.add('hidden');
    state.notesTarget = null;
}

document.getElementById('save-notes-btn').addEventListener('click', async () => {
    if (!state.notesTarget) return;
    const { rowIndex } = state.notesTarget;
    const row = state.entryRows[rowIndex];

    const notes = {
        mon: document.getElementById('note-mon').value,
        tue: document.getElementById('note-tue').value,
        wed: document.getElementById('note-wed').value,
        thu: document.getElementById('note-thu').value,
        fri: document.getElementById('note-fri').value,
        sat: row.notes?.sat || '',
        sun: row.notes?.sun || ''
    };

    // If entry already saved to DB, update notes via API
    if (row.entryId) {
        try {
            await api('PATCH', `/api/timeentries/${row.entryId}/notes`, { notes });
            showToast('Notes saved to server');
        } catch (err) {
            showToast(`Could not save to server: ${err.message}`, 'warning');
        }
    } else {
        showToast('Notes saved locally (will persist on next Save)');
    }

    state.entryRows[rowIndex].notes = notes;

    // Update notes button indicator
    const notesBtn = document.querySelector(`.btn-notes[data-row="${rowIndex}"]`);
    if (notesBtn) notesBtn.classList.toggle('has-notes', hasNotes(notes));

    closeNotesModal();
});

// ── ESC key closes modals ─────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.getElementById('notes-modal').classList.add('hidden');
        document.getElementById('confirm-modal').classList.add('hidden');
    }
});

// ── Utility ───────────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
