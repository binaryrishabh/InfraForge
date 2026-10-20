\set key random(1, :rows)
UPDATE pilot_keys SET version = version + 1 WHERE id = :key;
