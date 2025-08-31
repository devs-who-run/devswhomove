import { AppComponent } from './app.component';
import { TestBed } from '@angular/core/testing';
import { RouterModule } from '@angular/router';
import { ThemeService } from './core/services/theme.service';
import { PLATFORM_ID } from '@angular/core';
import { provideHttpClient } from '@angular/common/http';

describe('App', () => {
  beforeEach(async () => {
    const mockMatchMedia = (query: string) => {
      return {
        matches: false,
        media: query,
        onchange: null,
      };
    };

    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: mockMatchMedia,
    });

    await TestBed.configureTestingModule({
      imports: [AppComponent, RouterModule.forRoot([])],
      providers: [ThemeService, { provide: PLATFORM_ID, useValue: 'browser' }, provideHttpClient()],
    }).compileComponents();
  });

  it(`should have as title 'Devs Who Run'`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('Devs Who Run');
  });
});
