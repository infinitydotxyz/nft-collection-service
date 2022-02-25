import { InfinityTwitterAccount, Twitter } from '@services/twitter/Twitter';
import { ethers } from 'ethers';
import { Request, Response } from 'express';
import { error, log } from '@utils/logger';
import { jsonString } from '@utils/formatters';
import { StatusCode } from '@base/types/StatusCode';
import { firestore } from '@base/container';
import { getChainId, getChainId } from '@utils/ethers';

import { SalesOrderType, SCRAPER_SOURCE, TOKEN_TYPE } from '../types';

async function createNftTransactionHistory(orders: SalesOrderType) {
}

export { createNftTransactionHistory };
