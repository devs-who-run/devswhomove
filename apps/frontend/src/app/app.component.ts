import { Component, inject } from '@angular/core';
import { RouterModule } from '@angular/router';
import { ThemeService } from './core/services/theme.service';

@Component({
  imports: [RouterModule],
  selector: 'app-root',
  templateUrl: './app.html',
})
export class AppComponent {
  title = 'Devs Who Run';
  public readonly themeService = inject(ThemeService);
}
