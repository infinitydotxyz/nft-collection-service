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
    const tokenIds =
      'token_ids=0&token_ids=1&token_ids=10&token_ids=1003';
    const resp = await opensea.getTokenIdsOfContract('0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d', tokenIds);
    logger.log(resp);
  } catch (err) {
    logger.error(err);
  }
}
