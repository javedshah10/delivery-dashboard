import * as store from './store.js';
import { workDates, dayNumber } from './lib/workdays.js';
import { taskKpis, ownerProgress } from './lib/kpi.js';

const TABS = [
  ['overview', 'Overview'],
  ['tasks', 'Tasks'],
  ['workdays', 'Work days'],
  ['modules', 'Modules'],
  ['risks', 'Risks & decisions'],
  ['activity', 'Activity'],
];

let tab = 'overview';
let taskFilter = { owner: '', status: '', q: '' };
let commentTaskId = null;
let toastTimer = null;

function el(tag, props, ...kids) {
  const n = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'className') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of kids.flat()) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = el('div', { className: 'toast' });
    document.body.append(t);
  }
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 5000);
}

async function run(fn) {
  try {
    await fn();
  } catch (e) {
    showToast(e?.message || String(e));
  }
}

function badgeStatus(status) {
  return el('span', { className: `badge badge-${status}`, text: status.replace('_', ' ') });
}

function planContext(s) {
  const m = s.meta;
  const hol = s.holidays.map((h) => h.day);
  const dates = workDates(m.start_date, m.work_week, hol, m.working_days);
  const today = todayISO();
  const day = dayNumber(today, m.start_date, m.work_week, hol);
  return { dates, today, day, hol };
}

function renderAuth(root, s) {
  const box = el('div', { className: 'panel auth-box' });
  box.append(el('p', { text: 'Sign in with your team email to view and update the plan.' }));
  const email = el('input', { type: 'email', placeholder: 'you@company.com', autocomplete: 'email' });
  const password = el('input', { type: 'password', placeholder: 'Password', autocomplete: 'current-password' });
  const btn = el('button', { className: 'btn btn-primary', type: 'submit', text: 'Sign in' });
  const form = el('form', { className: 'auth-form' }, email, password, btn);
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    run(async () => {
      await store.signInWithPassword(email.value.trim(), password.value);
      password.value = '';
    });
  });
  const link = el('button', { className: 'btn', type: 'button', text: 'No password? Email me a sign-in link' });
  link.addEventListener('click', () =>
    run(async () => {
      await store.signInWithOtp(email.value.trim());
      showToast('Check your email for the sign-in link.');
    }),
  );
  box.append(form, link);
  root.append(box);
}

function renderOverview(root, s) {
  const { dates, day } = planContext(s);
  const k = taskKpis(s.tasks, day);
  const doneAll = s.tasks.filter((t) => t.status === 'done').length;
  const pct = s.tasks.length ? Math.round((doneAll / s.tasks.length) * 100) : 0;
  const pendingDec = s.decisions.filter((d) => d.status === 'pending').length;

  const grid = el('div', { className: 'stat-grid' });
  const add = (label, value, sub = '') => {
    const card = el('div', { className: 'panel' });
    card.append(el('div', { className: 'stat-label', text: label }));
    card.append(el('div', { className: 'stat-value', text: value }));
    if (sub) card.append(el('div', { className: 'task-meta', text: sub }));
    grid.append(card);
  };
  add('Day', `Day ${day} of ${s.meta.working_days}`, `Day ${s.meta.working_days}: ${dates[s.meta.working_days - 1]}`);
  add('Tasks done', `${pct}%`, `${doneAll} / ${s.tasks.length}`);
  const track = k.onTrack ? 'On track' : `${k.behind} behind`;
  add('Due vs done', track, `${k.done} done of ${k.due} due so far`);
  add('Late', String(k.late));
  add('Blocked', String(k.blocked));
  add('Decisions', `${pendingDec} open`, 'of 10');

  const statusRow = el('div', { className: 'panel' });
  const st = s.meta.plan_status;
  statusRow.append(
    el('span', { className: `badge badge-${st === 'DRAFT' ? 'draft' : 'approved'}`, text: st }),
  );
  if (!s.meta.work_week_confirmed) {
    statusRow.append(el('p', { className: 'task-meta', text: 'Working week is not confirmed yet.' }));
  }

  const owners = el('div', { className: 'panel' });
  owners.append(el('h2', { className: 'day-head', text: 'Progress by owner' }));
  const prog = ownerProgress(s.tasks);
  for (const [owner, p] of Object.entries(prog).sort((a, b) => a[0].localeCompare(b[0]))) {
    const row = el('div', { className: 'owner-bar' });
    row.append(el('div', { className: 'owner-bar-label' }, el('span', { text: owner }), el('span', { text: `${p}%` })));
    const track = el('div', { className: 'bar-track' });
    track.append(el('div', { className: 'bar-fill', style: `width:${p}%` }));
    row.append(track);
    owners.append(row);
  }

  root.append(grid, statusRow, owners);
}

function taskMatches(t) {
  if (taskFilter.owner && t.owner !== taskFilter.owner) return false;
  if (taskFilter.status && t.status !== taskFilter.status) return false;
  if (taskFilter.q) {
    const q = taskFilter.q.toLowerCase();
    const hay = `${t.title} ${t.note} ${t.proof}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function renderTasks(root, s) {
  const { dates, day, today } = planContext(s);
  const filters = el('div', { className: 'filters' });
  const owners = [...new Set(s.tasks.map((t) => t.owner))].sort();
  const oSel = el('select', {});
  oSel.append(el('option', { value: '', text: 'All owners' }));
  for (const o of owners) oSel.append(el('option', { value: o, text: o }));
  oSel.value = taskFilter.owner;
  oSel.addEventListener('change', () => {
    taskFilter.owner = oSel.value;
    render();
  });
  const sSel = el('select', {});
  for (const st of ['', 'todo', 'in_progress', 'done', 'blocked']) {
    sSel.append(el('option', { value: st, text: st || 'All statuses' }));
  }
  sSel.value = taskFilter.status;
  sSel.addEventListener('change', () => {
    taskFilter.status = sSel.value;
    render();
  });
  const search = el('input', { type: 'search', placeholder: 'Search…' });
  search.value = taskFilter.q;
  search.addEventListener('input', () => {
    taskFilter.q = search.value;
    render();
  });
  filters.append(oSel, sSel, search);

  const wrap = el('div');
  const byDay = new Map();
  for (const t of s.tasks) {
    if (!taskMatches(t)) continue;
    for (let d = t.day_start; d <= t.day_end; d++) {
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(t);
    }
  }
  for (let d = 1; d <= s.meta.working_days; d++) {
    const list = byDay.get(d);
    if (!list?.length) continue;
    const iso = dates[d - 1];
    const head = el('div', { className: `day-head${iso === today ? ' today' : ''}` });
    head.textContent = `Day ${d} · ${iso}`;
    wrap.append(head);
    for (const t of list) {
      const late = t.day_end <= day && t.status !== 'done';
      const row = el('div', { className: `task-row${late ? ' late' : ''}` });
      row.append(el('div', { className: 'task-title', text: t.title }));
      row.append(el('div', { className: 'task-meta', text: `${t.owner} · ${t.proof}` }));
      row.append(badgeStatus(t.status));
      if (t.note) row.append(el('p', { className: 'task-meta', text: t.note }));
      if (t.link?.toLowerCase().startsWith('https://')) {
        row.append(el('a', { href: t.link, rel: 'noopener noreferrer', target: '_blank', text: 'Link' }));
      }
      const can = store.canChangeTask(t);
      const controls = el('div', { className: 'task-controls' });
      const cb = el('input', { type: 'checkbox' });
      cb.checked = t.status === 'done';
      cb.disabled = !can;
      cb.addEventListener('change', () =>
        run(() => store.updateTask(t.id, { status: cb.checked ? 'done' : 'todo' })),
      );
      controls.append(el('label', {}, cb, ' Done'));
      const ip = el('button', { className: 'btn', type: 'button', text: 'In progress', disabled: !can });
      ip.addEventListener('click', () => run(() => store.updateTask(t.id, { status: 'in_progress' })));
      const bl = el('button', { className: 'btn', type: 'button', text: 'Blocked', disabled: !can });
      bl.addEventListener('click', () => run(() => store.updateTask(t.id, { status: 'blocked' })));
      controls.append(ip, bl);
      const note = el('textarea', { rows: '2', placeholder: 'Note', disabled: !can });
      note.value = t.note || '';
      note.addEventListener('blur', () => {
        if (note.value !== (t.note || '')) run(() => store.updateTask(t.id, { note: note.value }));
      });
      const link = el('input', { type: 'url', placeholder: 'https://…', disabled: !can });
      link.value = t.link || '';
      link.addEventListener('blur', () => {
        if (link.value !== (t.link || '')) run(() => store.updateTask(t.id, { link: link.value }));
      });
      controls.append(note, link);
      const cc = (s.commentsByTask.get(t.id) || []).length;
      const cbtn = el('button', { className: 'btn', type: 'button', text: `Comments (${cc})` });
      cbtn.addEventListener('click', () => {
        commentTaskId = t.id;
        render();
      });
      controls.append(cbtn);
      row.append(controls);
      wrap.append(row);
    }
  }
  root.append(filters, wrap);
}

function renderWorkdays(root, s) {
  const { dates, today } = planContext(s);
  const holSet = new Set(s.holidays.map((h) => h.day));
  const grid = el('div', { className: 'cal-grid' });
  for (let i = 0; i < dates.length; i++) {
    const iso = dates[i];
    const cell = el('div', {
      className: `cal-cell${iso === today ? ' today' : ''}${holSet.has(iso) ? ' holiday' : ''}`,
    });
    cell.append(el('div', { text: `D${i + 1}` }), el('div', { text: iso.slice(5) }));
    grid.append(cell);
  }
  root.append(grid);
  if (s.canEdit) {
    const row = el('div', { className: 'filters' });
    const dayIn = el('input', { type: 'date' });
    const lab = el('input', { type: 'text', placeholder: 'Label' });
    const add = el('button', { className: 'btn btn-primary', type: 'button', text: 'Add holiday' });
    add.addEventListener('click', () => run(() => store.addHoliday(dayIn.value, lab.value)));
    const rem = el('button', { className: 'btn', type: 'button', text: 'Remove selected date' });
    rem.addEventListener('click', () => run(() => store.removeHoliday(dayIn.value)));
    row.append(dayIn, lab, add, rem);
    root.append(row);
  }
}

function renderModules(root, s) {
  const grid = el('div', { className: 'module-grid' });
  for (const m of s.modules) {
    const card = el('div', { className: 'panel module-card' });
    card.append(el('h3', { text: m.name }));
    card.append(badgeStatus(m.status));
    if (m.status_label) card.append(el('p', { text: m.status_label }));
    card.append(el('p', { text: m.evidence }));
    grid.append(card);
  }
  root.append(grid);
}

function renderRisks(root, s) {
  for (const r of s.risks) {
    const box = el('div', { className: 'panel risk-item' });
    box.append(el('strong', { text: `Risk ${r.n}` }));
    box.append(el('p', { text: r.risk }));
    box.append(el('p', { className: 'task-meta', text: r.indicator }));
    box.append(badgeStatus(r.status));
    root.append(box);
  }
  root.append(el('h2', { className: 'day-head', text: 'Owner decisions' }));
  if (s.canEdit) {
    const wk = el('div', { className: 'panel' });
    wk.append(el('p', { text: 'Set working week (confirms schedule):' }));
    for (const ww of ['MON_FRI', 'SUN_THU']) {
      const b = el('button', {
        className: 'btn',
        type: 'button',
        text: ww,
        disabled: s.meta.work_week === ww && s.meta.work_week_confirmed,
      });
      b.addEventListener('click', () => run(() => store.setWorkWeek(ww)));
      wk.append(b);
    }
    root.append(wk);
  }
  for (const d of s.decisions) {
    const box = el('div', { className: `panel decision-item${d.status === 'answered' ? ' answered' : ''}` });
    box.append(el('p', { text: `${d.n}. ${d.question}` }));
    if (d.status === 'answered') {
      box.append(el('p', { className: 'task-meta', text: d.answer }));
    } else if (s.canEdit) {
      const ta = el('textarea', { rows: '3', placeholder: 'Answer…' });
      const save = el('button', { className: 'btn btn-primary', type: 'button', text: 'Save answer' });
      save.addEventListener('click', () => run(() => store.updateDecision(d.n, ta.value)));
      box.append(ta, save);
    }
    root.append(box);
  }
}

function renderActivity(root, s) {
  if (!s.activity.length) {
    root.append(el('p', { className: 'task-meta', text: 'No activity yet.' }));
    return;
  }
  for (const a of s.activity) {
    const row = el('div', { className: 'activity-row' });
    row.textContent = `${a.at} · ${a.actor} · ${a.action} ${a.table_name} #${a.row_key}`;
    root.append(row);
  }
}

function renderComments(s) {
  if (commentTaskId == null) return null;
  const task = s.tasks.find((t) => t.id === commentTaskId);
  const backdrop = el('div', { className: 'drawer-backdrop' });
  backdrop.addEventListener('click', () => {
    commentTaskId = null;
    render();
  });
  const drawer = el('div', { className: 'drawer' });
  const close = el('button', { className: 'btn', type: 'button', text: 'Close' });
  close.addEventListener('click', () => {
    commentTaskId = null;
    render();
  });
  drawer.append(close, el('h2', { text: task?.title || 'Comments' }));
  const list = s.commentsByTask.get(commentTaskId) || [];
  for (const c of list) {
    const item = el('div', { className: 'comment' });
    item.append(el('div', { className: 'comment-meta', text: `${c.author} · ${c.at}` }));
    item.append(el('div', { text: c.body }));
    drawer.append(item);
  }
  if (s.isTeam && !s.preview) {
    const body = el('textarea', { rows: '3', placeholder: 'Add a comment…' });
    const post = el('button', { className: 'btn btn-primary', type: 'button', text: 'Post' });
    post.addEventListener('click', () =>
      run(async () => {
        await store.addComment(commentTaskId, body.value);
        body.value = '';
      }),
    );
    drawer.append(body, post);
  }
  return [backdrop, drawer];
}

function render() {
  const s = store.getState();
  const app = document.getElementById('app');
  app.replaceChildren();

  const top = el('div', { className: 'top-bar' });
  top.append(el('h1', { text: s.meta?.title || 'Delivery Dashboard' }));
  const tools = el('div', { className: 'toolbar' });
  const theme = el('button', { className: 'btn', type: 'button', text: 'Theme' });
  theme.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    if (next === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', next);
  });
  tools.append(theme);
  if (!s.preview && s.session) {
    const out = el('button', { className: 'btn', type: 'button', text: 'Sign out' });
    out.addEventListener('click', () => run(() => store.signOut()));
    tools.append(out);
  }
  top.append(tools);
  app.append(top);

  if (s.preview) app.append(el('div', { className: 'banner', text: 'Preview: not connected' }));
  if (s.error) app.append(el('div', { className: 'banner banner-error', text: s.error }));

  if (!s.preview && !s.session) {
    renderAuth(app);
    return;
  }
  if (!s.preview && s.session && !s.isTeam) {
    app.append(el('div', { className: 'banner banner-error', text: 'Your email is not on the team list.' }));
    return;
  }
  if (!s.ready || !s.meta) {
    app.append(el('p', { text: 'Loading…' }));
    return;
  }

  const tabs = el('div', { className: 'tabs', role: 'tablist' });
  for (const [id, label] of TABS) {
    const b = el('button', {
      className: 'tab',
      type: 'button',
      role: 'tab',
      'aria-selected': tab === id ? 'true' : 'false',
      text: label,
    });
    b.addEventListener('click', () => {
      tab = id;
      render();
    });
    tabs.append(b);
  }
  app.append(tabs);

  const body = el('div', { className: 'panel' });
  if (tab === 'overview') renderOverview(body, s);
  else if (tab === 'tasks') renderTasks(body, s);
  else if (tab === 'workdays') renderWorkdays(body, s);
  else if (tab === 'modules') renderModules(body, s);
  else if (tab === 'risks') renderRisks(body, s);
  else if (tab === 'activity') renderActivity(body, s);
  app.append(body);

  const drawer = renderComments(s);
  if (drawer) app.append(...drawer);
}

function initTheme() {
  if (localStorage.getItem('theme') === 'light') document.documentElement.setAttribute('data-theme', 'light');
}

initTheme();
store.subscribe(render);
store.init().catch((e) => {
  showToast(e?.message || String(e));
});
