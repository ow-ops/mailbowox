// Maestro's script runtime has HTTP but no IMAP, so this asks the Stalwart JMAP API what bob received.
const auth = 'Basic Ym9iQG1haWxib3dveC50ZXN0Om1haWxib3dveC1kZXY=';
const call = (methodCalls) =>
  json(
    http.post('http://127.0.0.1:18080/jmap/', {
      headers: { Authorization: auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ using: ['urn:ietf:params:jmap:core', 'urn:ietf:params:jmap:mail'], methodCalls }),
    }).body,
  );

const session = json(http.get('http://127.0.0.1:18080/jmap/session', { headers: { Authorization: auth } }).body);
const accountId = session.primaryAccounts['urn:ietf:params:jmap:mail'];
// Stalwart serves subject and sender filters from a search index that lags behind delivery, so the newest
// messages are read and matched here instead.
const newest = call([
  ['Email/query', { accountId, sort: [{ property: 'receivedAt', isAscending: false }], limit: 10 }, 'q'],
  [
    'Email/get',
    { accountId, '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' }, properties: ['subject', 'from', 'preview'] },
    'g',
  ],
]).methodResponses[1][1].list;
const reply = newest.find((m) => m.subject === 'Re: Lunch on Friday');
if (!reply) throw new Error('bob got no reply');
const preview = reply.preview;
if (!preview.startsWith('Noon works.')) throw new Error('bob got: ' + preview);
