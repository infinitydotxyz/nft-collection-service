import Erc721Contract from './contracts/Erc721Contract';
import MetadataClient from './services/Metadata';


async function main(): Promise<void> {
    const addr = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'.toLowerCase();
    // const addr= '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e';
    // const addr = '0x806010c3c09f76aaa95193bb81656baa8a04a646';

    // const contractFactory = new ContractFactory();

    // const bayc = contractFactory.create(addr, '1', TokenStandard.ERC721);
    const bayc = new Erc721Contract(addr, '1');


    /**
     * find all token ids
     */
    // const tokens = await bayc.getTokenIds();

    // const mints = await bayc.getMints({returnType: 'generator'}) as unknown as Generator<Promise<ethers.Event[]>>;
    // console.log(tokens);
    const tokens: string[] = [];
    for(let x = 0; x < 10; x +=1) {
        tokens.push(`${x}`);
    }

    // console.log(tokens);
    // const opensea = new OpenSeaClient();
    // /**
    //  * get collection metadata 
    //  * name, description, links
    //  */
    // const metadata = await opensea.getCollectionMetadata(addr);


    // /**
    //  * get token uris
    //  */
    // const tokenUris: string[] = [];
    // let index = 0;
    // for(const tokenId of tokens) {
    //     const tokenUri = await bayc.getTokenUri(tokenId);
    //     tokenUris.push(tokenUri);
    //     if(index % 100 === 0) {
    //         console.log(`[${index / 100} %] token uri: ${tokenUri}`);
    //     }
    //     index += 1;
    // }

    // // /**
    // //  * get metadata for all tokens
    // //  */
    // console.time('');
    const metadataClient = new MetadataClient();
    // const metadataPromises: Array<Promise<{data: string}>> = [];
    // index = 0;
    // for (const url of tokenUris) {
    //     metadataPromises.push(metadataClient.get(url))
    //     index += 1;

    //     console.timeLog('', `${index / 100}%`);
    // }

    // const metadata = await Promise.all(metadataPromises);

    // console.timeEnd('')
    // console.log(metadata.length);

    // console.log(metadata.map((item) => item.data))


    const imageUrl = 'ipfs://QmRRPWG96cmgTn2qSzjwr2qvfNEuhunv6FNeMFGa9bx6mQ';
    const response = await metadataClient.get(imageUrl);
    const contentType = response.headers['content-type'];
    console.log(contentType);
    // console.log(image);
    // await writeFile('./image', Buffer.from(image.data));
}

void main();