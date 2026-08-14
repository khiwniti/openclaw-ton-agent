export { GATE_CONFIG, roundTripFeeTon, totalCostTon } from "./config";
export { kellyFraction, sizedPositionTon } from "./kelly";
export type { SizeInput, SizeResult } from "./kelly";
export { pointSetup } from "./point-setup";
export type { PointSetup, PointSetupInput } from "./point-setup";
export { evaluateGates, gatedMeta } from "./gates";
export type { GateContext, GateResult, GateVerdict } from "./gates";
export { createMacroFeed, isMacroRiskOff } from "./macro-feed";
