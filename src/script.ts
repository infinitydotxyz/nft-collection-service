/* eslint-disable @typescript-eslint/no-unused-vars */
import { AssertionError } from 'node:assert';
import Alchemy from './services/Alchemy';
import { collectionDao, firebase, logger, alchemy, opensea } from './container';

import { buildCollections } from './scripts/buildCollections';

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
  const tokenIds: string[] = [];
  const openseaLimit = 30;
  while(tokenIds.length < openseaLimit) {
    tokenIds.push(`token_ids=${tokenIds.length + 1}`);
  }
    const resp = await opensea.getTokenIdsOfContract('0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', tokenIds.join('&'));
    logger.log(resp);
    logger.log(`Requested: ${tokenIds.length} tokenIds received: ${resp.assets.length} assets`)
  } catch (err) {
    logger.error(err);
  }
}
