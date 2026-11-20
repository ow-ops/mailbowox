import type { Address } from '@/core';

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+$/;

// What an address field holds: the addresses entered, and the text still being typed.
export type Recipients = { list: Address[]; text: string };

export const isEmail = (value: string) => EMAIL.test(value);

export const sameAddress = (a: Address, b: Address) => a.email.toLowerCase() === b.email.toLowerCase();

export const addressName = (address: Address) => address.name || address.email;

// Commas and semicolons separate addresses, except inside a quoted name or angle brackets.
function splitList(input: string) {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let bracketed = false;
  for (const char of input) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === '<') bracketed = true;
    else if (!quoted && char === '>') bracketed = false;
    if (!quoted && !bracketed && (char === ',' || char === ';' || char === '\n')) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function parseAddress(text: string): Address {
  const match = /^(.*)<([^<>]*)>$/.exec(text.trim());
  if (!match) return { email: text.trim() };
  const name = match[1]
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .trim();
  const email = match[2].trim();
  return name ? { name, email } : { email };
}

export const parseAddresses = (input: string) => splitList(input).map(parseAddress);

export function formatAddress({ name, email }: Address) {
  if (!name) return email;
  return /[",;<>@]/.test(name) ? `"${name.replaceAll('"', '')}" <${email}>` : `${name} <${email}>`;
}
