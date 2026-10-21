import { app } from '@azure/functions';
import { ManagedIdentityCredential } from '@azure/identity';
import { registerMeFunction } from './functions/me.js';
import { registerCloudSaveFunctions } from './functions/cloudSave.js';

const credential = new ManagedIdentityCredential();

registerMeFunction(app, { credential });
registerCloudSaveFunctions(app, { credential });
