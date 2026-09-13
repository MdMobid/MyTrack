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

    state.logs.unshift(newLog);
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
          <p class="logs-empty__text">${searchQuery ? `No logs matched "${escapeHtml(searchQuery)}". Try another search keyword.` : `No logs found for the selected date filter.`}</p>
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

    // Sort dates DESCENDING: Today at top, then Yesterday, then older dates descending
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    let html = '';
    sortedDates.forEach(ds => {
      // Sort logs within day descending: latest log at top
      const dayLogs = groups[ds].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
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
      <div class="log-card" id="row-${logId}" data-id="${logId}">
        <div class="log-card__header">
          <div class="log-card__meta">
            <span class="log-card__time-icon">🕒</span>
            <span>${time}</span>
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
    initInputAndEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
