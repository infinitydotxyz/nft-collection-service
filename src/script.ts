import { tokensDataToFile } from './exporters/csv';
import { collectionService } from './container';

export async function main(): Promise<void> {
  const address = '0x1a92f7381b9f03921564a437210bb9396471050c'.toLowerCase();
  const chainId = '1';

  await collectionService.createCollection(address, chainId, true);
  // const chainId = '1';
  // const address = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'.toLowerCase();
  // await tokensDataToFile(chainId, address);
}
