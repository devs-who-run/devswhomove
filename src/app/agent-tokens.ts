import { signal, type WritableSignal } from '@angular/core';
import { errorMessage, request } from './api';
import type { AgentScope, AgentToken } from './models';

interface AgentContext {
  action(work: () => Promise<void>): Promise<void>;
  signedIn(): boolean;
  error: WritableSignal<string>;
  notice: WritableSignal<string>;
}

export class AgentTokens {
  readonly tokens = signal<AgentToken[]>([]);
  readonly newToken = signal('');
  name = '';
  write = true;
  read = true;
  events = false;

  constructor(private readonly context: AgentContext) {}

  async load(): Promise<void> {
    try {
      this.tokens.set((await request<{ tokens: AgentToken[] }>('/api/tokens')).tokens);
    } catch (error) {
      this.context.error.set(errorMessage(error));
    }
  }

  async create(): Promise<void> {
    if (!this.context.signedIn()) return;
    await this.context.action(async () => {
      const scopes: AgentScope[] = [];
      if (this.read) scopes.push('activities:read');
      if (this.write) scopes.push('activities:write');
      if (this.events) scopes.push('events:read');
      const result = await request<{ token: string }>('/api/tokens', 'POST', {
        name: this.name,
        scopes,
      });
      this.newToken.set(result.token);
      this.name = '';
      await this.load();
    });
  }

  async revoke(token: AgentToken): Promise<void> {
    if (!window.confirm(`Revoke access for "${token.name}"?`)) return;
    await this.context.action(async () => {
      await request(`/api/tokens/${token.id}`, 'DELETE');
      this.newToken.set('');
      await this.load();
      this.context.notice.set('Agent access revoked.');
    });
  }

  clear(): void {
    this.newToken.set('');
    this.tokens.set([]);
  }
}
