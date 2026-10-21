import sql from 'mssql';

export async function withTransaction(pool, work, transactionFactory = (connectionPool) => new sql.Transaction(connectionPool)) {
  if (typeof work !== 'function') throw new TypeError('transaction work must be a function.');
  const transaction = transactionFactory(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const result = await work(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Preserve the failure that caused the transaction to roll back.
    }
    throw error;
  }
}
