import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute} from 'node:path';
import {secretFindings,privacyFindings,inventory,localLinkFindings,publicationFindings} from '../scripts/lib/package-validation.mjs';

function temporary(t) {
 const base=realpathSync(tmpdir()), root=mkdtempSync(join(base,'pom-validation-'));
 t.after(()=>{const rel=relative(base,realpathSync(root));assert(!isAbsolute(rel) && rel.startsWith('pom-validation-'));rmSync(root,{recursive:true});});return root;
}
test('credential scanning does not exempt a line with another env reference or suppression',()=>{
 const marker='synthetic-value-for-test';const hits=secretFindings('fixture.ts',`const pass${'word'} = "${marker}"; // conventions-ok process.env.OTHER`);
 assert.equal(hits.length,1);assert(!JSON.stringify(hits).includes(marker));
});
test('placeholder and env references do not masquerade as credentials',()=>{
 for(const value of ['process.env.TEST_PASSWORD','"<secret-ref>"','"${SECRET_REF}"','"{{SECRET_REF}}"']) assert.deepEqual(secretFindings('fixture.ts',`const pass${'word'} = ${value};`),[]);
});
test('short and static backtick credentials are not exempt',()=>{
 for(const quote of ['"',"'",'`']) for(const name of ['pass'+'word','dbPass'+'word','clientSe'+'cret','apiTo'+'ken']) assert.equal(secretFindings('fixture.ts',`const ${name} = ${quote}x${quote};`).length,1);
});
test('known token and connection shapes are detected without echoing values',()=>{
 for(const text of ['ghp_'+'a'.repeat(35),'-----BEGIN '+'PRIVATE KEY-----',['Pwd','synthetic-connection-value'].join('=')]) assert(secretFindings('fixture.ts',text).length>0);
});
test('a package name ending in token is not a credential field',()=>{
 assert.deepEqual(secretFindings('package-lock.json','{"jsonwebtoken":"^9.0.0"}'),[]);
});

test('runtime credential expressions are code, independent of identifier spelling or line endings',()=>{
 const field=['pass','word'].join('');
 for(const name of [field,'account'+field[0].toUpperCase()+field.slice(1),'pwd']) for(const newline of ['\n','\r\n']) {
  for(const expression of ["randomBytes(24).toString('hex')",'generateDisposableCredential(rules)','account.credential','process.env.TEST_PASSWORD']) {
   assert.deepEqual(secretFindings('fixture.ts',`export {};${newline}const ${name} = ${expression};`),[]);
  }
 }
 assert.deepEqual(secretFindings('fixture.ts',`this.${field} = generateDisposableCredential(rules);`),[]);
 assert.deepEqual(secretFindings('fixture.ts',`const email = makeEmail(), ${field} = makeCredential();`),[]);
});

test('hardcoded primitive credential assignments remain protected while wrapped placeholders pass',()=>{
 const field=['pass','word'].join('');
 for (const value of ['12345678', '12345678n', '(12345678)']) {
  const hits=secretFindings('fixture.ts',`const ${field} = ${value};`);
  assert(hits.length>0, `Literal kind ${value} cannot become a runtime expression.`);
  assert(!JSON.stringify(hits).includes(value));
 }
 assert.deepEqual(secretFindings('fixture.ts',`const ${field} = ("<secret-ref>");`), []);
});

test('obvious literal fallbacks, comparisons and decoding are not generation exemptions',()=>{
 const field=['pass','word'].join('');
 for (const expression of ["(value || 'fixture-control')", "value ?? 'fixture-control'", "atob('fixture-control')", "value === 'fixture-control'"]) {
  const hits=secretFindings('fixture.ts',`const ${field} = ${expression};`);
  assert(hits.length>0);assert(!JSON.stringify(hits).includes('fixture-control'));
 }
 assert.deepEqual(secretFindings('fixture.ts', `assert(body.${field} === '***');`), []);
});

test('Markdown code generators pass while literal and raw connection credentials still fail',()=>{
 const field=['pass','word'].join('');
 assert.deepEqual(secretFindings('guide.md',`Example:\n\n\`\`\`ts\nconst ${field} = generateDisposableCredential(rules);\n\`\`\`\n`),[]);
 for(const source of [`const ${field} = ('synthetic-control-value');`, `const ${field} = \`synthetic-control-value\`;`, ['Pwd','synthetic-control-value'].join('='), `const connection = '${['Server=example.test',['Pwd','synthetic-control-value'].join('=')].join(';')}';`]) {
  const hits=secretFindings('fixture.ts',source);assert(hits.length>0);assert(!JSON.stringify(hits).includes('synthetic-control-value'));
 }
 const mixed=`const ${field} = makeCredential(); const connection = '${['Server=example.test',['Pwd','synthetic-control-value'].join('=')].join(';')}';`;
 assert(secretFindings('fixture.ts',mixed).some(hit=>hit.rule==='connection-credential'));
});
test('privacy distinguishes public references from private coordinates',()=>{
 assert.equal(privacyFindings('guide.md','https://playwright.dev/docs/intro https://example.test/demo').length,0);
 for(const text of [['https:','','dev.azure.com','private-organization','project'].join('/'),'10.'+'25.30.40','C:'+'\\Users\\LocalOwner\\project']) assert(privacyFindings('guide.md',text).length>0);
});
test('empty runtime histories pass but populated histories fail',()=>{
 assert.equal(privacyFindings('events.jsonl','\n').length,0);assert.equal(privacyFindings('events.jsonl','{"event":"run"}').length,1);
});
test('a dynamic URL path does not exempt a literal private host',()=>{
 const url=['https:','','internal-host.local','${recordId}'].join('/');
 assert(privacyFindings('guide.md',url).some(f=>f.rule==='unreviewed-url'));
 assert.equal(privacyFindings('guide.md',['https:','','${configuredHost}','path'].join('/')).length,0);
});
test('dynamic userinfo or port does not exempt a literal hostname',()=>{
 const withUserInfo=['https:','','${account}:${credential}@internal-host.local','path'].join('/');
 assert.deepEqual(privacyFindings('guide.md',withUserInfo).map(f=>f.rule),['url-userinfo','unreviewed-url']);
 const withPort=['https:','','internal-host.local:${port}','path'].join('/');
 assert(privacyFindings('guide.md',withPort).some(f=>f.rule==='unreviewed-url'));
});
test('inventory excludes protected recovery, local secrets and installed dependencies',t=>{
 const root=temporary(t);writeFileSync(join(root,'README.md'),'safe');
 for(const dir of ['.m1-private','node_modules','.validation']) {mkdirSync(join(root,dir));writeFileSync(join(root,dir,'sample'),'excluded');}
 writeFileSync(join(root,'.env'),'excluded');writeFileSync(join(root,'unexpected.bin'),'unknown');
 const result=inventory(root);assert.deepEqual(result.files,['README.md']);assert.equal(result.unexpected.length,1);assert.equal(result.excluded.length,4);
});
test('links verify existing targets, missing targets, encoding and containment',t=>{
 const root=temporary(t);mkdirSync(join(root,'docs'));writeFileSync(join(root,'README.md'),'safe');
 const r=localLinkFindings(root,'docs/guide.md','[ok](../README.md) [missing](no.md) [escape](../../outside.md) [invalid](%zz) [remote](https://example.test)');
 assert.equal(r.links,4);assert.deepEqual(r.findings.map(f=>f.rule),['missing-link-target','link-outside-package','invalid-link-encoding']);
});
test('fenced examples and comments are not rendered local links',t=>{
 const root=temporary(t);const r=localLinkFindings(root,'README.md','<!-- [comment](missing.md) -->\n```md\n[fenced](missing.md)\n```\n');assert.equal(r.links,0);
});
test('package inspection rejects bundled dependencies, recovery material and missing public files',()=>{
 const scope={files:['README.md','package.json','package-lock.json'],unexpected:[]};
 assert.deepEqual(publicationFindings(scope,['README.md','package.json']),[]);
 assert.equal(publicationFindings(scope,['package.json','examples/node_modules/dependency.js','.m1-private/recovery.dpapi']).length,3);
 assert(publicationFindings(scope,[]).length>0);
 const controlled={files:[...scope.files,'scripts/spike/.npmignore','scripts/spike/.gitattributes'],unexpected:[]};
 assert.deepEqual(publicationFindings(controlled,['README.md','package.json','scripts/spike/.gitattributes']),[]);
 assert(publicationFindings(controlled,['README.md','package.json']).some(f=>f.file==='scripts/spike/.gitattributes'));
 assert(publicationFindings(controlled,['README.md','package.json','scripts/spike/.gitattributes','scripts/spike/node_modules/dependency.js']).length>0);
});
