-- Widen only the admitted intent kinds. Existing rows and relation defaults stay intact.
ALTER TABLE "AccountMailIntent" DROP CONSTRAINT "AccountMailIntent_kind_check";
ALTER TABLE "AccountMailIntent" ADD CONSTRAINT "AccountMailIntent_kind_check"
  CHECK (kind IN ('signup','reset','verify','magic','otp'));
