import { execute as runOpenseaSraper } from './parser/opensea';
import chalk from 'chalk';
import { logger } from '../container';

const execute = (): void => {
  logger.log(chalk.blue('---      Running Opensea Sales Scraper     ----'));
  runOpenseaSraper();
};

export { execute };
