import { ethers } from 'ethers';
import { firestore } from '@base/container';

import {
  SalesOrderType,
  SCRAPER_SOURCE,
  TOKEN_TYPE,
  BASE_TIME,
  TransactionRepository,
  SalesRepository,
  DBN_COLLECTION_HISTORICAL,
  DBN_COLLECTION_STATUS,
  DBN_COLLECTION_ALL_TIME,
  DBN_COLLECTION_TXN,
  DBN_COLLECTIONS
} from 'sales-scraper/types';
import { getDocumentIdByTime } from 'sales-scraper/utils';
import { getRawAssetFromOpensea } from '../../../services/opensea/assets/getAssetFromOpensea';

const getETHPrice = (order: SalesOrderType): number => {
  return parseFloat(ethers.utils.formatEther(order.price.toString()));
};

const updateSalesDoc = async (
  docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  tx: TransactionRepository,
  docId: string
): Promise<void> => {
  const originalDocData = (await docRef.get())?.data() as SalesRepository;

  if (originalDocData) {
    const newDoc: SalesRepository = {
      docId: docId,
      totalVolume: originalDocData.totalVolume + tx.price,
      totalSales: originalDocData.totalSales + 1,
      floorPrice: originalDocData.floorPrice === 0 ? tx.price : Math.min(originalDocData.floorPrice, tx.price),
      ceilPrice: originalDocData.ceilPrice === 0 ? tx.price : Math.max(preoriginalDocDatavDoc.ceilPrice, tx.price),
      avgPrice: (originalDocData.totalVolume + tx.price) / (originalDocData.totalSales + 1),
      timestamp: tx.blockTimestamp
    };
    await docRef.set(newDoc);
  } else {
    const newDoc: SalesRepository = {
      docId,
      totalVolume: tx.price,
      totalSales: 1,
      floorPrice: tx.price,
      ceilPrice: tx.price,
      avgPrice: tx.price,
      timestamp: tx.blockTimestamp
    };
    await docRef.set(newDoc);
  }
};

const createNftTransactionHistory = async (orders: SalesOrderType[], chainId = '1'): Promise<void> => {
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

  const txns: TransactionRepository[] = orders.map((order: SalesOrderType) => {
    const tx: TransactionRepository = {
      txHash: order.txHash.toLocaleLowerCase(),
      tokenId: order.tokenIdStr,
      collectionAddr: order.collectionAddr.toLocaleLowerCase(),
      price: getETHPrice(order) / order.quantity,
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

  const collectionDocRef = firestore.collection(DBN_COLLECTIONS).doc(`${chainId}:${txns[0].collectionAddr}`);

  /*
    Insert Txns to Collection/Nft/Txns
  */

  txns.forEach(async (tx) => {
    const txId = new Date(tx.blockTimestamp).getTime().toString();
    await collectionDocRef.collection('nfts').doc(tx.tokenId).collection('txns').doc(txId).set(tx);
  });

  txns.forEach(async (tx) => {
    try {
      const collectionDocRef = firestore.collection('collections').doc(`${chainId}:${tx.collectionAddr}`);

      /*
        Add Txns
      */
      const txId = new Date(tx.blockTimestamp).getTime().toString();
      await collectionDocRef.collection('nfts').doc(tx.tokenId).collection('txns').doc(txId).set(tx);

      const allTimeDocRef = collectionDocRef.collection('status').doc('allTime');
      const prevDoc = (await allTimeDocRef.get())?.data() as HistoricalInfo;

      if (prevDoc) {
        const newDoc: HistoricalInfo = {
          docId: 'ALL-TIME-INFO',
          totalVolume: prevDoc.totalVolume + tx.price,
          totalSales: prevDoc.totalSales + 1,
          floorPrice: prevDoc.floorPrice === 0 ? tx.price : Math.min(prevDoc.floorPrice, tx.price),
          ceilPrice: prevDoc.ceilPrice === 0 ? tx.price : Math.max(prevDoc.ceilPrice, tx.price),
          avgPrice: (prevDoc.totalVolume + tx.price) / (prevDoc.totalSales + 1),
          timestamp: tx.blockTimestamp
        };
        await allTimeDocRef.set(newDoc);

        for (const key in BASE_TIME) {
          const baseTime = BASE_TIME[key];
          const docId = getDocumentIdByTime(tx.blockTimestamp, BASE_TIME[key]);
          console.log({ docId });
          const docRef = collectionDocRef.collection('status').doc(HISTORICAL_COLLECTION).collection(baseTime).doc(docId);
          await updateSalesInfo(docRef, tx, docId);
        }
      } else {
        const collectionStats = await initCollectionBaseVolume(chainId, tx);
        const newDoc: HistoricalInfo = {
          docId: 'ALL-TIME-INFO',
          totalVolume: collectionStats.market_cap,
          totalSales: collectionStats.total_sales,
          floorPrice: collectionStats.floor_price,
          ceilPrice: 0,
          avgPrice: collectionStats.average_price,
          timestamp: tx.blockTimestamp
        };
        await allTimeDocRef.set(newDoc);

        const yearlyDocId = getDocumentIdByTime(tx.blockTimestamp, BASE_TIME.YEARLY);
        const yearlDocId = collectionDocRef
          .collection('status')
          .doc(HISTORICAL_COLLECTION)
          .collection(BASE_TIME.YEARLY)
          .doc(yearlyDocId);

        await yearlDocId.set({ ...newDoc, docId: yearlDocId });

        const dailyDocId = getDocumentIdByTime(tx.blockTimestamp, BASE_TIME.DAILY);
        const dailyDoc = {
          docId: dailyDocId,
          totalVolume: collectionStats.one_day_volume,
          totalSales: collectionStats.one_day_sales,
          floorPrice: collectionStats.one_day_average_price,
          ceilPrice: 0,
          avgPrice: collectionStats.one_day_average_price,
          timestamp: tx.blockTimestamp
        };

        const dailyDocRef = collectionDocRef
          .collection('status')
          .doc(HISTORICAL_COLLECTION)
          .collection(BASE_TIME.DAILY)
          .doc(dailyDocId);
        await dailyDocRef.set(dailyDoc);

        // --- Store Weekly Info
        const weeklyDocId = getDocumentIdByTime(tx.blockTimestamp, BASE_TIME.WEEKLY);
        const weeklyDoc = {
          docId: weeklyDocId,
          totalVolume: collectionStats.seven_day_volume,
          totalSales: collectionStats.seven_day_sales,
          floorPrice: collectionStats.seven_day_average_price,
          ceilPrice: 0,
          avgPrice: collectionStats.seven_day_average_price,
          timestamp: tx.blockTimestamp
        };

        const weekyDocRef = collectionDocRef
          .collection('status')
          .doc(HISTORICAL_COLLECTION)
          .collection(BASE_TIME.WEEKLY)
          .doc(weeklyDocId);
        await weekyDocRef.set(weeklyDoc);

        // --- Store monthly Info ----

        const monthlyDocId = getDocumentIdByTime(tx.blockTimestamp, BASE_TIME.MONTHLY);
        const montlyDoc = {
          docId: monthlyDocId,
          totalVolume: collectionStats.thirty_day_volume,
          totalSales: collectionStats.thirty_day_sales,
          floorPrice: collectionStats.thirty_day_average_price,
          ceilPrice: 0,
          avgPrice: collectionStats.thirty_day_average_price,
          timestamp: tx.blockTimestamp
        };

        const monthlyDocRef = collectionDocRef
          .collection('status')
          .doc(HISTORICAL_COLLECTION)
          .collection(BASE_TIME.MONTHLY)
          .doc(monthlyDocId);
        await monthlyDocRef.set(montlyDoc);

        // --- Store Quartly Info ---
        const quarltyDocId = getDocumentIdByTime(tx.blockTimestamp, BASE_TIME.QUARTLY);
        const quarltyDocRef = collectionDocRef
          .collection('status')
          .doc(HISTORICAL_COLLECTION)
          .collection(BASE_TIME.QUARTLY)
          .doc(quarltyDocId);
        await quarltyDocRef.set({ ...montlyDoc, docId: quarltyDocId });

        // --- Store Yearly Info ----
      }
    } catch (err) {
      console.error('Firestore: Failed to store the order tx', err);
    }
  });

  console.log('createdNftTransactionhistory', { txns });
};

const initCollectionBaseVolume = async (chainId, tx: TransactionReporsitory) => {
  try {
    const data = await getRawAssetFromOpensea(chainId, tx.tokenId, tx.collectionAddr);
    const collectionStats = data?.collection?.stats;
    return collectionStats;
    // console.log(info?.collection?.status);
  } catch (err) {
    console.error('Sales Scraper: [Opensea API] Failed to retrieve token info');
  }
};

export { createNftTransactionHistory };
