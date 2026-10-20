\set key random(1, :rows - 31)
SELECT id, value FROM pilot_keys WHERE id >= :key AND id < :key + 32 ORDER BY id;
