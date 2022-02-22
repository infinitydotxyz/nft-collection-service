/* eslint-disable @typescript-eslint/no-unused-vars */
import { firebase, logger, tokenDao } from './container';
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
    const addr = '0x1cb1a5e65610aeff2551a50f76a87a7d3fb649c6';
    const chain = '1';
    const tokens = await tokenDao.getAllTokens(chain, addr);
    logger.log(`Found: ${tokens.length} tokens`)
    const batch = new BatchHandler();
    tokens.forEach((tokenDoc) => {
      const { mintPrice, mintTxHash, ...tokenWithoutMintPrice }  = tokenDoc;
      if(!tokenWithoutMintPrice.tokenId) {
        logger.log(`Invalid token`);
        logger.log(tokenWithoutMintPrice);
      } else {
        const ref = firebase.getTokenDocRef(chain, addr, tokenWithoutMintPrice.tokenId)
        batch.add(ref , tokenWithoutMintPrice, { merge: false});
      }
    })


    await batch.flush();

    logger.log(`Set collection to state without mint price`);

  } catch (err) {
    logger.log(`Failed at ${requests}`);
    logger.error(err);
  }
}
