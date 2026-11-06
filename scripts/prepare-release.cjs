'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const origin = 'https://minibaduk-dev.onrender.com';
const pub = 'hrv6hwKLQXsH1C5WZgvbaAtLy3T1HHPTRwJZmysJ+Wg=';
async function download(url, limit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {redirect:'error', signal:AbortSignal.timeout(120000), headers:{'Cache-Control':'no-cache'}});
      if (!response.ok) throw Error('Download HTTP ' + response.status);
      const chunks = []; let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > limit) throw Error('Download exceeded size limit');
        chunks.push(Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
async function main() {
  const expected = JSON.parse(fs.readFileSync('release.json', 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(expected.version) || !/^[a-f0-9]{64}$/.test(expected.installer_sha256)) throw Error('Invalid release configuration');
  const document = await download(origin + '/api/updates/windows-amd64/manifest.json', 16384);
  const envelope = JSON.parse(document);
  const payload = Buffer.from(envelope.payload, 'base64');
  const key = crypto.createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),Buffer.from(pub,'base64')]),format:'der',type:'spki'});
  if (!crypto.verify(null, payload, key, Buffer.from(envelope.signature, 'base64'))) throw Error('Invalid release signature');
  const manifest = JSON.parse(payload);
  const artifact = manifest.installer;
  if (manifest.version !== expected.version || manifest.os !== 'windows' || manifest.arch !== 'amd64' || !artifact ||
      artifact.url !== origin + '/downloads/windows-amd64/' + expected.version + '/Onjeom_Setup.exe' ||
      artifact.sha256 !== expected.installer_sha256 || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || artifact.size > 67108864) throw Error('Release metadata mismatch');
  const file = await download(artifact.url, artifact.size);
  if (file.length !== artifact.size || crypto.createHash('sha256').update(file).digest('hex') !== artifact.sha256 || file.toString('ascii',0,2) !== 'MZ') throw Error('Installer mismatch');
  fs.mkdirSync('dist', {recursive:true});
  const name = 'Onjeom_Setup_' + expected.version + '.exe';
  fs.writeFileSync(path.join('dist',name),file);
  fs.writeFileSync('dist/SHA256SUMS.txt',artifact.sha256 + '  ' + name + '\n');
  fs.writeFileSync('dist/windows-amd64.json',document);
  const archivedGuide = path.join('guides', expected.version + '.md');
  fs.copyFileSync(fs.existsSync(archivedGuide) ? archivedGuide : 'FRIEND_GUIDE.md', 'dist/FRIEND_GUIDE.md');
  fs.appendFileSync(process.env.GITHUB_ENV, 'RELEASE_TAG=v' + expected.version + '\nINSTALLER_NAME=' + name + '\n');
  console.log('Verified official signed installer ' + expected.version + ' (' + artifact.size + ' bytes)');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
