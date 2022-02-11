import CollectionService from './models/CollectionService';

enum Task {
    CreateCollection = 'create'
}

export async function main(): Promise<void> {

    const addressArg = process.argv.find((item) => {
        return item.includes('address');
    });
    const chainIdArg = process.argv.find((item) => {
        return item.includes('chain');
    });

    const taskArg = process.argv.find((item) => {
        return item.includes('task');
    });

    let address: string;
    let chainId = '1';
    let task = Task.CreateCollection;

    const parseArg = (arg: string): string   => {
        return arg.split('=')[1]?.trim()?.toLowerCase?.() ?? '';
    }

    if(addressArg) {
        address = parseArg(addressArg)
    } else {
        throw new Error("Must pass a collection address");
    }

    if(chainIdArg) {
        chainId = parseArg(chainIdArg);
    }

    if(taskArg) {
        task = parseArg(taskArg) as Task;
    }



    const collectionService = new CollectionService();
    let method: () => Promise<any>;
    switch(task) {
        case Task.CreateCollection: 
            method = collectionService.createCollection.bind(collectionService, address, chainId);
            break;
        default: 
            throw new Error(`Invalid task type ${task}`)
    }

    try{
        console.log(`Starting Task: ${task} Address: ${address} Chain Id: ${chainId} `)
        await method();
    }catch(err) {
        console.log(`Failed to complete task`);
        console.error(err);
    }
}
