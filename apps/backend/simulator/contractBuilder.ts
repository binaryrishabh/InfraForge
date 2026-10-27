import type { ContractBuilder } from "./model2Engine";

// Turns a run's design into a Model 2 contract. The design adapter lands with the adapter work;
// until then Model 2 runs are refused instead of guessed.
export const buildModel2Contract: ContractBuilder = () => ({ refused: ["The design adapter is not installed yet."] });
