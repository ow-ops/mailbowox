import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { mailStore } from '@/mail/store';
import { queryWords } from '@/utils/text';

export type ContactRef = { account: string; href: string };

export const useAddressBooks = () =>
  useQuery({ queryKey: ['contacts', 'books'], queryFn: async () => (await mailStore()).addressBooks() });

export const useContacts = (query: string) =>
  useQuery({
    queryKey: ['contacts', 'list', query],
    queryFn: async () => (await mailStore()).contacts(queryWords(query)),
    placeholderData: keepPreviousData,
  });

export const useContact = ({ account, href }: ContactRef) =>
  useQuery({
    queryKey: ['contacts', 'item', { account, href }],
    queryFn: async () => (await (await mailStore()).contact(account, href)) ?? null,
  });

export const useContactAddresses = () =>
  useQuery({ queryKey: ['contacts', 'addresses'], queryFn: async () => (await mailStore()).contactAddresses() });
