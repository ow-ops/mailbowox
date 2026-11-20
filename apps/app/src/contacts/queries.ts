import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { queryWords } from '@/utils/text';

import { getAddressBooks, getContact, getContactAddresses, getContacts, type ContactRef } from './db';

export const useAddressBooks = () => useQuery({ queryKey: ['contacts', 'books'], queryFn: getAddressBooks });

export const useContacts = (query: string) =>
  useQuery({
    queryKey: ['contacts', 'list', query],
    queryFn: () => getContacts(queryWords(query)),
    placeholderData: keepPreviousData,
  });

export const useContact = (ref: ContactRef) =>
  useQuery({ queryKey: ['contacts', 'item', ref], queryFn: () => getContact(ref) });

export const useContactAddresses = () =>
  useQuery({ queryKey: ['contacts', 'addresses'], queryFn: getContactAddresses });
