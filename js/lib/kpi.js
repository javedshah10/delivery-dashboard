/** @param {{ day_end: number, status: string }[]} tasks @param {number} todayDay */
export function taskKpis(tasks, todayDay) {
  let due = 0;
  let done = 0;
  let late = 0;
  let blocked = 0;
  for (const t of tasks) {
    if (t.status === 'blocked') blocked += 1;
    if (t.day_end > todayDay) continue;
    due += 1;
    if (t.status === 'done') done += 1;
    else late += 1;
  }
  const behind = due - done;
  return { due, done, late, blocked, behind, onTrack: behind <= 0 };
}

/** @param {{ owner: string, status: string }[]} tasks */
export function ownerProgress(tasks) {
  const totals = new Map();
  const done = new Map();
  for (const t of tasks) {
    totals.set(t.owner, (totals.get(t.owner) || 0) + 1);
    if (t.status === 'done') done.set(t.owner, (done.get(t.owner) || 0) + 1);
  }
  const out = {};
  for (const [owner, total] of totals) {
    const d = done.get(owner) || 0;
    out[owner] = total ? Math.round((d / total) * 100) : 0;
  }
  return out;
}
