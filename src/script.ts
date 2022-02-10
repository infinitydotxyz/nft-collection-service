import CollectionService from './models/CollectionService';

export async function main(): Promise<void> {

    const address = '0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D';
    const chainId = '1';

    const collectionService = new CollectionService();
    await collectionService.createCollection(address, chainId);
}
