import 'reflect-metadata';
import { Env, getEnv } from './utils';
import { main as dev } from './script';
import { main as cli } from './cli';
import { main as server } from './server';
import { main as background } from './background';
import { START_UP_MESSAGE } from './constants';
import { logger } from './container';

async function bootstrap(): Promise<void> {
  const env = getEnv();

  logger.log(START_UP_MESSAGE);

  switch (env) {
    case Env.Cli:
      await cli();
      return;
    case Env.Script:
      await dev();
      return;
    case Env.Serve:
      background();
      await server();
      return;
    default:
      throw new Error(`Env not bootstrapped ${env}`);
  }
}

void bootstrap();
