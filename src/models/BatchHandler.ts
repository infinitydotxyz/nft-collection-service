import { sleep } from '../utils';
import { firebase, logger } from '../container';

const MAX_SIZE = 500;
const MAX_PAYLOAD_SIZE = (11_534_336 * 3) / 4; // allocate 25% for any metadata that might be in the payload

interface Batch {
  batch: FirebaseFirestore.WriteBatch;
  size: number;
  payloadSize: number;
}

export default class BatchHandler {
  private currentBatch: Batch;

  constructor() {
    this.currentBatch = this.newBatch();
  }

  get size(): number {
    return this.currentBatch.size;
  }

  get maxSize(): number {
    return MAX_SIZE;
  }

  add(
    doc: FirebaseFirestore.DocumentReference,
    object: Partial<FirebaseFirestore.DocumentData>,
    options: FirebaseFirestore.SetOptions
  ): void {
    const objectSize = Buffer.byteLength(JSON.stringify(object ?? {}), 'utf8');
    if (this.currentBatch.size + 1 >= MAX_SIZE || this.currentBatch.payloadSize + objectSize >= MAX_PAYLOAD_SIZE) {
      this.flush(doc).catch((err) => {
        logger.error(err);
      });
    }

    this.currentBatch.batch.set(doc, object, options);
    this.currentBatch.size += 1;
    this.currentBatch.payloadSize += objectSize;
  }

  async flush(doc?: FirebaseFirestore.DocumentReference): Promise<void> {
    if (this.currentBatch.size > 0) {
      const maxAttempts = 5;
      let attempt = 0;
      const batch = this.currentBatch.batch;
      this.currentBatch = this.newBatch();
      for (;;) {
        attempt += 1;
        try {
          await batch.commit();
          return;
        } catch (err) {
          if (attempt > maxAttempts) {
            logger.log(`Failed to commit batch with ${this.currentBatch.size} doc path: ${doc?.path} and id: ${doc?.id}`);
            throw err;
          }
          await sleep(3000); // firebase has a limit of 1 write per doc per second
        }
      }
    }
  }

  private newBatch(): Batch {
    return {
      batch: firebase.db.batch(),
      size: 0,
      payloadSize: 0
    };
  }
}
