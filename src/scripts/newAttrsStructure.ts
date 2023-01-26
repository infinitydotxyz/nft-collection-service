/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import 'reflect-metadata';
import { Erc721Token } from '@infinityxyz/lib/types/core';
import { firestoreConstants, getCollectionDocId, getSearchFriendlyString } from '@infinityxyz/lib/utils';
import { firebase } from 'container';
import { firestore } from 'firebase-admin';
import { QuerySnapshot } from 'firebase-admin/firestore';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import BatchHandler from 'models/BatchHandler';
import path from 'path';

const db = firebase.db;

const errorFile = path.join(__dirname, 'errors.txt');

let totalColls = 0;
let totalNfts = 0;

export async function createNewAttrStructureInNfts(collection?: string) {
  // run for a single collection
  if (collection) {
    const collectionDocId = getCollectionDocId({ chainId: '1', collectionAddress: collection });
    const nftCollRef = db
      .collection(firestoreConstants.COLLECTIONS_COLL)
      .doc(collectionDocId)
      .collection(firestoreConstants.COLLECTION_NFTS_COLL);
    await run(collection, nftCollRef);
    return;
  }

  // fetch collections from firestore
  console.log('============================== Fetching collections from firestore =================================');
  let startAfter = '';
  const offsetFile = path.join(__dirname, 'offset.txt');
  if (existsSync(offsetFile)) {
    startAfter = readFileSync(offsetFile, 'utf8');
  }
  const limit = 10;
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

async function runAFew(colls: QuerySnapshot) {
  try {
    for (const coll of colls.docs) {
      const data = coll.data();
      if (!data.address) {
        console.error('Address is null for collection', coll);
        continue;
      }
      const collectionDocId = getCollectionDocId({ chainId: data.chainId, collectionAddress: data.address });
      const nftCollRef = db
        .collection(firestoreConstants.COLLECTIONS_COLL)
        .doc(collectionDocId)
        .collection(firestoreConstants.COLLECTION_NFTS_COLL);
      await run(data.address, nftCollRef);
    }
  } catch (e) {
    console.error('Error running a few', e);
  }
}

async function run(collection: string, nftCollRef: firestore.CollectionReference) {
  try {
    // ignore if too many nfts
    // gods unchained, ens, unstoppable domains
    if (
      collection === '0x0e3a2a1f2146d86a604adc220b4967a898d7fe07' ||
      collection === '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85' ||
      collection === '0x049aba7510f45ba5b64ea9e658e342f904db358d' ||
      collection === '0xd1e5b0ff1287aa9f9a268759062e4ab08b9dacbe'
    ) {
      return;
    }
    totalColls++;
    console.log('Updating nfts for', collection, '....');
    const fsBatchHandler = new BatchHandler();
    const limit = 500;
    let cursor = '';
    let done = false;
    let totalFetchedSoFar = 0;
    while (!done) {
      try {
        const nfts = await nftCollRef.orderBy('tokenId', 'asc').limit(limit).startAfter(cursor).get();
        totalFetchedSoFar += nfts.size;
        totalNfts += nfts.size;
        console.log('Total fetched so far', totalFetchedSoFar);

        // update cursor
        cursor = nfts.docs[nfts.size - 1].get('tokenId');

        // write to firestore
        updateDataInFirestore(nftCollRef, nfts, fsBatchHandler);
        done = nfts.size < limit;
      } catch (err) {
        console.error(err);
        throw err;
      }
    }

    // write batch
    fsBatchHandler
      .flush()
      .then(() => {
        console.log(`===================== Finished updating attrs for collection ${collection} ========================`);
        console.log(`Total colls so far: ${totalColls}`);
        console.log(`Total nfts so far: ${totalNfts}`);
      })
      .catch((e) => {
        console.error('Error creating new attrs structure for collection', collection, e);
        appendFileSync(errorFile, `${collection}\n`);
      });
  } catch (e) {
    console.error('Error in running collection', collection, e);
    appendFileSync(errorFile, `${collection}\n`);
  }
}

function updateDataInFirestore(nftsCollRef: firestore.CollectionReference, nfts: QuerySnapshot, fsBatchHandler: BatchHandler) {
  for (const nft of nfts.docs) {
    // update asset in collection/nfts collection
    const data = nft.data() as Erc721Token;
    const tokenId = data?.tokenId;
    if (data && tokenId) {
      const tokenRef = nftsCollRef.doc(tokenId);
      const attrMap: any = {};
      (data.metadata?.attributes ?? []).forEach((attr) => {
        const attrType = getSearchFriendlyString(attr.trait_type);
        const attrValue = getSearchFriendlyString(String(attr.value));
        attrMap[`${attrType}:::${attrValue}`] = true;
      });
      fsBatchHandler.add(tokenRef, { metadata: { attributesMap: attrMap } }, { merge: true });
    }
  }
}
