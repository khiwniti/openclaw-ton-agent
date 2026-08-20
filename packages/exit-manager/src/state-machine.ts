import { Position } from "./position";
import type { PositionEvent } from "@openclaw-ton-agent/shared";

export class PositionStateMachine {
  /**
   * Folds a series of PositionEvents into a current Position state.
   */
  static reconstruct(initial: Position, events: PositionEvent[]): Position {
    let current = { ...initial };
    for (const ev of events) {
      if (ev.type === "PARTIAL_EXIT") {
        current.lifecycleState = "PARTIAL_EXIT";
        if (typeof ev.payload.remainingQty === "number") {
          current.remainingQty = ev.payload.remainingQty;
        }
        if (typeof ev.payload.activeExitOrderId === "string") {
          current.activeExitOrderId = ev.payload.activeExitOrderId;
        }
      } else if (ev.type === "FULL_EXIT") {
        current.lifecycleState = "FULL_EXIT";
        if (typeof ev.payload.activeExitOrderId === "string") {
          current.activeExitOrderId = ev.payload.activeExitOrderId;
        }
        current.remainingQty = 0;
      } else if (ev.type === "SETTLED") {
        current.lifecycleState = "SETTLED";
        current.activeExitOrderId = null;
      }
    }
    return current;
  }

  /**
   * Applies an event transition to a position in place (or returns a new copy).
   */
  static transition(pos: Position, ev: PositionEvent): Position {
    return this.reconstruct(pos, [ev]);
  }
}
