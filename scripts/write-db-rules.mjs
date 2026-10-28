// Writes database.rules.json from web/src/hosting.config.json: each signed-in, allowed
// person can only read and write their own sync room (and read the public key notifications
// are signed with). Everything else, like the notification keys, only the GitHub Action can reach.
import fs from 'node:fs';

const { allowedEmails } = JSON.parse(fs.readFileSync('web/src/hosting.config.json', 'utf8'));
const emailCheck = allowedEmails.length
  ? '(' + allowedEmails.map((e) => `auth.token.email === '${e.toLowerCase().replace(/'/g, '')}'`).join(' || ') + ')'
  : 'false';
const access = `auth != null && auth.uid === $uid && auth.token.email_verified === true && ${emailCheck}`;
const signedIn = `auth != null && auth.token.email_verified === true && ${emailCheck}`;
const rules = {
  rules: {
    rooms: { $uid: { '.read': access, '.write': access } },
    notify: { public: { '.read': signedIn } },
  },
};
fs.writeFileSync('database.rules.json', JSON.stringify(rules, null, 2) + '\n');
console.log(`database.rules.json: ${allowedEmails.length} allowed account(s)`);
