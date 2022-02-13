import { writeFileSync } from 'fs';
import { tokenDao } from '../container';

export const tokensDataToFile = async (chainId: string, collection: string): Promise<void> => {
  const tokens = await tokenDao.getAllTokens(chainId, collection);
  let lines = '';
  for (const token of tokens) {
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    const id = chainId + ':' + collection + ':' + token.tokenId;
    lines += `${id},${token.rarityScore},${token.rarityRank},${token.image?.url},${token.image?.contentType},${tokens.length}\n`;
  }
  writeFileSync('./exported.csv', lines);
};
