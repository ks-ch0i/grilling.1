import { app } from '@azure/functions';
import { ManagedIdentityCredential } from '@azure/identity';
import { registerMeFunction } from './functions/me.js';

const credential = new ManagedIdentityCredential();

registerMeFunction(app, { credential });
