import { NftSalesRepository } from '../types';
import { firebase, logger } from '../../container';

export class CollectionStats {
  static firestore = firebase.db;

  async handleOrders(orders: NftSalesRepository[]): Promise<void> {
    return;
  }
}
