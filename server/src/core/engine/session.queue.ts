import { EventEmitter } from 'events';
import crypto from 'crypto';

interface QueuedMessage {
  id: string;
  message: any;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  enqueuedAt: number;
}

export class SessionQueue extends EventEmitter {
  private queue: QueuedMessage[] = [];
  private processing = false;
  private currentJobId: string | null = null;
  private timeoutMs: number;

  constructor(
    private sessionId: string,
    private processor: (message: any) => Promise<any>,
    timeoutMs: number = 45000 // 45s default timeout
  ) {
    super();
    this.timeoutMs = timeoutMs;
  }

  /**
   * Add message to the queue
   */
  async enqueue(message: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const job: QueuedMessage = {
        id: crypto.randomUUID(),
        message,
        resolve,
        reject,
        enqueuedAt: Date.now()
      };

      this.queue.push(job);
      this.emit('enqueued', { jobId: job.id, queueLength: this.queue.length });

      // Start processing if not already doing so
      this.processNext();
    });
  }

  /**
   * Process next message in FIFO order
   */
  private async processNext(): Promise<void> {
    if (this.processing) return;
    if (this.queue.length === 0) return;

    this.processing = true;
    const job = this.queue.shift()!;
    this.currentJobId = job.id;

    // Guard so the caller's promise is settled exactly once: either by the
    // timeout OR by the processor (success/error), whichever wins the race.
    let promiseSettled = false;
    const settleOnce = (fn: () => void): void => {
      if (promiseSettled) return;
      promiseSettled = true;
      fn();
    };

    // The slot (this.processing / currentJobId) is released exactly ONCE, and
    // ONLY when the real processor settles. A timeout rejects the caller but
    // must NOT advance the queue while the processor is still in-flight (JS
    // can't cancel promises): doing so would let a second job for the same
    // session run concurrently and clobber shared state.
    //
    // LIVENESS CONTRACT: the queue slot is released ONLY when the real processor settles
    // (success/error). On timeout we reject the caller but keep the slot, so a late-settling
    // processor can never run concurrently with the next job (prevents session-state corruption).
    // Consequence: if `processor` NEVER settles, this session's queue is stuck forever — the
    // processor MUST enforce its own I/O timeout/abort. Recovery is only via clear()/reset.
    let slotReleased = false;
    const releaseSlot = (): void => {
      if (slotReleased) return;
      slotReleased = true;
      this.processing = false;
      this.currentJobId = null;
      setImmediate(() => this.processNext());
    };

    const timeout = setTimeout(() => {
      this.emit('timeout', { jobId: job.id, duration: this.timeoutMs });
      settleOnce(() => {
        job.reject(new Error(`Timeout processing message after ${this.timeoutMs}ms (Session: ${this.sessionId})`));
      });
      // NOTE: intentionally do NOT release the slot here. The orphaned processor
      // is still running; the queue only advances once it actually settles below.
    }, this.timeoutMs);

    const startTime = Date.now();

    try {
      this.emit('processing', { jobId: job.id });

      const result = await this.processor(job.message);

      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      this.emit('completed', { jobId: job.id, duration });
      settleOnce(() => job.resolve(result));
    } catch (error) {
      clearTimeout(timeout);
      const duration = Date.now() - startTime;
      this.emit('error', { jobId: job.id, error, duration });
      settleOnce(() => job.reject(error));
    } finally {
      // Slot is released only here — i.e. only when the processor has truly
      // finished — guaranteeing at most one processor body runs per session.
      releaseSlot();
    }
  }

  /**
   * Current status for debugging
   */
  getStatus() {
    return {
      sessionId: this.sessionId,
      processing: this.processing,
      currentJobId: this.currentJobId,
      queueLength: this.queue.length,
      waitingJobs: this.queue.map(j => ({ id: j.id, waitingMs: Date.now() - j.enqueuedAt }))
    };
  }

  /**
   * Clear queue (on reset/error)
   */
  clear(): void {
    for (const job of this.queue) {
      job.reject(new Error('Queue cleared by reset/system command'));
    }
    this.queue = [];
  }
}
