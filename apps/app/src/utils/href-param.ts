import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

// Route params are URL-decoded on arrival, which turns a CardDAV href's %40 into @ and breaks the lookup.
// Hex has nothing to decode, so the href arrives exactly as stored.
export const hrefParam = (href: string) => bytesToHex(utf8ToBytes(href));

export const hrefFromParam = (param: string) => new TextDecoder().decode(hexToBytes(param));
