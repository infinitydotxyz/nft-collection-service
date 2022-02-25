import { ethers } from 'ethers';
import { WYVERN_EXCHANGE_ADDRESS, MERKLE_VALIDATOR_ADDRESS, WYVERN_ATOMICIZER_ADDRESS } from '../constants';
import WyvernExchangeABI from '.././abi/wyvernExchange.json';
import { ethProvider } from '../../../utils/ethers';
import { SCRAPER_SOURCE, TOKEN_TYPE, SalesOrderType } from '../types/index';

/**
 *
 * @param inputs inputs AtomicMatch call that triggered the handleAtomicMatch_ call handler.
 * @description This function is used to handle the case of a "bundle" sale made from OpenSea.
 *              A "bundle" sale is a sale that contains several assets embeded in the same, atomic, transaction.
 */
function handleBundleSale(inputs) {
  const calldataBuy: string = inputs.calldataBuy;
  const TRAILING_0x = 2;
  const METHOD_ID_LENGTH = 8;
  const UINT_256_LENGTH = 64;

  const indexStartNbToken = TRAILING_0x + METHOD_ID_LENGTH + UINT_256_LENGTH * 4;
  const indexStopNbToken = indexStartNbToken + UINT_256_LENGTH;

  const nbToken = ethers.BigNumber.from('0x' + calldataBuy.slice(indexStartNbToken, indexStopNbToken)).toNumber();
  const collectionAddrs: string[] = [];
  let offset = indexStopNbToken;
  for (let i = 0; i < nbToken; i++) {
    collectionAddrs.push(
      ethers.BigNumber.from('0x' + calldataBuy.slice(offset, offset + UINT_256_LENGTH)).toHexString()
    );

    // Move forward in the call data
    offset += UINT_256_LENGTH;
  }

  /**
   * After reading the contract addresses involved in the bundle sale
   * there are 2 chunks of params of length nbToken * UINT_256_LENGTH.
   *
   * Those chunks are each preceded by a "chunk metadata" of length UINT_256_LENGTH
   * Finalluy a last "chunk metadata" is set of length UINT_256_LENGTH. (3 META_CHUNKS)
   *
   *
   * After that we are reading the abiencoded data representing the transferFrom calls
   */
  const LEFT_CHUNKS = 2;
  const NB_META_CHUNKS = 3;
  offset += nbToken * UINT_256_LENGTH * LEFT_CHUNKS + NB_META_CHUNKS * UINT_256_LENGTH;

  const TRANSFER_FROM_DATA_LENGTH = METHOD_ID_LENGTH + UINT_256_LENGTH * 3;
  const tokenIdsList: string[] = [];
  for (let i = 0; i < nbToken; i++) {
    const transferFromData = calldataBuy.substring(offset, offset + TRANSFER_FROM_DATA_LENGTH);
    const tokenIdstr = ethers.BigNumber.from(
      '0x' + transferFromData.substring(METHOD_ID_LENGTH + UINT_256_LENGTH * 2)
    ).toString();
    tokenIdsList.push(tokenIdstr);

    // Move forward in the call data
    offset += TRANSFER_FROM_DATA_LENGTH;
  }

  return collectionAddrs.map((val, index) => ({
    collectionAddr: collectionAddrs[index],
    tokendIdStr: tokenIdsList[index],
    quantity: 1,
    tokenType: 'ERC721'
  }));
}

/**
 *
 * @param inputs The AtomicMatch call that triggered the handleAtomicMatch_ call handler.
 * @description This function is used to handle the case of a "normal" sale made from OpenSea.
 *              A "normal" sale is a sale that is not a bundle (only contains one asset).
 */

function handleSingleSale(inputs) {
  const TRAILING_0x = 2;
  const METHOD_ID_LENGTH = 8;
  const UINT_256_LENGTH = 64;

  const addrs = inputs.addrs;
  const nftAddrs = addrs[4];

  let collectionAddr;
  let tokendIdStr;
  let quantity = 1;
  let tokenType = 'ERC721';
  const calldataBuy: string = inputs.calldataBuy;

  let offset = TRAILING_0x + METHOD_ID_LENGTH + UINT_256_LENGTH * 2;
  if (nftAddrs.toLowerCase() === MERKLE_VALIDATOR_ADDRESS) {
    collectionAddr = ethers.BigNumber.from('0x' + calldataBuy.slice(offset, offset + UINT_256_LENGTH)).toHexString();
    offset += UINT_256_LENGTH;
    tokendIdStr = ethers.BigNumber.from('0x' + calldataBuy.slice(offset, offset + UINT_256_LENGTH)).toString();
    offset += UINT_256_LENGTH;
    if (calldataBuy.length > 458) {
      quantity = ethers.BigNumber.from('0x' + calldataBuy.slice(offset, offset + UINT_256_LENGTH)).toNumber();
      tokenType = 'ERC1155';
    }
  } else {
    // Token minted on Opensea
    collectionAddr = nftAddrs.toLowerCase();
    tokendIdStr = ethers.BigNumber.from('0x' + calldataBuy.slice(offset, offset + UINT_256_LENGTH)).toString();
    offset += UINT_256_LENGTH;
    if (calldataBuy.length > 202) {
      quantity = ethers.BigNumber.from('0x' + calldataBuy.slice(offset, offset + UINT_256_LENGTH)).toNumber();
      tokenType = 'ERC1155';
    }
  }

  return {
    collectionAddr,
    tokendIdStr,
    quantity,
    tokenType
  };
}

/**
 *
 * @param call The AtomicMatch call that triggered this call handler.
 * @description When a sale is made on OpenSea an AtomicMatch_ call is invoked.
 *              This handler will create the associated OpenSeaSale entity
 */
function handleAtomicMatch_(inputs, txHash, block) {
  try {
    const addrs = inputs.addrs;
    const saleAdress = addrs[11];

    const uints: BigInt[] = inputs.uints;
    // TODO: The price should be retrieved from the calculateMatchPrice_ method of OpenSea Smart Contract
    const price: BigInt = uints[4];
    const buyerAdress = addrs[1]; // Buyer.maker
    const sellerAdress = addrs[8]; // Saler.maker
    const paymentTokenErc20Address = addrs[6];

    const res: SalesOrderType = {
      txHash,
      blockNumber: block.number,
      blockTimestamp: new Date(block.timestamp),
      price,
      paymentToken: paymentTokenErc20Address,
      buyerAdress,
      sellerAdress,
      collectionAddr: '',
      tokenIdStr: '',
      quantity: 0,
      source: SCRAPER_SOURCE.OPENSEA,
      tokenType: TOKEN_TYPE.ERC721
    };

    if (saleAdress.toLowerCase() !== WYVERN_ATOMICIZER_ADDRESS) {
      const token = handleSingleSale(inputs);
      res.collectionAddr = token.collectionAddr;
      res.tokenIdStr = token.tokendIdStr;
      res.tokenType = token.tokenType === 'ERC721' ? TOKEN_TYPE.ERC721 : TOKEN_TYPE.ERC1155;
      res.quantity = token.quantity;

      return [res];
    } else {
      const tokens = handleBundleSale(inputs);
      const response = tokens.map((token) => ({
        ...res,
        ...token
      }));
      return response;
    }
  } catch (err) {
    console.error(`Failed to parse open sales transaction: ${txHash}`);
  }
}

const getTransactionByHash = async (txHash) => {
  return (await ethProvider.getTransaction(txHash)).data;
};

const sleep = async (ms) => {
  return await new Promise((resolve) => setTimeout(resolve, ms));
};

const execute = () => {
  /*
    --- Listen Opensea Sales event
  */
  const OpenseaContract = new ethers.Contract(WYVERN_EXCHANGE_ADDRESS, WyvernExchangeABI, ethProvider);
  const openseaIface = new ethers.utils.Interface(WyvernExchangeABI);

  OpenseaContract.on('OrdersMatched', async (...args) => {
    const event = args[args.length - 1];
    const txHash = event.transactionHash;

    let response;
    let maxAttempts = 10;
    while (maxAttempts > 0) {
      try {
        response = await getTransactionByHash(txHash);
      } catch (err) {
        await sleep(2000);
        maxAttempts--;
        continue;
      }
      break;
    }
    try {
      const block = await event.getBlock();
      const decodedResponse = openseaIface.decodeFunctionData('atomicMatch_', response);
      const orders = handleAtomicMatch_(decodedResponse, txHash, block);
    } catch (err) {
      console.error(`Failed to decode handleAtomicMatch function from tx: ${txHash}`);
    }
  });
};

export { execute };
