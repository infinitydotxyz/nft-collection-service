import PQueue from 'p-queue';
import { EventEmitter } from 'stream';
import { firebase, logger } from '../container';

export async function deleteCollectionGroups(groups: string[]) {
  const pQueue = new PQueue({
    concurrency: 300
  });

  const emitter = new EventEmitter();
  let lastUpdate = Date.now();
  let deletions = 0;
  emitter.on('delete', (id) => {
    deletions += 1;
    if (Date.now() - lastUpdate > 5000) {
      lastUpdate = Date.now();
      logger.log(`Deleted: ${deletions} docs. Most recent: ${id}`);
    }
  });

  const recurseOnDoc = async (docSnap: FirebaseFirestore.QueryDocumentSnapshot) => {
    let batch = firebase.db.batch();
    let size = 0;
    const subCollections = await docSnap.ref.listCollections();
    for (const coll of subCollections) {
      const collStream = coll.stream();
      /**
       * delete all docs from sub collections
       */
      for await (const doc of collStream) {
        const snap = doc as any as FirebaseFirestore.QueryDocumentSnapshot;
        try{
          await recurseOnDoc(snap);
          batch.delete(snap.ref);
          emitter.emit('delete', snap.ref.path);
          size += 1;
          if (size % 300 === 0) {
            await batch.commit();
            batch = firebase.db.batch();
          }
        }catch(err) {
          console.log(`Failed to delete docs`, err);
        }
      }
    }
  };

  for (const group of groups) {
    logger.log(`Starting deletions for collection group: ${group}`);
    const promises: Promise<void>[] = [];
    const query = firebase.db.collectionGroup(group);
    for await (const docSnap of query.stream()) {
      const docSnapshot = docSnap as any as FirebaseFirestore.QueryDocumentSnapshot;
      const promise = pQueue.add(async () => {
        try{
          await recurseOnDoc(docSnapshot);
          await docSnapshot.ref.delete();
          emitter.emit('delete', docSnapshot.ref.path);
        }catch(err) {
          logger.error('failed to recurse or delete', err);
          throw err;
        }
      })
      promises.push(promise);
    }

    await Promise.all(promises);
    logger.log(`Deleted all docs in group: ${group}`);
  }
  logger.log(`Deleted all doc in groups: ${groups.join(', ')}`);
}
