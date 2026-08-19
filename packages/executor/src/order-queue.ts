/**
 * Asynchronous Priority Order Queue Manager (L4).
 *
 * Decouples signal ingestion and position exit monitoring from on-chain execution.
 * - High Priority: Exits (Time-Stop, TP, SL, Momentum Reversal) - dispatched first.
 * - Normal Priority: Buys (New entries from Gated feed) - dispatched when capacity allows.
 * - Non-blocking: Monitoring loop never halts waiting for on-chain broadcast/seqno confirmation.
 * - Event-driven: When an individual position closes, the queue immediately executes the next pending buy order.
 */

import { type OrderRequest } from "@openclaw-ton-agent/shared";
import { createLogger } from "@openclaw-ton-agent/shared";
import { type Executor, type ExecutorResult } from "./modes.js";

const log = createLogger("order-queue");

export interface QueueItem {
  id: string;
  order: OrderRequest;
  priority: "high" | "normal";
  enqueuedAt: number;
  resolve: (res: ExecutorResult) => void;
  reject: (err: Error) => void;
}

export class OrderQueueManager {
  private highQueue: QueueItem[] = [];
  private normalQueue: QueueItem[] = [];
  private isProcessing = false;
  private isRunning = true;

  constructor(
    private readonly executor: Executor,
    private readonly canExecuteBuy: () => boolean,
    private readonly onOrderExecuted?: (res: ExecutorResult) => void
  ) {}

  /**
   * Enqueue an order for asynchronous execution.
   * Exits should pass priority: "high" to jump ahead of new buys.
   */
  enqueue(order: OrderRequest, priority: "high" | "normal" = "normal"): Promise<ExecutorResult> {
    return new Promise<ExecutorResult>((resolve, reject) => {
      const item: QueueItem = {
        id: order.id,
        order,
        priority,
        enqueuedAt: Date.now(),
        resolve,
        reject,
      };

      if (priority === "high") {
        this.highQueue.push(item);
        log.info("high-priority order enqueued (exit)", { orderId: order.id, ticker: order.token.ticker, side: order.side, queueDepth: this.size() });
      } else {
        this.normalQueue.push(item);
        log.info("normal-priority order enqueued (buy)", { orderId: order.id, ticker: order.token.ticker, side: order.side, queueDepth: this.size() });
      }

      this.scheduleProcess();
    });
  }

  /**
   * Notify the queue that capacity has freed up (e.g. an individual position closed).
   */
  notifySlotAvailable() {
    log.info("position closed slot notification received, waking queue worker", { queueDepth: this.size() });
    this.scheduleProcess();
  }

  /**
   * Return current queue stats.
   */
  size(): { high: number; normal: number; total: number } {
    return {
      high: this.highQueue.length,
      normal: this.normalQueue.length,
      total: this.highQueue.length + this.normalQueue.length,
    };
  }

  /**
   * Graceful shutdown of the queue.
   */
  stop() {
    this.isRunning = false;
  }

  private scheduleProcess() {
    if (!this.isRunning || this.isProcessing) return;
    setImmediate(() => this.processNext());
  }

  private async processNext() {
    if (!this.isRunning || this.isProcessing) return;

    let item: QueueItem | undefined;

    // 1. High priority queue (exits) always takes precedence
    if (this.highQueue.length > 0) {
      item = this.highQueue.shift();
    } 
    // 2. Normal priority queue (buys) only processed if capacity allows
    else if (this.normalQueue.length > 0) {
      if (!this.canExecuteBuy()) {
        log.info("capacity full, holding normal buy queue", { queueDepth: this.size() });
        return;
      }
      item = this.normalQueue.shift();
    }

    if (!item) return;

    this.isProcessing = true;
    const startTime = Date.now();
    const waitTimeMs = startTime - item.enqueuedAt;

    log.info("dispatching order from queue", {
      orderId: item.id,
      ticker: item.order.token.ticker,
      side: item.order.side,
      priority: item.priority,
      waitTimeMs,
    });

    try {
      const res = await this.executor.submit(item.order);
      item.resolve(res);
      this.onOrderExecuted?.(res);
    } catch (err: any) {
      log.error("order execution from queue failed", err as Error);
      item.reject(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.isProcessing = false;
      // Immediately loop to process next available item
      this.scheduleProcess();
    }
  }
}
