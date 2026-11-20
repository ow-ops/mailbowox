const MARKS = /[\u0300-\u036f]/g;

// Folds case and accents, so "elise" finds "Élise".
export const normalize = (text: string) => text.normalize('NFD').replace(MARKS, '').toLowerCase();

export const queryWords = (query: string) => [...new Set(normalize(query).split(/\s+/).filter(Boolean))];
