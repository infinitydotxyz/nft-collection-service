import { writeFileSync } from 'fs';
import { firebase, tokenDao, logger } from '../container';

export const tokensDataToFile = async (chainId: string, collection: string): Promise<void> => {
  const tokens = await tokenDao.getAllTokens(chainId, collection);
  let lines = '';
  for (const token of tokens) {
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    const id = chainId + ':' + collection + ':' + token.tokenId;
    lines += `${id},${token.rarityScore},${token.rarityRank},${token.image?.url},${token.image?.contentType},${tokens.length}\n`;
  }
  writeFileSync(`./${collection}.csv`, lines);
};

export async function exportCollections(): Promise<void> {
  const snap = await firebase.db.collection('collections').where('state.export.done', '==', false).get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const address = data.address as string;
    const chainId = data.chainId as string;
    logger.log('fetching data for', address);
    await tokensDataToFile(chainId, address.toLowerCase());
  }
}
