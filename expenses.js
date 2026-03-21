(() => {
  'use strict';
  const STORAGE_KEY = 'mytrack_expenses';
  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const CATEGORIES = [
    {name:'Food',       icon:'🍔', color:'#fb923c'},
    {name:'Transport',  icon:'🚗', color:'#00d4ff'},
    {name:'Shopping',   icon:'🛍️', color:'#f472b6'},
    {name:'Health',     icon:'💊', color:'#34d399'},
    {name:'Bills',      icon:'📄', color:'#7c3aed'},
    {name:'Education',  icon:'📚', color:'#fbbf24'},
    {name:'Entertainment',icon:'🎮',color:'#e879f9'},
    {name:'Other',      icon:'📦', color:'#94a3b8'},
  ];

  let state = { expenses: [] };
  let viewDate = { year: new Date().getFullYear(), month: new Date().getMonth() };
  let editingId = null;
  let filterCat = 'all';
  let searchQ = '';

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const genId = () => 'e_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
  const todayStr = () => new Date().toISOString().slice(0,10);
  const fmtAmt = n => '₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2});
  const fmtDate = ds => { if(!ds)return''; const d=new Date(ds+'T00:00:00'); return d.toLocaleDateString('en-IN',{day:'numeric',month:'short'}); };
  const escHtml = s => { const d=document.createElement('div'); d.textContent=String(s||''); return d.innerHTML; };

  /* ── PERSISTENCE ── */
  const save = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.expenses));
    if (window.db) {
      window.db.upsertDocument('mytrack_data', { _id: 'expenses_state' }, { 
        expenses: state.expenses 
      });
    }
  };
  function load() {
    try { const r=localStorage.getItem(STORAGE_KEY); if(r) state.expenses=JSON.parse(r); } catch(e){}
    
    if (window.db && window.db.isConfigured()) {
      window.db.fetchDocuments('mytrack_data').then(docs => {
        if (!docs) return;
        const remoteInfo = docs.find(d => d._id === 'expenses_state');
        if (remoteInfo) {
          state.expenses = remoteInfo.expenses || [];
          localStorage.setItem(STORAGE_KEY, JSON.stringify(state.expenses));
          render();
        }
      });
    }
  }

  /* ── HELPERS ── */
  function monthExpenses() {
    const prefix = `${viewDate.year}-${String(viewDate.month+1).padStart(2,'0')}`;
    return state.expenses.filter(e => e.date.startsWith(prefix));
  }

  function catInfo(name) { return CATEGORIES.find(c=>c.name===name) || CATEGORIES[CATEGORIES.length-1]; }

  /* ── STATS ── */
  function updateStats() {
    const today = todayStr();
    const curMonth = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
    const monthExp = state.expenses.filter(e=>e.date.startsWith(curMonth));
    const todayExp = state.expenses.filter(e=>e.date===today);
    const total = monthExp.reduce((s,e)=>s+Number(e.amount),0);
    const todayTotal = todayExp.reduce((s,e)=>s+Number(e.amount),0);
    const days = new Date().getDate();
    const avg = days>0 ? total/days : 0;
    $('#statSpent').textContent = fmtAmt(total);
    $('#statToday').textContent = fmtAmt(todayTotal);
    $('#statAvg').textContent   = fmtAmt(avg);
    $('#statCount').textContent = monthExp.length;
  }

  /* ── DONUT CHART ── */
  function renderDonut() {
    const exps = monthExpenses();
    const svg = $('#donutSvg');
    const total = exps.reduce((s,e)=>s+Number(e.amount),0);
    $('#donutTotal').textContent = fmtAmt(total);

    // Group by category
    const groups = {};
    exps.forEach(e => {
      groups[e.category] = (groups[e.category]||0) + Number(e.amount);
    });
    const entries = Object.entries(groups).sort((a,b)=>b[1]-a[1]);

    if(total===0) { svg.innerHTML='<circle cx="100" cy="100" r="70" fill="none" stroke="#181c2e" stroke-width="28"/>'; $('#chartLegend').innerHTML='<p style="font-size:0.78rem;color:var(--t3);text-align:center">No expenses this month</p>'; return; }

    const cx=100,cy=100,r=70,stroke=28;
    const circ = 2*Math.PI*r;
    let offset=0;
    let paths='';
    const legendItems=[];

    entries.forEach(([cat,amt]) => {
      const ci = catInfo(cat);
      const frac = amt/total;
      const dash = frac*circ;
      const gap  = circ-dash;
      paths+=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${ci.color}"
        stroke-width="${stroke}" stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
        stroke-dashoffset="${(-offset*circ/360+circ/4).toFixed(2)}"
        style="transition:stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1);cursor:pointer;"
        title="${escHtml(cat)}: ${fmtAmt(amt)}">
        <title>${escHtml(cat)}: ${fmtAmt(amt)}</title>
      </circle>`;
      offset += frac*360;
      legendItems.push({cat,amt,color:ci.color,pct:Math.round(frac*100)});
    });

    svg.innerHTML=`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg-deep)" stroke-width="${stroke}"/>`+paths;

    $('#chartLegend').innerHTML = legendItems.map(li=>`
      <div class="legend-item">
        <div class="legend-dot" style="background:${li.color}"></div>
        <span class="legend-name">${escHtml(li.cat)}</span>
        <span class="legend-amount">${fmtAmt(li.amt)}</span>
        <span class="legend-pct">${li.pct}%</span>
      </div>`).join('');
  }

  /* ── BAR CHART ── */
  /* ── LINE CHART ── */
  function renderBarChart() {
    const { year, month } = viewDate;
    const daysInMonth = new Date(year,month+1,0).getDate();
    const today = todayStr();
    const prefix = `${year}-${String(month+1).padStart(2,'0')}`;

    const dailyTotals = Array.from({length:daysInMonth},(_,i)=>{
      const d = `${prefix}-${String(i+1).padStart(2,'0')}`;
      return { day:i+1, total: state.expenses.filter(e=>e.date===d).reduce((s,e)=>s+Number(e.amount),0), date:d };
    });

    const max = Math.max(...dailyTotals.map(d=>d.total), 1);
    const svgEl = document.getElementById('lineChartSvg');
    const labelsEl = document.getElementById('lineChartLabels');
    const tooltip = document.getElementById('lineTooltip');
    if(!svgEl) return;

    const W = svgEl.clientWidth || 240;
    const H = 90;
    const padX = 4, padY = 10;
    const chartW = W - padX*2;
    const chartH = H - padY*2;
    const step = chartW / Math.max(daysInMonth-1, 1);

    const pts = dailyTotals.map((d,i)=>({
      x: padX + i*step,
      y: padY + chartH - (d.total/max)*chartH,
      d
    }));

    function bezierPath(pts) {
      if(pts.length<2) return `M${pts[0].x},${pts[0].y}`;
      let path = `M ${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
      for(let i=1;i<pts.length;i++){
        const p=pts[i-1], c=pts[i];
        const cx=(p.x+c.x)/2;
        path+=` C ${cx.toFixed(1)},${p.y.toFixed(1)} ${cx.toFixed(1)},${c.y.toFixed(1)} ${c.x.toFixed(1)},${c.y.toFixed(1)}`;
      }
      return path;
    }

    const linePath = bezierPath(pts);
    const areaPath = linePath
      + ` L ${pts[pts.length-1].x.toFixed(1)},${H} L ${pts[0].x.toFixed(1)},${H} Z`;

    const gradId = `lg_${month}_${year}`;
    const todayPt = pts.find(p=>p.d.date===today);

    svgEl.innerHTML = `
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#34d399" stop-opacity="0.3"/>
          <stop offset="100%" stop-color="#34d399" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      ${[0.25,0.5,0.75,1].map(f=>{
        const gy=(padY+chartH*(1-f)).toFixed(1);
        return `<line x1="${padX}" y1="${gy}" x2="${(W-padX).toFixed(1)}" y2="${gy}" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>`;
      }).join('')}
      <path d="${areaPath}" fill="url(#${gradId})"/>
      <path d="${linePath}" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${todayPt ? `<line x1="${todayPt.x.toFixed(1)}" y1="${padY}" x2="${todayPt.x.toFixed(1)}" y2="${H}" stroke="var(--cyan)" stroke-width="1" stroke-dasharray="3,3" opacity="0.5"/>` : ''}
      ${pts.filter(p=>p.d.total>0||p.d.date===today).map(p=>{
        const isT=p.d.date===today;
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${isT?4.5:3}"
          fill="${isT?'var(--cyan)':'#34d399'}" stroke="var(--bg)" stroke-width="1.5"
          class="line-dot" data-idx="${p.d.day-1}" style="cursor:pointer;"/>`;
      }).join('')}
    `;

    labelsEl.innerHTML = dailyTotals.map(d=>{
      const isT=d.date===today;
      const show=d.day===1||d.day%5===0||isT;
      return `<span class="line-chart-label${isT?' today-lbl':''}" style="${show?'':'visibility:hidden'}">${d.day}</span>`;
    }).join('');

    svgEl.querySelectorAll('.line-dot').forEach(dot=>{
      dot.addEventListener('mouseenter',()=>{
        const idx=parseInt(dot.dataset.idx);
        const d=dailyTotals[idx];
        const wrap=document.getElementById('lineChartWrap');
        const wRect=wrap.getBoundingClientRect();
        const sRect=svgEl.getBoundingClientRect();
        const cx=parseFloat(dot.getAttribute('cx'));
        const cy=parseFloat(dot.getAttribute('cy'));
        const scaleX=sRect.width/W;
        tooltip.textContent=`${d.day} — ${fmtAmt(d.total)}`;
        tooltip.style.left=(sRect.left-wRect.left+cx*scaleX)+'px';
        tooltip.style.top=(sRect.top-wRect.top+cy*scaleX-10)+'px';
        tooltip.classList.add('visible');
      });
      dot.addEventListener('mouseleave',()=>tooltip.classList.remove('visible'));
    });
  }

  /* ── EXPENSE LIST ── */
  function renderList() {
    const { year, month } = viewDate;
    const prefix = `${year}-${String(month+1).padStart(2,'0')}`;
    let exps = state.expenses.filter(e=>e.date.startsWith(prefix));
    if(filterCat!=='all') exps=exps.filter(e=>e.category===filterCat);
    if(searchQ) exps=exps.filter(e=>e.desc.toLowerCase().includes(searchQ.toLowerCase()));
    exps.sort((a,b)=>b.date.localeCompare(a.date));

    const listEl = $('#expList');
    if(exps.length===0) {
      listEl.innerHTML=`<div class="empty-state"><div class="empty-state__icon">💸</div><h3 class="empty-state__title">No expenses</h3><p class="empty-state__text">No expenses recorded for this period.</p></div>`;
      return;
    }

    listEl.innerHTML=`
      <div class="exp-list-header"><span>Description</span><span>Category</span><span>Date</span><span style="text-align:right">Amount</span></div>
      ${exps.map((e,i)=>{
        const ci=catInfo(e.category);
        const payIcons={cash:'💵',upi:'📱',card:'💳',netbanking:'🏦'};
        return `<div class="exp-item" style="animation-delay:${i*0.03}s">
          <div>
            <div class="exp-item__desc">${escHtml(e.desc)}</div>
            <div class="exp-item__sub">${payIcons[e.payment]||''} ${e.payment||''} ${e.notes?'· '+escHtml(e.notes):''}</div>
          </div>
          <div class="exp-item__cat"><span class="cat-dot" style="background:${ci.color}"></span>${escHtml(e.category)}</div>
          <div class="exp-item__date">${fmtDate(e.date)}</div>
          <div class="exp-item__right">
            <span class="exp-item__amount">${fmtAmt(e.amount)}</span>
            <div class="exp-item__actions">
              <button class="exp-action-btn" onclick="window.__editExp('${e.id}')">✏️</button>
              <button class="exp-action-btn del" onclick="window.__deleteExp('${e.id}')">🗑️</button>
            </div>
          </div>
        </div>`;
      }).join('')}`;
  }

  /* ── FULL RENDER ── */
  function render() {
    updateStats();
    $('#monthLabel').textContent = `${MONTH_NAMES[viewDate.month]} ${viewDate.year}`;
    renderDonut();
    renderBarChart();
    renderList();
    renderCatFilters();
  }

  function renderCatFilters() {
    const usedCats = [...new Set(state.expenses.map(e=>e.category))];
    const btns = usedCats.map(c=>{
      const ci=catInfo(c);
      return `<button class="filter-chip ${filterCat===c?'active':''}" data-cat="${escHtml(c)}"><span class="filter-chip-dot" style="background:${ci.color}"></span>${escHtml(c)}</button>`;
    }).join('');
    $('#catFilterBtns').innerHTML=btns;
    $$('#catFilterBtns .filter-chip').forEach(btn=>btn.addEventListener('click',()=>{
      filterCat=btn.dataset.cat; render();
    }));
    // also update all-btn active state
    const allBtn=document.querySelector('.filter-chip[data-cat="all"]');
    if(allBtn) allBtn.classList.toggle('active', filterCat==='all');
  }

  /* ── MODAL ── */
  function populateCatSelect(selected='Other') {
    $('#expCat').innerHTML = CATEGORIES.map(c=>`<option value="${c.name}" ${c.name===selected?'selected':''}>${c.icon} ${c.name}</option>`).join('');
  }

  function openModal() { $('#expModal').classList.add('open'); setTimeout(()=>$('#expDesc').focus(),300); }
  function closeModal() { $('#expModal').classList.remove('open'); editingId=null; }

  function saveExpense() {
    const desc = $('#expDesc').value.trim();
    const amount = parseFloat($('#expAmount').value);
    if(!desc || isNaN(amount) || amount<=0) {
      if(!desc) { $('#expDesc').style.boxShadow='var(--neu-in-sm),0 0 0 2px var(--red-dim)'; setTimeout(()=>$('#expDesc').style.boxShadow='',1500); }
      if(isNaN(amount)||amount<=0) { $('#expAmount').style.boxShadow='var(--neu-in-sm),0 0 0 2px var(--red-dim)'; setTimeout(()=>$('#expAmount').style.boxShadow='',1500); }
      return;
    }
    const exp = {
      id: editingId||genId(),
      desc, amount,
      category: $('#expCat').value,
      date: $('#expDate').value||todayStr(),
      payment: $('#expPayment').value,
      notes: $('#expNotes').value.trim(),
    };
    if(editingId) {
      const idx=state.expenses.findIndex(e=>e.id===editingId);
      if(idx>-1) state.expenses[idx]=exp;
    } else {
      state.expenses.unshift(exp);
    }
    save(); closeModal(); render();
  }

  window.__editExp = id => {
    editingId=id;
    const e=state.expenses.find(x=>x.id===id); if(!e) return;
    $('#expModalTitle').textContent='Edit Expense';
    $('#expDesc').value=e.desc;
    $('#expAmount').value=e.amount;
    $('#expDate').value=e.date;
    $('#expPayment').value=e.payment||'cash';
    $('#expNotes').value=e.notes||'';
    populateCatSelect(e.category);
    openModal();
  };

  window.__deleteExp = id => {
    if(!confirm('Delete this expense?')) return;
    state.expenses=state.expenses.filter(e=>e.id!==id);
    save(); render();
  };

  /* ── INIT ── */
  function init() {
    load();

    $('#prevMonth').addEventListener('click',()=>{
      viewDate.month--; if(viewDate.month<0){viewDate.month=11;viewDate.year--;} render();
    });
    $('#nextMonth').addEventListener('click',()=>{
      viewDate.month++; if(viewDate.month>11){viewDate.month=0;viewDate.year++;} render();
    });

    $('#btnAddExp').addEventListener('click',()=>{
      editingId=null;
      $('#expModalTitle').textContent='Add Expense';
      $('#expDesc').value=''; $('#expAmount').value='';
      $('#expDate').value=todayStr(); $('#expNotes').value='';
      $('#expPayment').value='upi';
      populateCatSelect();
      openModal();
    });

    $('#expCancel').addEventListener('click',closeModal);
    $('#modalClose').addEventListener('click',closeModal);
    $('#expModal').addEventListener('click',e=>{ if(e.target===$('#expModal')) closeModal(); });
    $('#expSave').addEventListener('click',saveExpense);
    $('#expAmount').addEventListener('keydown',e=>{ if(e.key==='Enter') saveExpense(); });

    // filter all btn
    const allBtn = document.querySelector('.filter-chip[data-cat="all"]');
    if(allBtn) allBtn.addEventListener('click',()=>{ filterCat='all'; render(); });

    $('#searchExp').addEventListener('input',e=>{ searchQ=e.target.value; renderList(); });
    document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });

    render();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
