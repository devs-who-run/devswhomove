import { Component, signal } from '@angular/core';
import { AboutComponent } from './components/about/about';
import { TestimonialsComponent } from './components/testimonials/testimonials';
import { FeaturesComponent } from './components/features/features';
import { NavigationComponent } from '../../shared/components/navigation.component';
import { testimonials, aboutDetails, features } from './landing-constants';

@Component({
  selector: 'app-home',
  imports: [
    NavigationComponent,
    AboutComponent,
    TestimonialsComponent,
    FeaturesComponent,
  ],
  template: `
    <app-navigation />
    <app-about [aboutDetails]="aboutDetails()" />
    <app-features [features]="features()" />
    <app-testimonials [testimonials]="testimonials()" />
  `,
})
export default class HomeComponent {
  testimonials = signal(testimonials);
  aboutDetails = signal(aboutDetails);
  features = signal(features);
}
