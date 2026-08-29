export interface VerticalScaleAction {
  resourceId: string;
  toSkuId: string;
  downtimeTicks: number;   // total restart window in simulated seconds
  remainingTicks: number;  // counts down each tick
}