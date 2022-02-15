import { tokensDataToFile } from './exporters/csv';
import { collectionService } from './container';
import MoralisClient from './services/Moralis';

export async function main(): Promise<void> {
  const address = '0x1a92f7381b9f03921564a437210bb9396471050c'.toLowerCase();
  const chainId = '1';

  try{

    const moralis = new MoralisClient();

    await moralis.getContractMetadata(address);
    await moralis.getContract(address);

  }catch(err: any) {
    console.log(err.response.requestUrl)
  }
}
