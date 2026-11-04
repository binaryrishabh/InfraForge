import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { LbAccountingReadings } from "../src/features/reports/components/LbAccountingReadings";

test("retained LB counters label calls, attempts, waits and overlapping totals", () => {
  const html = renderToStaticMarkup(<LbAccountingReadings metrics={{ profile: "lb-accounting/1", rejectedAtLb: 7, queuedAtLb: 8, acceptedByBackend: 9, queuedAtVm: 10, rejectedByVm: 11, timedOutDownstream: 12 }} />);
  for (const label of ["Rejected at load balancer (calls)", "Queued at load balancer (calls)", "Admitted by backend (attempts)", "Queued at VM (attempts)", "Refused by VM (attempts)", "Downstream timeouts (attempts)", "not current depth", "Counters overlap", "run segment"]) expect(html).toContain(label);
});
