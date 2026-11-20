module.exports = (path, options) => {
  const resolve = (opts) =>
    options.defaultResolver(path, {
      ...opts,
      packageFilter: (pkg) => {
        const filtered = opts.packageFilter ? opts.packageFilter(pkg) : pkg;
        if (filtered.name === 'react-native') delete filtered.exports;
        return filtered;
      },
    });
  try {
    return resolve(options);
  } catch {
    return resolve({ ...options, conditions: [...(options.conditions ?? []), 'import'] });
  }
};
