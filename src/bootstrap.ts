import 'reflect-metadata';
import { isDev } from './utils';
import {main as dev} from './dev';
import { main } from './index';

async function bootstrap(): Promise<void> {
    if(isDev()) {
        await dev();
    } else {
        main();
    }
}

void bootstrap();