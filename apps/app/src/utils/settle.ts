// Unlike Promise.all, waits for every task before throwing the first failure.
export async function settleAll(tasks: Promise<unknown>[]) {
  const failed = (await Promise.allSettled(tasks)).find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}
