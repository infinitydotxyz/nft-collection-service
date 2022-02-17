
import { sleep } from "./utils";
import {Token} from './types/Token.interface';
import { firebase, moralis } from "./container";
import { addNumOwnersUpdatedAtField, updateCollectionNumOwners } from './background';
import BatchHandler from "models/BatchHandler";

export async function main(): Promise<void> {
  const address = '0x9e8b85dbb082255bd81c5b25323b694bc799a616'.toLowerCase();
  const chainId = '1';
  const requests = 0;
  try{

    // const promises: Array<Promise<any>> = [];
    // // const res = await moralis.getAllTokens(address, chainId) ;
    // for(let x = 0; x < 100; x++) {
    //   requests += 1;
    //   promises.push(moralis.getAllTokens(address, chainId));
    //   console.log(`Requests: ${requests}`);
    // }

    // await Promise.allSettled(promises);


  // await updateCollectionNumOwners();

  await addNumOwnersUpdatedAtField();

  }catch(err) {
    console.log(`Failed at ${requests}`)
    console.error(err);
  }

}