(() => {
  'use strict';

  /* ── CONSTANTS & STORAGE KEYS ── */
  const STORAGE_KEY = 'mytrack_logs';
  const DELETED_KEY = 'mytrack_logs_deleted';
  const ORDERED_KEY = 'mytrack_logs_ordered';

  /* ── STATE ── */
  const state = {
    logs: [],
    deletedLogIds: []
  };

  let searchQuery = '';
  let editingLogId = null;

  /* ── DATE FILTER STATE ── */
  let dateFilter = {
    from: '',
    to: '',
    preset: 'all' // 'today' | 'yesterday' | 'week' | 'all' | 'custom'
  };

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

  function weekStartStr() {
    const now = new Date();
    const startOfWeek = new Date(now);
    const day = startOfWeek.getDay();
    const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Monday
    startOfWeek.setDate(diff);
    return dateStr(startOfWeek);
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
  function showToast(msg, type = 'info', dur = 2200) {
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

    // Preserve initial chronological order on very first run before any manual dragging
    const hasOrderFlag = localStorage.getItem(ORDERED_KEY);
    if (!hasOrderFlag && state.logs.length > 0) {
      state.logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      localStorage.setItem(ORDERED_KEY, 'true');
      saveState();
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
      updatedAt: Date.now()
    };

    state.logs.unshift(newLog);
    localStorage.setItem(ORDERED_KEY, 'true');
    saveState();
    renderLogs();

    // Scroll smoothly to newly added log or top
    requestAnimationFrame(() => {
      const addedRow = document.getElementById(`row-${newLog.id}`);
      if (addedRow) {
        addedRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });

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

  function openEditLogModal(id) {
    const log = state.logs.find(l => String(l.id) === String(id));
    const logModal = $('#logModal');
    const modalTitle = $('#logModalTitle');
    const modalDate = $('#modalLogDate');
    const modalText = $('#modalLogText');

    if (!log || !logModal || !modalText) return;

    editingLogId = String(id);
    if (modalTitle) modalTitle.textContent = 'Edit Log';
    if (modalDate) {
      modalDate.value = log.dateStr || (log.createdAt ? dateStr(new Date(log.createdAt)) : todayStr());
    }
    modalText.value = log.text;
    logModal.classList.add('open');
    setTimeout(() => { if (modalText) modalText.focus(); }, 200);
  }

  /* ── REORDERING LOGIC ── */
  function reorderLogs(sourceId, targetId, insertBefore, targetDate) {
    if (!sourceId || !targetId || sourceId === targetId) return;

    const sourceIdx = state.logs.findIndex(l => String(l.id) === String(sourceId));
    if (sourceIdx === -1) return;

    const [sourceLog] = state.logs.splice(sourceIdx, 1);

    // If moved into a different day group, update its dateStr
    if (targetDate && sourceLog.dateStr !== targetDate) {
      sourceLog.dateStr = targetDate;
      const [y, m, d] = targetDate.split('-').map(Number);
      const prevDate = sourceLog.createdAt ? new Date(sourceLog.createdAt) : new Date();
      const newDate = new Date(y, m - 1, d, prevDate.getHours(), prevDate.getMinutes(), prevDate.getSeconds());
      sourceLog.createdAt = newDate.getTime();
      sourceLog.updatedAt = Date.now();
    }

    const targetIdx = state.logs.findIndex(l => String(l.id) === String(targetId));
    if (targetIdx === -1) {
      state.logs.push(sourceLog);
    } else {
      const insertIdx = insertBefore ? targetIdx : targetIdx + 1;
      state.logs.splice(insertIdx, 0, sourceLog);
    }

    localStorage.setItem(ORDERED_KEY, 'true');
    saveState();
    renderLogs();
    showToast('Logs reordered', 'success', 1200);
  }

  function moveLogToDate(sourceId, targetDate) {
    if (!sourceId || !targetDate) return;
    const sourceIdx = state.logs.findIndex(l => String(l.id) === String(sourceId));
    if (sourceIdx === -1) return;

    const [sourceLog] = state.logs.splice(sourceIdx, 1);
    sourceLog.dateStr = targetDate;
    const [y, m, d] = targetDate.split('-').map(Number);
    const prevDate = sourceLog.createdAt ? new Date(sourceLog.createdAt) : new Date();
    const newDate = new Date(y, m - 1, d, prevDate.getHours(), prevDate.getMinutes(), prevDate.getSeconds());
    sourceLog.createdAt = newDate.getTime();
    sourceLog.updatedAt = Date.now();

    // Insert at beginning of that date in state.logs
    const firstOfDateIdx = state.logs.findIndex(l => (l.dateStr || dateStr(new Date(l.createdAt))) === targetDate);
    if (firstOfDateIdx !== -1) {
      state.logs.splice(firstOfDateIdx, 0, sourceLog);
    } else {
      let insertIdx = state.logs.findIndex(l => {
        const ds = l.dateStr || dateStr(new Date(l.createdAt));
        return targetDate.localeCompare(ds) > 0;
      });
      if (insertIdx === -1) insertIdx = state.logs.length;
      state.logs.splice(insertIdx, 0, sourceLog);
    }

    localStorage.setItem(ORDERED_KEY, 'true');
    saveState();
    renderLogs();
    showToast('Log moved to ' + formatDayBadge(targetDate), 'success', 1200);
  }

  /* ── FILTER & SEARCH LOGIC ── */
  function isDateFilterActive() {
    return Boolean(dateFilter.from || dateFilter.to || (dateFilter.preset && dateFilter.preset !== 'all'));
  }

  function updateFilterUi() {
    const filterBtn = $('#btnFilterLogs');
    const filterBadge = $('#logFilterBadge');
    const activeBar = $('#logsActiveFilterBar');
    const activeText = $('#logsActiveFilterText');

    const active = isDateFilterActive();

    if (filterBtn) {
      filterBtn.classList.toggle('active', active);
    }
    if (filterBadge) {
      filterBadge.style.display = active ? 'inline-block' : 'none';
    }

    if (activeBar && activeText) {
      if (active) {
        activeBar.style.display = 'flex';
        if (dateFilter.preset === 'today') {
          activeText.textContent = 'Showing logs for: Today';
        } else if (dateFilter.preset === 'yesterday') {
          activeText.textContent = 'Showing logs for: Yesterday';
        } else if (dateFilter.preset === 'week') {
          activeText.textContent = 'Showing logs for: This Week';
        } else if (dateFilter.from && !dateFilter.to) {
          activeText.textContent = `Showing logs for: ${formatDayBadge(dateFilter.from)}`;
        } else if (dateFilter.from && dateFilter.to) {
          if (dateFilter.from === dateFilter.to) {
            activeText.textContent = `Showing logs for: ${formatDayBadge(dateFilter.from)}`;
          } else {
            activeText.textContent = `Showing logs: ${dateFilter.from} to ${dateFilter.to}`;
          }
        } else if (!dateFilter.from && dateFilter.to) {
          activeText.textContent = `Showing logs up to: ${dateFilter.to}`;
        }
      } else {
        activeBar.style.display = 'none';
      }
    }
  }

  function getFilteredLogs() {
    let list = state.logs;

    if (dateFilter.from && !dateFilter.to) {
      // User rule: if from date is selected only, then show for that day only
      list = list.filter(l => {
        const ds = l.dateStr || (l.createdAt ? dateStr(new Date(l.createdAt)) : '');
        return ds === dateFilter.from;
      });
    } else if (dateFilter.from && dateFilter.to) {
      list = list.filter(l => {
        const ds = l.dateStr || (l.createdAt ? dateStr(new Date(l.createdAt)) : '');
        return ds >= dateFilter.from && ds <= dateFilter.to;
      });
    } else if (!dateFilter.from && dateFilter.to) {
      list = list.filter(l => {
        const ds = l.dateStr || (l.createdAt ? dateStr(new Date(l.createdAt)) : '');
        return ds <= dateFilter.to;
      });
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(l => l.text.toLowerCase().includes(q));
    }

    return list;
  }

  function renderLogs() {
    updateFilterUi();

    const feed = $('#logsFeed');
    if (!feed) return;

    const logs = getFilteredLogs();

    if (state.logs.length === 0) {
      feed.innerHTML = `
        <div class="logs-empty">
          <div class="logs-empty__icon">📝</div>
          <h3 class="logs-empty__title">Your Daily Logbook</h3>
          <p class="logs-empty__text">Capture your thoughts, activities, and reflections. Reorder entries anytime by dragging them!</p>
        </div>
      `;
      return;
    }

    if (logs.length === 0) {
      feed.innerHTML = `
        <div class="logs-empty">
          <div class="logs-empty__icon">🔍</div>
          <h3 class="logs-empty__title">No matching logs</h3>
          <p class="logs-empty__text">${searchQuery ? `No logs matched "${escapeHtml(searchQuery)}". Try another search keyword.` : `No logs found for the selected date filter.`}</p>
        </div>
      `;
      return;
    }

    // Group logs by dateStr while preserving custom sequence
    const groups = {};
    logs.forEach(log => {
      const ds = log.dateStr || (log.createdAt ? dateStr(new Date(log.createdAt)) : todayStr());
      if (!groups[ds]) groups[ds] = [];
      groups[ds].push(log);
    });

    // Sort dates DESCENDING: Today at top, then Yesterday, then older dates descending
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    let html = '';
    sortedDates.forEach(ds => {
      // Custom order within day is preserved
      const dayLogs = groups[ds];
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
    const logId = String(log.id);

    return `
      <div class="log-card" id="row-${logId}" data-id="${logId}" draggable="true">
        <div class="log-card__header">
          <div class="log-drag-handle" title="Drag to reorder" aria-label="Drag to reorder">
            <span class="log-drag-icon">⠿</span>
          </div>
          <div class="log-card__actions">
            <button type="button" class="log-action-btn" data-action="copy" data-id="${logId}" title="Copy" aria-label="Copy">📋</button>
            <button type="button" class="log-action-btn" data-action="edit" data-id="${logId}" title="Edit" aria-label="Edit">✏️</button>
            <button type="button" class="log-action-btn del" data-action="delete" data-id="${logId}" title="Delete" aria-label="Delete">🗑️</button>
          </div>
        </div>
        <div class="log-card__text">${formattedText}</div>
      </div>
    `;
  }

  /* ── FEED INTERACTIONS ── */
  function initFeedInteractions() {
    const feed = $('#logsFeed');
    if (!feed) return;

    feed.addEventListener('click', (e) => {
      const btn = e.target.closest('.log-action-btn');
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (!id) return;

      if (action === 'delete') {
        deleteLog(id);
      } else if (action === 'edit') {
        openEditLogModal(id);
      } else if (action === 'copy') {
        const log = state.logs.find(l => String(l.id) === String(id));
        if (log) copyLog(log.text);
      }
    });
  }

  /* ── DESKTOP DRAG & DROP ENGINE ── */
  function initDesktopDrag() {
    const feed = $('#logsFeed');
    if (!feed) return;

    let draggedId = null;

    feed.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.log-card');
      if (!card) return;

      // Don't drag if clicking buttons or links
      if (e.target.closest('.log-action-btn, button, a, input, textarea')) {
        e.preventDefault();
        return;
      }

      draggedId = card.dataset.id;
      card.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedId);
    });

    feed.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      const targetCard = e.target.closest('.log-card');
      if (!targetCard || targetCard.dataset.id === draggedId) return;

      const rect = targetCard.getBoundingClientRect();
      const isTop = e.clientY < rect.top + rect.height / 2;

      targetCard.classList.toggle('drag-over-top', isTop);
      targetCard.classList.toggle('drag-over-bottom', !isTop);
    });

    feed.addEventListener('dragleave', (e) => {
      const targetCard = e.target.closest('.log-card');
      if (targetCard) {
        targetCard.classList.remove('drag-over-top', 'drag-over-bottom');
      }
    });

    feed.addEventListener('drop', (e) => {
      e.preventDefault();

      const targetCard = e.target.closest('.log-card');
      const targetGroup = e.target.closest('.log-day-group');
      const targetDate = targetGroup ? targetGroup.dataset.date : null;

      if (targetCard && draggedId && targetCard.dataset.id !== draggedId) {
        const rect = targetCard.getBoundingClientRect();
        const insertBefore = e.clientY < rect.top + rect.height / 2;
        reorderLogs(draggedId, targetCard.dataset.id, insertBefore, targetDate);
      } else if (targetGroup && draggedId) {
        moveLogToDate(draggedId, targetDate);
      }

      cleanupDragState();
    });

    feed.addEventListener('dragend', () => {
      cleanupDragState();
    });

    function cleanupDragState() {
      draggedId = null;
      $$('.is-dragging, .drag-over-top, .drag-over-bottom, .drag-over-group').forEach(el => {
        el.classList.remove('is-dragging', 'drag-over-top', 'drag-over-bottom', 'drag-over-group');
      });
    }
  }

  /* ── TOUCH & POINTER DRAG & DROP ENGINE (MOBILE) ── */
  function initTouchDrag() {
    const feed = $('#logsFeed');
    if (!feed) return;

    let touchCard = null;
    let touchSourceId = null;
    let initialY = 0;
    let initialX = 0;
    let isTouchDragging = false;
    let ghostEl = null;

    feed.addEventListener('pointerdown', (e) => {
      // Desktop mouse uses native HTML5 drag
      if (e.pointerType === 'mouse') return;

      const handle = e.target.closest('.log-drag-handle');
      if (!handle) return;

      const card = handle.closest('.log-card');
      if (!card) return;

      touchCard = card;
      touchSourceId = card.dataset.id;
      initialX = e.clientX;
      initialY = e.clientY;
      isTouchDragging = false;
    });

    window.addEventListener('pointermove', (e) => {
      if (!touchCard) return;

      const dy = e.clientY - initialY;
      const dx = e.clientX - initialX;

      if (!isTouchDragging) {
        if (Math.abs(dy) > 6 || Math.abs(dx) > 6) {
          isTouchDragging = true;
          touchCard.classList.add('is-dragging');

          ghostEl = touchCard.cloneNode(true);
          ghostEl.classList.add('log-card-touch-ghost');
          ghostEl.style.width = `${touchCard.offsetWidth}px`;
          ghostEl.style.left = `${touchCard.getBoundingClientRect().left}px`;
          ghostEl.style.top = `${e.clientY - 20}px`;
          document.body.appendChild(ghostEl);
        }
      }

      if (isTouchDragging && ghostEl) {
        if (e.cancelable) e.preventDefault();
        ghostEl.style.top = `${e.clientY - 20}px`;

        $$('.drag-over-top, .drag-over-bottom, .drag-over-group').forEach(el => {
          el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-group');
        });

        ghostEl.style.display = 'none';
        const elUnder = document.elementFromPoint(e.clientX, e.clientY);
        ghostEl.style.display = 'flex';

        if (elUnder) {
          const targetCard = elUnder.closest('.log-card');
          if (targetCard && targetCard !== touchCard) {
            const rect = targetCard.getBoundingClientRect();
            const isTop = e.clientY < rect.top + rect.height / 2;
            targetCard.classList.toggle('drag-over-top', isTop);
            targetCard.classList.toggle('drag-over-bottom', !isTop);
          }
        }
      }
    }, { passive: false });

    function finishTouchDrag(e) {
      if (!touchCard) return;

      if (isTouchDragging && ghostEl) {
        ghostEl.style.display = 'none';
        const elUnder = document.elementFromPoint(e.clientX, e.clientY);
        if (ghostEl.parentNode) ghostEl.parentNode.removeChild(ghostEl);
        ghostEl = null;

        if (elUnder) {
          const targetCard = elUnder.closest('.log-card');
          if (targetCard && targetCard !== touchCard) {
            const rect = targetCard.getBoundingClientRect();
            const insertBefore = e.clientY < rect.top + rect.height / 2;
            const targetGroup = targetCard.closest('.log-day-group');
            const targetDate = targetGroup ? targetGroup.dataset.date : null;
            reorderLogs(touchSourceId, targetCard.dataset.id, insertBefore, targetDate);
          } else {
            const targetGroup = elUnder.closest('.log-day-group');
            if (targetGroup) {
              const targetDate = targetGroup.dataset.date;
              moveLogToDate(touchSourceId, targetDate);
            }
          }
        }
      }

      if (touchCard) {
        touchCard.classList.remove('is-dragging');
        touchCard = null;
      }
      touchSourceId = null;
      isTouchDragging = false;
      $$('.drag-over-top, .drag-over-bottom, .drag-over-group').forEach(el => {
        el.classList.remove('drag-over-top', 'drag-over-bottom', 'drag-over-group');
      });
    }

    window.addEventListener('pointerup', finishTouchDrag);
    window.addEventListener('pointercancel', finishTouchDrag);
  }

  /* ── INPUT & MODAL LISTENERS ── */
  function initInputAndEvents() {
    const btnAddLog = $('#btnAddLog');
    const searchInput = $('#logSearchInput');
    const clearBtn = $('#logSearchClear');

    // Filter Modal Elements
    const btnFilterLogs = $('#btnFilterLogs');
    const filterModal = $('#filterModal');
    const filterModalClose = $('#filterModalClose');
    const filterPresetChips = $('#filterPresetChips');
    const filterFromDate = $('#filterFromDate');
    const filterToDate = $('#filterToDate');
    const btnApplyFilter = $('#btnApplyFilter');
    const btnResetFilter = $('#btnResetFilter');
    const btnClearActiveFilter = $('#btnClearActiveFilter');

    // Add/Edit Log Modal Elements
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
          clearBtn.style.display = searchQuery ? 'flex' : 'none';
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

    /* ── DATE FILTER MODAL LISTENERS ── */
    function openFilterModal() {
      if (filterFromDate) filterFromDate.value = dateFilter.from || '';
      if (filterToDate) filterToDate.value = dateFilter.to || '';

      if (filterPresetChips) {
        filterPresetChips.querySelectorAll('.filter-preset-chip').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.preset === dateFilter.preset);
        });
      }

      if (filterModal) filterModal.classList.add('open');
    }

    function closeFilterModal() {
      if (filterModal) filterModal.classList.remove('open');
    }

    if (btnFilterLogs) {
      btnFilterLogs.addEventListener('click', openFilterModal);
    }

    if (filterModalClose) {
      filterModalClose.addEventListener('click', closeFilterModal);
    }

    if (filterModal) {
      filterModal.addEventListener('click', (e) => {
        if (e.target === filterModal) closeFilterModal();
      });
    }

    if (filterPresetChips) {
      filterPresetChips.addEventListener('click', (e) => {
        const chip = e.target.closest('.filter-preset-chip');
        if (!chip) return;

        const preset = chip.dataset.preset;
        filterPresetChips.querySelectorAll('.filter-preset-chip').forEach(b => {
          b.classList.toggle('active', b === chip);
        });

        if (preset === 'today') {
          if (filterFromDate) filterFromDate.value = todayStr();
          if (filterToDate) filterToDate.value = '';
        } else if (preset === 'yesterday') {
          if (filterFromDate) filterFromDate.value = yesterdayStr();
          if (filterToDate) filterToDate.value = '';
        } else if (preset === 'week') {
          if (filterFromDate) filterFromDate.value = weekStartStr();
          if (filterToDate) filterToDate.value = todayStr();
        } else if (preset === 'all') {
          if (filterFromDate) filterFromDate.value = '';
          if (filterToDate) filterToDate.value = '';
        }
      });
    }

    function onDateInputChange() {
      if (!filterPresetChips) return;
      const from = filterFromDate ? filterFromDate.value : '';
      const to = filterToDate ? filterToDate.value : '';

      let matchingPreset = '';
      if (!from && !to) matchingPreset = 'all';
      else if (from === todayStr() && !to) matchingPreset = 'today';
      else if (from === yesterdayStr() && !to) matchingPreset = 'yesterday';
      else if (from === weekStartStr() && to === todayStr()) matchingPreset = 'week';

      filterPresetChips.querySelectorAll('.filter-preset-chip').forEach(b => {
        b.classList.toggle('active', b.dataset.preset === matchingPreset);
      });
    }

    if (filterFromDate) filterFromDate.addEventListener('change', onDateInputChange);
    if (filterToDate) filterToDate.addEventListener('change', onDateInputChange);

    if (btnApplyFilter) {
      btnApplyFilter.addEventListener('click', () => {
        const from = filterFromDate ? filterFromDate.value : '';
        const to = filterToDate ? filterToDate.value : '';

        dateFilter.from = from;
        dateFilter.to = to;

        if (!from && !to) {
          dateFilter.preset = 'all';
        } else if (from === todayStr() && (!to || to === todayStr())) {
          dateFilter.preset = 'today';
        } else if (from === yesterdayStr() && (!to || to === yesterdayStr())) {
          dateFilter.preset = 'yesterday';
        } else if (from === weekStartStr() && to === todayStr()) {
          dateFilter.preset = 'week';
        } else {
          dateFilter.preset = 'custom';
        }

        closeFilterModal();
        renderLogs();
      });
    }

    if (btnResetFilter) {
      btnResetFilter.addEventListener('click', () => {
        dateFilter = { from: '', to: '', preset: 'all' };
        if (filterFromDate) filterFromDate.value = '';
        if (filterToDate) filterToDate.value = '';
        if (filterPresetChips) {
          filterPresetChips.querySelectorAll('.filter-preset-chip').forEach(b => {
            b.classList.toggle('active', b.dataset.preset === 'all');
          });
        }
        closeFilterModal();
        renderLogs();
      });
    }

    if (btnClearActiveFilter) {
      btnClearActiveFilter.addEventListener('click', () => {
        dateFilter = { from: '', to: '', preset: 'all' };
        renderLogs();
      });
    }

    // Global action dispatchers (for external/inline invocations)
    window.__copyLog = function (id, e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      const log = state.logs.find(l => String(l.id) === String(id));
      if (log) copyLog(log.text);
    };

    window.__editLog = function (id, e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      openEditLogModal(id);
    };

    window.__deleteLog = function (id, e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      deleteLog(id);
    };
  }

  /* ── INITIALIZATION ── */
  function init() {
    loadState();
    renderLogs();
    initFeedInteractions();
    initDesktopDrag();
    initTouchDrag();
    initInputAndEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
