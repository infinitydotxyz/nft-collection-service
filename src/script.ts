import { tokensDataToFile } from './exporters/csv';
import { collectionService, tokenDao } from './container';
import MoralisClient from './services/Moralis';
import Erc721Contract from './models/contracts/Erc721Contract';
import Nft from './models/Nft';

export async function main(): Promise<void> {
  const address = '0x1a92f7381b9f03921564a437210bb9396471050c'.toLowerCase();
  const chainId = '1';

  const contract = new Erc721Contract(address, chainId);
  const token = new Nft({
    tokenId: '1',
    mintedAt: 0,
    minter: '0x1a92f7381b9f03921564a437210bb9396471050c'
  }, contract);

  const generator = token.refreshToken(true);

  for await (const { token, action } of generator) {
    console.log(`Received data`);
    console.log(token);
    console.log(action);

    if(action) {
      switch(action) {
        case 'aggregateRequest':
          const tokens = await tokenDao.getAllTokens(chainId, address);
          
      }
    }
  }
  // try{

  //   const moralis = new MoralisClient();

  //   await moralis.getContractMetadata(address);
  //   await moralis.getContract(address);

  // }catch(err: any) {
  //   console.log(err.response.requestUrl)
  // }
}
