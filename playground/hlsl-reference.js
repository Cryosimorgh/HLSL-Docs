(() => {
  "use strict";
  const root=document.getElementById("reference-list");
  const search=document.getElementById("reference-search");
  const list=window.HLSLDocs?.list || [];
  const entries=[];
  function label(name,text){
    const p=document.createElement("p");
    const b=document.createElement("strong");b.textContent=name+" ";
    p.append(b,document.createTextNode(text));
    return p;
  }
  for(const item of list){
    const section=document.createElement("section");
    section.id=item.key;
    section.className="reference-entry";
    const heading=document.createElement("h2");
    heading.textContent=item.title+" · "+item.key;
    const note=document.createElement("div");
    note.className="reference-caption";
    note.textContent="Example";
    const pre=document.createElement("pre");
    const code=document.createElement("code");
    code.textContent=item.example;
    pre.append(code);
    section.append(heading,label("What:",item.what),label("Does:",item.does),
      label("Use:",item.use),note,pre);
    root.append(section);
    entries.push({item,section});
  }
  function filter(){
    const q=search.value.trim().toLowerCase();
    for(const {item,section} of entries){
      section.hidden=q!==""&&!([item.key,item.title,item.what,item.does,item.use]
        .some(s=>s.toLowerCase().includes(q)));
    }
  }
  search.addEventListener("input",filter);
  window.addEventListener("hashchange",()=>{
    // Direct links must still work after the user previously filtered entries.
    if(location.hash){search.value="";filter();}
  });
  if(location.hash){
    requestAnimationFrame(()=>{
      document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    });
  }
})();