(() => {
  'use strict';

  const HABITS_KEY = 'mytrack_data';
  const TODOS_KEY = 'mytrack_todos';
  const CATS_KEY = 'mytrack_todo_cats';
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const COLORS = [
    { name: 'Cyan', value: '#00d4ff', gradient: 'linear-gradient(135deg, #00d4ff, #0099cc)' },
    { name: 'Purple', value: '#7c3aed', gradient: 'linear-gradient(135deg, #7c3aed, #5b21b6)' },
    { name: 'Pink', value: '#f472b6', gradient: 'linear-gradient(135deg, #f472b6, #db2777)' },
    { name: 'Green', value: '#34d399', gradient: 'linear-gradient(135deg, #34d399, #059669)' },
    { name: 'Orange', value: '#fb923c', gradient: 'linear-gradient(135deg, #fb923c, #ea580c)' },
    { name: 'Red', value: '#f87171', gradient: 'linear-gradient(135deg, #f87171, #dc2626)' },
    { name: 'Blue', value: '#60a5fa', gradient: 'linear-gradient(135deg, #60a5fa, #2563eb)' },
    { name: 'Yellow', value: '#fbbf24', gradient: 'linear-gradient(135deg, #fbbf24, #d97706)' },
  ];

  let habitState = { habits: [], completions: {} };
  let todoState = { todos: [], categories: [] };

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function formatDate(ds) {
    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function getDayOfWeek(ds) {
    return new Date(ds + 'T00:00:00').getDay();
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function isOverdue(ds) {
    return ds && ds < todayStr();
  }

  function showToast(msg, type = 'info', dur = 3000) {
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

  /* ── PERSISTENCE ── */
  function saveHabits() {
    localStorage.setItem(HABITS_KEY, JSON.stringify({
      habits: habitState.habits,
      completions: habitState.completions
    }));
    if (window.db) {
      window.db.upsertDocument('mytrack_data', { _id: 'habits_state' }, {
        habits: habitState.habits,
        completions: habitState.completions
      });
    }
  }

  function loadHabits() {
    try {
      const raw = localStorage.getItem(HABITS_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        habitState.habits = data.habits || [];
        habitState.completions = data.completions || {};
      }
    } catch (e) { }

    if (window.db && window.db.isConfigured()) {
      window.db.fetchDocuments('mytrack_data').then(docs => {
        if (!docs) return;
        const remote = docs.find(d => d._id === 'habits_state');
        if (remote) {
          habitState.habits = remote.habits || [];
          habitState.completions = remote.completions || {};
          localStorage.setItem(HABITS_KEY, JSON.stringify({
            habits: habitState.habits,
            completions: habitState.completions
          }));
        }
      });
    }
  }

  function saveTodos() {
    localStorage.setItem(TODOS_KEY, JSON.stringify(todoState.todos));
    localStorage.setItem(CATS_KEY, JSON.stringify(todoState.categories));
    if (window.db) {
      window.db.upsertDocument('mytrack_data', { _id: 'todos_state' }, {
        todos: todoState.todos,
        categories: todoState.categories
      });
    }
  }

  function loadTodos() {
    try {
      const t = localStorage.getItem(TODOS_KEY);
      const c = localStorage.getItem(CATS_KEY);
      if (t) todoState.todos = JSON.parse(t);
      if (c) todoState.categories = JSON.parse(c);
    } catch (e) { }

    if (window.db && window.db.isConfigured()) {
      window.db.fetchDocuments('mytrack_data').then(docs => {
        if (!docs) return;
        const remote = docs.find(d => d._id === 'todos_state');
        if (remote) {
          todoState.todos = remote.todos || [];
          todoState.categories = remote.categories || [];
          localStorage.setItem(TODOS_KEY, JSON.stringify(todoState.todos));
          localStorage.setItem(CATS_KEY, JSON.stringify(todoState.categories));
        }
      });
    }
  }

  /* ── DATA ── */
  function getTodayHabits() {
    const todayIdx = getDayOfWeek(todayStr());
    const today = todayStr();
    return habitState.habits.filter(h => h.days.includes(todayIdx) && !(habitState.completions[today] && habitState.completions[today][h.id]));
  }

  function isHabitCompletedToday(habitId) {
    const dayComp = habitState.completions[todayStr()];
    return dayComp && dayComp[habitId] === true;
  }

  function getTodayTodos() {
    const today = todayStr();
    return todoState.todos.filter(t => !t.done && (t.due === today || isOverdue(t.due)));
  }

  function getHabitStreak(habitId) {
    let streak = 0;
    const habit = habitState.habits.find(h => h.id === habitId);
    if (!habit) return 0;

    const d = new Date();
    const todayComp = habitState.completions[todayStr()] || {};
    if (!todayComp[habitId]) {
      d.setDate(d.getDate() - 1);
    }

    while (true) {
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayIdx = d.getDay();
      if (!habit.days.includes(dayIdx)) {
        d.setDate(d.getDate() - 1);
        if (d < new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)) break;
        continue;
      }
      const completions = habitState.completions[ds] || {};
      if (completions[habitId]) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  /* ── ACTIONS ── */
  function toggleHabit(habitId) {
    const comps = habitState.completions[todayStr()] || {};
    const was = comps[habitId] === true;
    comps[habitId] = !was;
    habitState.completions[todayStr()] = comps;
    saveHabits();
    render();
    showToast(was ? 'Habit unchecked' : 'Habit completed!', 'success');
  }

  function toggleTodo(todoId) {
    const todo = todoState.todos.find(t => t.id === todoId);
    if (todo) {
      todo.done = !todo.done;
      saveTodos();
      render();
      showToast(todo.done ? 'Task completed!' : 'Task reopened', 'success');
    }
  }

  /* ── RENDER ── */
  function render() {
    const today = todayStr();
    const todayIdx = getDayOfWeek(today);
    
    const pendingHabits = getTodayHabits();
    const allTodayHabits = habitState.habits.filter(h => h.days.includes(todayIdx));
    const completedHabits = allTodayHabits.filter(h => isHabitCompletedToday(h.id));
    
    const pendingTodos = getTodayTodos();
    const completedTodos = todoState.todos.filter(t => t.done && t.due === today);
    
    const totalCount = allTodayHabits.length + pendingTodos.length + completedTodos.length;
    const completedCount = completedHabits.length + completedTodos.length;
    const pendingCount = pendingHabits.length + pendingTodos.length;
    const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

    document.getElementById('statTodayPct').textContent = pct + '%';
    document.getElementById('statStreak').textContent = completedHabits.length;
    document.getElementById('statCompleted').textContent = completedTodos.length;
    document.getElementById('statBestStreak').textContent = pendingCount;

    pendingTodos.sort((a, b) => {
      const aOver = a.due && a.due < today;
      const bOver = b.due && b.due < today;
      if (aOver && !bOver) return -1;
      if (!aOver && bOver) return 1;
      if (a.due === today && b.due !== today) return -1;
      if (b.due === today && a.due !== today) return 1;
      const pri = { high: 0, medium: 1, low: 2 };
      return (pri[a.priority] || 2) - (pri[b.priority] || 2);
    });

    const container = $('#mainContent');
    if (!container) return;

    if (pendingHabits.length === 0 && pendingTodos.length === 0) {
      container.innerHTML = `
        <div class="view-container daily-view">
          <div class="daily-view__header">
            <div class="daily-view__date">${formatDate(today)}</div>
          </div>
          <div class="empty-state">
            <div class="empty-state__icon">✨</div>
            <h3 class="empty-state__title">All done for today!</h3>
            <p class="empty-state__text">No habits or tasks due today. Enjoy your day!</p>
          </div>
        </div>
      `;
      return;
    }

    function renderHabitCard(habit) {
      const color = COLORS.find(c => c.value === habit.color) || COLORS[0];
      const streak = getHabitStreak(habit.id);
      return `
        <div class="habit-card" style="--habit-color: ${color.gradient};">
          <div class="habit-card__top">
            <div class="habit-card__info">
              <div class="habit-card__emoji">${escapeHtml(habit.emoji)}</div>
              <div>
                <div class="habit-card__name">${escapeHtml(habit.name)}</div>
                <div class="habit-card__streak ${streak >= 3 ? 'on-fire' : ''}">
                  ${streak > 0 ? `🔥 ${streak} day streak` : 'Start your streak!'}
                </div>
              </div>
            </div>
            <label class="habit-toggle">
              <input type="checkbox"
                     onchange="window.__toggleHabit('${habit.id}', this.checked)">
              <div class="habit-toggle__visual">
                <div class="habit-toggle__checkmark">
                  <svg viewBox="0 0 24 24">
                    <path class="check-path" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
              </div>
            </label>
          </div>
        </div>
      `;
    }

    function renderTaskCard(task) {
      const overdue = task.due && task.due < today;
      const priorityColor = task.priority === 'high' ? '#f87171' : task.priority === 'medium' ? '#fbbf24' : '#34d399';
      const priorityLabel = (task.priority || 'medium').charAt(0).toUpperCase() + (task.priority || 'medium').slice(1);
      return `
        <div class="habit-card completed-${task.done}" style="--habit-color: linear-gradient(135deg, ${priorityColor}, ${priorityColor}88);"
             data-task-id="${task.id}" id="task-card-${task.id}">
          <div class="habit-card__top">
            <div class="habit-card__info">
              <div class="habit-card__emoji" style="background: ${priorityColor}22;">📋</div>
              <div>
                <div class="habit-card__name">${escapeHtml(task.title)}</div>
                <div class="habit-card__streak" style="${overdue ? 'color: #f87171;' : ''}">
                  ${overdue ? '⚠️ Overdue' : task.due === today ? '📅 Due today' : task.category || 'No category'}
                </div>
              </div>
            </div>
            <label class="habit-toggle">
              <input type="checkbox" ${task.done ? 'checked' : ''}
                     onchange="window.__toggleTodo('${task.id}', this.checked)">
              <div class="habit-toggle__visual">
                <div class="habit-toggle__checkmark">
                  <svg viewBox="0 0 24 24">
                    <path class="check-path" d="M5 13l4 4L19 7"/>
                  </svg>
                </div>
              </div>
            </label>
          </div>
          <div class="habit-card__bottom">
            <div class="habit-card__days">
              <div class="habit-card__day priority-badge priority-${task.priority || 'medium'}">
                ${priorityLabel}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="view-container daily-view">
        <div class="daily-view__header">
          <div class="daily-view__date">${formatDate(today)}</div>
        </div>
        
        ${pendingTodos.length > 0 ? `
          <div class="habits-section-divider">
            <span>📋 Tasks Due</span>
          </div>
          <div class="habits-grid">
            ${pendingTodos.map(renderTaskCard).join('')}
          </div>
        ` : ''}
        
        ${pendingHabits.length > 0 ? `
          <div class="habits-section-divider">
            <span>🎯 Daily Habits</span>
          </div>
          <div class="habits-grid">
            ${pendingHabits.map(renderHabitCard).join('')}
          </div>
        ` : ''}
      </div>
    `;

    if (completedCount > 0 && completedCount === allTodayHabits.length + allTodayTodos.length && allTodayTodos.length > 0) {
      setTimeout(() => showConfetti(), 400);
    }
  }

  function showConfetti() {
    const colors = ['#00d4ff', '#7c3aed', '#f472b6', '#34d399', '#fb923c', '#fbbf24'];
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    for (let i = 0; i < 50; i++) {
      const conf = document.createElement('div');
      conf.className = 'confetti';
      conf.style.left = Math.random() * 100 + '%';
      conf.style.background = colors[Math.floor(Math.random() * colors.length)];
      conf.style.animationDelay = Math.random() * 0.5 + 's';
      conf.style.animationDuration = (2 + Math.random()) + 's';
      container.appendChild(conf);
    }

    setTimeout(() => container.remove(), 4000);
  }

  /* ── INIT ── */
  window.__toggleHabit = (id, checked) => {
    if (checked) {
      const comps = habitState.completions[todayStr()] || {};
      comps[id] = true;
      habitState.completions[todayStr()] = comps;
    } else {
      if (habitState.completions[todayStr()]) {
        delete habitState.completions[todayStr()][id];
      }
    }
    saveHabits();
    render();
    showToast('Habit completed!', 'success');
  };

  window.__toggleTodo = (id, checked) => {
    const todo = todoState.todos.find(t => t.id === id);
    if (todo) {
      todo.done = checked;
      saveTodos();
      render();
      showToast(checked ? 'Task completed!' : 'Task reopened', 'success');
    }
  };

  // Settings modal
  const btnSettings = document.getElementById('btnSettings');
  const settingsModal = document.getElementById('settingsModal');
  if (btnSettings && settingsModal) {
    btnSettings.addEventListener('click', () => {
      if (window.db && window.db.config) {
        document.getElementById('dbUrl').value = window.db.config.url || '';
        document.getElementById('dbKey').value = window.db.config.key || '';
        document.getElementById('fcmConfig').value = window.db.config.fcmConfig || '';
        document.getElementById('vapidKey').value = window.db.config.vapidKey || '';
      }
      settingsModal.classList.add('open');
    });
    document.getElementById('settingsClose').addEventListener('click', () => settingsModal.classList.remove('open'));
    document.getElementById('btnDisconnectDb').addEventListener('click', () => {
      window.db.clearConfig();
      settingsModal.classList.remove('open');
      showToast('Disconnected from Firebase Sync', 'info');
    });
    document.getElementById('btnSaveDb').addEventListener('click', () => {
      const url = document.getElementById('dbUrl').value.trim();
      const key = document.getElementById('dbKey').value.trim();
      const fcmCfg = document.getElementById('fcmConfig').value.trim();
      const vapid = document.getElementById('vapidKey').value.trim();

      if (!url) return showToast('Please enter Firebase DB URL', 'error');

      const newConfig = { url, key, fcmConfig: fcmCfg, vapidKey: vapid };
      localStorage.setItem('mytrack_db_config', JSON.stringify(newConfig));
      window.db.config = newConfig;

      settingsModal.classList.remove('open');
      showToast('Sync settings saved!', 'success');
      loadHabits();
      loadTodos();
      render();
    });

    // Export/Import handlers
    const btnExportData = document.getElementById('btnExportData');
    const btnImportData = document.getElementById('btnImportData');
    
    if (btnExportData) {
      btnExportData.addEventListener('click', () => {
        const data = {
          habits: habitState.habits,
          completions: habitState.completions,
          todos: todoState.todos,
          exportedAt: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const downloadUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `mytrack-backup-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Data exported successfully!', 'success');
      });
    }

    if (btnImportData) {
      btnImportData.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = (evt) => {
            try {
              const data = JSON.parse(evt.target.result);
              if (data.habits) habitState.habits = data.habits;
              if (data.completions) habitState.completions = data.completions;
              if (data.todos) todoState.todos = data.todos;
              saveHabits();
              saveTodos();
              render();
              showToast('Data imported successfully!', 'success');
            } catch (err) {
              showToast('Failed to parse backup file', 'error');
            }
          };
          reader.readAsText(file);
        };
        input.click();
      });
    }
  }

  // Settings dropdown toggle
  window.toggleSettingsDropdown = function(dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    dropdown.classList.toggle('settings-dropdown--open');
  };

  loadHabits();
  loadTodos();
  render();
})();