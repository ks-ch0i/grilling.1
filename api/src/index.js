import { app } from '@azure/functions';
import { ManagedIdentityCredential } from '@azure/identity';
import { registerMeFunction } from './functions/me.js';
import { registerCloudSaveFunctions } from './functions/cloudSave.js';
import { registerStageRunFunctions } from './functions/stageRuns.js';
import { registerRankingFunctions } from './functions/rankings.js';
import { registerPlayerSnapshotFunction } from './functions/playerSnapshots.js';
import { registerPvpMatchFunctions } from './functions/pvpMatches.js';

const credential = new ManagedIdentityCredential();

registerMeFunction(app, { credential });
registerCloudSaveFunctions(app, { credential });
registerStageRunFunctions(app, { credential });
registerRankingFunctions(app, { credential });
registerPlayerSnapshotFunction(app, { credential });
registerPvpMatchFunctions(app, { credential });
