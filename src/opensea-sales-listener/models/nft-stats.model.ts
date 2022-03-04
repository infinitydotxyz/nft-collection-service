import { NftSalesRepository } from '../types';
import { firebase, logger } from '../../container';

export class CollectionStats {
  static firestore = firebase.db;

  async handleOrders(orders: NftSalesRepository[], totalPrice: number, chainId = '1'): Promise<void> {}
}
