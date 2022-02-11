import ContractFactory from './models/contracts/ContractFactory';
import CollectionService from './models/CollectionService';

export async function main(): Promise<void> {

    const address = '0xdac17f958d2ee523a2206206994597c13d831ec7';
    const chainId = '1';

    const collectionService = new CollectionService();
    await collectionService.createCollection(address, chainId);

    // const factory = new ContractFactory();
    // const contract = await factory.create(address, chainId);
    // const owner = await contract.getOwner();
    // console.log(owner);

}
