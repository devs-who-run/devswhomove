import type { Activity, Profile, SportEvent } from './models';

const ago = (days: number, hour: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

export const DEMO_PROFILE: Profile = {
  id: 'preview-avery',
  username: 'averybuilds',
  name: 'Avery Chen',
  avatar: '',
  bio: 'Building things on the internet. Finding balance on the trails. Always up for an easy run and a good coffee.',
  location: 'Berlin, Germany',
  sports: ['Running', 'Cycling', 'Tennis'],
  visibility: 'public',
};

export const DEMO_ACTIVITIES: Activity[] = [
  {
    id: 'preview-1',
    userId: 'preview-avery',
    username: 'averybuilds',
    name: 'Avery Chen',
    avatar: '',
    title: 'Less screen time. More green time.',
    sport: 'Running',
    occurredAt: ago(0, 7),
    duration: 34,
    distance: 5.2,
    notes: 'An easy loop before the first standup. The best kind of morning reset.',
    visibility: 'public',
    source: 'agent',
  },
  {
    id: 'preview-2',
    userId: 'preview-jordan',
    username: 'jordanonbikes',
    name: 'Jordan Ellis',
    avatar: '',
    title: 'Taking the scenic route home',
    sport: 'Cycling',
    occurredAt: ago(1, 18),
    duration: 72,
    distance: 24.8,
    notes:
      'Closed the laptop, chased the last bit of light. No personal records, just a really good ride.',
    visibility: 'public',
    source: 'web',
  },
  {
    id: 'preview-3',
    userId: 'preview-sam',
    username: 'samslices',
    name: 'Sam Rivera',
    avatar: '',
    title: 'A different kind of pair programming',
    sport: 'Tennis',
    occurredAt: ago(1, 17),
    duration: 60,
    distance: null,
    notes: 'An hour of doubles with the local dev crew. Still debugging my backhand.',
    visibility: 'public',
    source: 'web',
  },
  {
    id: 'preview-4',
    userId: 'preview-avery',
    username: 'averybuilds',
    name: 'Avery Chen',
    avatar: '',
    title: 'A little headspace',
    sport: 'Walking',
    occurredAt: ago(2, 12),
    duration: 28,
    distance: 2.4,
    notes: 'A lunchtime walk, without the headphones.',
    visibility: 'public',
    source: 'web',
  },
];

export const DEMO_EVENTS: SportEvent[] = [
  {
    id: 'preview-run',
    hostId: 'preview-jordan',
    hostName: 'Jordan Ellis',
    title: 'The no-standup run club',
    sport: 'Running',
    startsAt: ago(-3, 9),
    location: 'Tiergarten, Berlin',
    description:
      'An easy 5K, a good chat, and coffee afterwards. All paces welcome. We regroup along the way.',
    level: 'Easy pace · All levels',
    capacity: 12,
    attendees: 8,
    joined: false,
  },
  {
    id: 'preview-tennis',
    hostId: 'preview-sam',
    hostName: 'Sam Rivera',
    title: 'Less doubles, more doubles',
    sport: 'Tennis',
    startsAt: ago(-5, 17),
    location: 'Volkspark, Berlin',
    description:
      'Friendly doubles for developers. Bring a racket and a sense of humour. We will rotate partners.',
    level: 'Beginner friendly',
    capacity: 8,
    attendees: 5,
    joined: false,
  },
  {
    id: 'preview-cycle',
    hostId: 'preview-avery',
    hostName: 'Avery Chen',
    title: 'The out-of-office ride',
    sport: 'Cycling',
    startsAt: ago(-7, 10),
    location: 'Tempelhofer Feld, Berlin',
    description:
      'A relaxed social ride with plenty of stops. Bring water, a helmet, and your favourite side-project story.',
    level: 'Social · 20–25 km',
    capacity: 16,
    attendees: 9,
    joined: false,
  },
];
