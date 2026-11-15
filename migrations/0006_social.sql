CREATE TABLE activity_kudos (
  activity_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (activity_id, actor_id)
);
CREATE INDEX activity_kudos_actor ON activity_kudos(actor_id);

CREATE TABLE activity_comments (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL
);
CREATE INDEX activity_comments_activity ON activity_comments(activity_id, created_at);
CREATE INDEX activity_comments_actor ON activity_comments(actor_id);

CREATE TABLE follows (
  follower_id TEXT NOT NULL,
  followee_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee ON follows(followee_id);

CREATE TABLE clubs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sport TEXT,
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX clubs_owner ON clubs(owner_id);

CREATE TABLE club_members (
  club_id TEXT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  actor_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  joined_at TEXT NOT NULL,
  PRIMARY KEY (club_id, actor_id)
);
CREATE INDEX club_members_actor ON club_members(actor_id);

ALTER TABLE events ADD COLUMN club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL;
ALTER TABLE atproto_events ADD COLUMN club_id TEXT REFERENCES clubs(id) ON DELETE SET NULL;
CREATE INDEX events_club ON events(club_id);
CREATE INDEX atproto_events_club ON atproto_events(club_id);
