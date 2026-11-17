import {chmod,lstat} from 'node:fs/promises';
import {join} from 'node:path';

export async function prepareFixtureAccess(directory,readOnlyFiles,writableFiles) {
  if(process.platform==='win32') return {group:'1000',scope:'Windows bind-mount ACL semantics; POSIX permissions not established'};
  const group=process.getgid();
  if(!Number.isInteger(group)||group<1000) throw Error('Run fixture verification as a dedicated non-system Linux user/group');
  const parent=await lstat(directory);if(!parent.isDirectory()||parent.isSymbolicLink())throw Error('Fixture directory required');
  await chmod(directory,0o700);
  for(const [names,mode] of [[readOnlyFiles,0o640],[writableFiles,0o660]]){
    for(const name of names){
      if(!/^[a-z][a-z0-9.-]+$/.test(name))throw Error('Invalid fixture filename');
      const path=join(directory,name),file=await lstat(path);
      if(!file.isFile()||file.isSymbolicLink()||file.uid!==process.getuid()||file.gid!==group)throw Error('Fixture file ownership mismatch');
      await chmod(path,mode);
    }
  }
  return {group:String(group),scope:'Private host directory; owner and explicitly added runtime group only; agent mounts remain read-only'};
}
