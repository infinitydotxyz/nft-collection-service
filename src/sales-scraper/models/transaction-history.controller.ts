import { firebase, logger } from '../../container';
import OpenSeaClient, { CollectionStats } from 'services/OpenSea';
import { getDocumentIdByTime, getETHPrice } from 'sales-scraper/utils';
import { SalesOrderType, BASE_TIME, TransactionRepository, SalesRepository } from 'sales-scraper/types';
import { DBN_HISTORICAL_DOC, DBN_STATUS_COLLECTION, DBN_ALL_TIME_DOC, DBN_TXN_COLLECTION } from 'sales-scraper/constants';

/**
 * @param docRef Reference to firestore doc needs to be updated
 * @param docId  Firestore document id based on timestamp
 * @param txns  Incoming order transactions
 * @param totalPrice Total price of the above transactions
 * @description This function is used to create/update sales document on firestore
 *              based on new orders.
 */
const updateSalesDoc = async (
  docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  docId: string,
  txns: TransactionRepository[],
  totalPrice: number
): Promise<void> => {
  try {
    const numSales = txns.length;
    const itemPrice = txns[0].price;
    const data = (await docRef.get())?.data() as SalesRepository;
    if (data) {
      /**
       * Needs to update the previous info
       */
      const updatedDoc: SalesRepository = {
        docId: docId,
        totalVolume: data.totalVolume + itemPrice,
        totalSales: data.totalSales + numSales,
        floorPrice: data.floorPrice === 0 ? itemPrice : Math.min(data.floorPrice, itemPrice),
        ceilPrice: data.ceilPrice === 0 ? itemPrice : Math.max(data.ceilPrice, itemPrice),
        avgPrice: (data.totalVolume + totalPrice) / (data.totalSales + numSales),
        timestamp: txns[0].blockTimestamp
      };
      await docRef.set(updatedDoc);
    } else {
      /**
       * Create new doc
       */
      const newDoc: SalesRepository = {
        docId,
        totalVolume: totalPrice,
        totalSales: numSales,
        floorPrice: itemPrice,
        ceilPrice: itemPrice,
        avgPrice: itemPrice,
        timestamp: txns[0].blockTimestamp
      };
      await docRef.set(newDoc);
    }
  } catch (err) {
    logger.error('Sales-scraper: updateSalesDoc', err);
  }
};

const createNftTransactionHistory = async (orders: SalesOrderType[], chainId = '1'): Promise<void> => {
  const firestore = firebase.db;
  // const _orders: SalesOrderType[] = [
  //   {
  //     txHash: '0x7a22fe80713bd5be68fc904bffa68c702838a6f94706e521ab74023592822479',
  //     blockNumber: 14301134,
  //     blockTimestamp: new Date(),
  //     price: BigInt('150000000000000000'),
  //     paymentToken: '0x0000000000000000000000000000000000000000',
  //     buyerAdress: '0xEe3a6b93e140f64953A896367B59FFF4b91514a9',
  //     sellerAdress: '0x461bF9d49AAEC8457F5a0772D3CCcEF7fae8A865',
  //     collectionAddr: '0x7a4d1b54dd21dde804c18b7a830b5bc6e586a7f6',
  //     tokenIdStr: '1428',
  //     quantity: 1,
  //     source: SCRAPER_SOURCE.OPENSEA,
  //     tokenType: TOKEN_TYPE.ERC721
  //   }
  // ];

  const totalPrice = getETHPrice(orders[0]);
  const txns: TransactionRepository[] = orders.map((order: SalesOrderType) => {
    const tx: TransactionRepository = {
      txHash: order.txHash.toLocaleLowerCase(),
      tokenId: order.tokenIdStr,
      collectionAddr: order.collectionAddr.toLocaleLowerCase(),
      price: getETHPrice(order) / txns.length,
      paymentToken: order.paymentToken,
      quantity: order.quantity,
      buyer: order.buyerAdress.toLocaleLowerCase(),
      seller: order.sellerAdress.toLocaleLowerCase(),
      source: order.source,
      blockNumber: order.blockNumber,
      blockTimestamp: order.blockTimestamp
    };
    return tx;
  });

  /*
    Insert Txns to Collection/Nft/Txns
  */
  const collectionDocRef = firestore.collection('collections').doc(`${chainId}:${txns[0].collectionAddr}`);
  txns.forEach(async (tx: TransactionRepository) => {
    const txDocId = new Date(tx.blockTimestamp).getTime().toString();
    await collectionDocRef.collection('nfts').doc(tx.tokenId).collection(DBN_TXN_COLLECTION).doc(txDocId).set(tx);
  });

  try {
    const allTimeDocRef = collectionDocRef.collection(DBN_STATUS_COLLECTION).doc(DBN_ALL_TIME_DOC);
    const data = (await allTimeDocRef.get())?.data() as SalesRepository;
    if (data) {
      /**
       * Update all-time info
       */
      await updateSalesDoc(allTimeDocRef, DBN_ALL_TIME_DOC, txns, totalPrice);

      /**
       *  Loop all the historical sales info by baseTime
       *  Update all the docs ( hourly, daily, .... )
       */
      Object.values(BASE_TIME).forEach(async (baseTime) => {
        const docId = getDocumentIdByTime(txns[0].blockTimestamp, baseTime as BASE_TIME);
        const docRef = collectionDocRef.collection('status').doc(DBN_HISTORICAL_DOC).collection(baseTime).doc(docId);
        await updateSalesDoc(docRef, docId, txns, totalPrice);
      });
    } else {
      /**
       * There is no sales info for this collection yet
       * Grab the sales from opensea
       * Init all the historical info based on opensea stats
       */
      await initCollectionSalesInfoFromOpensea(chainId, txns, totalPrice);
    }
  } catch (err) {
    logger.error('Failed store txn to the db', err);
  }
};

/**
 *
 * @param chainId
 * @param txns Incomming order transactions
 * @param totalPrice Total Price of the above txns
 * @description We don't have the sales info yet for the collection in the incoming txns
 *              Grab the sales info from opensea and init all the historical docs
 */
const initCollectionSalesInfoFromOpensea = async (
  chainId: string,
  txns: TransactionRepository[],
  totalPrice: number
): Promise<void> => {
  const osCollectionStats = await initCollectionBaseVolume(txns[0].collectionAddr, txns[0].tokenId);

  if (!osCollectionStats) return;

  const firestore = firebase.db;
  const collectionDocRef = firestore.collection('collections').doc(`${chainId}:${txns[0].collectionAddr}`);
  const historicalDocRef = collectionDocRef.collection('status').doc(DBN_HISTORICAL_DOC);
  const timestamp = txns[0].blockTimestamp;

  /**
   * All-Time
   */
  const allTimeDoc: SalesRepository = {
    docId: DBN_ALL_TIME_DOC,
    totalVolume: osCollectionStats.market_cap,
    totalSales: osCollectionStats.total_sales,
    floorPrice: osCollectionStats.floor_price,
    ceilPrice: 0,
    avgPrice: osCollectionStats.average_price,
    timestamp
  };
  const allTimeDocRef = collectionDocRef.collection(DBN_STATUS_COLLECTION).doc(DBN_ALL_TIME_DOC);
  await allTimeDocRef.set(allTimeDoc);

  /**
   * Yearly
   */
  const yearlyDocId = getDocumentIdByTime(timestamp, BASE_TIME.YEARLY);
  await historicalDocRef
    .collection(BASE_TIME.YEARLY)
    .doc(yearlyDocId)
    .set({
      ...allTimeDoc,
      docId: yearlyDocId
    });

  /**
   * Montly
   */
  const monthlyDocId = getDocumentIdByTime(timestamp, BASE_TIME.MONTHLY);
  const montlyDoc = {
    docId: monthlyDocId,
    totalVolume: osCollectionStats.thirty_day_volume,
    totalSales: osCollectionStats.thirty_day_sales,
    floorPrice: osCollectionStats.thirty_day_average_price,
    ceilPrice: 0,
    avgPrice: osCollectionStats.thirty_day_average_price,
    timestamp
  };
  await historicalDocRef.collection(BASE_TIME.MONTHLY).doc(monthlyDocId).set(montlyDoc);

  /**
   * Quartly
   */
  const quarltyDocId = getDocumentIdByTime(timestamp, BASE_TIME.QUARTLY);
  await historicalDocRef
    .collection(BASE_TIME.QUARTLY)
    .doc(quarltyDocId)
    .set({ ...montlyDoc, docId: quarltyDocId });

  /**
   * Daily
   */
  const dailyDocId = getDocumentIdByTime(timestamp, BASE_TIME.DAILY);
  const dailyDoc = {
    docId: dailyDocId,
    totalVolume: osCollectionStats.one_day_volume,
    totalSales: osCollectionStats.one_day_sales,
    floorPrice: osCollectionStats.one_day_average_price,
    ceilPrice: 0,
    avgPrice: osCollectionStats.one_day_average_price,
    timestamp
  };
  await historicalDocRef.collection(BASE_TIME.DAILY).doc(dailyDocId).set(dailyDoc);

  /**
   * Q12H
   */
  const q12HDocId = getDocumentIdByTime(timestamp, BASE_TIME.Q12H);
  await historicalDocRef
    .collection(BASE_TIME.Q12H)
    .doc(q12HDocId)
    .set({ ...dailyDoc, docId: q12HDocId });

  /**
   * Weekly
   */
  const weeklyDocId = getDocumentIdByTime(timestamp, BASE_TIME.WEEKLY);
  const weeklyDoc = {
    docId: weeklyDocId,
    totalVolume: osCollectionStats.seven_day_volume,
    totalSales: osCollectionStats.seven_day_sales,
    floorPrice: osCollectionStats.seven_day_average_price,
    ceilPrice: 0,
    avgPrice: osCollectionStats.seven_day_average_price,
    timestamp
  };
  await historicalDocRef.collection(BASE_TIME.WEEKLY).doc(weeklyDocId).set(weeklyDoc);

  /**
   * Hourly
   */
  const hourlyDocId = getDocumentIdByTime(timestamp, BASE_TIME.HOURLY);
  const hourlyDoc: SalesRepository = {
    docId: hourlyDocId,
    totalVolume: totalPrice,
    totalSales: txns.length,
    floorPrice: txns[0].price,
    ceilPrice: txns[0].price,
    avgPrice: txns[0].price,
    timestamp
  };
  await historicalDocRef.collection(BASE_TIME.HOURLY).doc(hourlyDocId).set(hourlyDoc);
};

const initCollectionBaseVolume = async (collectionAddr: string, tokenId: string): Promise<CollectionStats | undefined> => {
  try {
    const opensea = new OpenSeaClient();
    const data = await opensea.getCollectionStatsByCollectionAddr(collectionAddr, tokenId);
    return data;
  } catch (err) {
    logger.error('Sales-scraper: initCollectionBaseVolume', err);
  }
};

export { createNftTransactionHistory };
