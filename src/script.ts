import { tokensDataToFile } from './exporters/csv';

export async function main(): Promise<void> {
  const chainId = '1';
  const address = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'.toLowerCase();
  await tokensDataToFile(chainId, address);
}
