import { TokenStandard } from './contracts/Contract.interface';
import ContractFactory from './contracts/ContractFactory';
import MetadataClient from './services/Metadata';
import OpenSeaClient from './services/OpenSea';
import Aggregator from './Aggregator';

export async function main(): Promise<void> {
        const addr = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'.toLowerCase();
//     // const addr= '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e';
//     // const addr = '0x806010c3c09f76aaa95193bb81656baa8a04a646';

    const contractFactory = new ContractFactory();

    const bayc = contractFactory.create(addr, '1', TokenStandard.ERC721);
    const metadataClient = new MetadataClient();
    const openseaClient = new OpenSeaClient();

    const agg = new Aggregator(bayc, metadataClient, openseaClient);

    await agg.getInitalData();
    
}
