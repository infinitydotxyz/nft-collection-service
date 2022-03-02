import { BASE_TIME, SalesOrderType } from 'sales-scraper/types';
import { ethers } from 'ethers';
import moment from 'moment';

export const getDocumentIdByTime = (date: Date, baseTime: BASE_TIME): string => {
  const firstDayOfWeek = date.getDate() - date.getDay();
  const firstMonthofQuator = Math.floor(date.getMonth() / 3) * 3;

  switch (baseTime) {
    case BASE_TIME.HOURLY:
      return moment(date).format('YYYY-MM-DD-HH');
    case BASE_TIME.Q12H:
      return moment(date).format('YYYY-MM-DD-A');
    case BASE_TIME.DAILY:
      return moment(date).format('YYYY-MM-DD');
    case BASE_TIME.WEEKLY:
      return moment(date.setDate(firstDayOfWeek)).format('YYYY-MM-DD');
    case BASE_TIME.MONTHLY:
      return moment(date).format('YYYY-MM');
    case BASE_TIME.QUARTLY:
      return moment(date.setMonth(firstMonthofQuator)).format('YYYY-MM');
    case BASE_TIME.YEARLY:
      return moment(date).format('YYYY');
  }
};

export const getETHPrice = (order: SalesOrderType): number => {
  return parseFloat(ethers.utils.formatEther(order.price.toString()));
};
