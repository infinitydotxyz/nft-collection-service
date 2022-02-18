import { sleep } from '../utils';
import { firebase } from '../container';

const MAX_SIZE = 500;

interface Batch {
  batch: FirebaseFirestore.WriteBatch;
  size: number;
}

export default class BatchHandler {
  private currentBatch: Batch;

  constructor() {
    this.currentBatch = this.newBatch();
  }

  add(
    doc: FirebaseFirestore.DocumentReference,
    object: Partial<FirebaseFirestore.DocumentData>,
    options: FirebaseFirestore.SetOptions
  ): void {
    if (this.currentBatch.size >= MAX_SIZE) {
      this.flush().catch((err) => {
        console.error(err);
      });
    }

    this.currentBatch.batch.set(doc, object, options);
    this.currentBatch.size += 1;
  }

  async flush(): Promise<void> {
    if (this.currentBatch.size > 0) {
      const maxAttempts = 3;
      let attempt = 0;
      const batch = this.currentBatch.batch;
      this.currentBatch = this.newBatch();
      while (true) {
        attempt += 1;
        try {
          await batch.commit();
          return;
        } catch (err) {
          if (attempt > maxAttempts) {
            console.log(`Failed to commit batch`);
            throw err;
          }
          await sleep(1000); // firebase has a limit of 1 write per doc per second
        }
      }
    }
  }

  private newBatch(): Batch {
    return {
      batch: firebase.db.batch(),
      size: 0
    };
  }
}