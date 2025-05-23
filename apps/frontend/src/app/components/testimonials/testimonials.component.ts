import { Component } from '@angular/core';

type Testimonial = {
  quote: string;
  author: string;
  role: string;
  avatar: string;
};

@Component({
  selector: 'app-testimonials',
  template: `
    <section class="py-20 bg-white dark:bg-gray-900">
      <div class="px-4 mx-auto max-w-7xl sm:px-6 lg:px-8">
        <h2
          class="mb-16 text-3xl font-extrabold text-center text-gray-900 dark:text-white"
        >
          What Our Members Say
        </h2>
        <div class="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
          @for (testimonial of testimonials; track testimonial.author) {
          <div class="p-8 bg-gray-50 rounded-xl shadow-lg dark:bg-gray-800">
            <p class="mb-6 italic text-gray-600 dark:text-gray-300">
              "{{ testimonial.quote }}"
            </p>
            <div class="flex items-center">
              <img
                [src]="testimonial.avatar"
                [alt]="testimonial.author + ' avatar'"
                class="w-12 h-12 rounded-full"
                loading="lazy"
              />
              <div class="ml-4">
                <h4 class="font-semibold text-gray-900 dark:text-white">
                  {{ testimonial.author }}
                </h4>
                <p class="text-gray-500 dark:text-gray-400">
                  {{ testimonial.role }}
                </p>
              </div>
            </div>
          </div>
          }
        </div>
      </div>
    </section>
  `,
})
export class TestimonialsComponent {
  testimonials: Testimonial[] = [
    {
      quote:
        'This community helped me maintain a healthy work-life balance while improving both my coding skills and running performance.',
      author: 'Santosh Yadav',
      role: 'Senior Software Engineer',
      avatar: 'https://avatars.githubusercontent.com/u/11923975?v=4',
    },
    {
      quote:
        'Found an amazing group of like-minded developers who share my passion for running and clean code.',
      author: 'Sashikumar Yadav',
      role: 'Senior Software Engineer',
      avatar: 'https://avatars.githubusercontent.com/u/21971232?v=4',
    },
    {
      quote:
        'The weekly challenges keep me motivated to code better and run faster. Best community ever!',
      author: 'Codiini',
      role: 'Senior Developer',
      avatar: 'https://avatars.githubusercontent.com/u/57962747?v=4',
    },
  ];
}
