/**
 * MyTrack - Firebase Realtime Database & Intelligent Offline Merge Sync Engine
 */

class DataAPI {
  constructor() {
    this.configKey = 'mytrack_db_config';
    this.queueKey = 'mytrack_sync_queue';
    this.syncStatusKey = 'mytrack_sync_status';
    this.syncHandlers = new Map();

    // Load config: { url, key, fcmConfig, vapidKey }
    this.config = JSON.parse(localStorage.getItem(this.configKey) || 'null');

    // Load queue of pending offline updates
    this.queue = JSON.parse(localStorage.getItem(this.queueKey) || '[]');

    this.isSyncing = false;

    // Listeners for network & visibility
    window.addEventListener('online', () => {
      this.triggerAllSync();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        this.triggerAllSync();
      }
    });

    // Auto-sync periodic check (every 30 seconds when online and tab active)
    setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible') {
        this.triggerAllSync();
      }
    }, 30000);

    // Initial sync
    if (this.isConfigured()) {
      setTimeout(() => this.triggerAllSync(), 800);
    }
  }

  isConfigured() {
    return !!(this.config && this.config.url);
  }

  saveConfig(url, key, fcmConfig = null, vapidKey = null) {
    url = (url || '').replace(/\/$/, "");
    this.config = { url, key, fcmConfig, vapidKey };
    localStorage.setItem(this.configKey, JSON.stringify(this.config));
    this.triggerAllSync();
  }

  clearConfig() {
    this.config = null;
    localStorage.removeItem(this.configKey);
  }

  /**
   * Register a synchronization handler for a specific document ID (e.g. 'habits_state', 'todos_state', 'expenses_state')
   * Handler signature: async (remoteDoc) => returns merged local state
   */
  registerSyncHandler(docId, handler) {
    this.syncHandlers.set(docId, handler);
  }

  /**
   * Internal pure fetch against Firebase REST API
   */
  async _fetchAPI(path, method = 'GET', data = null) {
    if (!this.isConfigured()) return null;

    let url = `${this.config.url}/${path}.json`;
    if (this.config.key) {
      url += `?auth=${this.config.key}`;
    }

    const options = {
      method,
      headers: { "Content-Type": "application/json" }
    };
    if (data) options.body = JSON.stringify(data);

    const res = await fetch(url, options);
    if (!res.ok) {
      throw new Error(`Firebase Error: ${res.status} ${res.statusText}`);
    }

    return await res.json();
  }

  /**
   * Fetch single document
   */
  async fetchDocument(collection, docId) {
    if (!this.isConfigured() || !navigator.onLine) return null;
    try {
      const res = await this._fetchAPI(`${collection}/${docId}`, 'GET');
      if (!res) return null;
      return { _id: docId, ...res };
    } catch (e) {
      console.warn(`Failed to fetch ${collection}/${docId}:`, e);
      return null;
    }
  }

  /**
   * Fetch all documents in a collection
   */
  async fetchDocuments(collection) {
    if (!this.isConfigured() || !navigator.onLine) return null;
    try {
      const res = await this._fetchAPI(collection, 'GET');
      if (!res) return null;
      return Object.keys(res).map(key => ({ _id: key, ...res[key] }));
    } catch (e) {
      console.warn(`Failed to fetch collection ${collection}:`, e);
      return null;
    }
  }

  /**
   * Save document directly
   */
  async saveDocument(collection, docId, data) {
    if (!this.isConfigured()) return null;
    try {
      return await this._fetchAPI(`${collection}/${docId}`, 'PUT', data);
    } catch (e) {
      console.warn(`Failed to save ${collection}/${docId}:`, e);
      throw e;
    }
  }

  /**
   * Trigger sync for all registered handlers
   */
  async triggerAllSync() {
    if (!this.isConfigured() || !navigator.onLine || this.isSyncing) return;
    this.isSyncing = true;

    try {
      for (const [docId, handler] of this.syncHandlers.entries()) {
        try {
          const remoteDoc = await this.fetchDocument('mytrack_data', docId);
          if (remoteDoc) {
            await handler(remoteDoc);
          }
        } catch (err) {
          console.warn(`Sync failed for ${docId}:`, err);
        }
      }
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Upsert document with backward compatibility fallback
   */
  upsertDocument(collection, filter, updateDoc) {
    if (!filter._id || !this.isConfigured()) return;
    if (navigator.onLine) {
      this.saveDocument(collection, filter._id, updateDoc).catch(err => {
        console.warn('Direct save failed, will sync later:', err);
      });
    }
  }
}

// ── Intelligent Two-Way Merge Algorithms ──────────────────────

/**
 * Merge two habit states (local and remote)
 * - Habits: item-level merge by id & updatedAt (honors deletions)
 * - Completions: granular union per date and habitId
 */
function mergeHabitsState(local, remote) {
  if (!remote) return local;
  if (!local) return remote;

  const localHabits = Array.isArray(local.habits) ? local.habits : [];
  const remoteHabits = Array.isArray(remote.habits) ? remote.habits : [];
  const localDeletions = Array.isArray(local.deletedHabitIds) ? local.deletedHabitIds : [];
  const remoteDeletions = Array.isArray(remote.deletedHabitIds) ? remote.deletedHabitIds : [];

  // 1. Merge Deleted Habit IDs (Tombstones)
  const allDeletedMap = new Map();
  localDeletions.forEach(d => {
    if (typeof d === 'string') allDeletedMap.set(d, 0);
    else if (d && d.id) allDeletedMap.set(d.id, d.deletedAt || 0);
  });
  remoteDeletions.forEach(d => {
    if (typeof d === 'string') {
      if (!allDeletedMap.has(d)) allDeletedMap.set(d, 0);
    } else if (d && d.id) {
      const existing = allDeletedMap.get(d.id) || 0;
      allDeletedMap.set(d.id, Math.max(existing, d.deletedAt || 0));
    }
  });

  // 2. Merge Habits by ID
  const habitsMap = new Map();
  
  // Index remote habits
  remoteHabits.forEach(h => {
    if (!h || !h.id) return;
    habitsMap.set(h.id, { ...h });
  });

  // Merge local habits (latest updatedAt wins)
  localHabits.forEach(localH => {
    if (!localH || !localH.id) return;
    const remoteH = habitsMap.get(localH.id);
    if (!remoteH) {
      // Local exists, remote doesn't. Check if remote deleted it
      const deletedAt = allDeletedMap.get(localH.id);
      const localUpdated = localH.updatedAt || 0;
      if (deletedAt && deletedAt > localUpdated) {
        // Was deleted remotely more recently than locally updated
        return;
      }
      habitsMap.set(localH.id, { ...localH });
    } else {
      // Both exist: pick the newer one
      const localUpdated = localH.updatedAt || 0;
      const remoteUpdated = remoteH.updatedAt || 0;
      if (localUpdated >= remoteUpdated) {
        habitsMap.set(localH.id, { ...remoteH, ...localH });
      } else {
        habitsMap.set(localH.id, { ...localH, ...remoteH });
      }
    }
  });

  // Filter out any habits deleted after their last update
  const mergedHabits = [];
  for (const [id, habit] of habitsMap.entries()) {
    const deletedAt = allDeletedMap.get(id);
    const habitUpdated = habit.updatedAt || 0;
    if (deletedAt && deletedAt >= habitUpdated) {
      continue;
    }
    mergedHabits.push(habit);
  }

  // 3. Merge Completions (Granular union per date)
  const localComps = local.completions || {};
  const remoteComps = remote.completions || {};
  const mergedCompletions = {};

  const allDates = new Set([...Object.keys(localComps), ...Object.keys(remoteComps)]);
  for (const date of allDates) {
    const localDay = localComps[date] || {};
    const remoteDay = remoteComps[date] || {};
    const dayComp = {};

    const allHabitIds = new Set([...Object.keys(localDay), ...Object.keys(remoteDay)]);
    for (const hid of allHabitIds) {
      // If either device completed it, mark completed; if explicitly false on one and absent on other, union true
      if (localDay[hid] === true || remoteDay[hid] === true) {
        dayComp[hid] = true;
      } else if (localDay[hid] === false && remoteDay[hid] === false) {
        dayComp[hid] = false;
      } else if (localDay[hid] !== undefined) {
        dayComp[hid] = localDay[hid];
      } else {
        dayComp[hid] = remoteDay[hid];
      }
    }
    mergedCompletions[date] = dayComp;
  }

  const mergedDeletedArray = Array.from(allDeletedMap.entries()).map(([id, deletedAt]) => ({ id, deletedAt }));

  return {
    habits: mergedHabits,
    completions: mergedCompletions,
    deletedHabitIds: mergedDeletedArray,
    lastSyncedAt: Date.now()
  };
}

/**
 * Merge two todo states (local and remote)
 */
function mergeTodosState(local, remote) {
  if (!remote) return local;
  if (!local) return remote;

  const localTodos = Array.isArray(local.todos) ? local.todos : [];
  const remoteTodos = Array.isArray(remote.todos) ? remote.todos : [];
  const localDeletions = Array.isArray(local.deletedTodoIds) ? local.deletedTodoIds : [];
  const remoteDeletions = Array.isArray(remote.deletedTodoIds) ? remote.deletedTodoIds : [];

  const allDeletedMap = new Map();
  localDeletions.forEach(d => {
    if (typeof d === 'string') allDeletedMap.set(d, 0);
    else if (d && d.id) allDeletedMap.set(d.id, d.deletedAt || 0);
  });
  remoteDeletions.forEach(d => {
    if (typeof d === 'string') {
      if (!allDeletedMap.has(d)) allDeletedMap.set(d, 0);
    } else if (d && d.id) {
      const existing = allDeletedMap.get(d.id) || 0;
      allDeletedMap.set(d.id, Math.max(existing, d.deletedAt || 0));
    }
  });

  const todosMap = new Map();
  remoteTodos.forEach(t => { if (t && t.id) todosMap.set(t.id, { ...t }); });

  localTodos.forEach(localT => {
    if (!localT || !localT.id) return;
    const remoteT = todosMap.get(localT.id);
    if (!remoteT) {
      const deletedAt = allDeletedMap.get(localT.id);
      const localUpdated = localT.updatedAt || 0;
      if (deletedAt && deletedAt > localUpdated) return;
      todosMap.set(localT.id, { ...localT });
    } else {
      const localUpdated = localT.updatedAt || 0;
      const remoteUpdated = remoteT.updatedAt || 0;
      if (localUpdated >= remoteUpdated) {
        todosMap.set(localT.id, { ...remoteT, ...localT });
      } else {
        todosMap.set(localT.id, { ...localT, ...remoteT });
      }
    }
  });

  const mergedTodos = [];
  for (const [id, todo] of todosMap.entries()) {
    const deletedAt = allDeletedMap.get(id);
    if (deletedAt && deletedAt >= (todo.updatedAt || 0)) continue;
    mergedTodos.push(todo);
  }

  // Categories merge (union preserving order)
  const localCats = Array.isArray(local.categories) ? local.categories : [];
  const remoteCats = Array.isArray(remote.categories) ? remote.categories : [];
  const mergedCats = Array.from(new Set([...localCats, ...remoteCats]));

  const mergedDeletedArray = Array.from(allDeletedMap.entries()).map(([id, deletedAt]) => ({ id, deletedAt }));

  return {
    todos: mergedTodos,
    categories: mergedCats.length > 0 ? mergedCats : ['Personal', 'Work', 'Health', 'Shopping', 'Learning'],
    deletedTodoIds: mergedDeletedArray,
    lastSyncedAt: Date.now()
  };
}

/**
 * Merge two expense states (local and remote)
 */
function mergeExpensesState(local, remote) {
  if (!remote) return local;
  if (!local) return remote;

  const localExps = Array.isArray(local.expenses) ? local.expenses : [];
  const remoteExps = Array.isArray(remote.expenses) ? remote.expenses : [];
  const localDeletions = Array.isArray(local.deletedExpenseIds) ? local.deletedExpenseIds : [];
  const remoteDeletions = Array.isArray(remote.deletedExpenseIds) ? remote.deletedExpenseIds : [];

  const allDeletedMap = new Map();
  localDeletions.forEach(d => {
    if (typeof d === 'string') allDeletedMap.set(d, 0);
    else if (d && d.id) allDeletedMap.set(d.id, d.deletedAt || 0);
  });
  remoteDeletions.forEach(d => {
    if (typeof d === 'string') {
      if (!allDeletedMap.has(d)) allDeletedMap.set(d, 0);
    } else if (d && d.id) {
      const existing = allDeletedMap.get(d.id) || 0;
      allDeletedMap.set(d.id, Math.max(existing, d.deletedAt || 0));
    }
  });

  const expsMap = new Map();
  remoteExps.forEach(e => { if (e && e.id) expsMap.set(e.id, { ...e }); });

  localExps.forEach(localE => {
    if (!localE || !localE.id) return;
    const remoteE = expsMap.get(localE.id);
    if (!remoteE) {
      const deletedAt = allDeletedMap.get(localE.id);
      const localUpdated = localE.updatedAt || 0;
      if (deletedAt && deletedAt > localUpdated) return;
      expsMap.set(localE.id, { ...localE });
    } else {
      const localUpdated = localE.updatedAt || 0;
      const remoteUpdated = remoteE.updatedAt || 0;
      if (localUpdated >= remoteUpdated) {
        expsMap.set(localE.id, { ...remoteE, ...localE });
      } else {
        expsMap.set(localE.id, { ...localE, ...remoteE });
      }
    }
  });

  const mergedExpenses = [];
  for (const [id, exp] of expsMap.entries()) {
    const deletedAt = allDeletedMap.get(id);
    if (deletedAt && deletedAt >= (exp.updatedAt || 0)) continue;
    mergedExpenses.push(exp);
  }

  // Categories merge
  const localCats = Array.isArray(local.categories) ? local.categories : [];
  const remoteCats = Array.isArray(remote.categories) ? remote.categories : [];
  const catNames = new Set();
  const mergedCats = [];
  [...localCats, ...remoteCats].forEach(c => {
    if (c && c.name && !catNames.has(c.name)) {
      catNames.add(c.name);
      mergedCats.push(c);
    }
  });

  const mergedDeletedArray = Array.from(allDeletedMap.entries()).map(([id, deletedAt]) => ({ id, deletedAt }));

  return {
    expenses: mergedExpenses,
    categories: mergedCats,
    deletedExpenseIds: mergedDeletedArray,
    lastSyncedAt: Date.now()
  };
}

// Global instance
window.db = new DataAPI();
window.mergeHabitsState = mergeHabitsState;
window.mergeTodosState = mergeTodosState;
window.mergeExpensesState = mergeExpensesState;

