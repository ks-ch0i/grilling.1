import sql from 'mssql';

const poolsByCredential = new WeakMap();

function validateConfig(config) {
  if (!config || typeof config.server !== 'string' || !config.server.trim()) {
    throw new TypeError('SQL server configuration is missing.');
  }
  if (typeof config.database !== 'string' || !config.database.trim()) {
    throw new TypeError('SQL database configuration is missing.');
  }
  if (!config.credential || typeof config.credential !== 'object' || typeof config.credential.getToken !== 'function') {
    throw new TypeError('SQL TokenCredential is missing.');
  }
}

function poolMapFor(credential) {
  let pools = poolsByCredential.get(credential);
  if (!pools) {
    pools = new Map();
    poolsByCredential.set(credential, pools);
  }
  return pools;
}

export async function getSqlPool(config, { poolFactory = (poolConfig) => new sql.ConnectionPool(poolConfig) } = {}) {
  validateConfig(config);
  const key = `${config.server.trim().toLowerCase()}|${config.database.trim().toLowerCase()}`;
  const pools = poolMapFor(config.credential);
  let pendingPool = pools.get(key);
  if (!pendingPool) {
    const poolConfig = {
      server: config.server.trim(),
      database: config.database.trim(),
      pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      connectionTimeout: 15000,
      requestTimeout: 30000,
      options: {
        port: 1433,
        encrypt: true,
        trustServerCertificate: false,
      },
      authentication: {
        type: 'token-credential',
        options: { credential: config.credential },
      },
    };
    const pool = poolFactory(poolConfig);
    pendingPool = Promise.resolve().then(() => pool.connect()).then((connectedPool) => connectedPool ?? pool).catch(async (error) => {
      pools.delete(key);
      try {
        await pool.close?.();
      } catch {
        // Keep the original connection error for the caller.
      }
      throw error;
    });
    pools.set(key, pendingPool);
  }
  return pendingPool;
}
