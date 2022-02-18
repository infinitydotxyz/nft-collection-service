import { sleep } from "./utils";
import {Token} from './types/Token.interface';
import { firebase, moralis, collectionService } from "./container";
import { addNumOwnersUpdatedAtField, updateCollectionNumOwners } from './background';
import BatchHandler from "./models/BatchHandler";
import { tokensDataToFile } from './exporters/csv';

export async function main(): Promise<void> {
  const address = '0x9e8b85dbb082255bd81c5b25323b694bc799a616'.toLowerCase();
  const chainId = '1';
  const requests = 0;
  try{

  /**
   * must be run to add numOwnersUpdatedAt field to existing collections 
   * that don't yet have this field
   */
  await addNumOwnersUpdatedAtField();
    
//   const snap = await firebase.db.collection('collections').where('state.create.step', '==', 'complete').get();
//   for (const doc of snap.docs) {
//     const data = doc.data();
//     const address = data.address as string;
//     console.log('fetching data for', address);
//     await tokensDataToFile(chainId, address.toLowerCase());
//   } 

  }catch(err) {
    console.log(`Failed at ${requests}`)
    console.error(err);
  }

}

