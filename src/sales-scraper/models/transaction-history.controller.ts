import { ethers } from 'ethers';
import { firebase, logger } from '../../container';
import { getDocumentIdByTime, getETHPrice } from 'sales-scraper/utils';
import { SalesOrderType, BASE_TIME, TransactionRepository, SalesRepository } from 'sales-scraper/types';
import { DBN_HISTORICAL_DOC, DBN_STATUS_COLLECTION, DBN_ALL_TIME_DOC, DBN_TXN_COLLECTION } from 'sales-scraper/constants';
import { getRawAssetFromOpensea } from '../../../services/opensea/assets/getAssetFromOpensea';

const updateSalesDoc = async (
  docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  docId: string,
  txns: TransactionRepository[],
  totalPrice: number
): Promise<void> => {
  const numSales = txns.length;
  const itemPrice = txns[0].price;

  const data = (await docRef.get())?.data() as SalesRepository;

  if (data) {
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
      // --- update all time sales info ---
      await updateSalesDoc(allTimeDocRef, DBN_ALL_TIME_DOC, txns, totalPrice);

      // --- update hourly,daily,... sales info ----
      Object.values(BASE_TIME).forEach(async (baseTime) => {
        const docId = getDocumentIdByTime(txns[0].blockTimestamp, baseTime as BASE_TIME);
        const docRef = collectionDocRef.collection('status').doc(DBN_HISTORICAL_DOC).collection(baseTime).doc(docId);
        await updateSalesDoc(docRef, docId, txns, totalPrice);
      });
    } else {
      await initCollectionSalesInfoFromOpensea(chainId, txns, totalPrice);
    }
  } catch (err) {
    logger.error('Failed store txn to the db', err);
  }
};

const initCollectionSalesInfoFromOpensea = async (
  chainId: string,
  txns: TransactionRepository[],
  totalPrice: number
): Promise<void> => {
  const osCollectionStats = await initCollectionBaseVolume(chainId, txns[0].collectionAddr, txns[0].tokenId);

  const firestore = firebase.db;
  const collectionDocRef = firestore.collection('collections').doc(`${chainId}:${txns[0].collectionAddr}`);
  const historicalDocRef = collectionDocRef.collection('status').doc(DBN_HISTORICAL_DOC);
  const timestamp = txns[0].blockTimestamp;

  // --- set all time info ----
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

  // --- yearly ---
  const yearlyDocId = getDocumentIdByTime(timestamp, BASE_TIME.YEARLY);
  await historicalDocRef
    .collection(BASE_TIME.YEARLY)
    .doc(yearlyDocId)
    .set({
      ...allTimeDoc,
      docId: yearlyDocId
    });

  // --- monthly ---
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

  // --- quartly ---
  const quarltyDocId = getDocumentIdByTime(timestamp, BASE_TIME.QUARTLY);
  await historicalDocRef
    .collection(BASE_TIME.QUARTLY)
    .doc(quarltyDocId)
    .set({ ...montlyDoc, docId: quarltyDocId });

  // --- daily ---

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
  await historicalDocRef.collection(BASE_TIME.DAILY).doc(dailyDocId).set({ dailyDoc });

  // --- Weekly ---
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
  await historicalDocRef.collection(BASE_TIME.WEEKLY).doc(weeklyDocId).set({ weeklyDoc });
};

const initCollectionBaseVolume = async (chainId: string, collectionAddr: string, tokenId: string) => {
  try {
    // const data = await getRawAssetFromOpensea(chainId, collectionAddr, tokenId);
    //const osCollectionStats = data?.collection?.stats;
    //return osCollectionStats;
    // console.log(info?.collection?.status);
  } catch (err) {
    logger.error('Sales Scraper: [Opensea API] Failed to retrieve token info');
  }
};

export { createNftTransactionHistory };
