import 'reflect-metadata';
import { Env, getEnv } from './utils';
import { main as dev } from './script';
import { main as cli } from './cli';
import { main } from './index';
import {main as background} from './background';
import { START_UP_MESSAGE } from './constants';

async function bootstrap(): Promise<void> {
  const env = getEnv();

  console.log(START_UP_MESSAGE);

  background();

  switch (env) {
    case Env.Cli:
      await cli();
      return;
    case Env.Script:
      await dev();
      return;
    case Env.Production:
      await main();
      return;
    default:
      throw new Error(`Env not bootstrapped ${env}`);
  }
}

void bootstrap();
