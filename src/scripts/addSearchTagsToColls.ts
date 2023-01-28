/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { BaseCollection } from '@infinityxyz/lib/types/core';
import { firestoreConstants, getCollectionDocId, trimLowerCase } from '@infinityxyz/lib/utils';
import { firebase } from 'container';
import { QuerySnapshot } from 'firebase-admin/firestore';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import BatchHandler from 'models/BatchHandler';
import path from 'path';
import 'reflect-metadata';

const db = firebase.db;

const errorFile = path.join(__dirname, 'errors.txt');

let totalColls = 0;
const fsBatchHandler = new BatchHandler();

export async function addSearchTagsToColls(collection?: string) {
  // run for a single collection
  if (collection) {
    const collectionDocId = getCollectionDocId({ chainId: '1', collectionAddress: collection });
    const coll = await db.collection(firestoreConstants.COLLECTIONS_COLL).doc(collectionDocId).get();
    run(coll.data() as BaseCollection);
  } else {
    // fetch collections from firestore
    console.log('============================== Fetching collections from firestore =================================');
    let startAfter = '';
    const offsetFile = path.join(__dirname, 'offset.txt');
    if (existsSync(offsetFile)) {
      startAfter = readFileSync(offsetFile, 'utf8');
    }
    const limit = 1000;
    let done = false;
    while (!done) {
      const colls = await db
        .collection(firestoreConstants.COLLECTIONS_COLL)
        .orderBy('address', 'asc')
        .startAfter(startAfter)
        .limit(limit)
        .get();
      console.log('================ START AFTER ===============', startAfter, colls.size);
      writeFileSync(offsetFile, `${startAfter}`);

      // update cursor
      startAfter = colls.docs[colls.size - 1].get('address');

      // break condition
      if (colls.size < limit) {
        done = true;
      }
      await runAFew(colls);
    }
  }

  // final flush
  fsBatchHandler
    .flush()
    .then(() => {
      console.log(`===================== Finished updating searchTags ========================`);
      console.log(`Total colls so far: ${totalColls}`);
    })
    .catch((e) => {
      console.error('Error creating searchTags for collections', e);
    });
}

async function runAFew(colls: QuerySnapshot) {
  try {
    for (const coll of colls.docs) {
      const data = coll.data() as BaseCollection;
      if (!data.address) {
        console.error('Address is null for collection', coll);
        continue;
      }
      run(data);
    }

    if (fsBatchHandler.size == fsBatchHandler.maxSize) {
      await fsBatchHandler.flush();
      console.log('Total colls so far: ', totalColls);
    }
  } catch (e) {
    console.error('Error running a few', e);
  }
}

function run(data: BaseCollection) {
  try {
    totalColls++;
    const slug = data.slug;
    const collectionMetadata = data.metadata;
    const firstFourLetters = slug.slice(0, 4);

    const searchTags = [trimLowerCase(data.address)];

    if (collectionMetadata?.name) {
      searchTags.push(trimLowerCase(collectionMetadata.name));
    }
    if (collectionMetadata?.symbol) {
      searchTags.push(trimLowerCase(collectionMetadata.symbol));
    }
    if (slug) {
      searchTags.push(trimLowerCase(slug));
    }
    if (firstFourLetters) {
      searchTags.push(trimLowerCase(firstFourLetters));
    }

    // write to firestore
    const collectionDocId = getCollectionDocId({ chainId: '1', collectionAddress: data.address });
    const collRef = db.collection(firestoreConstants.COLLECTIONS_COLL).doc(collectionDocId);
    fsBatchHandler.add(collRef, { searchTags }, { merge: true });
  } catch (e) {
    console.error('Error in running collection', data.address, e);
    appendFileSync(errorFile, `${data.address}\n`);
  }
}
