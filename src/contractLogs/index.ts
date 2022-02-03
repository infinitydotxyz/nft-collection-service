/**
 * responsible for getting historical logs for contracts
 */

import { ethers, Event, Contract } from "ethers";
import { getProviderByChainId } from "../utils/ethers";
import Erc721Abi from "../abi/Erc721";
import { NULL_ADDR } from "../constants";
import {ThunkedLogRequest, paginateLogs} from './paginate';


export async function getContractLogs(address: string, chainId = '1') {
    await getErc721Mints(address, '1', {toBlock: 12345483});
//   await getERC721ContractCreator(address, chainId);
}

/**
 * mint is a transfer log from 0x0...
 *
 * 
 */
async function getErc721Mints(
  address: string,
  chainId = '1',
  options?: {
      fromBlock?: number
      toBlock?: number | 'latest'
  }
) {
  const provider = getProviderByChainId("1");
  const contract = new Contract(address, Erc721Abi, provider);
  const mintsFilter = contract.filters.Transfer(NULL_ADDR);

  console.log(mintsFilter);

  try {
      const thunkedLogRequest: ThunkedLogRequest = async (fromBlock: number, toBlock: number | 'latest') => {
          return await contract.queryFilter(mintsFilter, fromBlock, toBlock);
      }

      let fromBlock = options?.fromBlock;
      if(typeof fromBlock !== 'number') {
          const firstTransaction = await getERC721ContractCreator(address, chainId);
          fromBlock = firstTransaction.blockNumber;
      }
      console.log(`Starting at block: ${fromBlock}`)


      const mints = await paginateLogs(thunkedLogRequest, provider, fromBlock, options?.toBlock);
    //   12298060

    console.log(mints);

    console.log(mints.length)
  } catch (err) {
    console.error(err);
  }
}


/**
 * when the contract is created it emits an OwnershipTransferred event
 * from the NULL address to the new owner
 */
async function getERC721ContractCreator(address: string, chainId = "1"): Promise<Event> {
  const provider = getProviderByChainId(chainId);
  const contract = new Contract(address, Erc721Abi, provider);

  const filter = contract.filters.OwnershipTransferred(NULL_ADDR);

  // eslint-disable-next-line no-useless-catch
  try{
      const contractCreationTx = await contract.queryFilter(filter);
      const tx = contractCreationTx?.[0];
      if (tx) {
        return tx;
      }
    
      throw new Error(
        `failed to get contract creator tx for: ${address} on chain: ${chainId}`
      );
  }catch(err) {
      
      throw err;
  }
}
