/* global json, http */
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
const newest = call([
  ['Email/query', { accountId, sort: [{ property: 'receivedAt', isAscending: false }], limit: 10 }, 'q'],
  [
    'Email/get',
    {
      accountId,
      '#ids': { resultOf: 'q', name: 'Email/query', path: '/ids' },
      properties: ['subject', 'textBody', 'htmlBody', 'bodyValues'],
      fetchTextBodyValues: true,
      fetchHTMLBodyValues: true,
    },
    'g',
  ],
]).methodResponses[1][1].list;
const message = newest.find((m) => m.subject === 'Formatted plan');
if (!message) throw new Error('bob got nothing');
const value = (parts) => parts.map((part) => message.bodyValues[part.partId].value).join('');
const html = value(message.htmlBody);
const text = value(message.textBody);
if (!html.includes('<b>bold</b>')) throw new Error('no bold in: ' + html);
if (!html.includes('href="https://example.org/docs"')) throw new Error('no link in: ' + html);
if (!text.startsWith('Plain then bold and https://example.org/docs')) throw new Error('text part: ' + text);
