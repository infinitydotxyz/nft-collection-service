// eslint-disable-next-line eslint-comments/disable-enable-pair
/* eslint-disable @typescript-eslint/no-unused-vars */
import Alchemy from './services/Alchemy';
import { collectionDao, firebase, logger, alchemy, opensea } from './container';
import { buildCollections } from './scripts/buildCollections';
import { sleep } from './utils';
import fs, { read } from 'fs';
import path from 'path';
import { readFile, writeFile } from 'fs/promises';
import got from 'got/dist/source';
import { COLLECTION_SERVICE_URL } from './constants';
import ContractFactory from 'models/contracts/ContractFactory';
import { firestoreConstants, trimLowerCase } from '@infinityxyz/lib/utils';
import { TokenStandard } from '@infinityxyz/lib/types/core';
import { deleteDataSubColl } from 'scripts/deleteDataSubColl';


// eslint-disable-next-line @typescript-eslint/require-await
// do not remove commented code
export async function main(): Promise<void> {
  try {
    await deleteDataSubColl();
    // await checkCollectionTokenStandard()
    // const summary = await collectionDao.getCollectionsSummary();
    // logger.log(`Found: ${summary.collections.length} collections. Number of complete collections: ${summary.numberComplete}`);
    // await collectionDao.getCollectionsSummary();
    // await appendDisplayTypeToCollections();
  } catch (err) {
    logger.error(err);
  }
}

async function checkCollectionTokenStandard(): Promise<void> {
  async function deleteCollection(db: FirebaseFirestore.Firestore, collectionPath: string, batchSize: number): Promise<void> {
    const collectionRef = db.collection(collectionPath);
    const query = collectionRef.orderBy('__name__').limit(batchSize);
  
    return await new Promise((resolve, reject) => {
      deleteQueryBatch(db, query, resolve).catch(reject);
    });
  }
  
  async function deleteQueryBatch(
    db: FirebaseFirestore.Firestore,
    query: FirebaseFirestore.Query,
    resolve: () => void
  ): Promise<void> {
    const snapshot = await query.get();
  
    const batchSize = snapshot.size;
    if (batchSize === 0) {
      // When there are no documents left, we are done
      resolve();
      return;
    }
  
    // Delete documents in a batch
    const batch = db.batch();
    snapshot.docs.forEach((doc: FirebaseFirestore.DocumentSnapshot) => {
      batch.delete(doc.ref);
    });
    await batch.commit();
  
    // Recurse on the next process tick, to avoid
    // exploding the stack.
    process.nextTick(() => {
      void deleteQueryBatch(db, query, resolve);
    });
  }

  try {
    const query = firebase.db.collection(firestoreConstants.COLLECTIONS_COLL).where('tokenStandard', '==', TokenStandard.ERC721);
    const iterator = collectionDao.streamCollections(query);
    let collectionsChecked = 0;
    for await (const { collection, ref } of iterator) {
      const factory = new ContractFactory();
      const address = collection.address;
      const chainId = collection.chainId;
      collectionsChecked += 1;
      if (collectionsChecked % 10 === 0) {
        logger.log(`Checked ${collectionsChecked} collections`);
      }
      if (address && chainId) {
        try {
          await factory.getTokenStandard(address, chainId);
        } catch (err: any) {
          const message = typeof err?.message === 'string' ? (err?.message as string) : 'Unknown';
          if (message.includes('Failed to detect token standard')) {
            logger.log(message);
            logger.log(`Found non ERC721 contract. Deleting ${chainId}:${address} nfts`);
            const nftsCollection = ref.collection(firestoreConstants.COLLECTION_NFTS_COLL).path;
            await deleteCollection(firebase.db, nftsCollection, 300);
            await ref.set({ state: { create: { step: '', error: { message } } }, tokenStandard: '' }, { merge: true });
            logger.log('Deleted collection nfts');
          } else {
            logger.log('unknown error occurred');
            logger.error(err);
          }
        }
      }
    }
    logger.log('Successfully checked all collection token standards');
  } catch (err) {
    logger.error('Unknown error occurred');
    logger.error(err);
  }
}

async function enqueueResultsDotJson(): Promise<void> {
  const file = './results.json';

  const rawData = await readFile(file, 'utf-8');
  const data: Array<{ address: string; chainId: string }> = JSON.parse(rawData);

  const collectionsEnqueued: Array<{ address: string }> = [];

  for (const collection of data) {
    const response = await got.post({
      url: `${COLLECTION_SERVICE_URL}/collection`,
      json: {
        address: collection.address,
        chainId: collection.chainId
      }
    });

    if (response.statusCode === 202) {
      collectionsEnqueued.push({ address: trimLowerCase(collection.address) });
    }
  }

  await writeFile('./enqueued.json', JSON.stringify(collectionsEnqueued));
}

export function flattener(): void {
  const file = path.join(__dirname, '../resultsbak.json');
  const data = fs.readFileSync(file, 'utf-8');
  const parsed = JSON.parse(data);
  const onlyObj = parsed[0];
  fs.appendFileSync('results.json', '[');
  for (const obj in onlyObj) {
    const val = onlyObj[obj];
    const datum = {
      address: val.address,
      chainId: val.chainId,
      hasBlueCheck: val.hasBlueCheck
    };
    if (datum.address && datum.chainId === '1' && String(datum.hasBlueCheck)) {
      fs.appendFileSync('results.json', JSON.stringify(datum) + ',');
    }
  }
  fs.appendFileSync('results.json', ']');
}

export async function appendDisplayTypeToCollections(): Promise<void> {
  const data = await firebase.db.collection('collections').get();
  data.forEach(async (doc) => {
    await sleep(2000);
    const address = doc.get('address') as string;
    const dispType = doc.get('displayType');
    if (address && !dispType) {
      const resp = await opensea.getCollectionMetadata(address);
      logger.log(address, resp.displayType);
      await firebase.db
        .collection('collections')
        .doc('1:' + address)
        .set({ displayType: resp.displayType }, { merge: true });
    }
  });
}
