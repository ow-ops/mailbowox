import { hrefFromParam, hrefParam } from '@/utils/href-param';

describe('hrefParam', () => {
  it('survives URL decoding untouched', () => {
    const href = 'https://cal.example/dav/cal/alice%40example.org/default/a b%2Fc.ics';
    const param = hrefParam(href);
    expect(decodeURIComponent(param)).toBe(param);
    expect(hrefFromParam(param)).toBe(href);
  });
});
