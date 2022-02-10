import ContractFactory from './contracts/ContractFactory';

import PQueue from "p-queue";


export default class CollectionService {
    private contractFactory: ContractFactory;

    tasks: PQueue;

    constructor(){
        this.contractFactory = new ContractFactory();
    }
    
    async createCollection(address: string, chainId: string) {
        
    }

}