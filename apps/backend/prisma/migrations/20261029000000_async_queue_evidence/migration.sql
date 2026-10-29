-- Opt-in revision 3 adds real queue metrics; earlier evidence rules remain intact.
BEGIN;

CREATE OR REPLACE FUNCTION protect_experiment_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run "Deployment"%ROWTYPE; first_second INTEGER; item JSONB; metric JSONB; metric_key TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Retained experiment measurements are immutable'; END IF;
  SELECT * INTO run FROM "Deployment" WHERE id = NEW."deploymentId" FOR SHARE;
  IF NOT FOUND OR run."ownerId" IS NULL OR run."challengeId" IS NULL OR run."challengeExperiment" IS NULL OR
     run.status IS DISTINCT FROM 'live' OR NOT run."runtimeActive" THEN
    RAISE EXCEPTION 'Experiment evidence requires an owned live resilience attempt';
  END IF;
  first_second := GREATEST(0, (run."challengeExperiment"->>'atSimulatedSecond')::integer - 30);
  IF run."evaluationStopAtSimulatedSeconds" IS NULL OR
     run."evaluationStopAtSimulatedSeconds" - first_second + 1 > 121 OR
     NEW."simulatedSeconds" < first_second OR NEW."simulatedSeconds" > run."evaluationStopAtSimulatedSeconds" THEN
    RAISE EXCEPTION 'Experiment evidence is outside its bounded retained window';
  END IF;
  IF NOT COALESCE(
    NEW.payload - ARRAY['version','topologyRevision','overallHealth','loadFraction','targetLoadFraction','resources','pools'] = '{}'::jsonb AND
    NEW.payload->'version' IN ('1'::jsonb, '2'::jsonb, '3'::jsonb) AND
    jsonb_typeof(NEW.payload->'topologyRevision') = 'number' AND
    (NEW.payload->>'topologyRevision')::numeric BETWEEN 0 AND 1000000 AND
    (NEW.payload->>'topologyRevision')::numeric = trunc((NEW.payload->>'topologyRevision')::numeric) AND
    NEW.payload->>'overallHealth' IN ('healthy','degraded','saturated','critical') AND
    jsonb_typeof(NEW.payload->'loadFraction') = 'number' AND (NEW.payload->>'loadFraction')::numeric BETWEEN 0 AND 10 AND
    jsonb_typeof(NEW.payload->'targetLoadFraction') = 'number' AND (NEW.payload->>'targetLoadFraction')::numeric BETWEEN 0 AND 10 AND
    jsonb_typeof(NEW.payload->'resources') = 'array' AND jsonb_array_length(NEW.payload->'resources') BETWEEN 1 AND 128 AND
    jsonb_typeof(NEW.payload->'pools') = 'array' AND jsonb_array_length(NEW.payload->'pools') <= 128, false) THEN
    RAISE EXCEPTION 'Malformed or oversized experiment measurements';
  END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.payload->'resources') LOOP
    IF NOT COALESCE(jsonb_typeof(item) = 'object' AND
      (item - ARRAY['id','health','cpu','memory','rps','connections'] = '{}'::jsonb OR (NEW.payload->'version' = '3'::jsonb AND item - ARRAY['id','health','cpu','memory','rps','connections','asyncQueue'] = '{}'::jsonb)) AND
      jsonb_typeof(item->'id') = 'string' AND length(item->>'id') BETWEEN 1 AND 256 AND
      (item->>'health' IN ('healthy','degraded','saturated','failed') OR
        (NEW.payload->'version' IN ('2'::jsonb, '3'::jsonb) AND item->>'health' = 'unknown')) AND
      ((jsonb_typeof(item->'cpu') = 'number' AND (item->>'cpu')::numeric BETWEEN 0 AND 100) OR
        (NEW.payload->'version' IN ('2'::jsonb, '3'::jsonb) AND item->'cpu' = 'null'::jsonb)) AND
      ((jsonb_typeof(item->'memory') = 'number' AND (item->>'memory')::numeric BETWEEN 0 AND 100) OR
        (NEW.payload->'version' IN ('2'::jsonb, '3'::jsonb) AND item->'memory' = 'null'::jsonb)) AND
      (NOT item ? 'rps' OR (jsonb_typeof(item->'rps') = 'number' AND (item->>'rps')::numeric BETWEEN 0 AND 1e12)) AND
      (NOT item ? 'connections' OR (jsonb_typeof(item->'connections') = 'number' AND (item->>'connections')::numeric BETWEEN 0 AND 1e12)), false) THEN
      RAISE EXCEPTION 'Malformed experiment resource measurement';
    END IF;
    IF item ? 'asyncQueue' THEN
      metric := item->'asyncQueue';
      IF NOT COALESCE(NEW.payload->'version' = '3'::jsonb AND jsonb_typeof(metric) = 'object' AND
        metric->'version' = '1'::jsonb AND metric - ARRAY['version','published','completed','readyDepth','oldestReadyAgeSeconds','inFlight','redeliveries','deadLettered'] = '{}'::jsonb, false) THEN
        RAISE EXCEPTION 'Malformed queue measurement revision';
      END IF;
      FOREACH metric_key IN ARRAY ARRAY['published','completed','readyDepth','oldestReadyAgeSeconds','inFlight','redeliveries','deadLettered'] LOOP
        IF NOT COALESCE(metric ? metric_key AND (metric->metric_key = 'null'::jsonb OR
          (jsonb_typeof(metric->metric_key) = 'number' AND (metric->>metric_key)::numeric BETWEEN 0 AND 1e12)), false) THEN
          RAISE EXCEPTION 'Malformed queue measurement value';
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(NEW.payload->'pools') LOOP
    IF NOT COALESCE(jsonb_typeof(item) = 'object' AND
      item - ARRAY['id','currentReplicas','baseReplicas','pending'] = '{}'::jsonb AND
      jsonb_typeof(item->'id') = 'string' AND length(item->>'id') BETWEEN 1 AND 256 AND
      jsonb_typeof(item->'currentReplicas') = 'number' AND (item->>'currentReplicas')::numeric BETWEEN 0 AND 128 AND
      (item->>'currentReplicas')::numeric = trunc((item->>'currentReplicas')::numeric) AND
      jsonb_typeof(item->'baseReplicas') = 'number' AND (item->>'baseReplicas')::numeric BETWEEN 0 AND 128 AND
      (item->>'baseReplicas')::numeric = trunc((item->>'baseReplicas')::numeric) AND
      (item->'pending' = 'null'::jsonb OR (jsonb_typeof(item->'pending') = 'object' AND
        (item->'pending') - ARRAY['action','secondsRemaining'] = '{}'::jsonb AND
        item->'pending'->>'action' IN ('up','down') AND
        jsonb_typeof(item->'pending'->'secondsRemaining') = 'number' AND
        (item->'pending'->>'secondsRemaining')::numeric BETWEEN 0 AND 3600 AND
        (item->'pending'->>'secondsRemaining')::numeric = trunc((item->'pending'->>'secondsRemaining')::numeric))), false) THEN
      RAISE EXCEPTION 'Malformed experiment pool measurement';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(NEW.payload->'resources')) <> jsonb_array_length(NEW.payload->'resources') OR
     (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(NEW.payload->'pools')) <> jsonb_array_length(NEW.payload->'pools') THEN
    RAISE EXCEPTION 'Duplicate experiment measurement identity';
  END IF;
  RETURN NEW;
END $$;

COMMIT;
