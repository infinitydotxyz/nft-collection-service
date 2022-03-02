import { execute as runOpenseaSalesListener } from './parser/opensea';
import chalk from 'chalk';
import { logger } from '../container';

const execute = (): void => {
  logger.log(chalk.blue('---  Running Opensea Sales Scraper ----'));
  runOpenseaSalesListener();
};

export { execute };
