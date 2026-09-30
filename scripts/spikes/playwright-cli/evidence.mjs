// Required evidence for this fixed experiment only; no general result schema.
import assert from 'node:assert/strict';

function jsonLines(bytes) {
  return bytes.toString('utf8').split(/\r?\n/).filter(line=>line.trim()).map(line=>JSON.parse(line));
}

export function verifyRequiredEvidence(files) {
  const png=files.get('evidence/page.png');
  assert.ok(png?.length>=33,'missing or invalid M4 screenshot');
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(8),13);assert.equal(png.subarray(12,16).toString(),'IHDR');
  assert.ok(png.readUInt32BE(16)>0 && png.readUInt32BE(20)>0,'invalid screenshot dimensions');
  assert.equal(png.subarray(-12).toString('hex'),'0000000049454e44ae426082','incomplete PNG');
  const snapshot=files.get('evidence/initial.yml')?.toString('utf8');
  assert.ok(snapshot && /^\s*- heading "Public fixture".*\[ref=[^\]]+\]/m.test(snapshot),'missing or invalid M4 reference snapshot');
  let trace=false,network=false;
  for(const [path,bytes] of files) {
    if(/^evidence\/traces\/[^/]+\.trace$/.test(path)) {
      const records=jsonLines(bytes);
      assert.ok(records.some(record=>record.type==='frame-snapshot' && Array.isArray(record.snapshot?.html)),'trace lacks DOM snapshots');
      assert.ok(files.has(path.slice(0,-6)+'.network'),'trace lacks associated network evidence');trace=true;
    }
    if(/^evidence\/traces\/[^/]+\.network$/.test(path)) {
      const records=jsonLines(bytes);
      assert.ok(records.some(record=>record.type==='resource-snapshot' && typeof record.snapshot?.request?.method==='string' && Number.isInteger(record.snapshot?.response?.status)),'network evidence lacks observations');network=true;
    }
  }
  assert.ok(trace && network,'missing required trace or network evidence');
}
