export enum SCRAPER_SOURCE {
  OPENSEA = 'OPENSEA'
}

export enum TOKEN_TYPE {
  ERC721 = 'ERC721',
  ERC1155 = 'ERC1155'
}

export enum BASE_TIME {
  HOURLY = 'hourly',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  YEARLY = 'yearly'
}
export interface SalesOrderType {
  txHash: string;
  blockNumber: number;
  blockTimestamp: Date;
  price: BigInt;
  paymentToken: string;
  buyerAddress: string;
  sellerAddress: string;
  collectionAddr: string;
  tokenIdStr: string;
  quantity: number;
  source: SCRAPER_SOURCE;
  tokenType: TOKEN_TYPE;
}

export interface TransactionRepository {
  txHash: string;
  tokenId: string;
  collectionAddr: string;
  price: number;
  paymentToken: string;
  quantity: number;
  buyer: string;
  seller: string;
  source: string;
  blockNumber: number;
  blockTimestamp: Date;
}

export interface SalesRepository {
  docId: string;
  totalVolume: number;
  totalSales: number;
  floorPrice: number;
  ceilPrice: number;
  avgPrice: number;
  timestamp: Date;
}
