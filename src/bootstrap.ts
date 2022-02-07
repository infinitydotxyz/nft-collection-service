import 'reflect-metadata';
import { isDev } from './utils';
import {main as dev} from './dev';
import { main } from './index';

function bootstrap(): void {
    if(isDev()) {
        dev();
    } else {
        main();
    }
}

void bootstrap();