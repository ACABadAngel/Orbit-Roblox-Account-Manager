import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assetNames, releaseMetadata, validateBundle, publishNative } from './publish-native.mjs';
const repo='ACABadAngel/Orbit-Roblox-Account-Manager', sha='a'.repeat(40);
const assets=assetNames.map(name=>({name,state:'uploaded',size:10}));
async function bundle(run) {
  const folder=await mkdtemp(join(tmpdir(),'orbit-publish-'));
  try {
    await writeFile(join(folder,assetNames[0]),'synthetic-ci-zip');
    await writeFile(join(folder,assetNames[1]),createHash('sha256').update('synthetic-ci-zip').digest('hex')+'\n');
    await writeFile(join(folder,assetNames[2]),'synthetic-ci-installer');
    await run(folder);
  } finally {await rm(folder,{recursive:true,force:true});}
}
test('native patch is visible to 0.6.1 stable checks and does not become the Electron latest release',()=>{
  const result=releaseMetadata('0.6.2',sha,repo);
  assert.equal(result.tag_name,'native-v0.6.2');assert.equal(result.prerelease,false);assert.equal(result.draft,true);assert.equal(result.make_latest,'false');
  assert.equal(releaseMetadata('0.6.3-beta.1',sha,repo).prerelease,true);
});
test('release inputs cannot redirect publication to another repository or commit',()=>{
  for(const input of [['0.6.2',sha,'someone/else'],['0.6.2','main',repo],['0.6.2; bad',sha,repo]])assert.throws(()=>releaseMetadata(...input));
});
test('corrupt ZIPs cannot be published',()=>bundle(async folder=>{
  await writeFile(join(folder,assetNames[0]),'changed');await assert.rejects(()=>validateBundle(folder),/checksum/);
}));
test('release stays a draft until all three tested assets have uploaded',()=>bundle(async folder=>{
  const calls=[];let uploaded=false;
  const api=async(method,path,body)=>{
    calls.push([method,path,body]);
    if(path.includes('/tags/')){const error=new Error('not found');error.status=404;throw error;}
    if(method==='POST'){assert.equal(body.draft,true);return{id:42};}
    if(method==='GET')return{id:42,assets:uploaded?assets:[]};
    assert.equal(uploaded,true);assert.deepEqual(body,{draft:false,prerelease:false,make_latest:'false'});return{html_url:'release-url'};
  };
  const result=await publishNative({version:'0.6.2',sha,repo,folder,api,upload:async(tag,files,resume)=>{assert.equal(tag,'native-v0.6.2');assert.equal(files.length,3);assert.equal(resume,false);uploaded=true;}});
  assert.equal(result.published,true);assert.equal(calls.at(-1)[0],'PATCH');
}));
test('an upload failure never exposes a partial release',()=>bundle(async folder=>{
  const methods=[];
  await assert.rejects(()=>publishNative({version:'0.6.2',sha,repo,folder,api:async(method,path)=>{methods.push(method);if(path.includes('/tags/')){const error=new Error();error.status=404;throw error;}return{id:42};},upload:async()=>{throw new Error('upload failed');}}),/upload failed/);
  assert.equal(methods.includes('PATCH'),false);
}));
test('published versions are immutable and reruns skip them',()=>bundle(async folder=>{
  let writes=0;
  const result=await publishNative({version:'0.6.2',sha,repo,folder,api:async method=>{if(method!=='GET')writes++;return{draft:false,prerelease:false,assets,html_url:'existing'};},upload:async()=>{writes++;}});
  assert.equal(result.published,false);assert.equal(writes,0);
}));
test('a draft from another commit is not overwritten',()=>bundle(async folder=>{
  await assert.rejects(()=>publishNative({version:'0.6.2',sha,repo,folder,api:async()=>({draft:true,target_commitish:'b'.repeat(40)}),upload:async()=>assert.fail('upload should not run')}),/another commit/);
}));
