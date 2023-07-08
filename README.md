# nft-collection-service

## Scripts
<!-- * `npm run serve` - starts the program in production mode (not yet implemented) -->
* `npm run dev` - runs `script.ts` for developing/testing flows
* `npm run cli` - start in cli mode. Example: `npm run cli -- address=0x08d7c0242953446436f34b4c78fe9da38c73668d chain=1 task=create`
* `npm run cli-server` - start in cli mode with a heap size of 60GB
* `npm run queue` - starts a collection queue listener to scrape collections based off a db subscription 
## CLI 

* Tasks
    * `scrape` - scrapes collections from opensea and new collections to the db (saves the minimal amount of data for a collection)
        * Example command: `npm run cli -- task=scrape`
    * `create` - handles creating the specified collection (gets all data for the collection including all nfts)
        * Modes 
            * Address Mode 
                * `address` (required) - the address to run the task for 
                * `chain` (optional) - Base 10 chain id. Defaults to 1
                * `hasBlueCheck` (optional) - whether the collection is verified (defaults to false)
                * `reset` (optional) - if set to `true` the collection will be reset and all data will be collected, defaults to false
                * `partial` (optional, defaults to true) - if set to `false` collection will be completely indexed, else only collection level metadata will be indexed
                * `mintData` (optional, defaults to false) - if set to `true` mint prices, timestamps and mint txn hashes will be collected
                * `task` (optional) - the type of task to run. Valid tasks include 
                    * `create` (default) - creates a collection
            * File Mode
                * `file` (required) - path to a file structured as    
                * `hasBlueCheck` (optional) - overrides hasBlueCheck for every item in the file
                * `reset` (optional) - if set to `true` all collections will be reset and all data will be collected, defaults to false
                * `partial` (optional, defaults to true) - if set to `false` collection will be completely indexed, else only           collection level metadata will be indexed
                * `mintData` (optional, defaults to false) - if set to `true` mint prices, timestamps and mint txn hashes will be collected
                ```ts
                [
                    { 
                        address: string, // (required)
                        chainId: string, // (optional) defaults to 1
                        hasBlueCheck: boolean, // (optional) defaults to false
                        reset: boolean, // (optional) defaults to false
                        partial: boolean, // (optional) defaults to true
                        mintData: boolean // (optional) defaults to false
                    },
                    ...
                ]
                ```

