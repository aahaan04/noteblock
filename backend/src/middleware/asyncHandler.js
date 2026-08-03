// Express 4 does not catch a rejected promise thrown from an async route
// handler — it becomes an unhandled rejection, which (Node >= 15) terminates
// the process by default. A single transient Supabase network error in any
// unwrapped handler would otherwise take the whole server down for every
// venue at once, not just fail one request. Wrapping every handler with this
// forwards the error to Express's own error middleware instead.
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
