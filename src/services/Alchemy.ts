// alchemy-nft-api/alchemy-web3-script.js
import { createAlchemyWeb3 } from '@alch/alchemy-web3';
import { singleton } from 'tsyringe';
import { logger } from '../container';
import axios from 'axios';

@singleton()
export default class Alchemy {
  // Initialize an alchemy-web3 instance:
  web3 = createAlchemyWeb3(process.env.JSON_RPC_MAINNET1 ?? '');

  async getNFTsOfOwner(address: string): Promise<void> {
    // The wallet address we want to query for NFTs:
    const nfts = await this.web3.alchemy.getNfts({
      owner: address
    });
    // Print owner's wallet address:
    logger.log('fetching NFTs for address:', address);
    logger.log('...');

    // Print total NFT count returned in the response:
    logger.log('number of NFTs found:', nfts.totalCount);
    logger.log('...');

    // Print contract address and tokenId for each NFT:
    for (const nft of nfts.ownedNfts) {
      logger.log('===');
      logger.log('contract address:', nft.contract.address);
      logger.log('token ID:', nft.id.tokenId);
    }
    logger.log('===');
  }

  async getNFTMetadata(address: string, tokenId: number): Promise<void> {
    // Fetch metadata for a particular NFT:
    logger.log('fetching metadata for a crypto coven NFT...');
    const response = await this.web3.alchemy.getNftMetadata({
      contractAddress: '0x5180db8F5c931aaE63c74266b211F580155ecac8',
      tokenId: '1590'
    });

    logger.log(response?.metadata);

    // Print some commonly used fields:
    // logger.log('NFT name: ', response.title);
    // logger.log('token type: ', response?.id?.tokenMetadata?.tokenType);
    // logger.log('tokenUri: ', response?.tokenUri?.gateway);
    // logger.log('image url: ', response?.metadata?.image);
    // logger.log('time last updated: ', response?.timeLastUpdated);
    // logger.log('===');
  }

  getNFTsOfCollection(contractAddr: string): void {
    // Fetch metadata for a particular NFT:
    logger.log('fetching nfts of a collection');
    const baseURL = `${process.env.JSON_RPC_MAINNET1}/getNFTsForCollection`;
    const cursorKey = '';
    const withMetadata = 'true';
    const url = `${baseURL}?contractAddress=${contractAddr}&cursorKey=${cursorKey}&withMetadata=${withMetadata}`;

    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    axios
      .get(url)
      .then((response) => logger.log(JSON.stringify(response.data, null, 2)))
      .catch((error) => logger.log(error));
  }
}
