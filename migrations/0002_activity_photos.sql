ALTER TABLE activities ADD COLUMN photo_key TEXT;
ALTER TABLE activities ADD COLUMN photo_type TEXT CHECK (photo_type IN ('image/jpeg', 'image/png', 'image/webp'));
