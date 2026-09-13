(() => {
  'use strict';

  /* ── CONSTANTS & STORAGE KEYS ── */
  const STORAGE_KEY = 'mytrack_logs';
  const DELETED_KEY = 'mytrack_logs_deleted';

  /* ── STATE ── */
  const state = {
    logs: [],
    deletedLogIds: []
  };

  let searchQuery = '';
  let editingLogId = null;

  /* ── DOM SELECTORS ── */
  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  /* ── DATE & TIME UTILS ── */
  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function dateStr(d = new Date()) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function todayStr() {
    return dateStr(new Date());
  }

  function yesterdayStr() {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return dateStr(d);
  }

  function formatTime(d = new Date()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
  }

  function formatDayBadge(ds) {
    if (ds === todayStr()) return 'Today';
    if (ds === yesterdayStr()) return 'Yesterday';

    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatLogText(text) {
    const escaped = escapeHtml(text);
    // Linkify URLs
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return escaped.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  }

  /* ── TOAST NOTIFICATIONS ── */
  function showToast(msg, type = 'info', dur = 2800) {
    const cont = $('#toastContainer');
    if (!cont) return;
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const t = document.createElement('div');
    t.className = `toast toast--${type}`;
    t.innerHTML = `<span class="toast__icon">${icons[type]}</span><span class="toast__message">${escapeHtml(msg)}</span>`;
    cont.appendChild(t);
    setTimeout(() => {
      t.classList.add('toast--out');
      setTimeout(() => t.remove(), 250);
    }, dur);
  }

  /* ── PERSISTENCE & MERGE SYNC ── */
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.logs));
    localStorage.setItem(DELETED_KEY, JSON.stringify(state.deletedLogIds));

    if (window.db && window.db.isConfigured()) {
      window.db.saveDocument('mytrack_data', 'logs_state', {
        logs: state.logs,
        deletedLogIds: state.deletedLogIds,
        lastSyncedAt: Date.now()
      }).catch(e => console.warn('Logs cloud sync pending:', e));
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state.logs = JSON.parse(raw);
      const del = localStorage.getItem(DELETED_KEY);
      if (del) state.deletedLogIds = JSON.parse(del);
    } catch (e) {
      console.warn('Failed to load local logs:', e);
    }

    if (window.db) {
      window.db.registerSyncHandler('logs_state', async (remote) => {
        if (!remote || !window.mergeLogsState) return;
        const merged = window.mergeLogsState(
          { logs: state.logs, deletedLogIds: state.deletedLogIds },
          remote
        );
        state.logs = merged.logs || [];
        state.deletedLogIds = merged.deletedLogIds || [];

        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.logs));
        localStorage.setItem(DELETED_KEY, JSON.stringify(state.deletedLogIds));

        if (window.db.isConfigured() && navigator.onLine) {
          await window.db.saveDocument('mytrack_data', 'logs_state', merged).catch(() => { });
        }
        renderLogs();
      });

      if (window.db.isConfigured() && navigator.onLine) {
        window.db.triggerAllSync();
      }
    }
  }

  /* ── LOG OPERATIONS ── */
  function addLog(text, chosenDate) {
    const trimmed = text.trim();
    if (!trimmed) return;

    const now = new Date();
    const ds = chosenDate || todayStr();

    let timestamp;
    if (ds === todayStr()) {
      timestamp = now.getTime();
    } else {
      const [y, m, d] = ds.split('-').map(Number);
      const customDate = new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
      timestamp = customDate.getTime();
    }

    const newLog = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      text: trimmed,
      createdAt: timestamp,
      dateStr: ds,
      timeStr: formatTime(now),
      updatedAt: Date.now()
    };

    state.logs.push(newLog);
    saveState();
    renderLogs();

    // Scroll to the added log or day group
    const feed = $('#logsFeed');
    if (feed) {
      requestAnimationFrame(() => {
        const addedGroup = document.querySelector(`.log-day-group[data-date="${ds}"]`);
        if (addedGroup) {
          addedGroup.scrollIntoView({ behavior: 'smooth', block: 'end' });
        } else {
          feed.scrollTop = feed.scrollHeight;
        }
      });
    }

    showToast('Log added!', 'success');
  }

  function updateLog(id, newText, chosenDate) {
    const trimmed = newText.trim();
    if (!trimmed) return;

    const log = state.logs.find(l => String(l.id) === String(id));
    if (!log) return;

    log.text = trimmed;
    if (chosenDate) {
      log.dateStr = chosenDate;
      const [y, m, d] = chosenDate.split('-').map(Number);
      const prevDate = log.createdAt ? new Date(log.createdAt) : new Date();
      const updatedDate = new Date(y, m - 1, d, prevDate.getHours(), prevDate.getMinutes(), prevDate.getSeconds());
      log.createdAt = updatedDate.getTime();
    }
    log.updatedAt = Date.now();
    saveState();
    renderLogs();
    showToast('Log updated!', 'success');
  }

  function deleteLog(id) {
    if (!id) return;
    const idStr = String(id);
    const logIndex = state.logs.findIndex(l => String(l.id) === idStr);
    if (logIndex === -1) {
      console.warn('Log not found for deletion:', id);
      return;
    }

    if (!confirm('Delete this log entry?')) return;

    state.logs.splice(logIndex, 1);
    if (!state.deletedLogIds) state.deletedLogIds = [];
    state.deletedLogIds.push({ id: idStr, deletedAt: Date.now() });

    saveState();
    renderLogs();
    showToast('Log deleted', 'info');
  }

  function copyLog(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!', 'success');
      }).catch(() => {
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showToast('Copied to clipboard!', 'success');
    } catch (e) {
      showToast('Could not copy text', 'error');
    }
    document.body.removeChild(ta);
  }

  /* ── RENDER ENGINE ── */
  function getFilteredLogs() {
    if (!searchQuery) return state.logs;
    const q = searchQuery.toLowerCase();
    return state.logs.filter(l => l.text.toLowerCase().includes(q));
  }

  function renderLogs() {
    const feed = $('#logsFeed');
    if (!feed) return;

    const logs = getFilteredLogs();

    if (state.logs.length === 0) {
      feed.innerHTML = `
        <div class="logs-empty">
          <div class="logs-empty__icon">📝</div>
          <h3 class="logs-empty__title">Your Daily Logbook</h3>
          <p class="logs-empty__text">Capture your thoughts, activities, and reflections. Every entry records the exact time and day automatically!</p>
        </div>
      `;
      return;
    }

    if (logs.length === 0) {
      feed.innerHTML = `
        <div class="logs-empty">
          <div class="logs-empty__icon">🔍</div>
          <h3 class="logs-empty__title">No matching logs</h3>
          <p class="logs-empty__text">No logs matched "${escapeHtml(searchQuery)}". Try another search keyword.</p>
        </div>
      `;
      return;
    }

    // Group logs by dateStr
    const groups = {};
    logs.forEach(log => {
      const ds = log.dateStr || (log.createdAt ? dateStr(new Date(log.createdAt)) : todayStr());
      if (!groups[ds]) groups[ds] = [];
      groups[ds].push(log);
    });

    // Sort dates ascending
    const sortedDates = Object.keys(groups).sort();

    let html = '';
    sortedDates.forEach(ds => {
      const dayLogs = groups[ds].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      const isToday = ds === todayStr();
      const badgeText = formatDayBadge(ds);

      html += `
        <div class="log-day-group" data-date="${ds}">
          <div class="log-day-divider">
            <span class="log-day-badge ${isToday ? 'today' : ''}">${badgeText}</span>
          </div>
          ${dayLogs.map(log => renderLogRow(log)).join('')}
        </div>
      `;
    });

    feed.innerHTML = html;
  }

  function renderLogRow(log) {
    const formattedText = formatLogText(log.text);
    const time = log.timeStr || (log.createdAt ? formatTime(new Date(log.createdAt)) : '');
    const logId = String(log.id);

    return `
      <div class="log-row" id="row-${logId}" data-id="${logId}">
        <div class="log-item-track">
          <div class="log-bubble-container">
            <div class="log-bubble"><div class="log-text">${formattedText}</div></div>
            <div class="log-actions" onclick="event.stopPropagation()">
              <button type="button" class="log-action-btn" data-action="copy" data-id="${logId}" title="Copy" aria-label="Copy">📋</button>
              <button type="button" class="log-action-btn" data-action="edit" data-id="${logId}" title="Edit" aria-label="Edit">✏️</button>
              <button type="button" class="log-action-btn delete" data-action="delete" data-id="${logId}" title="Delete" aria-label="Delete">🗑️</button>
            </div>
          </div>
        </div>
        <div class="log-time-reveal" aria-hidden="true">
          <span class="log-time-text">${time}</span>
        </div>
      </div>
    `;
  }

  /* ── GESTURE & INTERACTION ENGINE (PER-ROW SWIPE & DIRECT TAP SELECTION) ── */
  function initInstagramSwipeGesture() {
    const feed = $('#logsFeed');
    if (!feed) return;

    let activeRow = null;
    let isDragging = false;
    let isGestureLocked = false;
    let startX = 0;
    let startY = 0;
    let initialX = 0;
    let currentX = 0;

    const REVEAL_WIDTH = 75; // px to reveal timestamp

    function clearSelection() {
      $$('.log-row.is-selected').forEach(r => r.classList.remove('is-selected'));
    }

    function clearOtherRevealed(exceptRow) {
      $$('.log-row.is-revealed').forEach(r => {
        if (r !== exceptRow) {
          r.classList.remove('is-revealed');
          r.style.removeProperty('--row-drag-x');
        }
      });
    }

    function onPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;

      // Click on buttons or inputs should not trigger row drag
      if (e.target.closest('button, a, input, textarea, .log-actions')) return;

      const row = e.target.closest('.log-row');
      if (!row) {
        clearSelection();
        return;
      }

      clearOtherRevealed(row);

      activeRow = row;
      isDragging = false;
      isGestureLocked = false;
      startX = e.clientX;
      startY = e.clientY;
      initialX = row.classList.contains('is-revealed') ? -REVEAL_WIDTH : 0;
      currentX = initialX;
    }

    function onPointerMove(e) {
      if (!activeRow) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      // Determine gesture direction
      if (!isGestureLocked) {
        if (Math.abs(deltaY) > 8 && Math.abs(deltaY) > Math.abs(deltaX)) {
          // Vertical scroll detected; abandon horizontal drag
          activeRow = null;
          return;
        }

        if (Math.abs(deltaX) > 8 && Math.abs(deltaX) >= Math.abs(deltaY)) {
          isGestureLocked = true;
          isDragging = true;
          clearSelection();
          activeRow.classList.add('is-dragging');
          try {
            if (activeRow.setPointerCapture) activeRow.setPointerCapture(e.pointerId);
          } catch (err) { }
        }
      }

      if (!isDragging || !activeRow) return;

      if (e.cancelable) e.preventDefault();

      let targetX = initialX + deltaX;

      // Clamping with slight resistance
      if (targetX > 0) {
        targetX = targetX * 0.12;
      } else if (targetX < -REVEAL_WIDTH) {
        const extra = targetX + REVEAL_WIDTH;
        targetX = -REVEAL_WIDTH + extra * 0.22;
      }

      currentX = targetX;
      activeRow.style.setProperty('--row-drag-x', `${targetX}px`);
    }

    function onPointerUp(e) {
      if (!activeRow) return;

      const row = activeRow;
      activeRow = null;

      if (isDragging) {
        isDragging = false;
        row.classList.remove('is-dragging');
        try {
          if (row.releasePointerCapture && e.pointerId) {
            row.releasePointerCapture(e.pointerId);
          }
        } catch (err) { }

        // Sticky snap logic: stays in place until dragged back
        if (initialX === 0) {
          // Started closed: drag left past halfway snaps open
          if (currentX < -32) {
            row.classList.add('is-revealed');
          } else {
            row.classList.remove('is-revealed');
          }
        } else {
          // Started open: drag right past halfway closes it
          if (currentX > -42) {
            row.classList.remove('is-revealed');
          } else {
            row.classList.add('is-revealed');
          }
        }

        row.style.removeProperty('--row-drag-x');
      } else {
        // Direct click/tap on the log: toggle options immediately!
        if (row.classList.contains('is-revealed')) {
          row.classList.remove('is-revealed');
          row.style.removeProperty('--row-drag-x');
        } else if (row.classList.contains('is-selected')) {
          row.classList.remove('is-selected');
        } else {
          clearSelection();
          row.classList.add('is-selected');
        }
      }
    }

    // Right-click / context menu triggers selection for desktop convenience
    feed.addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.log-row');
      if (row) {
        e.preventDefault();
        clearSelection();
        row.classList.add('is-selected');
      }
    });

    // Dismiss selection on click outside
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.log-row.is-selected')) {
        clearSelection();
      }
    });

    // Direct click handler for action buttons
    feed.addEventListener('click', (e) => {
      const btn = e.target.closest('.log-action-btn');
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!id) return;

      clearSelection();

      if (action === 'delete') {
        deleteLog(id);
      } else if (action === 'edit') {
        if (window.__editLog) window.__editLog(id, e);
      } else if (action === 'copy') {
        if (window.__copyLog) window.__copyLog(id, e);
      }
    });

    feed.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  /* ── INPUT & MODAL LISTENERS ── */
  function initInputAndEvents() {
    const btnAddLog = $('#btnAddLog');
    const searchInput = $('#logSearchInput');
    const clearBtn = $('#logSearchClear');

    const logModal = $('#logModal');
    const modalTitle = $('#logModalTitle');
    const modalDate = $('#modalLogDate');
    const modalText = $('#modalLogText');
    const btnSaveLog = $('#btnSaveLog');
    const btnCancelLog = $('#btnCancelLog');
    const logModalClose = $('#logModalClose');

    function openNewLogModal() {
      editingLogId = null;
      if (modalTitle) modalTitle.textContent = 'New Log';
      if (modalDate) modalDate.value = todayStr();
      if (modalText) {
        modalText.value = '';
        modalText.placeholder = 'Write a log, reflection, or note...';
      }
      if (logModal) logModal.classList.add('open');
      setTimeout(() => { if (modalText) modalText.focus(); }, 200);
    }

    function closeLogModal() {
      if (logModal) logModal.classList.remove('open');
      editingLogId = null;
    }

    if (btnAddLog) {
      btnAddLog.addEventListener('click', openNewLogModal);
    }

    if (btnSaveLog) {
      btnSaveLog.addEventListener('click', () => {
        if (!modalText) return;
        const val = modalText.value.trim();
        if (!val) {
          modalText.style.boxShadow = 'var(--neu-inset), 0 0 0 2px rgba(248, 113, 113, 0.5)';
          setTimeout(() => { modalText.style.boxShadow = ''; }, 1200);
          showToast('Please enter log text', 'error');
          return;
        }

        const chosenDate = modalDate && modalDate.value ? modalDate.value : todayStr();

        if (editingLogId) {
          updateLog(editingLogId, val, chosenDate);
        } else {
          addLog(val, chosenDate);
        }
        closeLogModal();
      });
    }

    // Shortcut: Ctrl+Enter or Cmd+Enter to save from modal
    if (modalText) {
      modalText.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          if (btnSaveLog) btnSaveLog.click();
        }
      });
    }

    if (btnCancelLog) btnCancelLog.addEventListener('click', closeLogModal);
    if (logModalClose) logModalClose.addEventListener('click', closeLogModal);
    if (logModal) {
      logModal.addEventListener('click', (e) => {
        if (e.target === logModal) closeLogModal();
      });
    }

    // Search bar
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        searchQuery = searchInput.value.trim();
        if (clearBtn) {
          clearBtn.style.display = searchQuery ? 'block' : 'none';
        }
        renderLogs();
      });
    }

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (searchInput) searchInput.value = '';
        searchQuery = '';
        clearBtn.style.display = 'none';
        renderLogs();
        if (searchInput) searchInput.focus();
      });
    }

    // Global action dispatchers
    window.__copyLog = function (id, e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const log = state.logs.find(l => String(l.id) === String(id));
      if (log) copyLog(log.text);
      $$('.log-row.is-selected').forEach(r => r.classList.remove('is-selected'));
    };

    window.__editLog = function (id, e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const log = state.logs.find(l => String(l.id) === String(id));
      if (!log || !logModal || !modalText) return;

      editingLogId = String(id);
      if (modalTitle) modalTitle.textContent = 'Edit Log';
      if (modalDate) {
        modalDate.value = log.dateStr || (log.createdAt ? dateStr(new Date(log.createdAt)) : todayStr());
      }
      modalText.value = log.text;
      logModal.classList.add('open');
      $$('.log-row.is-selected').forEach(r => r.classList.remove('is-selected'));
      setTimeout(() => modalText.focus(), 200);
    };

    window.__deleteLog = function (id, e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      $$('.log-row.is-selected').forEach(r => r.classList.remove('is-selected'));
      deleteLog(id);
    };
  }

  /* ── INITIALIZATION ── */
  function init() {
    loadState();
    renderLogs();
    initInstagramSwipeGesture();
    initInputAndEvents();

    // Scroll to bottom on initial load
    const feed = $('#logsFeed');
    if (feed) {
      setTimeout(() => {
        feed.scrollTop = feed.scrollHeight;
      }, 100);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
