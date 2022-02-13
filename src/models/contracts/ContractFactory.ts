import { ethers } from 'ethers';
import Contract, { TokenStandard } from './Contract.interface';
import Erc721Contract from './Erc721Contract';

export default class ContractFactory {
  async create(address: string, chainId: string): Promise<Contract> {
    const standard = await this.getTokenStandard(address, chainId);
    switch (standard) {
      case TokenStandard.ERC721:
        return new Erc721Contract(address, chainId);
      case TokenStandard.ERC1155:
      default:
        throw new Error(`Token Standard: ${standard} not yet implemented`);
    }
  }

  private async getTokenStandard(address: string, chainId: string): Promise<TokenStandard> {
    // TODO sniff or request token standard
    if (!ethers.utils.isAddress(address)) {
      throw new Error(`invaplid token address: ${address}`);
    }

    if (!chainId) {
      throw new Error(`invalid chainId: ${chainId}`);
    }

    return await new Promise((resolve, reject) => {
      resolve(TokenStandard.ERC721);
    });
  }
}
