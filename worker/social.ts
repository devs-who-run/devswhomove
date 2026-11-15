import type {
  Activity,
  ActivityComment,
  Club,
  ClubMember,
  Profile,
  ProfileSocial,
} from '../src/app/models';
import { HttpError, sport, text } from './validation';

/** Public members only: private GitHub profiles never appear in social data. */
export const PUBLIC_ACTORS = `(SELECT id AS actor_id, username, name, avatar FROM users
  WHERE visibility = 'public'
  UNION ALL SELECT did AS actor_id, handle AS username, name, avatar FROM atproto_accounts)`;

/** Activities that anyone can see, and therefore the only ones open to kudos and comments. */
export const PUBLIC_ACTIVITIES = `(SELECT a.id AS activity_id, a.user_id AS owner_id
  FROM activities a JOIN users u ON u.id = a.user_id
  WHERE a.visibility = 'public' AND u.visibility = 'public'
  UNION ALL SELECT uri AS activity_id, did AS owner_id FROM atproto_activities)`;

export const PUBLIC_PROFILE_REQUIRED =
  'Make your profile public to give kudos, comment, follow people, or join clubs.';
const MAX_COMMENTS_PER_ACTIVITY = 200;
const MAX_FOLLOWING = 1000;
const MAX_OWNED_CLUBS = 10;

/** Reject social participation from private profiles so identities are never exposed by accident. */
export function requirePublicProfile(user: Profile): void {
  if (user.visibility !== 'public') throw new HttpError(403, PUBLIC_PROFILE_REQUIRED);
}

/** Add kudos and comment counts from public members to a list of activities. */
export async function withSocial(
  db: D1Database,
  activities: Activity[],
  viewerId?: string,
): Promise<Activity[]> {
  if (!activities.length) return activities;
  const result = await db
    .prepare(
      `SELECT j.value AS id,
        (SELECT COUNT(*) FROM activity_kudos k JOIN ${PUBLIC_ACTORS} p ON p.actor_id = k.actor_id
          WHERE k.activity_id = j.value) AS kudos,
        EXISTS(SELECT 1 FROM activity_kudos WHERE activity_id = j.value AND actor_id = ?) AS kudoed,
        (SELECT COUNT(*) FROM activity_comments c JOIN ${PUBLIC_ACTORS} p ON p.actor_id = c.actor_id
          WHERE c.activity_id = j.value) AS comments
      FROM json_each(?) j`,
    )
    .bind(viewerId || '', JSON.stringify(activities.map((activity) => activity.id)))
    .all<{ id: string; kudos: number; kudoed: number; comments: number }>();
  const counts = new Map(result.results.map((row) => [row.id, row]));
  return activities.map((activity) => {
    const row = counts.get(activity.id);
    return {
      ...activity,
      kudos: row?.kudos ?? 0,
      kudoed: Boolean(row?.kudoed),
      comments: row?.comments ?? 0,
    };
  });
}

/** Return the owner of a publicly visible activity, or fail as if it does not exist. */
async function publicActivityOwner(db: D1Database, activityId: string): Promise<string> {
  const row = await db
    .prepare(`SELECT owner_id AS ownerId FROM ${PUBLIC_ACTIVITIES} WHERE activity_id = ?`)
    .bind(activityId)
    .first<{ ownerId: string }>();
  if (!row) throw new HttpError(404, 'Activity not found.');
  return row.ownerId;
}

export async function setKudos(
  db: D1Database,
  user: Profile,
  activityId: string,
  give: boolean,
): Promise<{ kudos: number; kudoed: boolean }> {
  const ownerId = await publicActivityOwner(db, activityId);
  if (give) {
    requirePublicProfile(user);
    if (ownerId === user.id) throw new HttpError(400, 'You can’t give kudos to your own activity.');
    await db
      .prepare(
        'INSERT OR IGNORE INTO activity_kudos (activity_id, actor_id, created_at) VALUES (?, ?, ?)',
      )
      .bind(activityId, user.id, new Date().toISOString())
      .run();
  } else {
    await db
      .prepare('DELETE FROM activity_kudos WHERE activity_id = ? AND actor_id = ?')
      .bind(activityId, user.id)
      .run();
  }
  const [activity] = await withSocial(db, [{ id: activityId } as Activity], user.id);
  return { kudos: activity.kudos ?? 0, kudoed: Boolean(activity.kudoed) };
}

interface CommentRow {
  id: string;
  body: string;
  createdAt: string;
  authorId: string;
  username: string;
  name: string;
  avatar: string;
}

function comment(row: CommentRow, viewerId: string, ownerId: string): ActivityComment {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.createdAt,
    author: { id: row.authorId, username: row.username, name: row.name, avatar: row.avatar },
    canDelete: !!viewerId && (row.authorId === viewerId || ownerId === viewerId),
  };
}

const COMMENT_SELECT = `SELECT c.id, c.body, c.created_at AS createdAt, p.actor_id AS authorId,
  p.username, p.name, p.avatar
  FROM activity_comments c JOIN ${PUBLIC_ACTORS} p ON p.actor_id = c.actor_id`;

export async function listComments(
  db: D1Database,
  activityId: string,
  viewerId = '',
): Promise<ActivityComment[]> {
  const ownerId = await publicActivityOwner(db, activityId);
  const result = await db
    .prepare(`${COMMENT_SELECT} WHERE c.activity_id = ? ORDER BY c.created_at, c.id LIMIT ?`)
    .bind(activityId, MAX_COMMENTS_PER_ACTIVITY)
    .all<CommentRow>();
  return result.results.map((row) => comment(row, viewerId, ownerId));
}

export async function addComment(
  db: D1Database,
  user: Profile,
  activityId: string,
  input: unknown,
): Promise<ActivityComment> {
  requirePublicProfile(user);
  const ownerId = await publicActivityOwner(db, activityId);
  const body = text(input, 'Comment', 500);
  const id = crypto.randomUUID();
  const result = await db
    .prepare(
      `INSERT INTO activity_comments (id, activity_id, actor_id, body, created_at)
      SELECT ?, ?, ?, ?, ? WHERE
        (SELECT COUNT(*) FROM activity_comments WHERE activity_id = ?) < ?`,
    )
    .bind(
      id,
      activityId,
      user.id,
      body,
      new Date().toISOString(),
      activityId,
      MAX_COMMENTS_PER_ACTIVITY,
    )
    .run();
  if (!result.meta.changes)
    throw new HttpError(409, 'This activity has reached the comment limit.');
  const row = await db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).bind(id).first<CommentRow>();
  if (!row) throw new HttpError(500, 'Could not save your comment.');
  return comment(row, user.id, ownerId);
}

/** Let the comment author or the activity owner remove a comment, even after visibility changes. */
export async function deleteComment(
  db: D1Database,
  user: Profile,
  activityId: string,
  commentId: string,
): Promise<void> {
  const result = await db
    .prepare(
      `DELETE FROM activity_comments WHERE id = ? AND activity_id = ? AND (actor_id = ? OR ? IN (
        SELECT user_id FROM activities WHERE id = ?
        UNION ALL SELECT did FROM atproto_activities WHERE uri = ?))`,
    )
    .bind(commentId, activityId, user.id, user.id, activityId, activityId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, 'Comment not found.');
}

/** Remove social data attached to a deleted activity. */
export function deleteActivitySocial(db: D1Database, activityId: string): D1PreparedStatement[] {
  return [
    db.prepare('DELETE FROM activity_kudos WHERE activity_id = ?').bind(activityId),
    db.prepare('DELETE FROM activity_comments WHERE activity_id = ?').bind(activityId),
  ];
}

export async function setFollow(
  db: D1Database,
  user: Profile,
  targetInput: unknown,
  follow: boolean,
): Promise<ProfileSocial> {
  const targetId = text(targetInput, 'Profile ID', 300);
  if (targetId === user.id) throw new HttpError(400, 'You can’t follow yourself.');
  if (follow) {
    requirePublicProfile(user);
    const target = await db
      .prepare(`SELECT 1 AS found FROM ${PUBLIC_ACTORS} WHERE actor_id = ?`)
      .bind(targetId)
      .first();
    if (!target) throw new HttpError(404, 'Profile is private or does not exist.');
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at)
        SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM follows WHERE follower_id = ?) < ?`,
      )
      .bind(user.id, targetId, new Date().toISOString(), user.id, MAX_FOLLOWING)
      .run();
    if (!result.meta.changes) {
      const existing = await db
        .prepare('SELECT 1 AS found FROM follows WHERE follower_id = ? AND followee_id = ?')
        .bind(user.id, targetId)
        .first();
      if (!existing) throw new HttpError(400, `You can follow at most ${MAX_FOLLOWING} people.`);
    }
  } else {
    await db
      .prepare('DELETE FROM follows WHERE follower_id = ? AND followee_id = ?')
      .bind(user.id, targetId)
      .run();
  }
  return profileSocial(db, targetId, user.id);
}

/** Count public followers and followed people for a profile. */
export async function profileSocial(
  db: D1Database,
  profileId: string,
  viewerId = '',
): Promise<ProfileSocial> {
  const row = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM follows f JOIN ${PUBLIC_ACTORS} p ON p.actor_id = f.follower_id
          WHERE f.followee_id = ?) AS followers,
        (SELECT COUNT(*) FROM follows f JOIN ${PUBLIC_ACTORS} p ON p.actor_id = f.followee_id
          WHERE f.follower_id = ?) AS following,
        EXISTS(SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?) AS viewerFollows`,
    )
    .bind(profileId, profileId, viewerId, profileId)
    .first<{ followers: number; following: number; viewerFollows: number }>();
  return {
    followers: row?.followers ?? 0,
    following: row?.following ?? 0,
    viewerFollows: Boolean(row?.viewerFollows),
  };
}

const CLUB_SELECT = `SELECT c.id, c.slug, c.name, c.description, c.sport, c.owner_id AS ownerId,
  o.name AS ownerName,
  (SELECT COUNT(*) FROM club_members m JOIN ${PUBLIC_ACTORS} p ON p.actor_id = m.actor_id
    WHERE m.club_id = c.id) AS members,
  EXISTS(SELECT 1 FROM club_members WHERE club_id = c.id AND actor_id = ?) AS joined
  FROM clubs c LEFT JOIN ${PUBLIC_ACTORS} o ON o.actor_id = c.owner_id`;

type ClubRow = Omit<Club, 'joined'> & { joined: number };
const club = (row: ClubRow): Club => ({ ...row, joined: Boolean(row.joined) });

export async function listClubs(db: D1Database, viewerId = ''): Promise<Club[]> {
  const result = await db
    .prepare(`${CLUB_SELECT} ORDER BY members DESC, c.name COLLATE NOCASE LIMIT 100`)
    .bind(viewerId)
    .all<ClubRow>();
  return result.results.map(club);
}

export async function findClub(db: D1Database, slug: string, viewerId = ''): Promise<Club> {
  const row = await db
    .prepare(`${CLUB_SELECT} WHERE c.slug = ?`)
    .bind(viewerId, slug)
    .first<ClubRow>();
  if (!row) throw new HttpError(404, 'Club not found.');
  return club(row);
}

export async function clubMembers(db: D1Database, clubId: string): Promise<ClubMember[]> {
  const result = await db
    .prepare(
      `SELECT p.actor_id AS id, p.username, p.name, p.avatar, m.role
      FROM club_members m JOIN ${PUBLIC_ACTORS} p ON p.actor_id = m.actor_id
      WHERE m.club_id = ? ORDER BY m.role DESC, m.joined_at LIMIT 100`,
    )
    .bind(clubId)
    .all<ClubMember>();
  return result.results;
}

/** Turn a club name into a readable URL slug. */
export function clubSlug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/g, '') || 'club'
  );
}

export async function createClub(
  db: D1Database,
  user: Profile,
  data: Record<string, unknown>,
): Promise<Club> {
  requirePublicProfile(user);
  const name = text(data['name'], 'Club name', 60);
  const description = text(data['description'] ?? '', 'Description', 300, false);
  const clubSport = data['sport'] == null || data['sport'] === '' ? null : sport(data['sport']);
  const base = clubSlug(name);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  for (let attempt = 0; attempt < 4; attempt++) {
    const slug = attempt
      ? `${base.slice(0, 41)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 6)}`
      : base;
    const result = await db
      .prepare(
        `INSERT INTO clubs (id, slug, name, description, sport, owner_id, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM clubs WHERE owner_id = ?) < ?
        ON CONFLICT(slug) DO NOTHING`,
      )
      .bind(id, slug, name, description, clubSport, user.id, now, user.id, MAX_OWNED_CLUBS)
      .run();
    if (result.meta.changes) {
      await db
        .prepare(
          `INSERT INTO club_members (club_id, actor_id, role, joined_at) VALUES (?, ?, 'owner', ?)`,
        )
        .bind(id, user.id, now)
        .run();
      return findClub(db, slug, user.id);
    }
    const owned = await db
      .prepare('SELECT COUNT(*) AS count FROM clubs WHERE owner_id = ?')
      .bind(user.id)
      .first<{ count: number }>();
    if ((owned?.count ?? 0) >= MAX_OWNED_CLUBS)
      throw new HttpError(400, `You can create at most ${MAX_OWNED_CLUBS} clubs.`);
  }
  throw new HttpError(409, 'Could not reserve a club address. Try a different name.');
}

export async function setMembership(
  db: D1Database,
  user: Profile,
  slug: string,
  join: boolean,
): Promise<Club> {
  const current = await findClub(db, slug, user.id);
  if (join) {
    requirePublicProfile(user);
    await db
      .prepare(
        `INSERT OR IGNORE INTO club_members (club_id, actor_id, role, joined_at)
        VALUES (?, ?, 'member', ?)`,
      )
      .bind(current.id, user.id, new Date().toISOString())
      .run();
  } else {
    if (current.ownerId === user.id)
      throw new HttpError(400, 'Club owners can’t leave. Delete the club instead.');
    await db
      .prepare('DELETE FROM club_members WHERE club_id = ? AND actor_id = ?')
      .bind(current.id, user.id)
      .run();
  }
  return findClub(db, slug, user.id);
}

export async function deleteClub(db: D1Database, user: Profile, slug: string): Promise<void> {
  const current = await findClub(db, slug, user.id);
  if (current.ownerId !== user.id) throw new HttpError(403, 'Only the club owner can delete it.');
  await db.batch([
    db.prepare('UPDATE events SET club_id = NULL WHERE club_id = ?').bind(current.id),
    db.prepare('UPDATE atproto_events SET club_id = NULL WHERE club_id = ?').bind(current.id),
    db.prepare('DELETE FROM club_members WHERE club_id = ?').bind(current.id),
    db.prepare('DELETE FROM clubs WHERE id = ? AND owner_id = ?').bind(current.id, user.id),
  ]);
}

/** Validate an optional event club link: only club members can post events to a club. */
export async function eventClub(
  db: D1Database,
  user: Profile,
  value: unknown,
): Promise<string | null> {
  if (value == null || value === '') return null;
  const clubId = text(value, 'Club', 64);
  const member = await db
    .prepare('SELECT 1 AS found FROM club_members WHERE club_id = ? AND actor_id = ?')
    .bind(clubId, user.id)
    .first();
  if (!member) throw new HttpError(403, 'Join this club before adding events to it.');
  return clubId;
}
