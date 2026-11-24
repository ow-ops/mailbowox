import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'react-native';

import { mailStore } from '@/mail/store';
import { usePref } from '@/prefs/store';

const RECHECK_SECONDS = 30 * 24 * 60 * 60;

// Addresses at these hosts belong to people, not companies: their site icon says nothing about the sender.
const PERSONAL = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'hotmail.fr', 'live.com', 'live.fr', 'msn.com',
  'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'gmx.com', 'gmx.de', 'gmx.fr',
  'web.de', 'proton.me', 'protonmail.com', 'pm.me', 'tutanota.com', 'tuta.io', 'fastmail.com', 'hey.com',
  'mail.com', 'zoho.com', 'yandex.com', 'yandex.ru', 'mail.ru', 'orange.fr', 'wanadoo.fr', 'free.fr',
  'sfr.fr', 'laposte.net', 'bbox.fr', 'neuf.fr', 'migadu.com',
]);

// Second-level labels that take a third to make a registrable domain, as in example.co.uk.
const SHARED = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu']);

// The domain a company registers, from the host it sends from: mail.news.example.co.uk is example.co.uk.
export function organizationDomain(host: string) {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  const keep = labels.length > 2 && SHARED.has(labels[labels.length - 2]) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

export const gravatarUrl = (email: string) =>
  `https://gravatar.com/avatar/${bytesToHex(sha256(utf8ToBytes(email.trim().toLowerCase())))}?s=128&d=404`;

// BIMI: the logo a domain publishes for its mail, found over DNS (through Cloudflare's resolver).
async function bimiLogo(domain: string) {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=default._bimi.${domain}&type=TXT`, {
    headers: { accept: 'application/dns-json' },
  });
  if (!response.ok) return undefined;
  const { Answer } = (await response.json()) as { Answer?: { data: string }[] };
  const record = Answer?.map((answer) => answer.data.replace(/"/g, '')).find((data) => data.startsWith('v=BIMI1'));
  return record?.match(/(?:^|;)\s*l=(https:\/\/[^;\s]+)/)?.[1];
}

// Native resolves true and web resolves nothing on success; both reject when the image doesn't load.
const loads = (url: string) => Image.prefetch(url).then(
  () => true,
  () => false,
);

// Gravatar first, as a person chose it; then, for a company, its BIMI logo and its website's icon.
async function findPicture(email: string) {
  if (await loads(gravatarUrl(email))) return gravatarUrl(email);
  const domain = email.split('@')[1]?.toLowerCase();
  if (!domain || PERSONAL.has(organizationDomain(domain))) return undefined;
  const logo = await bimiLogo(domain).catch(() => undefined);
  if (logo) return logo;
  const icon = `https://${organizationDomain(domain)}/apple-touch-icon.png`;
  return (await loads(icon)) ? icon : undefined;
}

async function picture(email: string) {
  const store = await mailStore();
  const known = await store.avatar(email);
  if (known && Date.now() / 1000 - known.checkedAt < RECHECK_SECONDS) return known.source ?? null;
  const found = await findPicture(email);
  await store.setAvatar(email, found);
  return found ?? null;
}

export function useAvatar(email: string | undefined) {
  const enabled = usePref('contactPictures');
  return useQuery({
    queryKey: ['avatar', email?.toLowerCase()],
    queryFn: () => picture(email ?? ''),
    enabled: enabled && !!email?.includes('@'),
    staleTime: Infinity,
    retry: false,
  });
}
