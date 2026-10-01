// Start-up helpers: the page must never sit blank. The sign-in library comes from an outside
// server; when that is slow or blocked, the user is told so, with what to do.

/** `promise`, or a rejection with `message` if it has not settled within `ms`. */
export function withTimeout(promise, ms, message) {
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

/** The plain message shown in place of the page when start-up fails. */
export function bootErrorMessage(error) {
  const reason = error?.message || (error ? String(error) : '');
  return 'The dashboard could not load. Check your internet connection, then press Ctrl+F5. '
    + 'If it keeps happening, tell the project team.' + (reason ? ` (${reason})` : '');
}
