import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync,symlinkSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {resolveSkillRoots,linkRepresentativeSkill} from '../scripts/lib/skill-roots.mjs';
function fixture(t) {
 const base=realpathSync(tmpdir()),root=mkdtempSync(join(base,'pom-roots-'));
 t.after(()=>{const rel=relative(base,realpathSync(root));assert(!isAbsolute(rel)&&rel.startsWith('pom-roots-'));rmSync(root,{recursive:true});});
 const packageRoot=join(root,'package'),projectRoot=join(root,'consumer'),runRoot=join(projectRoot,'.harness/runs/proof');
 mkdirSync(join(packageRoot,'.agents/skills/element-locators'),{recursive:true});mkdirSync(projectRoot);
 writeFileSync(join(packageRoot,'.agents/skills/element-locators/SKILL.md'),'canonical content');
 return {root,packageRoot,projectRoot,runRoot};
}
test('distinct explicit roots keep output in consumer storage',t=>{const f=fixture(t),roots=resolveSkillRoots(f);assert.equal(roots.runRoot,f.runRoot);assert(Object.isFrozen(roots));});
test('relative roots, package writes, project-root writes and outside output are refused',t=>{
 const f=fixture(t);for(const overrides of [{projectRoot:'.'},{projectRoot:f.packageRoot},{runRoot:f.packageRoot},{runRoot:f.projectRoot},{runRoot:join(f.root,'outside')}])assert.throws(()=>resolveSkillRoots({...f,...overrides}));
});
test('a package installed inside the consumer still has an independent run root',t=>{
 const f=fixture(t),packageRoot=join(f.projectRoot,'node_modules/harness');mkdirSync(packageRoot,{recursive:true});assert.equal(resolveSkillRoots({...f,packageRoot}).runRoot,f.runRoot);
 assert.throws(()=>resolveSkillRoots({...f,packageRoot,runRoot:join(packageRoot,'runs')}));
});
test('linked output directories cannot redirect writes outside the consumer',t=>{
 const f=fixture(t);symlinkSync(f.packageRoot,join(f.projectRoot,'redirect'),'junction');assert.throws(()=>resolveSkillRoots({...f,runRoot:join(f.projectRoot,'redirect/runs')}));rmSync(join(f.projectRoot,'redirect'));
});
test('native discovery link points at the same canonical files and is idempotent',t=>{
 const f=fixture(t),target=linkRepresentativeSkill(f);assert.equal(realpathSync(target),realpathSync(join(f.packageRoot,'.agents/skills/element-locators')));assert.equal(readFileSync(join(target,'SKILL.md'),'utf8'),'canonical content');assert.equal(linkRepresentativeSkill(f),target);rmSync(target);
});
test('existing consumer customizations are never overwritten',t=>{
 const f=fixture(t),target=join(f.projectRoot,'.agents/skills/element-locators');mkdirSync(target,{recursive:true});writeFileSync(join(target,'SKILL.md'),'consumer customizations');assert.throws(()=>linkRepresentativeSkill(f));assert.equal(readFileSync(join(target,'SKILL.md'),'utf8'),'consumer customizations');
});
test('discovery parent links cannot modify package storage',t=>{
 const f=fixture(t);symlinkSync(f.packageRoot,join(f.projectRoot,'.agents'),'junction');assert.throws(()=>linkRepresentativeSkill(f));rmSync(join(f.projectRoot,'.agents'));
});
