/* eslint-disable @typescript-eslint/no-unused-vars */
import { AssertionError } from 'node:assert';
import Alchemy from './services/Alchemy';
import { collectionDao, firebase, logger } from './container';

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
    const alchemyClient = new Alchemy();
    alchemyClient.getNFTsOfCollection('0x61fce80d72363b731425c3a2a46a1a5fed9814b2');
    // await collectionDao.getCollectionsSummary();
  } catch (err) {
    logger.error(err);
  }
}
