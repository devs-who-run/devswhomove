import { Component, signal } from '@angular/core';
import { HeaderComponent } from './components/header/header';
import { CtaComponent } from './components/cta/cta';
import { AboutComponent } from './components/about/about';
import { TestimonialsComponent } from './components/testimonials/testimonials';
import { FeaturesComponent } from './components/features/features';
import { FooterComponent } from './components/footer/footer';
import { ThemeButtonComponent } from './components/theme-button/theme-button';
import { testimonials, aboutDetails, features } from './home-constants';

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
    <app-theme-button />
    <app-header />
    <app-about [aboutDetails]="aboutDetails()" />
    <app-features [features]="features()" />
    <app-testimonials [testimonials]="testimonials()" />
    <app-cta />
    <app-footer />
  `,
})
export default class HomeComponent {
  testimonials = signal(testimonials);
  aboutDetails = signal(aboutDetails);
  features = signal(features);
}
