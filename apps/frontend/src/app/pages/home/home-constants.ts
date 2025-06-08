import { AboutDetail, Feature, Testimonial } from './types';

export const testimonials: Testimonial[] = [
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

export const aboutDetails: AboutDetail[] = [
  {
    icon: '🏃‍♂️',
    title: 'Run Together',
    description:
      'Join virtual running sessions and local meetups with fellow developers.',
  },
  {
    icon: '💻',
    title: 'Code Together',
    description:
      'Collaborate on open-source projects and share technical knowledge.',
  },
  {
    icon: '🎯',
    title: 'Grow Together',
    description:
      'Set goals, track progress, and celebrate achievements together.',
  },
];

export const features: Feature[] = [
  {
    title: 'Weekly Challenges',
    description: 'Participate in coding challenges and running goals.',
    icon: '🎯',
  },
  {
    title: 'Virtual Events',
    description: 'Join online meetups and virtual running sessions.',
    icon: '🌐',
  },
  {
    title: 'Tech Talks',
    description: 'Learn from experienced developers and runners.',
    icon: '🎤',
  },
  {
    title: 'Progress Tracking',
    description: 'Track your running and coding achievements.',
    icon: '📊',
  },
];
