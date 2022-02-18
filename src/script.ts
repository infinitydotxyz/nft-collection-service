import { addNumOwnersUpdatedAtField } from './background';

export async function main(): Promise<void> {
  // const address = '0x9e8b85dbb082255bd81c5b25323b694bc799a616'.toLowerCase();
  // const chainId = '1';
  const requests = 0;
  try{

  /**
   * must be run to add numOwnersUpdatedAt field to existing collections 
   * that don't yet have this field
   */
  await addNumOwnersUpdatedAtField();
    

  }catch(err) {
    console.log(`Failed at ${requests}`)
    console.error(err);
  }

}

