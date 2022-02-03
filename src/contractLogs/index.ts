/**
 * responsible for getting historical logs for contracts
 */

import { ethers, Event, Contract } from "ethers";
import { getProviderByChainId } from "../utils/ethers";
import Erc721Abi from "../abi/Erc721";
import { NULL_ADDR } from "../constants";

/**
 * need to know
 * network
 *
 */
export async function getContractLogs(address: string) {
  //   await getErc721Mints(address);
  await getERC721ContractCreator(address);
}

/**
 * mint is a transfer log from 0x0...
 *
 * 2K block range and no limit on the response size
 */
async function getErc721Mints(
  address: string,
  fromBlock?: number,
  toBlock?: number
) {
  const provider = getProviderByChainId("1");
  const contract = new Contract(address, Erc721Abi, provider);
  const mintsFilter = contract.filters.Transfer(NULL_ADDR);

  console.log(mintsFilter);

  try {
    const mints = await contract.queryFilter(mintsFilter, 12298060, 12299060);
    console.log(mints);
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
