import { FillRecord, PositionEvent } from "@openclaw-ton-agent/shared";
import { Position } from "./position";
import { PositionJournal } from "./journal";

export interface SettlementProvider {
  checkSettlement(txHashOrOrderId: string): Promise<{ settled: boolean; status: "CONFIRMED" | "FAILED" | "PENDING"; pnlTon?: number }>;
}

export class SettlementReconciler {
  private journal: PositionJournal;
  private provider: SettlementProvider;

  constructor(journal: PositionJournal, provider: SettlementProvider) {
    this.journal = journal;
    this.provider = provider;
  }

  async reconcilePending(pendingFills: FillRecord[]): Promise<FillRecord[]> {
    const updated: FillRecord[] = [];

    for (const fill of pendingFills) {
      if (fill.settlement !== "PENDING") {
        updated.push(fill);
        continue;
      }

      const res = await this.provider.checkSettlement(fill.orderId);
      if (res.settled) {
        const nextStatus = res.status;
        const pnlTon = res.pnlTon ?? fill.pnlTon ?? 0;
        
        const nextFill: FillRecord = {
          ...fill,
          settlement: nextStatus,
          pnlTon,
        };
        updated.push(nextFill);

        // Append settlement event to the journal
        const ev: PositionEvent = {
          type: nextStatus === "CONFIRMED" ? "SETTLED" : "FULL_EXIT",
          positionId: fill.positionId,
          ts: Date.now(),
          payload: {
            orderId: fill.orderId,
            settlement: nextStatus,
            pnlTon,
          },
          idempotencyKey: `settle-${fill.id}-${nextStatus}`,
        };
        this.journal.append(ev);
      } else {
        updated.push(fill);
      }
    }

    return updated;
  }
}
