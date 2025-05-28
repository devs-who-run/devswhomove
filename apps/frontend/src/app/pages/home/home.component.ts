import { Component } from '@angular/core';
import { HeaderComponent } from '../../components/header/header.component';
import { AboutComponent } from '../../components/about/about.component';
import { TestimonialsComponent } from '../../components/testimonials/testimonials.component';
import { FeaturesComponent } from '../../components/features/features.component';
import { FooterComponent } from '../../components/footer/footer.component';
import { ThemeButtonComponent } from '../../components/theme-button/theme-button.component';
import { CtaComponent } from '../../components/cta/cta.component';

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
    <app-theme-button></app-theme-button>
    <app-header></app-header>
    <app-about></app-about>
    <app-features></app-features>
    <app-testimonials></app-testimonials>
    <app-cta></app-cta>
    <app-footer></app-footer>
  `,
})
export class HomeComponent {}
