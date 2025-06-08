import { ICON_NAME } from './svg-icon-constants';

export type Icon = (typeof ICON_NAME)[keyof typeof ICON_NAME];
