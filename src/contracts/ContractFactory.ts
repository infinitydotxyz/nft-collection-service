import Contract, {TokenStandard} from './Contract.interface'
import Erc721Contract from './Erc721Contract';

export default class ContractFactory {
    create(address: string, chainId: string, standard: TokenStandard): Contract {
        switch(standard) {
            case TokenStandard.ERC721:
                return new Erc721Contract(address, chainId);
            case TokenStandard.ERC1155:
            default: 
                throw new Error(`Token Standard: ${standard} not yet implemented`);
        }
    }
}