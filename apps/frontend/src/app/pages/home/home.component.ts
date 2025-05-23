import { Component, inject } from '@angular/core';
import { HeaderComponent } from '../../components/header/header.component';
import { AboutComponent } from '../../components/about/about.component';
import { TestimonialsComponent } from '../../components/testimonials/testimonials.component';
import { FeaturesComponent } from '../../components/features/features.component';
import { FooterComponent } from '../../components/footer/footer.component';
import { ThemeButtonComponent } from '../../components/theme-button/theme-button.component';
import { CtaComponent } from '../../components/cta/cta.component';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'app-home',
  imports: [
    HeaderComponent,
    CtaComponent,
    AboutComponent,
    TestimonialsComponent,
    FeaturesComponent,
    FooterComponent,
    ThemeButtonComponent,
  ],
  template: `
    <div
      class="min-h-screen transition-colors duration-300 bg-white dark:bg-gray-900"
      [class.dark]="themeService.isDarkMode()"
    >
      <app-theme-button></app-theme-button>
      <app-header></app-header>
      <app-about></app-about>
      <app-features></app-features>
      <app-testimonials></app-testimonials>
      <app-cta></app-cta>
      <app-footer></app-footer>
    </div>
  `,
})
export class HomeComponent {
  themeService = inject(ThemeService);
}
