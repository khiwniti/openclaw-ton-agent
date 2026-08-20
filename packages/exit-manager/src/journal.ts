import { Journal } from "@openclaw-ton-agent/shared/src/journal";
import type { PositionEvent } from "@openclaw-ton-agent/shared";
import { PositionStateMachine } from "./state-machine";
import { Position } from "./position";

export class PositionJournal {
  private journal: Journal;
  private seenIdempotencyKeys: Set<string> = new Set();

  constructor(filePath: string) {
    this.journal = new Journal(filePath);
    this._loadIdempotencyKeys();
  }

  private _loadIdempotencyKeys() {
    const events = this.journal.tail(1000) as PositionEvent[];
    for (const ev of events) {
      if (ev.idempotencyKey) {
        this.seenIdempotencyKeys.add(ev.idempotencyKey);
      }
    }
  }

  append(ev: PositionEvent): boolean {
    if (ev.idempotencyKey) {
      if (this.seenIdempotencyKeys.has(ev.idempotencyKey)) {
        return false; // Skip duplicate
      }
      this.seenIdempotencyKeys.add(ev.idempotencyKey);
    }
    this.journal.append(ev);
    return true;
  }
  
  readAll(): PositionEvent[] {
    return this.journal.tail(1000) as PositionEvent[];
  }

  reconstruct(initial: Position): Position {
    const events = this.readAll().filter(e => e.positionId === initial.id);
    return PositionStateMachine.reconstruct(initial, events);
  }
}
