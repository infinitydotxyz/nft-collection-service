/* eslint-disable @typescript-eslint/no-unused-vars */
import { AssertionError } from 'node:assert';
import Alchemy from './services/Alchemy';
import { collectionDao, firebase, logger, alchemy, opensea } from './container';

import { buildCollections } from './scripts/buildCollections';
import fs from 'fs';
import path from 'path';

// eslint-disable-next-line @typescript-eslint/require-await
export async function main(): Promise<void> {
  try {
    /**
     * must be run to add numOwnersUpdatedAtAndDataExported fields to existing collections
     * that don't yet have these fields
     */
    // await addNumOwnersUpdatedAtAndDataExportedFields();
    // await buildCollections();
    // await collectionDao.getCollectionsSummary();
    // const tokenIds: string[] = [];
    // const openseaLimit = 30;
    // while (tokenIds.length < openseaLimit) {
    //   tokenIds.push(`token_ids=${tokenIds.length + 1}`);
    // }
    // const resp = await opensea.getTokenIdsOfContract('0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', tokenIds.join('&'));
    // const resp = await opensea.getNFTsOfContract('0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', 50, '');
    // logger.log(resp);
    // logger.log(`Requested: ${tokenIds.length} tokenIds received: ${resp.assets.length} assets`);
    // flattener();
    // const resp = await opensea.getCollectionMetadata('0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d');
    const resp = await opensea.getCollection('boredapeyachtclub');
    logger.log(resp);
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
