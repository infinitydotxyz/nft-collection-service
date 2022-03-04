import { BASE_TIME, SalesOrderType } from '../types';
import { ethers } from 'ethers';
import moment from 'moment';

/**
 *
 * @param date
 * @param baseTime
 * @returns Firestore historical document id ( sales info ) based on date and basetime
 *
 */
export const getDocumentIdByTime = (timestamp: number, baseTime: BASE_TIME): string => {
  const date = new Date(timestamp);
  const firstDayOfWeek = date.getDate() - date.getDay();

  switch (baseTime) {
    case BASE_TIME.HOURLY:
      return moment(date).format('YYYY-MM-DD-HH');
    case BASE_TIME.DAILY:
      return moment(date).format('YYYY-MM-DD');
    case BASE_TIME.WEEKLY:
      return moment(date.setDate(firstDayOfWeek)).format('YYYY-MM-DD');
    case BASE_TIME.MONTHLY:
      return moment(date).format('YYYY-MM');
    case BASE_TIME.YEARLY:
      return moment(date).format('YYYY');
  }
};

export const getETHPrice = (order: SalesOrderType): number => {
  return parseFloat(ethers.utils.formatEther(order.price.toString()));
};
