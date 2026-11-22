'use strict';

const vscode = require('vscode');
const { CodingSession, activityUrl, parseDuration, uploadWalk } = require('./nudges.cjs');

const TOKEN_KEY = 'devsWhoMove.agentToken';

function activate(context) {
  const session = new CodingSession();
  let logging = false;
  const config = () => vscode.workspace.getConfiguration('devsWhoMove');

  async function logWalk() {
    if (logging) return;
    logging = true;
    try {
      const token = await context.secrets.get(TOKEN_KEY);
      if (!token) {
        vscode.window.showErrorMessage('Set an agent token using "Devs Who Move: Set Agent Token" first.');
        return;
      }
      const value = await vscode.window.showInputBox({
        prompt: 'How many minutes was your completed walk?',
        validateInput: (input) => parseDuration(input) === null ? 'Enter a number from 1 to 1440.' : undefined,
        ignoreFocusOut: true,
      });
      if (value === undefined) return;
      const duration = parseDuration(value);
      if (duration === null) return;
      const confirmed = await vscode.window.showWarningMessage(
        'Log this completed walk? Agent-created activities are public; profile privacy still applies.',
        { modal: true },
        'Log public walk',
      );
      if (confirmed !== 'Log public walk') return;
      const url = activityUrl(config().get('serverUrl'));
      await uploadWalk(url, token, duration, new Date());
      vscode.window.showInformationMessage('Your completed walk was logged.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error.';
      vscode.window.showErrorMessage(`Could not log the walk: ${message}`);
    } finally {
      logging = false;
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('devsWhoMove.setToken', async () => {
      const token = await vscode.window.showInputBox({
        prompt: 'Enter an agent token with activities:write permission',
        password: true,
        ignoreFocusOut: true,
      });
      if (token === undefined) return;
      if (!token.trim()) {
        vscode.window.showErrorMessage('Agent token cannot be empty.');
        return;
      }
      await context.secrets.store(TOKEN_KEY, token.trim());
      vscode.window.showInformationMessage('Devs Who Move agent token saved in VS Code secret storage.');
    }),
    vscode.commands.registerCommand('devsWhoMove.clearToken', async () => {
      await context.secrets.delete(TOKEN_KEY);
      vscode.window.showInformationMessage('Devs Who Move agent token removed.');
    }),
    vscode.commands.registerCommand('devsWhoMove.logWalk', logWalk),
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) session.reset();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('devsWhoMove')) session.reset();
    }),
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      if (!event.contentChanges.length || !vscode.window.state.focused || !config().get('enabled')) return;
      if (!vscode.window.visibleTextEditors.some((editor) => editor.document === event.document)) return;
      const reminder = config().get('reminderMinutes');
      const idle = config().get('idleMinutes');
      if (!Number.isFinite(reminder) || reminder < 1 || reminder > 480 ||
          !Number.isFinite(idle) || idle < 1 || idle > 60) return;
      if (!session.recordEdit(Date.now(), reminder * 60_000, idle * 60_000)) return;
      const action = await vscode.window.showInformationMessage(
        'You have been coding for a while. How about a walk?',
        'Log a completed walk',
        'Not now',
      );
      if (action === 'Log a completed walk') await logWalk();
    }),
  );
}

module.exports = { activate };
