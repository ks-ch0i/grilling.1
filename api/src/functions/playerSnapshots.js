import { createPvpHandlers } from './pvp.js';

export function createPlayerSnapshotHandler(dependencies = {}) {
  return createPvpHandlers(dependencies).publishSnapshot;
}

export function registerPlayerSnapshotFunction(app, dependencies = {}) {
  app.http('pvpSnapshotPublish', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    route: 'pvp/snapshot',
    handler: createPlayerSnapshotHandler(dependencies),
  });
}
