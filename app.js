/* ============================================================
   MyTrack — Dark Neumorphism Habit Tracker
   Application Logic
   ============================================================ */

(() => {
  'use strict';

  // ── Constants ─────────────────────────────────────────────
  const STORAGE_KEY = 'mytrack_data';
  const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const EMOJIS = ['💪', '🧘', '📖', '🏃', '💧', '🍎', '😴', '✍️', '🎵', '🧠', '🌱', '🎨', '💻', '🏋️', '🚶', '📝', '🧹', '🍳', '💊', '🎯'];

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

  const QUOTES = [
    "The secret of getting ahead is getting started. – Mark Twain",
    "We are what we repeatedly do. Excellence is not an act, but a habit. – Aristotle",
    "Small daily improvements are the key to staggering long-term results.",
    "Motivation is what gets you started. Habit is what keeps you going. – Jim Ryun",
    "Success is the sum of small efforts, repeated day in and day out.",
    "Discipline is choosing between what you want now and what you want most.",
    "Every journey begins with a single step.",
    "The only bad workout is the one that didn't happen.",
    "Your habits shape your identity, and your identity shapes your habits.",
    "Progress, not perfection.",
    "It's not about being the best. It's about being better than you were yesterday.",
    "Don't watch the clock; do what it does. Keep going. – Sam Levenson",
  ];

  // ── State ─────────────────────────────────────────────────
  let state = {
    habits: [],
    completions: {},   // { 'YYYY-MM-DD': { habitId: true/false } }
    currentView: 'daily',
    monthlyViewDate: null, // { year, month } for monthly nav
  };

  let editingHabitId = null;

  // ── Helpers ───────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function dateStr(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function getDayOfWeek(dateString) {
    return new Date(dateString + 'T00:00:00').getDay();
  }

  function getWeekDates() {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - dayOfWeek + i);
      dates.push(dateStr(d));
    }
    return dates;
  }

  function generateId() {
    return 'h_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  }

  function randomQuote() {
    return QUOTES[Math.floor(Math.random() * QUOTES.length)];
  }

  function formatDate(ds) {
    const d = new Date(ds + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  function isHabitActiveOnDay(habit, dayIndex) {
    return habit.days.includes(dayIndex);
  }

  function getActiveHabitsForDate(ds) {
    const dayIndex = getDayOfWeek(ds);
    return state.habits.filter(h => isHabitActiveOnDay(h, dayIndex));
  }

  // ── Persistence ───────────────────────────────────────────
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      habits: state.habits,
      completions: state.completions,
    }));
    // Sync to Mongo
    if (window.db) {
      window.db.upsertDocument('mytrack_data', { _id: 'habits_state' }, { 
        habits: state.habits, 
        completions: state.completions 
      });
    }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        state.habits = data.habits || [];
        state.completions = data.completions || {};
      }
    } catch (e) {
      console.warn('Failed to load state:', e);
    }
    
    // Attempt remote sync if online
    if (window.db && window.db.isConfigured()) {
      window.db.fetchDocuments('mytrack_data').then(docs => {
        if (!docs) return;
        const remoteInfo = docs.find(d => d._id === 'habits_state');
        if (remoteInfo) {
          state.habits = remoteInfo.habits || [];
          state.completions = remoteInfo.completions || {};
          // Save remotely fetched data purely to local so no loop happens
          localStorage.setItem(STORAGE_KEY, JSON.stringify({
            habits: state.habits,
            completions: state.completions,
          }));
          renderCurrentView();
        }
      });
    }
  }

  // ── Streak Calculation ────────────────────────────────────
  function calculateStreak() {
    let streak = 0;
    const d = new Date();

    // Check if today is complete — if not, start from yesterday
    const todayActive = getActiveHabitsForDate(todayStr());
    const todayCompletions = state.completions[todayStr()] || {};
    const todayAllDone = todayActive.length > 0 && todayActive.every(h => todayCompletions[h.id]);

    if (!todayAllDone) {
      d.setDate(d.getDate() - 1);
    }

    while (true) {
      const ds = dateStr(d);
      const active = getActiveHabitsForDate(ds);
      if (active.length === 0) {
        d.setDate(d.getDate() - 1);
        // Don't count days with no active habits, but don't break streak
        // Limit lookback to prevent infinite loop
        if (streak === 0 && d < new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)) break;
        continue;
      }
      const completions = state.completions[ds] || {};
      const allDone = active.every(h => completions[h.id]);
      if (allDone) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }

    // Also count today if all done
    if (todayAllDone) {
      // Already counted
    }

    return streak;
  }

  function calculateBestStreak() {
    let best = 0;
    let current = 0;
    const d = new Date();
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    while (d >= oneYearAgo) {
      const ds = dateStr(d);
      const active = getActiveHabitsForDate(ds);
      if (active.length === 0) {
        d.setDate(d.getDate() - 1);
        continue;
      }
      const completions = state.completions[ds] || {};
      const allDone = active.every(h => completions[h.id]);
      if (allDone) {
        current++;
        best = Math.max(best, current);
      } else {
        current = 0;
      }
      d.setDate(d.getDate() - 1);
    }
    return best;
  }

  function getHabitStreak(habitId) {
    let streak = 0;
    const habit = state.habits.find(h => h.id === habitId);
    if (!habit) return 0;

    const d = new Date();
    // Start from today or yesterday
    const todayComp = state.completions[todayStr()] || {};
    if (!todayComp[habitId]) {
      d.setDate(d.getDate() - 1);
    }

    while (true) {
      const ds = dateStr(d);
      const dayIdx = getDayOfWeek(ds);
      if (!isHabitActiveOnDay(habit, dayIdx)) {
        d.setDate(d.getDate() - 1);
        if (d < new Date(Date.now() - 365 * 24 * 60 * 60 * 1000)) break;
        continue;
      }
      const completions = state.completions[ds] || {};
      if (completions[habitId]) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  }

  // ── Stats Computation ────────────────────────────────────
  function computeStats() {
    const today = todayStr();
    const activeToday = getActiveHabitsForDate(today);
    const todayComps = state.completions[today] || {};
    const completed = activeToday.filter(h => todayComps[h.id]).length;
    const total = activeToday.length;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const streak = calculateStreak();
    const bestStreak = calculateBestStreak();

    return { pct, streak, completed, total, bestStreak };
  }

  function updateStatsBar() {
    const stats = computeStats();
    $('#statTodayPct').textContent = stats.pct + '%';
    $('#statStreak').textContent = stats.streak;
    $('#statCompleted').textContent = `${stats.completed}/${stats.total}`;
    $('#statBestStreak').textContent = stats.bestStreak;
  }

  // ── View Switching ────────────────────────────────────────
  function switchView(view) {
    state.currentView = view;
    $$('.view-switcher__btn').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    renderCurrentView();
  }

  function renderCurrentView() {
    const main = $('#mainContent');
    main.innerHTML = '';
    switch (state.currentView) {
      case 'daily': renderDailyView(main); break;
      case 'weekly': renderWeeklyView(main); break;
      case 'monthly': renderMonthlyView(main); break;
    }
    updateStatsBar();
  }

  // ── Daily View ────────────────────────────────────────────
  function renderDailyView(container) {
    const today = todayStr();
    const activeHabits = getActiveHabitsForDate(today);
    const inactiveHabits = state.habits.filter(h => !activeHabits.includes(h));
    const todayComps = state.completions[today] || {};
    const completed = activeHabits.filter(h => todayComps[h.id]).length;
    const total = activeHabits.length;

    const weekDates = getWeekDates();

    function renderHabitCard(habit, isActiveToday) {
      const isDone = !!todayComps[habit.id];
      const streak = getHabitStreak(habit.id);
      const color = COLORS.find(c => c.value === habit.color) || COLORS[0];
      return `
        <div class="habit-card ${isDone ? 'completed' : ''} ${!isActiveToday ? 'habit-card--inactive' : ''}"
             style="--habit-color: ${color.gradient}"
             data-habit-id="${habit.id}" id="habit-card-${habit.id}">
          <div class="habit-card__top">
            <div class="habit-card__info">
              <div class="habit-card__emoji">${habit.emoji}</div>
              <div>
                <div class="habit-card__name">${escapeHtml(habit.name)}</div>
                <div class="habit-card__streak ${streak >= 3 ? 'on-fire' : ''}">
                  ${!isActiveToday
                    ? `<span class="habit-card__rest-tag">Rest day today</span>`
                    : streak > 0 ? `🔥 ${streak} day streak` : 'No streak yet'}
                </div>
              </div>
            </div>
            ${isActiveToday ? `
              <label class="habit-toggle">
                <input type="checkbox" ${isDone ? 'checked' : ''}
                       onchange="window.__toggleHabit('${habit.id}', this.checked)">
                <div class="habit-toggle__visual">
                  <div class="habit-toggle__checkmark">
                    <svg viewBox="0 0 24 24">
                      <path class="check-path" d="M5 13l4 4L19 7"/>
                    </svg>
                  </div>
                </div>
              </label>
            ` : `<div class="habit-card__rest-icon">😴</div>`}
          </div>
          <div class="habit-card__bottom">
            <div class="habit-card__days">
              ${weekDates.map(wd => {
                const dayIdx = getDayOfWeek(wd);
                const isActive = isHabitActiveOnDay(habit, dayIdx);
                const isToday = wd === today;
                const isCompletedDay = isActive && (state.completions[wd] || {})[habit.id];
                return `<div class="habit-card__day ${isActive ? 'active' : ''} ${isToday ? 'today' : ''} ${isCompletedDay ? 'completed-day' : ''}">${DAY_NAMES[dayIdx].charAt(0)}</div>`;
              }).join('')}
            </div>
            <div class="habit-card__actions">
              <button class="habit-card__action-btn" onclick="window.__editHabit('${habit.id}')" title="Edit">✏️</button>
              <button class="habit-card__action-btn delete" onclick="window.__deleteHabit('${habit.id}')" title="Delete">🗑️</button>
            </div>
          </div>
        </div>
      `;
    }

    const html = `
      <div class="view-container daily-view">
        <div class="daily-view__header">
          <div class="daily-view__date">${formatDate(today)}</div>
        </div>

        ${state.habits.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state__icon">🎯</div>
            <h3 class="empty-state__title">No habits yet</h3>
            <p class="empty-state__text">Add your first habit to start building powerful daily routines!</p>
            <button class="btn-add-habit" onclick="document.getElementById('btnAddHabit').click()">＋ Create a Habit</button>
          </div>
        ` : `
          <div class="habits-grid">
            ${activeHabits.map(h => renderHabitCard(h, true)).join('')}
            ${inactiveHabits.length > 0 ? `
              <div class="habits-section-divider">
                <span>Not scheduled today</span>
              </div>
              ${inactiveHabits.map(h => renderHabitCard(h, false)).join('')}
            ` : ''}
          </div>
        `}
      </div>
    `;
    container.innerHTML = html;
  }

  // ── Weekly View ───────────────────────────────────────────
  function renderWeeklyView(container) {
    const weekDates = getWeekDates();
    const today = todayStr();
    const habits = state.habits;

    // Weekly bar chart data
    const barData = weekDates.map(wd => {
      const active = getActiveHabitsForDate(wd);
      const comps = state.completions[wd] || {};
      const done = active.filter(h => comps[h.id]).length;
      const total = active.length;
      return { date: wd, done, total, pct: total > 0 ? Math.round((done / total) * 100) : 0 };
    });

    const html = `
      <div class="view-container weekly-view">
        ${habits.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state__icon">📊</div>
            <h3 class="empty-state__title">No habits yet</h3>
            <p class="empty-state__text">Create habits to see your weekly progress here!</p>
            <button class="btn-add-habit" onclick="document.getElementById('btnAddHabit').click()">＋ Create a Habit</button>
          </div>
        ` : `
          <div class="weekly-grid">
            <table class="weekly-grid__table">
              <thead>
                <tr>
                  <th style="text-align:left">Habit</th>
                  ${weekDates.map(wd => {
      const dayIdx = getDayOfWeek(wd);
      const isToday = wd === today;
      const d = new Date(wd + 'T00:00:00');
      return `<th class="${isToday ? 'today-col' : ''}">${DAY_NAMES[dayIdx]}<br><small style="font-weight:400;opacity:0.5">${d.getDate()}</small></th>`;
    }).join('')}
                </tr>
              </thead>
              <tbody>
                ${habits.map(habit => {
      return `
                    <tr>
                      <td class="weekly-grid__habit-name">
                        <span>${habit.emoji}</span> ${escapeHtml(habit.name)}
                      </td>
                      ${weekDates.map(wd => {
        const dayIdx = getDayOfWeek(wd);
        const isActive = isHabitActiveOnDay(habit, dayIdx);
        const isToday = wd === today;
        const isFuture = wd > today;
        const isDone = isActive && (state.completions[wd] || {})[habit.id];
        let cellClass = 'weekly-cell';
        if (isToday) cellClass += ' today-cell';
        if (isFuture) cellClass += ' future';
        if (!isActive) cellClass += ' missed';
        else if (isDone) cellClass += ' done';

        return `<td><div class="${cellClass}" data-date="${wd}" data-habit="${habit.id}" 
                                  ${isActive && !isFuture ? `onclick="window.__toggleWeekly('${habit.id}','${wd}')"` : ''}>
                                  ${isDone ? '✓' : isActive ? '' : '·'}
                                </div></td>`;
      }).join('')}
                    </tr>
                  `;
    }).join('')}
              </tbody>
            </table>
          </div>

          <div class="weekly-chart" style="margin-top: 24px;">
            <div class="weekly-chart__title">Daily Completion Rate</div>
            <div class="weekly-chart__bars">
              ${barData.map(bd => {
      const dayIdx = getDayOfWeek(bd.date);
      const isToday = bd.date === today;
      return `
                  <div class="weekly-chart__bar-group">
                    <div class="weekly-chart__bar-track">
                      <div class="weekly-chart__bar-fill ${isToday ? 'today-bar' : ''}" 
                           style="height: ${bd.pct}%">
                        ${bd.pct > 15 ? `<span class="weekly-chart__bar-value">${bd.pct}%</span>` : ''}
                      </div>
                    </div>
                    <span class="weekly-chart__bar-label ${isToday ? 'today-label' : ''}">${DAY_NAMES[dayIdx]}</span>
                  </div>
                `;
    }).join('')}
            </div>
          </div>
        `}
      </div>
    `;
    container.innerHTML = html;

    // Animate bars in after render
    requestAnimationFrame(() => {
      $$('.weekly-chart__bar-fill').forEach(bar => {
        const h = bar.style.height;
        bar.style.height = '0%';
        requestAnimationFrame(() => { bar.style.height = h; });
      });
    });
  }

  // ── Monthly View ──────────────────────────────────────────
  function renderMonthlyView(container) {
    const now = new Date();
    if (!state.monthlyViewDate) {
      state.monthlyViewDate = { year: now.getFullYear(), month: now.getMonth() };
    }
    const { year, month } = state.monthlyViewDate;
    const today = todayStr();

    // Calendar grid
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Compute per-day completion levels
    const dayData = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const active = getActiveHabitsForDate(ds);
      const comps = state.completions[ds] || {};
      const done = active.filter(h => comps[h.id]).length;
      const total = active.length;
      const pct = total > 0 ? Math.round((done / total) * 100) : -1; // -1 = no habits that day
      let level = 0;
      if (pct >= 0) {
        if (pct === 0) level = 0;
        else if (pct <= 25) level = 1;
        else if (pct <= 50) level = 2;
        else if (pct <= 75) level = 3;
        else level = 4;
      }
      dayData.push({ day: d, ds, pct, level, done, total, isToday: ds === today });
    }

    // Per-habit monthly stats
    const habitStats = state.habits.map(habit => {
      let totalActive = 0;
      let totalDone = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (ds > today) continue;
        const dayIdx = getDayOfWeek(ds);
        if (isHabitActiveOnDay(habit, dayIdx)) {
          totalActive++;
          if ((state.completions[ds] || {})[habit.id]) totalDone++;
        }
      }
      const pct = totalActive > 0 ? Math.round((totalDone / totalActive) * 100) : 0;
      const color = COLORS.find(c => c.value === habit.color) || COLORS[0];
      return { habit, totalActive, totalDone, pct, color };
    });

    // Overall monthly score
    let totalOverall = 0, doneOverall = 0;
    habitStats.forEach(hs => { totalOverall += hs.totalActive; doneOverall += hs.totalDone; });
    const overallPct = totalOverall > 0 ? Math.round((doneOverall / totalOverall) * 100) : 0;

    const html = `
      <div class="view-container monthly-view">

        <div class="month-nav">
          <button class="month-nav__btn" onclick="window.__monthNav(-1)">◀</button>
          <h2 class="month-nav__title">${MONTH_NAMES[month]} ${year}</h2>
          <button class="month-nav__btn" onclick="window.__monthNav(1)">▶</button>
        </div>

        ${state.habits.length === 0 ? `
          <div class="empty-state">
            <div class="empty-state__icon">🗓️</div>
            <h3 class="empty-state__title">Nothing to show</h3>
            <p class="empty-state__text">Create habits and start tracking to see your monthly heatmap!</p>
            <button class="btn-add-habit" onclick="document.getElementById('btnAddHabit').click()">＋ Create a Habit</button>
          </div>
        ` : `
          <div class="monthly-layout">

            <div class="monthly-left">
              <div class="monthly-score-card">
                <div class="monthly-score-card__label">Monthly Score</div>
                <div class="monthly-score-card__ring">
                  <svg viewBox="0 0 80 80">
                    <circle class="score-ring-bg" cx="40" cy="40" r="32"/>
                    <circle class="score-ring-fill" cx="40" cy="40" r="32"
                      stroke-dasharray="${(overallPct / 100) * 201} 201"/>
                  </svg>
                  <span class="monthly-score-card__value">${overallPct}%</span>
                </div>
              </div>

              <div class="heatmap-legend-card">
                <span class="heatmap-legend-label">Completion</span>
                <div class="heatmap-legend-swatches">
                  <div class="heatmap-swatch level-0"></div>
                  <div class="heatmap-swatch level-1"></div>
                  <div class="heatmap-swatch level-2"></div>
                  <div class="heatmap-swatch level-3"></div>
                  <div class="heatmap-swatch level-4"></div>
                </div>
                <div class="heatmap-legend-range">
                  <span>None</span><span>Full</span>
                </div>
              </div>
            </div>

            <div class="monthly-right">
              <div class="calendar-heatmap">
                <div class="calendar-heatmap__grid">
                  ${DAY_NAMES.map(d => `<div class="calendar-heatmap__day-header">${d}</div>`).join('')}
                  ${Array(firstDay).fill('<div class="calendar-heatmap__cell empty"></div>').join('')}
                  ${dayData.map(dd => `
                    <div class="calendar-heatmap__cell ${dd.pct >= 0 ? 'level-' + dd.level : ''} ${dd.isToday ? 'today' : ''}"
                         title="${dd.pct >= 0 ? dd.done + '/' + dd.total + ' completed' : 'No habits'}">
                      <span class="calendar-heatmap__cell-date">${dd.day}</span>
                    </div>
                  `).join('')}
                </div>
              </div>

              <div class="monthly-breakdown">
                <div class="monthly-breakdown__title">Habit Breakdown</div>
                <div class="monthly-analytics">
                  ${habitStats.map(hs => `
                    <div class="habit-analytics-card">
                      <div class="habit-analytics-card__header">
                        <span class="habit-analytics-card__emoji">${hs.habit.emoji}</span>
                        <span class="habit-analytics-card__name">${escapeHtml(hs.habit.name)}</span>
                        <span class="habit-analytics-card__pct">${hs.pct}%</span>
                      </div>
                      <div class="habit-analytics-card__bar">
                        <div class="habit-analytics-card__bar-fill" style="width:${hs.pct}%;background:${hs.color.gradient}"></div>
                      </div>
                      <div class="habit-analytics-card__stats">
                        <span>${hs.totalDone} / ${hs.totalActive} days completed</span>
                      </div>
                    </div>
                  `).join('')}
                </div>
              </div>
            </div>

          </div>
        `}

      </div>
    `;
    container.innerHTML = html;

    // Animate bars
    requestAnimationFrame(() => {
      $$('.habit-analytics-card__bar-fill').forEach(bar => {
        const w = bar.style.width;
        bar.style.width = '0%';
        requestAnimationFrame(() => { bar.style.width = w; });
      });
    });
  }

  // ── Habit Toggle ──────────────────────────────────────────
  window.__toggleHabit = function (habitId, checked) {
    const today = todayStr();
    if (!state.completions[today]) state.completions[today] = {};
    state.completions[today][habitId] = checked;
    saveState();

    // Check for 100% completion celebration
    const activeToday = getActiveHabitsForDate(today);
    const todayComps = state.completions[today];
    const allDone = activeToday.every(h => todayComps[h.id]);

    if (checked) {
      // Ripple effect on the card
      const card = document.getElementById(`habit-card-${habitId}`);
      if (card) {
        card.classList.add('completed');
        const ripple = document.createElement('div');
        ripple.className = 'habit-card__ripple';
        const rect = card.getBoundingClientRect();
        ripple.style.left = rect.width - 40 + 'px';
        ripple.style.top = '30px';
        card.appendChild(ripple);
        setTimeout(() => ripple.remove(), 700);
      }
    }

    // Delayed re-render to let animation play
    setTimeout(() => {
      renderCurrentView();
      if (allDone && checked && activeToday.length > 1) {
        launchCelebration();
      }
    }, checked ? 400 : 100);
  };

  window.__toggleWeekly = function (habitId, dateStr) {
    if (!state.completions[dateStr]) state.completions[dateStr] = {};
    state.completions[dateStr][habitId] = !state.completions[dateStr][habitId];
    saveState();
    renderCurrentView();
  };

  // ── Month Navigation ──────────────────────────────────────
  window.__monthNav = function (dir) {
    let { year, month } = state.monthlyViewDate;
    month += dir;
    if (month < 0) { month = 11; year--; }
    if (month > 11) { month = 0; year++; }
    state.monthlyViewDate = { year, month };
    renderCurrentView();
  };

  // ── Habit CRUD ────────────────────────────────────────────
  window.__editHabit = function (habitId) {
    editingHabitId = habitId;
    const habit = state.habits.find(h => h.id === habitId);
    if (!habit) return;
    openModal(habit);
  };

  window.__deleteHabit = function (habitId) {
    const habit = state.habits.find(h => h.id === habitId);
    if (!habit) return;
    if (!confirm(`Delete "${habit.name}"? This cannot be undone.`)) return;
    state.habits = state.habits.filter(h => h.id !== habitId);
    saveState();
    renderCurrentView();
  };

  // ── Modal ─────────────────────────────────────────────────
  let modalState = { emoji: '💪', color: '#00d4ff', days: [0, 1, 2, 3, 4, 5, 6] };

  function initModal() {
    // Emoji picker
    const emojiPicker = $('#emojiPicker');
    emojiPicker.innerHTML = EMOJIS.map(e =>
      `<button class="emoji-picker__btn" data-emoji="${e}">${e}</button>`
    ).join('');

    emojiPicker.addEventListener('click', (e) => {
      const btn = e.target.closest('.emoji-picker__btn');
      if (!btn) return;
      modalState.emoji = btn.dataset.emoji;
      $$('.emoji-picker__btn').forEach(b => b.classList.toggle('selected', b === btn));
    });

    // Color picker
    const colorPicker = $('#colorPicker');
    colorPicker.innerHTML = COLORS.map(c =>
      `<button class="color-picker__btn" data-color="${c.value}" style="background:${c.gradient};color:${c.value}" title="${c.name}"></button>`
    ).join('');

    colorPicker.addEventListener('click', (e) => {
      const btn = e.target.closest('.color-picker__btn');
      if (!btn) return;
      modalState.color = btn.dataset.color;
      $$('.color-picker__btn').forEach(b => b.classList.toggle('selected', b === btn));
    });

    // Days selector
    const daysSelector = $('#daysSelector');
    daysSelector.innerHTML = DAY_NAMES.map((d, i) =>
      `<button class="days-selector__btn" data-day="${i}">${d}</button>`
    ).join('');

    daysSelector.addEventListener('click', (e) => {
      const btn = e.target.closest('.days-selector__btn');
      if (!btn) return;
      const day = parseInt(btn.dataset.day);
      if (modalState.days.includes(day)) {
        if (modalState.days.length > 1) {
          modalState.days = modalState.days.filter(d => d !== day);
        }
      } else {
        modalState.days.push(day);
      }
      $$('.days-selector__btn').forEach(b => {
        b.classList.toggle('selected', modalState.days.includes(parseInt(b.dataset.day)));
      });
    });

    // Save
    $('#modalSave').addEventListener('click', saveHabit);
    $('#modalCancel').addEventListener('click', closeModal);
    $('#habitModal').addEventListener('click', (e) => {
      if (e.target === $('#habitModal')) closeModal();
    });

    // DB Settings Modal
    const btnSettings = document.getElementById('btnSettings');
    const settingsModal = document.getElementById('settingsModal');
    if (btnSettings && settingsModal) {
      btnSettings.addEventListener('click', () => {
        if (window.db && window.db.config) {
          document.getElementById('dbUrl').value = window.db.config.url;
          document.getElementById('dbKey').value = window.db.config.key || '';
        }
        settingsModal.classList.add('open');
      });
      document.getElementById('settingsClose').addEventListener('click', () => settingsModal.classList.remove('open'));
      document.getElementById('btnDisconnectDb').addEventListener('click', () => {
        window.db.clearConfig();
        settingsModal.classList.remove('open');
        alert("Disconnected from Firebase Sync.");
      });
      document.getElementById('btnSaveDb').addEventListener('click', () => {
        const url = document.getElementById('dbUrl').value.trim();
        const key = document.getElementById('dbKey').value.trim();
        if (!url) return alert("Please enter the Firebase DB URL");
        window.db.saveConfig(url, key);
        settingsModal.classList.remove('open');
        alert("Firebase Sync Configured! Your data will now auto-sync in the background.");
        loadState(); // trigger a re-sync
      });
    }
  }

  function openModal(habit = null) {
    const modal = $('#habitModal');

    if (habit) {
      $('#modalTitle').textContent = 'Edit Habit';
      $('#habitName').value = habit.name;
      modalState.emoji = habit.emoji;
      modalState.color = habit.color;
      modalState.days = [...habit.days];
    } else {
      $('#modalTitle').textContent = 'New Habit';
      $('#habitName').value = '';
      modalState.emoji = '💪';
      modalState.color = '#00d4ff';
      modalState.days = [0, 1, 2, 3, 4, 5, 6];
      editingHabitId = null;
    }

    // Sync UI
    $$('.emoji-picker__btn').forEach(b => b.classList.toggle('selected', b.dataset.emoji === modalState.emoji));
    $$('.color-picker__btn').forEach(b => b.classList.toggle('selected', b.dataset.color === modalState.color));
    $$('.days-selector__btn').forEach(b => b.classList.toggle('selected', modalState.days.includes(parseInt(b.dataset.day))));

    modal.classList.add('open');
    setTimeout(() => $('#habitName').focus(), 300);
  }

  function closeModal() {
    $('#habitModal').classList.remove('open');
    editingHabitId = null;
  }

  function saveHabit() {
    const name = $('#habitName').value.trim();
    if (!name) {
      $('#habitName').style.boxShadow = 'var(--neu-inset), 0 0 0 2px rgba(248, 113, 113, 0.5)';
      setTimeout(() => { $('#habitName').style.boxShadow = ''; }, 1500);
      return;
    }

    if (editingHabitId) {
      const habit = state.habits.find(h => h.id === editingHabitId);
      if (habit) {
        habit.name = name;
        habit.emoji = modalState.emoji;
        habit.color = modalState.color;
        habit.days = [...modalState.days];
      }
    } else {
      state.habits.push({
        id: generateId(),
        name,
        emoji: modalState.emoji,
        color: modalState.color,
        days: [...modalState.days],
        createdAt: todayStr(),
      });
    }

    saveState();
    closeModal();
    renderCurrentView();
  }

  // ── Celebration ───────────────────────────────────────────
  function launchCelebration() {
    const overlay = $('#celebrationOverlay');
    const colors = ['#00d4ff', '#7c3aed', '#f472b6', '#34d399', '#fb923c', '#fbbf24', '#f87171'];

    for (let i = 0; i < 60; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.top = -20 + 'px';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.width = (6 + Math.random() * 10) + 'px';
      piece.style.height = (6 + Math.random() * 10) + 'px';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      piece.style.animationDelay = (Math.random() * 0.5) + 's';
      piece.style.animationDuration = (1 + Math.random() * 1.5) + 's';
      overlay.appendChild(piece);
    }

    setTimeout(() => { overlay.innerHTML = ''; }, 3000);
  }

  // ── Utility ───────────────────────────────────────────────
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Keyboard Shortcuts ────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'n' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      openModal();
    }
  });

  // ── Init ──────────────────────────────────────────────────
  function init() {
    loadState();
    initModal();

    // View switcher
    $('#viewSwitcher').addEventListener('click', (e) => {
      const btn = e.target.closest('.view-switcher__btn');
      if (btn) switchView(btn.dataset.view);
    });

    // Add habit button
    $('#btnAddHabit').addEventListener('click', () => openModal());

    // Enter key to save habit in modal
    $('#habitName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveHabit();
    });

    // Initial render
    renderCurrentView();
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
