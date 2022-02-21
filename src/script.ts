/* eslint-disable @typescript-eslint/no-unused-vars */
import { firebase, logger } from './container';
import BatchHandler from './models/BatchHandler';
import { addNumOwnersUpdatedAtAndDataExportedFields } from './background';
import { createInfuraApiKeys } from './scripts/createInfuraKeys';

// eslint-disable-next-line @typescript-eslint/require-await
export async function main(): Promise<void> {
  // const address = '0x9e8b85dbb082255bd81c5b25323b694bc799a616'.toLowerCase();
  // const chainId = '1';
  const requests = 0;
  try {
    /**
     * must be run to add numOwnersUpdatedAtAndDataExported fields to existing collections
     * that don't yet have these fields
     */
    // await addNumOwnersUpdatedAtAndDataExportedFields();

    // const numKeys = 45;
    // const namePrefix = 'INFINITY_NFT_COLLECTION_SERVICE';
    // await createInfuraApiKeys(numKeys, namePrefix);
    logger.log('Hello world');
    logger.error(new Error("hello world error"));

  } catch (err) {
    logger.log(`Failed at ${requests}`);
    logger.error(err);
  }
}
