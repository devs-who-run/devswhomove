import { Component, signal } from '@angular/core';
import { SvgIconDirective } from '../../../shared/directives/svg/svg-icon';
import { ICON_NAME } from '../../../shared/directives/svg';

@Component({
  selector: 'app-footer',
  imports: [SvgIconDirective],
  template: `
    <footer class="footer-bg">
      <div class="section-container">
        <div class="grid grid-cols-1 gap-8 md:grid-cols-3">
          <div>
            <h3 class="text-footer-title">Devs Who Run</h3>
            <p class="text-footer-description">
              Balancing code and cardio, one step at a time.
            </p>
          </div>
          <div>
            <h3 class="text-footer-title">Quick Links</h3>
            <ul class="space-y-2">
              <li>
                <a href="#about" class="footer-link">About</a>
              </li>
              <li>
                <a href="#features" class="footer-link">Features</a>
              </li>
              <li>
                <a href="#testimonials" class="footer-link">Testimonials</a>
              </li>
            </ul>
          </div>
          <div>
            <h3 class="text-footer-title">Connect</h3>
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
              class="profile-link"
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
