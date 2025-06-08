import { Component, signal } from '@angular/core';
import { ICON_NAME } from '../../../../shared/directives/svg';
import { SvgIconDirective } from '../../../../shared/directives/svg/svg-icon';

@Component({
  selector: 'app-footer',
  imports: [SvgIconDirective],
  template: `
    <footer class="py-12 text-gray-300 bg-gray-900">
      <div class="px-4 mx-auto max-w-7xl sm:px-6 lg:px-8">
        <div class="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div>
            <h3 class="mb-4 text-xl font-bold text-white">Devs Who Run</h3>
            <p class="text-gray-400">
              Balancing code and cardio, one step at a time.
            </p>
          </div>
          <div>
            <h3 class="mb-4 text-xl font-bold text-white">Quick Links</h3>
            <ul class="space-y-2">
              <li>
                <a href="#about" class="transition-colors hover:text-white"
                  >About</a
                >
              </li>
              <li>
                <a href="#features" class="transition-colors hover:text-white"
                  >Features</a
                >
              </li>
              <li>
                <a
                  href="#testimonials"
                  class="transition-colors hover:text-white"
                  >Testimonials</a
                >
              </li>
            </ul>
          </div>
          <div>
            <h3 class="mb-4 text-xl font-bold text-white">Connect</h3>
            <ul class="space-y-2">
              <li>
                <a
                  href="https://discord.gg/gjPdvKjFx3"
                  class="inline-flex gap-1 items-center transition-colors hover:text-white"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Discord
                  <span
                    appSvgIcon
                    [iconName]="iconName.discord"
                    iconClass="w-5 h-5 ml-1"
                  ></span>
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/devs-who-run/devswhomove"
                  class="inline-flex gap-1 items-center transition-colors hover:text-white"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                  <span
                    appSvgIcon
                    [iconName]="iconName.github"
                    iconClass="w-5 h-5 ml-1"
                  ></span>
                </a>
              </li>
            </ul>
          </div>
        </div>
        <div class="pt-8 mt-8 text-center border-t border-gray-800">
          <p>&copy; {{ currentYear() }} Devs Who Run. All rights reserved.</p>
          <p>
            Made with passion for running by
            <a
              href="https://github.com/santoshyadavdev"
              class="text-blue-400 transition-colors hover:text-white"
              target="_blank"
              rel="noopener noreferrer"
              >Santosh Yadav</a
            >.
          </p>
        </div>
      </div>
    </footer>
    <span appSvgIcon iconName="smile" iconClass="hidden"></span>
  `,
})
export class FooterComponent {
  protected readonly iconName = ICON_NAME;
  protected readonly currentYear = signal(new Date().getFullYear());
}
