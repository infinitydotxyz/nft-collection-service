/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
import 'reflect-metadata';
import { firestoreConstants, trimLowerCase } from '@infinityxyz/lib/utils';
import { firebase } from 'container';
import { ethers } from 'ethers';
import { DocumentData, QuerySnapshot } from 'firebase-admin/firestore';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import 'reflect-metadata';
import { getProviderByChainId } from 'utils/ethers';
import Erc721Abi from '../abi/Erc721';
import BatchHandler from 'models/BatchHandler';
import { BaseCollection } from '@infinityxyz/lib/types/core';

const db = firebase.db;

export async function main() {
  // fetch collections from firestore
  console.log('============================== Fetching collections from firestore =================================');
  let startAfter = '';
  const offsetFile = path.join(__dirname, 'offset.txt');
  if (existsSync(offsetFile)) {
    startAfter = readFileSync(offsetFile, 'utf8');
  }
  const limit = 50;
  let done = false;
  while (!done) {
    const colls = await db.collection('collections').orderBy('address', 'asc').startAfter(startAfter).limit(limit).get();
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
      const data = coll.data() as BaseCollection;
      if (!data) {
        console.error('Data is null for collection', coll);
        continue;
      }
      await run(data.chainId, data.address, data);
    }
  } catch (e) {
    console.error('Error running a few', e);
  }
}

async function run(chainId: string, address: string, collectionData: BaseCollection) {
  try {
    // check if collection indexing is complete
    // const status = collectionDoc?.data()?.state.create.step;
    // if (status !== 'complete') {
    //   console.error('Collection indexing is not complete for', address);
    //   return;
    // }

    // exception for ENS
    if (address === '0x57f1887a8bf19b14fc0df6fd9b2acc9af147ea85') {
      return;
    }
    console.log(`============================== Fetching tokens from firestore for ${address} =================================`);
    const tokens = await db.collection('collections').doc(`${chainId}:${address}`).collection('nfts').get();
    await updateOwners(chainId, address, tokens, collectionData);
  } catch (e) {
    console.error('Error in running collection', address, e);
  }
}

async function updateOwners(
  chainId: string,
  collectionAddress: string,
  tokens: QuerySnapshot<DocumentData>,
  collectionData: BaseCollection
) {
  const provider = getProviderByChainId(chainId);
  const contract = new ethers.Contract(collectionAddress, Erc721Abi, provider);
  const fsBatchHandler = new BatchHandler();
  for (const token of tokens.docs) {
    const tokenData = token.data();
    if (!tokenData) {
      console.error('Data is null for token');
      return;
    }
    // fetch owner
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const owner = trimLowerCase((await contract.ownerOf(tokenData.tokenId)) as string);
    // update in firestore
    if (owner) {
      // update asset in collection/nfts collection
      const collectionDocId = `${chainId}:${collectionAddress}`;
      const tokenId = tokenData.tokenId;
      const tokenRef = db.collection('collections').doc(collectionDocId).collection('nfts').doc(tokenId);
      fsBatchHandler.add(tokenRef, { owner }, { merge: true });

      // update in user's collection
      const userDocRef = db.collection(firestoreConstants.USERS_COLL).doc(owner);
      const userCollectionDocRef = userDocRef.collection(firestoreConstants.USER_COLLECTIONS_COLL).doc(collectionDocId);
      fsBatchHandler.add(userCollectionDocRef, collectionData, { merge: true });

      const userTokenDocRef = userCollectionDocRef.collection(firestoreConstants.USER_NFTS_COLL).doc(tokenId);
      fsBatchHandler.add(userTokenDocRef, { tokenData, owner }, { merge: true });
    }
  }
  fsBatchHandler
    .flush()
    .then(() => {
      console.log(`===================== Finished updating owners for collection ${collectionAddress} ========================`);
    })
    .catch((e) => {
      console.error('Error updating owners for collection', collectionAddress, e);
    });
}

void main();
