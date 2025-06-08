import {
  Directive,
  ElementRef,
  inject,
  input,
  OnInit,
  Renderer2,
} from '@angular/core';
import { SVG_ICONS } from './svg-icon-constants';
import { Icon } from './types';

@Directive({
  selector: '[appSvgIcon]',
})
export class SvgIconDirective implements OnInit {
  iconName = input.required<Icon>();
  iconClass = input<string>('');
  fill = input<string>('currentColor');

  private readonly el = inject(ElementRef);
  private readonly renderer = inject(Renderer2);

  ngOnInit(): void {
    if (!this.iconName() || !SVG_ICONS[this.iconName()]) {
      console.error(`SVG icon not found: ${this.iconName()}`);
      return;
    }

    const svgString = SVG_ICONS[this.iconName()];
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.error(
        `Failed to parse SVG for icon: ${this.iconName()}`,
        parseError
      );
      return;
    }
    const svgElement = doc.documentElement;

    if (this.iconClass()) {
      const classes = this.iconClass().split(' ');
      classes.forEach((className) => {
        if (className) {
          this.renderer.addClass(svgElement, className);
        }
      });
    }
    const fillableElements = svgElement.querySelectorAll(
      'path, rect, circle, ellipse, polygon, polyline'
    );
    fillableElements.forEach((element) => {
      element.setAttribute('fill', this.fill());
    });

    const paths = svgElement.querySelectorAll('path');
    paths.forEach((path) => {
      path.setAttribute('fill', this.fill());
    });

    this.renderer.setProperty(this.el.nativeElement, 'innerHTML', '');
    this.renderer.appendChild(this.el.nativeElement, svgElement);
  }
}
