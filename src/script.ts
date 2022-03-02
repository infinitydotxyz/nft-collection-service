/* eslint-disable @typescript-eslint/no-unused-vars */
import { AssertionError } from 'node:assert';
import { collectionDao, firebase, logger } from './container';

import { buildCollections } from './scripts/buildCollections';
import { execute as runOpenSeaListener } from './opensea-sales-listener';

// eslint-disable-next-line @typescript-eslint/require-await
export async function main(): Promise<void> {
  try {
    /**
     * must be run to add numOwnersUpdatedAtAndDataExported fields to existing collections
     * that don't yet have these fields
     */
    // await addNumOwnersUpdatedAtAndDataExportedFields();
    //await buildCollections();
    // await collectionDao.getCollectionsSummary();

    runOpenSeaListener();
  } catch (err) {
    logger.error(err);
  }
}
