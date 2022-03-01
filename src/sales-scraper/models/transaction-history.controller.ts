import { ethers } from 'ethers';
import { firestore } from '@base/container';

import { SalesOrderType, SCRAPER_SOURCE, TOKEN_TYPE } from '../types';
import { getRawAssetFromOpensea } from '../../../services/opensea/assets/getAssetFromOpensea';
import moment from 'moment';

const HISTORICAL_COLLECTION = 'history';
interface TransactionReporsitory {
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

interface HistoricalInfo {
  docId: string;
  totalVolume: number;
  totalSales: number;
  floorPrice: number;
  ceilPrice: number;
  avgPrice: number;
  timestamp: Date;
}

const getPrice = (_order): number => {
  return parseFloat(ethers.utils.formatEther(_order.price));
};

enum BASE_TIME {
  HOURLY = 'hourly',
  Q12H = 'q12h',
  DAILY = 'daily',
  WEEKLY = 'weekly',
  MONTHLY = 'monthly',
  QUARTLY = 'quartly',
  YEARLY = 'yearly'
}

const getHistoricalDocID = (date: Date, baseTime: BASE_TIME): string => {
  const fisrtDayOfWeek = date.getDate() - date.getDay();
  const firstMonthofQuator = Math.floor(date.getMonth() / 3) * 3;

  switch (baseTime) {
    case BASE_TIME.HOURLY:
      return moment(date).format('YYYY-MM-DD-HH');
    case BASE_TIME.Q12H:
      return moment(date).format('YYYY-MM-DD-A');
    case BASE_TIME.DAILY:
      return moment(date).format('YYYY-MM-DD');
    case BASE_TIME.WEEKLY:
      return moment(date.setDate(fisrtDayOfWeek)).format('YYYY-MM-DD');
    case BASE_TIME.MONTHLY:
      return moment(date).format('YYYY-MM');
    case BASE_TIME.QUARTLY:
      return moment(date.setMonth(firstMonthofQuator)).format('YYYY-MM');
    case BASE_TIME.YEARLY:
      return moment(date).format('YYYY');
  }
};

const updateSalesInfo = async (
  docRef: FirebaseFirestore.DocumentReference<FirebaseFirestore.DocumentData>,
  tx: TransactionReporsitory,
  docId: string
) => {
  const prevDoc = (await docRef.get())?.data() as HistoricalInfo;
  if (prevDoc) {
    const newDoc: HistoricalInfo = {
      docId: docId,
      totalVolume: prevDoc.totalVolume + tx.price,
      totalSales: prevDoc.totalSales + 1,
      floorPrice: prevDoc.floorPrice === 0 ? tx.price : Math.min(prevDoc.floorPrice, tx.price),
      ceilPrice: prevDoc.ceilPrice === 0 ? tx.price : Math.max(prevDoc.ceilPrice, tx.price),
      avgPrice: (prevDoc.totalVolume + tx.price) / (prevDoc.totalSales + 1),
      timestamp: tx.blockTimestamp
    };
    await docRef.set(newDoc);
  } else {
    const newDoc: HistoricalInfo = {
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

const createNftTransactionHistory = (chainId = '1') => {
  const _orders: SalesOrderType[] = [
    {
      txHash: '0x7a22fe80713bd5be68fc904bffa68c702838a6f94706e521ab74023592822479',
      blockNumber: 14301134,
      blockTimestamp: new Date(),
      price: BigInt('150000000000000000'),
      paymentToken: '0x0000000000000000000000000000000000000000',
      buyerAdress: '0xEe3a6b93e140f64953A896367B59FFF4b91514a9',
      sellerAdress: '0x461bF9d49AAEC8457F5a0772D3CCcEF7fae8A865',
      collectionAddr: '0x7a4d1b54dd21dde804c18b7a830b5bc6e586a7f6',
      tokenIdStr: '1428',
      quantity: 1,
      source: SCRAPER_SOURCE.OPENSEA,
      tokenType: TOKEN_TYPE.ERC721
    }
  ];

  const txns: TransactionReporsitory[] = _orders.map((_order: SalesOrderType) => {
    const tx: TransactionReporsitory = {
      txHash: _order.txHash.toLocaleLowerCase(),
      tokenId: _order.tokenIdStr,
      collectionAddr: _order.collectionAddr.toLocaleLowerCase(),
      price: getPrice(_order),
      paymentToken: _order.paymentToken,
      quantity: _order.quantity,
      buyer: _order.buyerAdress.toLocaleLowerCase(),
      seller: _order.sellerAdress.toLocaleLowerCase(),
      source: _order.source,
      blockNumber: _order.blockNumber,
      blockTimestamp: _order.blockTimestamp
    };
    return tx;
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
          const docId = getHistoricalDocID(tx.blockTimestamp, BASE_TIME[key]);
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

        const yearlyDocId = getHistoricalDocID(tx.blockTimestamp, BASE_TIME.YEARLY);
        const yearlDocId = collectionDocRef
          .collection('status')
          .doc(HISTORICAL_COLLECTION)
          .collection(BASE_TIME.YEARLY)
          .doc(yearlyDocId);

        await yearlDocId.set({ ...newDoc, docId: yearlDocId });

        const dailyDocId = getHistoricalDocID(tx.blockTimestamp, BASE_TIME.DAILY);
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
        const weeklyDocId = getHistoricalDocID(tx.blockTimestamp, BASE_TIME.WEEKLY);
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

        const monthlyDocId = getHistoricalDocID(tx.blockTimestamp, BASE_TIME.MONTHLY);
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
        const quarltyDocId = getHistoricalDocID(tx.blockTimestamp, BASE_TIME.QUARTLY);
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
