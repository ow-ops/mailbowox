import { printAsync } from 'expo-print';

export const printHtml = (html: string) => printAsync({ html });
