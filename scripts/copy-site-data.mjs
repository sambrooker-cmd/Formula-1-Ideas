// Copy published race files (site-data/) into the hosted build (dist/data/).
import fs from 'node:fs';

if (fs.existsSync('site-data')) {
  fs.cpSync('site-data', 'dist/data', { recursive: true });
  const n = JSON.parse(fs.readFileSync('site-data/sessions.json', 'utf8')).length;
  console.log(`Copied ${n} published session(s) into dist/data`);
} else {
  fs.mkdirSync('dist/data', { recursive: true });
  fs.writeFileSync('dist/data/sessions.json', '[]');
  console.log('No site-data yet: the site starts with no races');
}
