import * as v from 'valibot';

import { readItem } from './kv';

// A stored value this version can't read counts as unset rather than stopping the app at launch.
export function readJson<const TSchema extends v.GenericSchema, TFallback>(
  key: string,
  schema: TSchema,
  fallback: TFallback,
) {
  try {
    return v.parse(schema, JSON.parse(readItem(key) ?? ''));
  } catch {
    return fallback;
  }
}
