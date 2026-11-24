import { decrypt, openPreview } from '@/push/preview';

// RFC 8291 appendix A, the same message the gateway's encryption test produces.
const rfc = {
  keys: {
    privateKey: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
    publicKey: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  },
  sealed:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

describe('push preview', () => {
  it('decrypts the RFC 8291 example', () => {
    expect(decrypt(rfc.sealed, rfc.keys)).toBe('When I grow up, I want to be a watermelon');
  });

  it('gives null for text that is not a preview, a wrong key or garbage', () => {
    expect(openPreview(rfc.sealed, rfc.keys)).toBeNull();
    expect(openPreview(rfc.sealed, { ...rfc.keys, auth: 'AAAAAAAAAAAAAAAAAAAAAA' })).toBeNull();
    expect(openPreview('not sealed', rfc.keys)).toBeNull();
    expect(openPreview(undefined, rfc.keys)).toBeNull();
  });
});
