import express, { Request, Response } from 'express';
import { collectionQueue, logger } from './container';
import * as ethers from 'ethers';

export function main(): void {
  const app = express();

  app.enable('trust proxy');

  // app.use(express.raw({ type: 'application/octet-stream' }));
  app.use(express.json());

  app.get('/', (req, res) => {
    res.send('hello world').status(200);
  })

  app.post('/enqueue', async (req: Request<any, { chainId: string; address: string }>, res: Response) => {
    const address = req.body.address as string;
    const chainId = req.body.chainId as string;

    logger.log(chainId, address)

    if (chainId !== '1') {
      res.sendStatus(400);
      return;
    }

    if (!ethers.utils.isAddress(address)) {
      res.sendStatus(400);
      return;
    }

    try {
      await collectionQueue.enqueueCollection(address, chainId);
      res.sendStatus(201);
    } catch (err) {
      res.sendStatus(500);
    }
  });

  const PORT = process.env.PORT ?? 8080;

  app.listen(PORT, () => {
    logger.log(`App listening on port ${PORT}`);
  });
}
