import { logger } from './container';

export async function main(): Promise<void> {
  // TODO how will clients communicate with the collection service?
  logger.log('production');

  return await new Promise((resolve) => resolve());
}
