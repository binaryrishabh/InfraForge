\set key random(1, :rows)
SELECT value FROM pilot_keys WHERE id = :key;
