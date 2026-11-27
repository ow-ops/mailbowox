import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';

// The real argon2id is tested in Rust; these tests only need the same password and salt to give the same key.
export const core = {
  passwordKey: async (password: string, salt: Uint8Array) => sha256(concatBytes(utf8ToBytes(password), salt)),
};
