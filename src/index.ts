import { BigNumber, providers } from 'ethers';
import OpenSeaClient from './services/OpenSea';
import Erc721Contract from './contracts/Erc721Contract';
import MetadataClient from './services/Metadata';

async function main(): Promise<void> {
    const addr = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'.toLowerCase();
    // const addr= '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e';

    const bayc = new Erc721Contract(addr, '1');

    /**
     * find all token ids
     */
    const tokens = await bayc.getTokenIds();


    const opensea = new OpenSeaClient();
    /**
     * get collection metadata 
     * name, description, links
     */
    const metadata = await opensea.getCollectionMetadata(addr);

    /**
     * get token uris
     */
    const tokenUris: string[] = [];
    let index = 0;
    for(const tokenId of tokens) {
        const tokenUri = await bayc.getTokenUri(tokenId);
        tokenUris.push(tokenUri);
        if(index % 100 === 0) {
            console.log(`[${index / 100} %] token uri: ${tokenUri}`);
        }
        index += 1;
    }

    /**
     * get metadata for all tokens
     */
    const metadataClient = new MetadataClient();
    for (const url of tokenUris) {
        const metadata = await metadataClient.getMetadata(url)
        console.log(metadata);
    }

}

void main();