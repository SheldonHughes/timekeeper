// Shared formatting/date helpers used by both the cab tablet app and
// the supervisor dashboard.

export function todayStr(d = new Date()) {
  return dateStr(d);
}

export function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatClock(d) {
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDayLabel(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatShortDate(dateString) {
  const [y, m, d] = dateString.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// HH:MM:SS elapsed timer, used for the running clocked-in display.
export function formatElapsed(startDate, now = new Date()) {
  let totalSeconds = Math.max(0, Math.floor((now - startDate) / 1000));
  const h = Math.floor(totalSeconds / 3600);
  totalSeconds -= h * 3600;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds - m * 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatHours(totalSeconds) {
  return (totalSeconds / 3600).toFixed(1);
}

export function jobLabel(job) {
  if (!job) return '';
  return `${job.ownerName} — ${job.jobName}`;
}

// Turns a "6:32 AM"-style <input type="time"> value plus a base date
// into a real Date, used by the edit-time screen.
export function timeInputToDate(baseDate, timeValue) {
  const [h, m] = timeValue.split(':').map(Number);
  const d = new Date(baseDate);
  d.setHours(h, m, 0, 0);
  return d;
}

export function dateToTimeInput(d) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function uid() {
  return crypto.randomUUID();
}

// "2 hrs ago" / "yesterday" style relative label, used on the
// supervisor dashboard's approval queue.
export function timeAgo(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
