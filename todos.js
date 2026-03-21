(() => {
  'use strict';
  const STORAGE_KEY = 'mytrack_todos';
  const CATS_KEY = 'mytrack_todo_cats';

  const DEFAULT_CATS = ['Personal','Work','Health','Shopping','Learning'];

  let state = { todos: [], categories: [...DEFAULT_CATS] };
  let editingId = null;
  let modalSubtasks = [];
  let activeFilter = 'all';
  let activePriority = 'all';
  let searchQuery = '';

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);

  function genId() { return 't_' + Date.now() + '_' + Math.random().toString(36).slice(2,7); }
  function todayStr() { const d=new Date(); return d.toISOString().slice(0,10); }
  function fmtDate(ds) {
    if(!ds) return '';
    const d = new Date(ds+'T00:00:00');
    return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});
  }
  function isOverdue(ds) { return ds && ds < todayStr(); }

  /* ── PERSISTENCE ── */
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.todos));
    localStorage.setItem(CATS_KEY, JSON.stringify(state.categories));
  }
  function load() {
    try {
      const t = localStorage.getItem(STORAGE_KEY);
      const c = localStorage.getItem(CATS_KEY);
      if(t) state.todos = JSON.parse(t);
      if(c) state.categories = JSON.parse(c);
    } catch(e) {}
  }

  /* ── STATS ── */
  function updateStats() {
    const total = state.todos.length;
    const done = state.todos.filter(t=>t.done).length;
    const open = total - done;
    const overdue = state.todos.filter(t=>!t.done && isOverdue(t.due)).length;
    $('#statTotal').textContent = total;
    $('#statOpen').textContent = open;
    $('#statDone').textContent = done;
    $('#statOverdue').textContent = overdue;
  }

  /* ── RENDER ── */
  function filteredTodos() {
    return state.todos.filter(t => {
      if(activeFilter==='open' && t.done) return false;
      if(activeFilter==='done' && !t.done) return false;
      if(activeFilter==='overdue' && (t.done || !isOverdue(t.due))) return false;
      if(activePriority!=='all' && t.priority!==activePriority) return false;
      if(searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
      return true;
    });
  }

  function render() {
    updateStats();
    const main = $('#todoMain');
    const todos = filteredTodos();

    if(state.todos.length === 0) {
      main.innerHTML = `<div class="empty-state">
        <div class="empty-state__icon">✅</div>
        <h3 class="empty-state__title">No tasks yet</h3>
        <p class="empty-state__text">Add your first task to get started!</p>
      </div>`;
      return;
    }

    if(todos.length === 0) {
      main.innerHTML = `<div class="empty-state">
        <div class="empty-state__icon">🔍</div>
        <h3 class="empty-state__title">No matching tasks</h3>
        <p class="empty-state__text">Try changing your filters or search query.</p>
      </div>`;
      return;
    }

    // Group by category
    const groups = {};
    todos.forEach(t => {
      const cat = t.category || 'Uncategorized';
      if(!groups[cat]) groups[cat] = [];
      groups[cat].push(t);
    });

    const catColors = {
      'Personal':'var(--cyan)','Work':'var(--purple)','Health':'var(--green)',
      'Shopping':'var(--orange)','Learning':'var(--pink)'
    };

    main.innerHTML = `<div class="todo-board">
      ${Object.entries(groups).map(([cat, tasks]) => {
        const col = catColors[cat] || 'var(--t2)';
        const done = tasks.filter(t=>t.done).length;
        return `
        <div class="todo-category-group" id="group-${CSS.escape(cat)}">
          <div class="todo-category-group__header" onclick="this.closest('.todo-category-group').classList.toggle('collapsed')">
            <div class="todo-category-group__title">
              <span style="width:10px;height:10px;border-radius:50%;background:${col};display:inline-block;box-shadow:0 0 8px ${col}"></span>
              ${escHtml(cat)}
              <span class="todo-category-group__count">${done}/${tasks.length}</span>
            </div>
            <span class="todo-category-group__chevron">▼</span>
          </div>
          <div class="todo-category-group__body">
            ${tasks.map(t => renderTaskCard(t)).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }

  function renderTaskCard(t) {
    const overdue = !t.done && isOverdue(t.due);
    const subtasksDone = (t.subtasks||[]).filter(s=>s.done).length;
    const subtasksTotal = (t.subtasks||[]).length;
    return `
    <div class="task-card priority-${t.priority} ${t.done?'done':''} ${overdue?'overdue':''}" id="task-${t.id}">
      <div class="task-check ${t.done?'checked':''}" onclick="window.__toggleTodo('${t.id}')"></div>
      <div class="task-body">
        <div class="task-title">${escHtml(t.title)}</div>
        <div class="task-meta">
          <span class="priority-chip ${t.priority}">${{high:'🔴 High',medium:'🟡 Medium',low:'🟢 Low'}[t.priority]}</span>
          ${t.due ? `<span class="task-due">📅 ${fmtDate(t.due)}</span>` : ''}
          ${subtasksTotal>0 ? `<span class="task-due">☑️ ${subtasksDone}/${subtasksTotal}</span>` : ''}
        </div>
        ${t.notes ? `<div class="task-notes">${escHtml(t.notes)}</div>` : ''}
        ${subtasksTotal>0 ? `
          <div class="subtasks">
            ${(t.subtasks||[]).map((s,i)=>`
              <div class="subtask-item">
                <div class="subtask-check ${s.done?'checked':''}" onclick="window.__toggleSubtask('${t.id}',${i})"></div>
                <span class="subtask-text ${s.done?'done':''}">${escHtml(s.text)}</span>
              </div>`).join('')}
          </div>` : ''}
      </div>
      <div class="task-actions">
        <button class="task-action-btn" onclick="window.__editTodo('${t.id}')" title="Edit">✏️</button>
        <button class="task-action-btn del" onclick="window.__deleteTodo('${t.id}')" title="Delete">🗑️</button>
      </div>
    </div>`;
  }

  /* ── ACTIONS ── */
  window.__toggleTodo = id => {
    const t = state.todos.find(x=>x.id===id);
    if(t) { t.done=!t.done; save(); render(); }
  };

  window.__toggleSubtask = (tid, idx) => {
    const t = state.todos.find(x=>x.id===tid);
    if(t && t.subtasks[idx]) { t.subtasks[idx].done=!t.subtasks[idx].done; save(); render(); }
  };

  window.__editTodo = id => {
    editingId = id;
    const t = state.todos.find(x=>x.id===id);
    if(!t) return;
    $('#modalTitle').textContent = 'Edit Task';
    $('#taskTitle').value = t.title;
    $('#taskPriority').value = t.priority;
    $('#taskDue').value = t.due||'';
    $('#taskNotes').value = t.notes||'';
    modalSubtasks = (t.subtasks||[]).map(s=>({...s}));
    populateCategorySelect(t.category);
    renderModalSubtasks();
    openModal();
  };

  window.__deleteTodo = id => {
    if(!confirm('Delete this task?')) return;
    state.todos = state.todos.filter(x=>x.id!==id);
    save(); render();
  };

  /* ── MODAL ── */
  function populateCategorySelect(selected='') {
    const sel = $('#taskCategory');
    sel.innerHTML = state.categories.map(c=>`<option value="${escHtml(c)}" ${c===selected?'selected':''}>${escHtml(c)}</option>`).join('');
  }

  function renderModalSubtasks() {
    $('#subtaskList').innerHTML = modalSubtasks.map((s,i)=>`
      <div class="subtask-modal-item">
        ${escHtml(s.text)}
        <button onclick="window.__removeModalSubtask(${i})">✕</button>
      </div>`).join('');
  }

  window.__removeModalSubtask = i => {
    modalSubtasks.splice(i,1);
    renderModalSubtasks();
  };

  function openModal() { $('#todoModal').classList.add('open'); setTimeout(()=>$('#taskTitle').focus(),300); }
  function closeModal() { $('#todoModal').classList.remove('open'); editingId=null; modalSubtasks=[]; }

  function saveTask() {
    const title = $('#taskTitle').value.trim();
    if(!title) { $('#taskTitle').style.boxShadow='var(--neu-in-sm),0 0 0 2px var(--red-dim)'; setTimeout(()=>$('#taskTitle').style.boxShadow='',1500); return; }

    let cat = $('#taskCategory').value;
    const newCat = $('#newCategory').value.trim();
    if(newCat) { cat=newCat; if(!state.categories.includes(newCat)) state.categories.push(newCat); }

    const task = {
      id: editingId || genId(),
      title,
      category: cat,
      priority: $('#taskPriority').value,
      due: $('#taskDue').value || null,
      notes: $('#taskNotes').value.trim(),
      subtasks: modalSubtasks.map(s=>({...s})),
      done: editingId ? (state.todos.find(x=>x.id===editingId)||{}).done||false : false,
      createdAt: editingId ? (state.todos.find(x=>x.id===editingId)||{}).createdAt||todayStr() : todayStr(),
    };

    if(editingId) {
      const idx = state.todos.findIndex(x=>x.id===editingId);
      if(idx>-1) state.todos[idx]=task;
    } else {
      state.todos.unshift(task);
    }
    save(); closeModal(); render();
  }

  function escHtml(s='') { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }

  /* ── INIT ── */
  function init() {
    load();

    // filters
    $$('.filter-btn[data-filter]').forEach(btn => btn.addEventListener('click', () => {
      $$('.filter-btn[data-filter]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      render();
    }));
    $$('.filter-btn[data-priority]').forEach(btn => btn.addEventListener('click', () => {
      $$('.filter-btn[data-priority]').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      activePriority = btn.dataset.priority;
      render();
    }));
    $('#searchTodo').addEventListener('input', e => { searchQuery=e.target.value; render(); });

    // modal
    $('#btnAddTodo').addEventListener('click', () => {
      editingId=null; modalSubtasks=[];
      $('#modalTitle').textContent='New Task';
      $('#taskTitle').value='';
      $('#taskPriority').value='medium';
      $('#taskDue').value='';
      $('#taskNotes').value='';
      $('#newCategory').value='';
      populateCategorySelect();
      renderModalSubtasks();
      openModal();
    });
    $('#modalCancel').addEventListener('click', closeModal);
    $('#modalClose').addEventListener('click', closeModal);
    $('#todoModal').addEventListener('click', e => { if(e.target===$('#todoModal')) closeModal(); });
    $('#modalSave').addEventListener('click', saveTask);
    $('#taskTitle').addEventListener('keydown', e => { if(e.key==='Enter') saveTask(); });

    // subtask add
    $('#btnAddSubtask').addEventListener('click', () => {
      const v = $('#subtaskInput').value.trim();
      if(!v) return;
      modalSubtasks.push({text:v, done:false});
      $('#subtaskInput').value='';
      renderModalSubtasks();
    });
    $('#subtaskInput').addEventListener('keydown', e => {
      if(e.key==='Enter') { e.preventDefault(); $('#btnAddSubtask').click(); }
    });

    document.addEventListener('keydown', e => { if(e.key==='Escape') closeModal(); });

    render();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
