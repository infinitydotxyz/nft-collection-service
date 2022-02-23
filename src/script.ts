/* eslint-disable @typescript-eslint/no-unused-vars */
import { firebase, logger } from './container';

import { buildCollections } from './scripts/buildCollections';

// eslint-disable-next-line @typescript-eslint/require-await
export async function main(): Promise<void> {

  try {
    /**
     * must be run to add numOwnersUpdatedAtAndDataExported fields to existing collections
     * that don't yet have these fields
     */
    // await addNumOwnersUpdatedAtAndDataExportedFields();



    await buildCollections();


  } catch (err) {
    logger.error(err);
  }
}

