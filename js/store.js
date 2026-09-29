let supabase = null;
let onChange = () => {};
let state = emptyState();

function emptyState() {
  return {
    preview: true,
    ready: false,
    error: '',
    session: null,
    isTeam: false,
    canEdit: false,
    myName: '',
    meta: null,
    holidays: [],
    tasks: [],
    modules: [],
    risks: [],
    decisions: [],
    commentsByTask: new Map(),
    activity: [],
  };
}

async function loadConfig() {
  try {
    const m = await import('./config.js');
    if (m.SUPABASE_URL && m.SUPABASE_ANON_KEY) return m;
  } catch {
    /* preview */
  }
  return null;
}

function seedToState(raw) {
  const tasks = raw.tasks.map((t, i) => ({ id: i + 1, ...t }));
  const modules = raw.modules.map((m, i) => ({ id: i + 1, ...m }));
  return {
    preview: true,
    ready: true,
    error: '',
    session: null,
    isTeam: true,
    canEdit: false,
    myName: '',
    meta: { id: 1, ...raw.meta },
    holidays: (raw.holidays || []).map((h) =>
      typeof h === 'string' ? { day: h, label: '' } : h,
    ),
    tasks,
    modules,
    risks: raw.risks,
    decisions: raw.decisions,
    commentsByTask: new Map(),
    activity: [],
  };
}

async function loadPreview() {
  const res = await fetch('data/seed.json');
  if (!res.ok) throw new Error('Could not load seed data');
  state = seedToState(await res.json());
}

async function refreshAll() {
  const [meta, holidays, tasks, modules, risks, decisions, comments, activity] =
    await Promise.all([
      supabase.from('plan_meta').select('*').eq('id', 1).single(),
      supabase.from('holiday').select('*').order('day'),
      supabase.from('task').select('*').order('sort'),
      supabase.from('module').select('*').order('sort'),
      supabase.from('risk').select('*').order('n'),
      supabase.from('decision').select('*').order('n'),
      supabase.from('task_comment').select('*').order('at'),
      supabase.from('activity').select('*').order('at', { ascending: false }).limit(50),
    ]);
  for (const r of [meta, holidays, tasks, modules, risks, decisions, comments, activity]) {
    if (r.error) throw r.error;
  }
  const commentsByTask = new Map();
  for (const c of comments.data) {
    const list = commentsByTask.get(c.task_id) || [];
    list.push(c);
    commentsByTask.set(c.task_id, list);
  }
  state = {
    ...state,
    ready: true,
    preview: false,
    meta: meta.data,
    holidays: holidays.data,
    tasks: tasks.data,
    modules: modules.data,
    risks: risks.data,
    decisions: decisions.data,
    commentsByTask,
    activity: activity.data,
  };
}

async function refreshAccess() {
  const [{ data: team }, { data: edit }, { data: name }] = await Promise.all([
    supabase.rpc('is_team'),
    supabase.rpc('can_edit'),
    supabase.rpc('my_name'),
  ]);
  state.isTeam = !!team;
  state.canEdit = !!edit;
  state.myName = name || '';
}

let channelStarted = false;
function realtimeChannel() {
  if (!supabase || state.preview || channelStarted) return;
  channelStarted = true;
  supabase
    .channel('dashboard')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'plan_meta' },
      () => refreshAll().then(notify).catch(setErr),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'holiday' },
      () => refreshAll().then(notify).catch(setErr),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'task' },
      () => refreshAll().then(notify).catch(setErr),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'task_comment' },
      () => refreshAll().then(notify).catch(setErr),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'module' },
      () => refreshAll().then(notify).catch(setErr),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'risk' },
      () => refreshAll().then(notify).catch(setErr),
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'decision' },
      () => refreshAll().then(notify).catch(setErr),
    )
    .subscribe();
}

function setErr(e) {
  state.error = e?.message || String(e);
  notify();
}

function notify() {
  onChange();
}

export function subscribe(fn) {
  onChange = fn;
}

export function getState() {
  return state;
}

export async function init() {
  const cfg = await loadConfig();
  if (!cfg) {
    await loadPreview();
    notify();
    return;
  }
  const { createClient } = await import(
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'
  );
  supabase = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  state.preview = false;
  const { data: sub } = supabase.auth.onAuthStateChange(async (_ev, session) => {
    state.session = session;
    if (!session) {
      state.ready = false;
      state.isTeam = false;
      notify();
      return;
    }
    try {
      await refreshAccess();
      if (!state.isTeam) {
        state.ready = true;
        notify();
        return;
      }
      await refreshAll();
      realtimeChannel();
      notify();
    } catch (e) {
      setErr(e);
    }
  });
  state.session = (await supabase.auth.getSession()).data.session;
  if (state.session) {
    await refreshAccess();
    if (state.isTeam) {
      await refreshAll();
      realtimeChannel();
    }
  }
  notify();
  return sub;
}

export function canChangeTask(task) {
  if (state.preview) return false;
  if (!state.isTeam) return false;
  if (state.canEdit) return true;
  return task.owner === state.myName;
}

export async function signInWithPassword(email, password) {
  if (!supabase) throw new Error('Not connected');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signInWithOtp(email) {
  if (!supabase) throw new Error('Not connected');
  // The link must come back to this page; the address must also be in Supabase's allowed
  // redirect URLs, or Supabase sends the user to its Site URL instead.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: window.location.origin + window.location.pathname },
  });
  if (error) throw error;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}

async function reloadTask(id) {
  const { data, error } = await supabase.from('task').select('*').eq('id', id).single();
  if (error) throw error;
  state.tasks = state.tasks.map((t) => (t.id === id ? data : t));
  notify();
}

export async function updateTask(id, patch) {
  if (state.preview) throw new Error('Preview mode: changes are not saved');
  const allowed = {};
  if ('status' in patch) allowed.status = patch.status;
  if ('note' in patch) allowed.note = patch.note;
  if ('link' in patch) {
    const link = patch.link.trim();
    if (link && !link.toLowerCase().startsWith('https://')) {
      throw new Error('Link must start with https://');
    }
    allowed.link = link;
  }
  const { error } = await supabase.from('task').update(allowed).eq('id', id);
  if (error) {
    await reloadTask(id);
    throw error;
  }
  await refreshAll();
  notify();
}

export async function addComment(taskId, body) {
  if (state.preview) throw new Error('Preview mode: changes are not saved');
  const text = body.trim();
  if (!text) throw new Error('Comment cannot be empty');
  const { error } = await supabase.from('task_comment').insert({ task_id: taskId, body: text });
  if (error) throw error;
  await refreshAll();
  notify();
}

export async function addHoliday(day, label = '') {
  if (state.preview) throw new Error('Preview mode');
  const { error } = await supabase.from('holiday').insert({ day, label });
  if (error) throw error;
  await refreshAll();
  notify();
}

export async function removeHoliday(day) {
  if (state.preview) throw new Error('Preview mode');
  const { error } = await supabase.from('holiday').delete().eq('day', day);
  if (error) throw error;
  await refreshAll();
  notify();
}

export async function updateDecision(n, answer) {
  if (state.preview) throw new Error('Preview mode');
  const { error } = await supabase.from('decision').update({ answer }).eq('n', n);
  if (error) throw error;
  await refreshAll();
  notify();
}

export async function setWorkWeek(workWeek) {
  if (state.preview) throw new Error('Preview mode');
  const { error } = await supabase
    .from('plan_meta')
    .update({ work_week: workWeek, work_week_confirmed: true })
    .eq('id', 1);
  if (error) throw error;
  await refreshAll();
  notify();
}
