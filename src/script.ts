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
    // const tokenIds =
    //   'token_ids=0&token_ids=1&token_ids=10&token_ids=100&token_ids=1000&token_ids=1001&token_ids=1002&token_ids=1003&token_ids=1004&token_ids=1005&token_ids=1006&token_ids=1007&token_ids=1008&token_ids=1009&token_ids=101&token_ids=1010&token_ids=1011&token_ids=1012&token_ids=1013&token_ids=1014&token_ids=1015&token_ids=1016&token_ids=1017&token_ids=1018&token_ids=1019&token_ids=102&token_ids=1020&token_ids=1021&token_ids=1022&token_ids=1023&token_ids=1024&token_ids=1025&token_ids=1026&token_ids=1027&token_ids=1028&token_ids=1029&token_ids=103&token_ids=1030&token_ids=1031&token_ids=1032&token_ids=1033&token_ids=1034&token_ids=1035&token_ids=1036&token_ids=1037&token_ids=1038&token_ids=1039&token_ids=104&token_ids=1040&token_ids=1041';
    // const resp = await opensea.getTokenIdsOfContract('0xce25e60a89f200b1fa40f6c313047ffe386992c3', tokenIds);
    // logger.log(resp);
  } catch (err) {
    logger.error(err);
  }
}
