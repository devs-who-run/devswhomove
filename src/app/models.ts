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
  kudos?: number;
  kudoed?: boolean;
  comments?: number;
}

/** A public member of the community shown in social features. */
export interface SocialActor {
  id: string;
  username: string;
  name: string;
  avatar: string;
}

export interface ActivityComment {
  id: string;
  body: string;
  createdAt: string;
  author: SocialActor;
  canDelete: boolean;
}

export interface ProfileSocial {
  followers: number;
  following: number;
  viewerFollows: boolean;
}

export interface Club {
  id: string;
  slug: string;
  name: string;
  description: string;
  sport: Sport | null;
  ownerId: string;
  ownerName: string | null;
  members: number;
  joined: boolean;
}

export interface ClubMember extends SocialActor {
  role: 'owner' | 'member';
}

export interface ClubDetail {
  club: Club;
  members: ClubMember[];
  activities: Activity[];
  events: SportEvent[];
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
  conferenceName?: string | null;
  conferenceUrl?: string | null;
  clubId?: string | null;
  clubName?: string | null;
  clubSlug?: string | null;
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
  clubs?: Club[];
}
