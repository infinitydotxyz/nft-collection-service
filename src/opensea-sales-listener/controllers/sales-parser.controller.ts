import { firebase, logger } from '../../container';
import OpenSeaClient, { CollectionStats } from '../../services/OpenSea';
import { getDocumentIdByTime, convertWeiToEther } from '../utils';
import { NftTransaction, BASE_TIME, NftSalesRepository, CollectionStatsRepository, NftStatsRepository } from '../types';
import { DBN_COLLECTION_STATS, DBN_ALL_TIME, DBN_NFT_STATS, DBN_HISTORY, NULL_ADDRESS, DBN_SALES } from '../constants';
import { getHashByNftAddress } from '../../utils';

import SalesModel from 'opensea-sales-listener/models/sales.model';

// /**
//  *
//  * @description extract order info from transactions
//  * @returns
//  */
// const extractOrders = (transactions: NftTransaction[]): NftSalesRepository[] =>
//

// /**
//  * @description create new records on <sales> collection
//  */
// const createNftSales = async (orders: NftSalesRepository[], chainId = '1'): Promise<void> => {
//   try {
//     const firestore = firebase.db;
//     const batch = firestore.batch();
//     const SalesCollectionRef = firestore.collection(DBN_SALES);
//     orders.forEach((order) => {
//       const docRef = SalesCollectionRef.doc();
//       batch.create(docRef, order);
//     });
//     await batch.commit();
//   } catch (err) {
//     logger.error('SALES-LISTENER:[createNftSales]', err);
//     throw err;
//   }
// };

// /**
//  * @description update nft-stats collection with new orders
//  */
// const updateNftStats = async (orders: NftSalesRepository[], totalPrice: number, chainId = '1'): Promise<void> => {
//   try {
//     const firestore = firebase.db;
//     const batch = firestore.batch();

//     const NftStatsCollectionRef = firestore.collection(DBN_NFT_STATS);
//     orders.forEach((order) => {
//       const docRef = SalesCollectionRef.doc();
//       batch.create(docRef, order);
//     });
//     await batch.commit();
//   } catch (err) {
//     logger.error('SALES-LISTENER:[updateNftStats]', err);
//     throw err;
//   }
// };

export const handleNftTransactions = async (transactions: NftTransaction[], chainId = '1'): Promise<void> => {
  /** Skip the transactions without ether as the payment. ex: usd, matic ... */
  if (transactions[0].paymentToken !== NULL_ADDRESS) {
    return;
  }
  try {
    const totalPrice = convertWeiToEther(transactions[0].price);
    const orders: NftSalesRepository[] = transactions.map((tx: NftTransaction) => {
      const order: NftSalesRepository = {
        txHash: tx.txHash.trim().toLowerCase(),
        tokenId: tx.tokenIdStr,
        collectionAddress: tx.collectionAddr.trim().toLowerCase(),
        price: totalPrice / transactions.length,
        paymentTokenType: tx.paymentToken,
        quantity: tx.quantity,
        buyer: tx.buyerAddress.trim().toLowerCase(),
        seller: tx.sellerAddress.trim().toLowerCase(),
        source: tx.source,
        blockNumber: tx.blockNumber,
        blockTimestamp: tx.blockTimestamp
      };
      return order;
    });

    await SalesModel.handleOrders(orders);

    // await createNftSales(orders);
    // await updateNftStats(orders, totalPrice);

    // const firestore = firebase.db;

    /**
     * Update nft-stats collection
     */
    // const curStatsDocRef = firestore.collection(DBN_COLLECTION_STATS).doc(`${chainId}:${orders[0].collectionAddress}`);
    // txns.forEach(async (tx: NftSalesRepository) => {
    //   const txDocId = new Date(tx.blockTimestamp).getTime().toString();
    //   const nftDocId = getHashByNftAddress(chainId, txns[0].collectionAddress, txns[0].tokenId);
    //   await firestore.collection(DBN_NFT_STATS).doc(nftDocId).collection(DBN_HISTORY).doc(txDocId).set(tx);
    // });

    // const allTimeDocRef = curStatsDocRef;
    // const data = (await allTimeDocRef.get())?.data() as SalesRepository;
    // if (data) {
    //   /**
    //    * Update all-time info
    //    */
    //   await updateSalesDoc(allTimeDocRef, DBN_ALL_TIME, txns, totalPrice);

    //   /**
    //    *  Loop all the historical sales info by baseTime
    //    *  Update all the docs ( hourly, daily, .... )
    //    */
    //   // Object.values(BASE_TIME).forEach(async (baseTime) => {
    //   //   const docId = getDocumentIdByTime(txns[0].blockTimestamp, baseTime as BASE_TIME);
    //   //   const docRef = curStatsDocRef.collection(baseTime).doc(docId);
    //   //   await updateSalesDoc(docRef, docId, txns, totalPrice);
    //   // });
    // } else {
    //   /**
    //    * There is no sales info for this collection yet
    //    * Grab the sales from opensea
    //    * Init all the historical info based on opensea stats
    //    */
    //   //await initCollectionSalesInfoFromOpensea(chainId, txns, totalPrice);
    // }
    // logger.log(`... Finished parsing order ${orders[0].collectionAddr} [tokenId:] ${orders[0].tokenIdStr} `);
  } catch (err) {
    logger.error('Sales-scraper:updateCollectionSalesInfo', err);
  }
};

/**
 * @param docRef Reference to firestore doc needs to be updated
 * @param docId  Firestore document id based on timestamp
 * @param txns  Incoming order transactions
 * @param totalPrice Total price of the above transactions
 * @description This function is used to create/update sales document on firestore
 *              based on new orders.
 */
// const updateSalesDoc = async (
//   docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
//   docId: string,
//   txns: NftSalesRepository[],
//   totalPrice: number
// ): Promise<void> => {
//   try {
//     const numSales = txns.length;
//     const itemPrice = txns[0].price;
//     const data = (await docRef.get())?.data() as CollectionStatsRepository;
//     if (data) {
//       /**
//        * Update Original Doc
//        */
//       const updatedDoc: CollectionStatsRepository = {
//         totalVolume: data.totalVolume + itemPrice,
//         totalNumSales: data.totalNumSales + numSales,
//         floorPrice: data.floorPrice === 0 ? itemPrice : Math.min(data.floorPrice, itemPrice),
//         ceilPrice: data.ceilPrice === 0 ? itemPrice : Math.max(data.ceilPrice, itemPrice),
//         avgPrice: (data.totalVolume + totalPrice) / (data.totalNumSales + numSales),
//         timestamp: txns[0].blockTimestamp
//       };
//       await docRef.set(updatedDoc, { merge: true });
//     } else {
//       /**
//        * Create new doc
//        */
//       const newDoc: NftSalesRepository = {
//         totalVolume: totalPrice,
//         totalSales: numSales,
//         floorPrice: itemPrice,
//         ceilPrice: itemPrice,
//         avgPrice: itemPrice,
//         timestamp: txns[0].blockTimestamp
//       };
//       await docRef.set(newDoc, { merge: true });
//     }
//   } catch (err) {
//     logger.error('Sales-scraper: updateSalesDoc', err);
//   }
// };

// /**
//  *
//  * @param chainId
//  * @param txns Incomming order transactions
//  * @param totalPrice Total Price of the above txns
//  * @description We don't have the sales info yet for the collection in the incoming txns
//  *              Grab the sales info from opensea and init all the historical docs
//  */
// const initCollectionSalesInfoFromOpensea = async (
//   chainId: string,
//   txns: TransactionRepository[],
//   totalPrice: number
// ): Promise<void> => {
//   try {
//     const osCollectionStats = await initCollectionBaseVolume(txns[0].collectionAddr, txns[0].tokenId);

//     if (!osCollectionStats) return;

//     const firestore = firebase.db;
//     const curStatsDocRef = firestore.collection(DBN_COLLECTION_STATS).doc(`${chainId}:${txns[0].collectionAddr}`);
//     const timestamp = txns[0].blockTimestamp;

//     /**
//      * All-Time
//      */
//     const allTimeDoc: SalesRepository = {
//       docId: DBN_ALL_TIME,
//       totalVolume: osCollectionStats.market_cap,
//       totalSales: osCollectionStats.total_sales,
//       floorPrice: osCollectionStats.floor_price,
//       ceilPrice: 0,
//       avgPrice: osCollectionStats.average_price,
//       timestamp
//     };
//     const allTimeDocRef = curStatsDocRef;
//     await allTimeDocRef.set(allTimeDoc);

//     /**
//      * Yearly
//      */
//     const yearlyDocId = getDocumentIdByTime(timestamp, BASE_TIME.YEARLY);
//     await curStatsDocRef
//       .collection(BASE_TIME.YEARLY)
//       .doc(yearlyDocId)
//       .set({
//         ...allTimeDoc,
//         docId: yearlyDocId
//       });

//     /**
//      * Monthly
//      */
//     const monthlyDocId = getDocumentIdByTime(timestamp, BASE_TIME.MONTHLY);
//     const monthlyDoc = {
//       docId: monthlyDocId,
//       totalVolume: osCollectionStats.thirty_day_volume,
//       totalSales: osCollectionStats.thirty_day_sales,
//       floorPrice: osCollectionStats.thirty_day_average_price,
//       ceilPrice: 0,
//       avgPrice: osCollectionStats.thirty_day_average_price,
//       timestamp
//     };
//     await curStatsDocRef.collection(BASE_TIME.MONTHLY).doc(monthlyDocId).set(monthlyDoc);

//     /**
//      * Daily
//      */
//     const dailyDocId = getDocumentIdByTime(timestamp, BASE_TIME.DAILY);
//     const dailyDoc = {
//       docId: dailyDocId,
//       totalVolume: osCollectionStats.one_day_volume,
//       totalSales: osCollectionStats.one_day_sales,
//       floorPrice: osCollectionStats.one_day_average_price,
//       ceilPrice: 0,
//       avgPrice: osCollectionStats.one_day_average_price,
//       timestamp
//     };
//     await curStatsDocRef.collection(BASE_TIME.DAILY).doc(dailyDocId).set(dailyDoc);

//     /**
//      * Weekly
//      */
//     const weeklyDocId = getDocumentIdByTime(timestamp, BASE_TIME.WEEKLY);
//     const weeklyDoc = {
//       docId: weeklyDocId,
//       totalVolume: osCollectionStats.seven_day_volume,
//       totalSales: osCollectionStats.seven_day_sales,
//       floorPrice: osCollectionStats.seven_day_average_price,
//       ceilPrice: 0,
//       avgPrice: osCollectionStats.seven_day_average_price,
//       timestamp
//     };
//     await curStatsDocRef.collection(BASE_TIME.WEEKLY).doc(weeklyDocId).set(weeklyDoc);

//     /**
//      * Hourly
//      */
//     const hourlyDocId = getDocumentIdByTime(timestamp, BASE_TIME.HOURLY);
//     const hourlyDoc: SalesRepository = {
//       docId: hourlyDocId,
//       totalVolume: totalPrice,
//       totalSales: txns.length,
//       floorPrice: txns[0].price,
//       ceilPrice: txns[0].price,
//       avgPrice: txns[0].price,
//       timestamp
//     };
//     await curStatsDocRef.collection(BASE_TIME.HOURLY).doc(hourlyDocId).set(hourlyDoc);
//   } catch (err) {
//     logger.error('Sales-scraper:initCollectionSalesInfoFromOpensea', err);
//   }
// };

// const initCollectionBaseVolume = async (collectionAddr: string, tokenId: string): Promise<CollectionStats | undefined> => {
//   try {
//     const opensea = new OpenSeaClient();
//     const data = await opensea.getCollectionStatsByCollectionAddr(collectionAddr, tokenId);
//     return data;
//   } catch (err) {
//     logger.error('Sales-scraper: initCollectionBaseVolume', err);
//   }
// };
