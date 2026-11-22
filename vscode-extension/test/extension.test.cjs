'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

test('reminders never upload and a completed walk requires explicit public confirmation', async () => {
  const commands = {};
  const listeners = {};
  const values = { enabled: true, reminderMinutes: 1, idleMinutes: 1, serverUrl: 'https://example.com' };
  const document = {};
  let action;
  let confirmation;
  let uploads = 0;
  const vscode = {
    commands: { registerCommand: (name, handler) => { commands[name] = handler; return {}; } },
    workspace: {
      getConfiguration: () => ({ get: (name) => values[name] }),
      onDidChangeConfiguration: (handler) => { listeners.config = handler; return {}; },
      onDidChangeTextDocument: (handler) => { listeners.edit = handler; return {}; },
    },
    window: {
      state: { focused: true },
      visibleTextEditors: [{ document }],
      onDidChangeWindowState: (handler) => { listeners.focus = handler; return {}; },
      showInformationMessage: async () => action,
      showWarningMessage: async () => confirmation,
      showInputBox: async () => '10',
      showErrorMessage: () => {},
    },
  };
  const originalLoad = Module._load;
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  try {
    Module._load = function (request, ...args) {
      return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args);
    };
    global.fetch = async () => { uploads++; return { ok: true }; };
    let now = 0;
    Date.now = () => now;
    const { activate } = require('../extension.cjs');
    activate({ subscriptions: [], secrets: { get: async () => 'secret', store: async () => {}, delete: async () => {} } });
    const edit = () => listeners.edit({ document, contentChanges: [{}] });
    await edit();
    now = 30_000;
    await edit();
    now = 60_000;
    action = 'Not now';
    await edit();
    assert.equal(uploads, 0);

    confirmation = undefined;
    await commands['devsWhoMove.logWalk']();
    assert.equal(uploads, 0);
    confirmation = 'Log public walk';
    await commands['devsWhoMove.logWalk']();
    assert.equal(uploads, 1);

    const pending = [];
    vscode.window.showInformationMessage = () => new Promise((resolve) => pending.push(resolve));
    now = 120_000;
    await edit();
    now = 150_000;
    await edit();
    now = 180_000;
    const firstReminder = edit();
    assert.equal(pending.length, 1);

    now = 210_000;
    await edit();
    now = 240_000;
    await edit();
    now = 270_000;
    const secondReminder = edit();
    assert.equal(pending.length, 2);

    now = 300_000;
    await edit();
    now = 330_000;
    await edit();
    pending[0]('Not now');
    await firstReminder;
    now = 360_000;
    const thirdReminder = edit();
    assert.equal(pending.length, 3);
    assert.equal(uploads, 1);
    pending[1]('Not now');
    pending[2]('Not now');
    await Promise.all([secondReminder, thirdReminder]);
  } finally {
    Module._load = originalLoad;
    global.fetch = originalFetch;
    Date.now = originalNow;
  }
});
