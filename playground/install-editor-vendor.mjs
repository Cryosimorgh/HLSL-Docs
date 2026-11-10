// CI/developer preparation only. The distributable ships these static assets;
// users never need Node.js/npm, and the browser never downloads editor code.
import {execFileSync} from "node:child_process";
import {cp,mkdtemp,mkdir,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
const root=fileURLToPath(new URL(".",import.meta.url));
const temp=await mkdtemp(join(tmpdir(),"cm5-pinned-"));
const version="5.65.21";
try {
  execFileSync(process.platform==="win32"?"npm.cmd":"npm",[
    "install", "--prefix",temp, "--no-save","--ignore-scripts",
    "--no-audit","--no-fund","--package-lock=false",
    "codemirror@"+version
  ],{stdio:"inherit",timeout:120000});
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