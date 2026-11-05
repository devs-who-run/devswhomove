export const SPORTS = [
  'Running',
  'Cycling',
  'Tennis',
  'Walking',
  'Swimming',
  'Strength',
  'Other',
] as const;
export type Sport = (typeof SPORTS)[number];
export type Visibility = 'public' | 'private';
export type AgentScope = 'activities:read' | 'activities:write' | 'events:read';

export interface Profile {
  id: string;
  username: string;
  name: string;
  avatar: string;
  bio: string;
  location: string;
  sports: Sport[];
  visibility: Visibility;
  provider?: 'github' | 'atproto';
}

export interface Activity {
  id: string;
  userId: string;
  username: string;
  name: string;
  avatar: string;
  title: string;
  sport: Sport;
  occurredAt: string;
  duration: number;
  distance: number | null;
  notes: string;
  visibility: Visibility;
  source: 'web' | 'agent';
  photo?: string | null;
}

export interface SportEvent {
  id: string;
  hostId: string;
  hostName: string;
  title: string;
  sport: Sport;
  startsAt: string;
  location: string;
  description: string;
  level: string;
  capacity: number;
  attendees: number;
  joined: boolean;
}

export interface EventAttendee {
  name: string;
  avatar: string;
}

export interface AgentToken {
  id: string;
  name: string;
  scopes: AgentScope[];
  createdAt: string;
  expiresAt: string;
}

export interface Bootstrap {
  viewer: Profile | null;
  activities: Activity[];
  events: SportEvent[];
  githubConfigured: boolean;
  atprotoConfigured?: boolean;
}
