import CollectionService from './models/CollectionService';

export async function main(): Promise<void> {
  const address = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'.toLowerCase();
  const chainId = '1';

  const collectionService = new CollectionService();
  await collectionService.createCollection(address, chainId);
}
