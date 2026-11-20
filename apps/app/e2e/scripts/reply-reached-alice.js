// Asks the Stalwart JMAP API whether alice got bob's reply, sent from bob's account.
const auth = 'Basic YWxpY2VAbWFpbGJvd294LnRlc3Q6bWFpbGJvd294LWRldg==';
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
const found = newest.filter((m) => m.subject === 'Re: Weekend hike' && m.from[0].email === 'bob@mailbowox.test');
if (found.length === 0 || !found[0].preview.startsWith('Count me in.')) throw new Error('alice got: ' + JSON.stringify(found));
