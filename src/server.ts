import express, { Request, Response } from 'express';
import { collectionQueue, logger } from './container';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { validateAddress, validateChainId, normalizeAddress } from './utils/ethers';
import { NULL_ADDR } from './constants';

export async function main(): Promise<void> {
  const packageDotJSON = resolve('./package.json');
  const { version } = JSON.parse(await readFile(packageDotJSON, 'utf-8'));

  const app = express();

  app.enable('trust proxy');

  app.use(express.raw({ type: 'application/octet-stream' }));
  app.use(express.json());

  app.get('/', (req, res) => {
    res.send(`NFT Collection Service Version: ${version}`).status(200);
  });


  app.post('/collection', async (req: Request<any, { chainId: string; address: string, indexInitiator: string }>, res: Response) => {
    let address = req.body.address as string;
    let chainId = req.body.chainId as string;
    let indexInitiator = req.body.indexInitiator as string;

    if(!indexInitiator) {
      indexInitiator = NULL_ADDR;
    }

    try{
      chainId = validateChainId(chainId);
      address = validateAddress(normalizeAddress(address));
      indexInitiator = validateAddress(normalizeAddress(indexInitiator));
    }catch(err) {
      res.sendStatus(400);
      return;
    }

    try {
      await collectionQueue.enqueueCollection(address, chainId);
      res.sendStatus(202);
    } catch (err) {
      res.sendStatus(500);
    }
  });

  const PORT = process.env.PORT ?? 8080;

  app.listen(PORT, () => {
    logger.log(`App listening on port ${PORT}`);
  });
}
