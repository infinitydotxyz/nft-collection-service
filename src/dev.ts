import { TokenStandard } from './models/contracts/Contract.interface';
import ContractFactory from './models/contracts/ContractFactory';
import CollectionMetadataProvider from './models/CollectionMetadataProvider';
import Collection from './models/Collection';
import { firebase, metadataClient } from './container';


export async function main(): Promise<void> {
        const addr = '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d'.toLowerCase();
//     // const addr= '0x8a90cab2b38dba80c64b7734e58ee1db38b8992e';
//     // const addr = '0x806010c3c09f76aaa95193bb81656baa8a04a646';

    const contractFactory = new ContractFactory();

    const bayc = contractFactory.create(addr, '1', TokenStandard.ERC721);

    const collectionMetadataProvider = new CollectionMetadataProvider();

    const collection = new Collection(bayc, metadataClient, collectionMetadataProvider);

    const {collection: collectionData, tokens, tokensWithErrors } = await collection.getInitialData();



    const collectionDoc = firebase.db.collection('collections').doc(`${collectionData.chainId}:${collectionData.address.toLowerCase()}`);
    await collectionDoc.set(collectionData, { merge: true});

    console.log('Updated collection doc');

    // TODO update tokens as we get data for them
    interface Batch {
        batch: FirebaseFirestore.WriteBatch,
        size: number
    }
    const batches: Batch[] = [];
    const newBatch = (): Batch => {
        return { batch: firebase.db.batch(), size: 0 };
    }
    
    let currentBatch = newBatch();
    for(const token of tokens) {
        if(currentBatch.size >= 500) {
            batches.push(currentBatch);
            currentBatch = newBatch();
            console.log(`Created new batch. Batches: ${batches.length}`);
        }
        const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId)
        currentBatch.batch.set(tokenDoc, token); // overwrite the token

        currentBatch.size += 1;
    }

    for(const token of tokensWithErrors) {
        if(currentBatch.size >= 500) {
            batches.push(currentBatch);
            currentBatch = newBatch();
            console.log(`Created new batch. Batches: ${batches.length}`);
        }
        const tokenDoc = collectionDoc.collection('nfts').doc(token.tokenId)
        currentBatch.batch.set(tokenDoc, token, {merge: true}); // only update the error field
        currentBatch.size += 1;
    }

    try{

        const batchPromises = batches.map(async (item) => await item.batch.commit());
        await Promise.all(batchPromises);
        console.log('wrote all batches');
    }catch(err) {
        console.error('failed to write batches');
        console.error(err);
    }

}
