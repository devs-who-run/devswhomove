'use strict';

class CodingSession {
  constructor() {
    this.reset();
  }

  reset() {
    this.firstEdit = null;
    this.lastEdit = null;
  }

  recordEdit(now, reminderMs, idleMs) {
    if (this.lastEdit === null || now < this.lastEdit || now - this.lastEdit >= idleMs) {
      this.firstEdit = now;
      this.lastEdit = now;
      return false;
    }
    this.lastEdit = now;
    if (now - this.firstEdit < reminderMs) return false;
    this.reset();
    return true;
  }
}

function parseDuration(value) {
  if (!/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const duration = Number(value);
  return Number.isFinite(duration) && duration >= 1 && duration <= 1440 ? duration : null;
}

function activityUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Configure a valid Devs Who Move server origin.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Use an HTTPS server origin (or HTTP localhost), without a path or credentials.');
  }
  return new URL('/api/activities', url);
}

async function uploadWalk(url, token, duration, completedAt, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Walking break',
        sport: 'Walking',
        occurredAt: new Date(completedAt.getTime() - duration * 60_000).toISOString(),
        duration,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('The request failed or timed out. Check your activities before trying again; the walk may have been saved.');
  }
  if (!response.ok) {
    if (response.status >= 500) {
      throw new Error(`Server returned HTTP ${response.status}. Check your activities before trying again; the walk may have been saved.`);
    }
    throw new Error(`Server returned HTTP ${response.status}. Check your token and server settings before trying again.`);
  }
}

module.exports = { CodingSession, parseDuration, activityUrl, uploadWalk };
