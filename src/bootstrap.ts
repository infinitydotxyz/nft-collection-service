import 'reflect-metadata';
import { Env, getEnv } from './utils';
import { main as dev } from './script';
import { main as cli } from './cli';
import { main } from './index';

async function bootstrap(): Promise<void> {
  const env = getEnv();

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
