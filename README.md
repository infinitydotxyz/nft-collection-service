# nft-collection-service

## Scripts
* `npm run start` - starts the program in production mode (not yet implemented)
* `npm run dev` - runs `script.ts` for developing/testing flows
* `npm run watch` - same as `npm run dev` but will restart on changes
* `npm run cli` - start in cli mode. Example: `npm run cli -- address=0xBC4CA0EdA7647A8aB7C2061c2E118A18a936f13D chain=1 task=create`
    * Options 
        * `address` (required) - the address to run the task for 
        * `chain` (optional) - Base 10 chain id. Defaults to 1
        * `task` (optional) - the type of task to run. Valid tasks include 
            * `create` (default) - creates a collection