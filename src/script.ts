/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unused-vars */
import 'dotenv/config';
import 'reflect-metadata';
import { firebase, logger, opensea, collectionDao, alchemy, zora } from './container';
import { sleep } from './utils';
import { readFile } from 'fs/promises';
import fs from 'fs';

import path from 'path';

import { deleteCollectionGroups } from 'scripts/deleteDataSubColl';
import { start } from 'scripts/deleteDataSubCollThreads';
import { fixInfinityStats } from 'scripts/fixInfinityStats';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { AllTimeTransactionFeeRewardsDoc, ChainId, CreationFlow } from '@infinityxyz/lib/types/core';
import { reIndex } from 'scripts/reIndex';
import { addBlueCheck } from 'scripts/addBlueCheck';
import { updateGoerliDoodlesImages } from 'scripts/updateGoerliDoodlesImages';
import { updateCollectionMetadata } from 'scripts/updateCollectionMetadata';
import { resetStep } from 'scripts/resetStep';
import Firebase from 'database/Firebase';
import { UserRewardsDto } from '@infinityxyz/lib/types/dto';
import PQueue from 'p-queue';
import { CollectionTotalSupplyExceededError } from 'models/errors/CreationFlow';
import { v1 } from 'firebase-admin/firestore';

// do not remove commented code
// eslint-disable-next-line @typescript-eslint/require-await
export async function main(): Promise<void> {
  try {
    await exportV1AirdropToCsv();
    // await addV1AirdropToCurrentRewards();
    // await reIndex(CreationFlow.TokenMetadataOS);
    // return;
    // await updateCollectionMetadata();
    // return;
    // await resetStep();
    // return;
    // await getCollectionNFTsFromAlchemy();
    // return;
    // const summary = await collectionDao.getCollectionsSummary();
    // fs.writeFileSync('./summary.json', JSON.stringify(summary, null, 2));
    // // const summary: any = JSON.parse(await readFile('./summary.json', 'utf8'));
    // logger.log(`Found: ${summary.collections.length} collections. Number of complete collections: ${summary.numberComplete}`);
    // const collectionsByState = summary.collections.reduce((acc: Record<string, any[]>, collection: any) => {
    //   return {
    //     ...acc,
    //     [collection.state]: [...(acc[collection.state] || []), collection]
    //   };
    // }, {});
    // const nonErc721 = [];
    // for (const [state, collections] of Object.entries(collectionsByState)) {
    //   const percentInState = Math.floor(((collections as any[]).length / summary.collections.length) * 10000) / 100;
    //   console.log(`Found: ${(collections as any[]).length} ${percentInState}% collections in state: ${state}`);
    //   for (const collection of collections as any[]) {
    //     if (collection.error.message === 'Failed to detect token standard') {
    //       nonErc721.push(collection);
    //     }
    //   }
    // }
    // console.log(
    //   `Found: ${nonErc721.length} ${
    //     Math.floor((nonErc721.length / summary.collections.length) * 10000) / 100
    //   }%  collections without ERC721 standard`
    // );
  } catch (err) {
    logger.error(err);
  }
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

export async function addV1AirdropToCurrentRewards(): Promise<void> {
  const data = await firebase.db.collection('airdropStats').get();

  const queue = new PQueue({ concurrency: 300 });
  const numUsers = data.docs.length;
  console.log(`Found ${numUsers} users`);
  let totalUpdatedSoFar = 0;
  for (const doc of data.docs) {
    const user = doc.id;
    const v1Airdrop = doc.get('finalEarnedTokens') as number;
    if (v1Airdrop) {
      queue
        .add(async () => {
          await firebase.db.runTransaction(async (txn) => {
            const v1AirdropDoc = await txn.get(doc.ref);
            const v1Airdrop = v1AirdropDoc.get('finalEarnedTokens') ?? (0 as number);
            const allTimeTxnFeeRewardsRef = firebase.db
              .collection('users')
              .doc(user)
              .collection('userRewards')
              .doc('1')
              .collection('userAllTimeRewards')
              .doc('userAllTimeTransactionFeeRewards') as FirebaseFirestore.DocumentReference<AllTimeTransactionFeeRewardsDoc>;
            const allTimeTxnFeeSnap = await txn.get(allTimeTxnFeeRewardsRef);

            const defaultAllTimeTxnFeesDoc: AllTimeTransactionFeeRewardsDoc = {
              userAddress: user,
              chainId: ChainId.Mainnet,
              rewards: 0,
              volumeEth: 0,
              volumeWei: '0',
              volumeUSDC: 0,
              updatedAt: Date.now(),
              userSells: 0,
              userBuys: 0,
              protocolFeesWei: '0',
              protocolFeesEth: 0,
              protocolFeesUSDC: 0,
              v1Airdrop: 0
            };

            let allTimeTxnFees = allTimeTxnFeeSnap.data() ?? defaultAllTimeTxnFeesDoc;

            allTimeTxnFees = {
              ...defaultAllTimeTxnFeesDoc,
              ...allTimeTxnFees
            };

            allTimeTxnFees.v1Airdrop = v1Airdrop;
            txn.set(allTimeTxnFeeRewardsRef, allTimeTxnFees, { merge: true });
          });
          console.log(`Updated user: ${user}, airdrop: ${v1Airdrop} total updated so far, ${++totalUpdatedSoFar}`);
        })
        .catch((err) => {
          console.error(err);
        });
    }
  }

  await queue.onIdle();
}

export async function exportV1AirdropToCsv(): Promise<void> {
  const data = await firebase.db.collection('airdropStats').get();
  const numUsers = data.docs.length;
  console.log(`Found ${numUsers} users`);
  let totalUpdatedSoFar = 0;
  for (const doc of data.docs) {
    const user = doc.id;
    const v1Airdrop = doc.get('finalEarnedTokens') as number;
    let lines = '';
    if (v1Airdrop) {
      lines += `${user},${v1Airdrop}\n`;
    }
    fs.appendFileSync('v1Airdrop.csv', lines);
    console.log(`Updated user: ${user}, total updated so far, ${++totalUpdatedSoFar}`);
  }
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

export async function getCollectionNFTsFromAlchemy(): Promise<void> {
  // bayc
  const data = await alchemy.getNFTsOfCollection('0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', '0');
  console.log(JSON.stringify(data, null, 2));
}

void main();
