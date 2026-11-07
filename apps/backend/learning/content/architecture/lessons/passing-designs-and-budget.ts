import type { LearningLesson } from "@infraforge/contracts/learning";

export const passingDesignsAndBudget: LearningLesson = {
  id: "passing-designs-and-budget", contentVersion: 1, trackId: "architecture", moduleId: "design-reasoning",
  title: "More than one design can pass", kind: "conceptual-exercise", level: "advanced", availability: "available",
  summary: "Use a budget as an acceptance bound, then choose between passing allocations using stated priorities.",
  prerequisites: ["compare-designs-honestly", "split-the-capacity-budget"], experiment: null,
  problem: ["Suppose two reports under identical conditions meet every requirement. One has a lower monthly estimate; the other has a lower terminal p95. Both remain within budget. Which design is valid, and what else would you need to choose between them?"],
  explanation: [
    "Both are valid under those requirements. A monthly-budget criterion compares a recorded estimate with a ceiling. It does not minimize spending, maximize speed or require using the whole allowance. A preference for lower cost or lower latency is an additional decision rule that you must state.",
    "Reopen Split the capacity budget (split-the-capacity-budget). Compare passing allocations using Monthly resource price line items, Monthly estimate (CostEstimate gate) and Remaining monthly budget. Match each line item to its resource and recorded size; remaining budget is the reviewed limit minus the retained total. It is a projection, not money in an account.",
    "Compare p95, app and database CPU, Overall health and Whole run: Completed for the same workload and horizon. Extra capacity may lower sampled CPU without improving useful completions. A faster completed-request sample does not prove fewer failed callers or more maximum capacity. Check Whole run: Failed and Whole run: In-flight too.",
    "Try the lab's allocations separately and inspect the over-budget candidate. Performance can pass while the spending requirement fails. Recommend a passing allocation, say which observed advantage matters to you, and identify an untested workload or fault. Leaving budget unspent is valid when all requirements are met."
  ],
  check: {question: "In the hypothetical pair, the cheaper design and the faster design both meet every requirement and budget limit. What does the budget verdict establish?",
    choices: [{id: "both", text: "Both estimates meet the ceiling; choosing between them needs an explicit cost or latency priority."},
      {id: "cheapest", text: "Only the cheaper design is valid, and it is the cheapest possible design."},
      {id: "spend", text: "The design with more remaining budget must spend it before passing."}],
    correctChoiceId: "both", explanation: "The budget is an acceptance bound, not an optimizer or a spending target. Both designs qualify in this hypothetical; their different advantages need a stated preference. Neither report proves a global optimum."},
  limitations: ["The cheaper-versus-faster pair is a hypothetical decision exercise, not a new simulated outcome. The linked lab supplies the executable comparison; this lesson has no experiment.",
    "Prices are retained catalog snapshot estimates, not provider quotes. Missing totals or line items remain Unknown. The gate does not establish billing accuracy, network charges or later scaling cost; changing a catalog size changes several properties together.",
    "Terminal latency and CPU are sampled for the authored workload. They establish neither a whole-run latency SLO nor availability, durability or a cheapest possible production design."],
  followUp: "Return to Split the capacity budget (split-the-capacity-budget). Cite two passing reports and their remaining budgets, state your selection priority, then explain why the over-budget candidate is unacceptable even if its performance requirements pass.",
};
