// CI/developer preparation only. The distributable ships these static assets;
// users never need Node.js/npm, and the browser never downloads editor code.
import {execFileSync} from "node:child_process";
import {cp,mkdtemp,mkdir,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL(".",import.meta.url));
const temp=await mkdtemp(join(tmpdir(),"cm5-pinned-"));
const version="5.65.21";
try {
  const args=["install","--prefix",temp,"--no-save","--ignore-scripts",
    "--no-audit","--no-fund","--package-lock=false","codemirror@"+version];
  if(process.platform==="win32"){
    // Execute npm's JS CLI directly via Node, avoiding .cmd quoting/EINVAL.
    const npmCli=join(dirname(process.execPath),"node_modules","npm","bin","npm-cli.js");
    execFileSync(process.execPath,[npmCli,...args],{stdio:"inherit",timeout:120000});
  }else{
    execFileSync("npm",args,{stdio:"inherit",timeout:120000});
  }
  const src=join(temp,"node_modules","codemirror");
  const out=join(root,"vendor","codemirror");
  await mkdir(out,{recursive:true});
  const files={
    "lib/codemirror.js":"codemirror.js",
    "lib/codemirror.css":"codemirror.css",
    "mode/clike/clike.js":"clike.js",
    "addon/fold/foldcode.js":"foldcode.js",
    "addon/fold/foldgutter.js":"foldgutter.js",
    "addon/fold/foldgutter.css":"foldgutter.css",
    "addon/hint/show-hint.js":"show-hint.js",
    "addon/hint/show-hint.css":"show-hint.css",
    "LICENSE":"LICENSE"
  };
  for(const [from,to] of Object.entries(files)){
    await cp(join(src,from),join(out,to));
    if(!(await readFile(join(out,to))).length)throw Error("Empty vendor asset: "+to);
  }
  console.log("Installed offline CodeMirror",version,"files:",Object.values(files).join(", "));
}finally{
  await rm(temp,{recursive:true,force:true,maxRetries:5,retryDelay:250});
}