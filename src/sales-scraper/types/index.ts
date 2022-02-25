export enum SCRAPER_SOURCE {
  OPENSEA = 'OPENSEA'
}

export enum TOKEN_TYPE {
  ERC721 = 'ERC721',
  ERC1155 = 'ERC1155'
}

export interface SalesOrderType {
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
  price: BigInt;
  paymentToken: string;
  buyerAdress: string;
  sellerAdress: string;
  collectionAddr: string;
  tokenIdStr: string;
  quantity: number;
  source: SCRAPER_SOURCE;
  tokenType: TOKEN_TYPE;
}

export interface TransactionHistoryReporsitory {
  txHash: string;
  price: BigInt;
  erc20PaymentTokenType: string;
  quantity: number;
  buyer: string;
  seller: string;
  blockNumber: number;
  blockTimeStamp: Date;
}
