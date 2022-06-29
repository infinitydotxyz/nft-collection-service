/* eslint-disable eslint-comments/disable-enable-pair */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unused-vars */
import 'dotenv/config';
import 'reflect-metadata';
import { firebase, logger, opensea, mnemonic, collectionDao, alchemy, zora } from './container';
import { sleep } from './utils';
import { readFile } from 'fs/promises';
import fs from 'fs';

import path from 'path';

import { deleteCollectionGroups } from 'scripts/deleteDataSubColl';
import { start } from 'scripts/deleteDataSubCollThreads';
import { fixInfinityStats } from 'scripts/fixInfinityStats';
import { firestoreConstants } from '@infinityxyz/lib/utils';
import { CreationFlow } from '@infinityxyz/lib/types/core';
import { reIndex } from 'scripts/reIndex';
import { addBlueCheck } from 'scripts/addBlueCheck';
import { updateGoerliDoodlesImages } from 'scripts/updateGoerliDoodlesImages';
import { updateCollectionMetadata } from 'scripts/updateCollectionMetadata';
import { resetStep } from 'scripts/resetStep';
import { StatsPeriod } from './services/Mnemonic';

// eslint-disable-next-line @typescript-eslint/require-await
// do not remove commented code
export async function main(): Promise<void> {
  try {
    // await reIndex(CreationFlow.TokenMetadataOS);
    // return;

    // await updateCollectionMetadata();
    // return;

    // await resetStep();
    // return;

    // await getCollectionNFTsFromAlchemy();

    // await writeTopMnemonicCollectionsToLocalFile();
    // return;

    const summary = await collectionDao.getCollectionsSummary();
    fs.writeFileSync('./summary.json', JSON.stringify(summary, null, 2));

    // const summary: any = JSON.parse(await readFile('./summary.json', 'utf8'));
    logger.log(`Found: ${summary.collections.length} collections. Number of complete collections: ${summary.numberComplete}`);

    const collectionsByState = summary.collections.reduce((acc: Record<string, any[]>, collection: any) => {
      return {
        ...acc,
        [collection.state]: [...(acc[collection.state] || []), collection]
      };
    }, {});

    const nonErc721 = [];

    for (const [state, collections] of Object.entries(collectionsByState)) {
      const percentInState = Math.floor(((collections as any[]).length / summary.collections.length) * 10000) / 100;
      console.log(`Found: ${(collections as any[]).length} ${percentInState}% collections in state: ${state}`);
      for (const collection of collections as any[]) {
        if (collection.error.message === 'Failed to detect token standard') {
          nonErc721.push(collection);
        }
      }
    }

    console.log(
      `Found: ${nonErc721.length} ${
        Math.floor((nonErc721.length / summary.collections.length) * 10000) / 100
      }%  collections without ERC721 standard`
    );
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

export async function getCollectionsFromMnemonic(): Promise<void> {
  const data = await mnemonic.getERC721Collections();
  console.log(data);
}

export async function getCollectionNFTsFromAlchemy(): Promise<void> {
  // bayc
  const data = await alchemy.getNFTsOfCollection('0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', '0');
  console.log(JSON.stringify(data, null, 2));
}

export async function writeTopMnemonicCollectionsToLocalFile() {
  const monthlyTop500 = await mnemonic.getTopCollections('by_sales_volume', StatsPeriod.Monthly, 500, 0);
  const weeklyTop500 = await mnemonic.getTopCollections('by_sales_volume', StatsPeriod.Weekly, 500, 0);
  const dailyTop500 = await mnemonic.getTopCollections('by_sales_volume', StatsPeriod.Daily, 500, 0);

  // dedup
  const collections = new Set<string>();
  monthlyTop500?.collections.forEach((collection) => {
    collections.add(collection.contractAddress ?? '');
  });
  weeklyTop500?.collections.forEach((collection) => {
    collections.add(collection.contractAddress ?? '');
  });
  dailyTop500?.collections.forEach((collection) => {
    collections.add(collection.contractAddress ?? '');
  });

  console.log('Total collections', collections.size);

  // write to file
  const file = path.join(__dirname, '../topMnemonicColls.txt');
  collections.forEach((collection) => {
    fs.appendFileSync(file, collection + '\n');
  });
}

void main();
