import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { DEMO_PROFILE } from './demo';
import { Login } from './login';

describe('Login', () => {
  it('renders provider actions in the sidebar and emits login events', () => {
    const fixture = TestBed.createComponent(Login);
    fixture.componentRef.setInput('placement', 'sidebar');
    fixture.detectChanges();
    const githubLogin = vi.fn();
    const atprotoLogin = vi.fn();
    fixture.componentInstance.githubLogin.subscribe(githubLogin);
    fixture.componentInstance.atprotoLogin.subscribe(atprotoLogin);

    const html = fixture.nativeElement as HTMLElement;
    expect(html.classList.contains('sidebar-bottom')).toBe(true);
    expect(html.textContent).toContain('BUILT FOR HUMANS. & AGENTS.');
    html.querySelector<HTMLButtonElement>('.github-button')!.click();
    html.querySelector<HTMLButtonElement>('.atproto-button')!.click();
    expect(githubLogin).toHaveBeenCalledOnce();
    expect(atprotoLogin).toHaveBeenCalledOnce();
  });

  it('renders the signed-in account and disables sign-out while saving', () => {
    const fixture = TestBed.createComponent(Login);
    fixture.componentRef.setInput('placement', 'sidebar');
    fixture.componentRef.setInput('viewer', DEMO_PROFILE);
    fixture.componentRef.setInput('saving', true);
    fixture.detectChanges();
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('.account')?.textContent).toContain(DEMO_PROFILE.name);
    expect(html.querySelector('.avatar')?.textContent).toContain('AC');
    expect(html.querySelector('.account')?.textContent).toContain(`@${DEMO_PROFILE.username}`);
    expect(html.querySelector('.account [aria-label="Sign out"]')).toMatchObject({
      disabled: true,
    });
  });

  it.each([
    ['header', 'GitHub', 'AT Protocol'],
    ['profile', 'Sign in with GitHub', 'Sign in with AT Protocol'],
    ['agents', 'Connect with GitHub', 'Connect with AT Protocol'],
  ] as const)(
    'renders %s provider actions and emits login events',
    (placement, github, atproto) => {
      const fixture = TestBed.createComponent(Login);
      fixture.componentRef.setInput('placement', placement);
      fixture.detectChanges();
      const githubLogin = vi.fn();
      const atprotoLogin = vi.fn();
      fixture.componentInstance.githubLogin.subscribe(githubLogin);
      fixture.componentInstance.atprotoLogin.subscribe(atprotoLogin);
      const buttons = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')];
      expect(buttons.map((button) => button.textContent?.trim())).toEqual([github, atproto]);
      buttons[0].click();
      buttons[1].click();
      expect(githubLogin).toHaveBeenCalledOnce();
      expect(atprotoLogin).toHaveBeenCalledOnce();
    },
  );
});
