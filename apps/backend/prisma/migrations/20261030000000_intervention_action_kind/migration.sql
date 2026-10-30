-- Learners can apply interventions during a run; the action log must accept that kind.
BEGIN;
ALTER TABLE "RunAction" DROP CONSTRAINT "RunAction_kind_check";
ALTER TABLE "RunAction" ADD CONSTRAINT "RunAction_kind_check"
  CHECK (kind IN ('load', 'speed', 'chaos', 'vertical-scale', 'pool-scale', 'topology', 'intervention', 'teardown'));
COMMIT;
