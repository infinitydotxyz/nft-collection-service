import { tokensDataToFile } from './exporters/csv';
import { collectionService, firebase } from './container';

export async function main(): Promise<void> {
  // const address = '0x1a92f7381b9f03921564a437210bb9396471050c'.toLowerCase();
  // const chainId = '1';

  // await collectionService.createCollection(address, chainId, true);
  const chainId = '1';
  const snap = await firebase.db.collection('collections').where('state.create.step', '==', 'complete').get();
  for (const doc of snap.docs) {
    const data = doc.data();
    const address = data.address as string;
    console.log('fetching data for', address);
    await tokensDataToFile(chainId, address.toLowerCase());
  } 
}
