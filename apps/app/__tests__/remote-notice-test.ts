import i18n from '@/i18n';
import { remoteNotice } from '@/mail/remote-notice';

const bob = { name: 'Bob', email: 'bob@example.com' };

describe('remoteNotice', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  it('names the sender who cannot tell the message was opened', () => {
    expect(remoteNotice(i18n.t, 3, bob, 'ask')).toBe("3 remote images blocked, so Bob can't tell you opened this.");
    expect(remoteNotice(i18n.t, 1, bob, 'ask')).toBe("1 remote image blocked, so Bob can't tell you opened this.");
  });

  it('falls back to the address, then to the sender', () => {
    expect(remoteNotice(i18n.t, 2, { email: 'news@shop.example' }, 'ask')).toBe(
      "2 remote images blocked, so news@shop.example can't tell you opened this.",
    );
    expect(remoteNotice(i18n.t, 2, undefined, 'ask')).toBe(
      "2 remote images blocked, so the sender can't tell you opened this.",
    );
  });

  it('only counts when remote content is never loaded', () => {
    expect(remoteNotice(i18n.t, 4, bob, 'never')).toBe('4 remote images blocked.');
  });

  it('reads in French', async () => {
    await i18n.changeLanguage('fr');
    expect(remoteNotice(i18n.t, 3, bob, 'ask')).toBe(
      '3 images distantes bloquées : Bob ne peut pas savoir que vous avez ouvert ce message.',
    );
    expect(remoteNotice(i18n.t, 1, undefined, 'ask')).toBe(
      '1 image distante bloquée : l’expéditeur ne peut pas savoir que vous avez ouvert ce message.',
    );
    await i18n.changeLanguage('en');
  });
});
