(function(){
'use strict';

/* ═══════════ MIGRATION ═══════════ */
var DATA_VERSION = 2;
function migrateData() {
  var versionKey = 'ce_saves_version', dataKey = 'ce_saves_v1';
  var storedVersion = localStorage.getItem(versionKey);
  var currentVersion = parseInt(storedVersion, 10) || 0;
  if (currentVersion < 2 && localStorage.getItem(dataKey)) {
    try {
      var oldData = JSON.parse(localStorage.getItem(dataKey) || '[]');
      var newData = oldData.map(function(item) {
        if (!item.type) { item.type = item.files ? 'project' : 'file'; }
        return item;
      });
      localStorage.setItem(dataKey, JSON.stringify(newData));
    } catch(e) {}
    currentVersion = 2;
  }
  localStorage.setItem(versionKey, currentVersion);
}
migrateData();

/* ═══════════ HIGHLIGHTER ═══════════ */
var KW=new Set(['const','let','var','function','return','if','else','for','while','do',
  'switch','case','break','continue','new','delete','typeof','instanceof','in','of',
  'class','extends','import','export','default','async','await','try','catch','finally',
  'throw','this','super','null','undefined','true','false','void','yield','static',
  'get','set','from','debugger','with']);

function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

function highlight(code){
  var out=[],i=0,len=code.length,c,j,word;
  while(i<len){
    c=code[i];
    if(c==='/'&&code[i+1]==='/'){j=code.indexOf('\n',i);if(j===-1)j=len;out.push('<span class="cmt">'+esc(code.slice(i,j))+'</span>');i=j;continue;}
    if(c==='/'&&code[i+1]==='*'){j=code.indexOf('*/',i+2);j=j===-1?len:j+2;out.push('<span class="cmt">'+esc(code.slice(i,j))+'</span>');i=j;continue;}
    if(c==='"'||c==="'"||c==='`'){j=i+1;while(j<len){if(code[j]==='\\'){j+=2;continue;}if(code[j]===c){j++;break;}j++;}out.push('<span class="str">'+esc(code.slice(i,j))+'</span>');i=j;continue;}
    if(/\d/.test(c)&&(i===0||/\W/.test(code[i-1]))){j=i;if(code[j]==='0'&&(code[j+1]==='x'||code[j+1]==='X')){j+=2;while(j<len&&/[0-9a-fA-F]/.test(code[j]))j++;}else{while(j<len&&/[\d.eE]/.test(code[j]))j++;}out.push('<span class="num">'+esc(code.slice(i,j))+'</span>');i=j;continue;}
    if(/[a-zA-Z_$]/.test(c)){j=i+1;while(j<len&&/[\w$]/.test(code[j]))j++;word=code.slice(i,j);if(KW.has(word))out.push('<span class="kw">'+esc(word)+'</span>');else if(code[j]==='(')out.push('<span class="fn">'+esc(word)+'</span>');else if(/^[A-Z]/.test(word))out.push('<span class="cls">'+esc(word)+'</span>');else out.push(esc(word));i=j;continue;}
    out.push(esc(c));i++;
  }
  return out.join('');
}

/* ═══════════ STATE ═══════════ */
var files=[{id:1,name:'index.html',content:''}];
var activeId=1,nextId=2;
var undoSt={1:[]},redoSt={1:[]};
var lastCommit='';
var undoTimer=null;
var editingTabId = null;

function getFile(){for(var k=0;k<files.length;k++)if(files[k].id===activeId)return files[k];return files[0];}
function findFileByName(name){for(var i=0;i<files.length;i++){if(files[i].name===name)return files[i];}return null;}

/* ═══════════ DOM ═══════════ */
var tabsBar=document.getElementById('tabsBar');
var lineNums=document.getElementById('lineNums');
var hlLayer=document.getElementById('hlLayer');
var codeArea=document.getElementById('codeArea');
var undoBtn=document.getElementById('undoBtn');
var redoBtn=document.getElementById('redoBtn');
var selAllBtn=document.getElementById('selAllBtn');
var copyTip=document.getElementById('copyTip');
var copyBtn=document.getElementById('copyBtn');
var tipDismiss=document.getElementById('tipDismiss');
var menuBtn=document.getElementById('menuBtn');
var dropdown=document.getElementById('dropdown');
var saveBtn=document.getElementById('saveBtn');
var deleteBtn=document.getElementById('deleteBtn');
var renameBtn=document.getElementById('renameBtn');
var addFileBtn=document.getElementById('addFileBtn');
var openSavesBtn=document.getElementById('openSavesBtn');
var savesPanel=document.getElementById('savesPanel');
var savesClose=document.getElementById('savesClose');
var savesList=document.getElementById('savesList');
var playBtn=document.getElementById('playBtn');
var previewOverlay=document.getElementById('previewOverlay');
var previewFrame=document.getElementById('previewFrame');
var closePreviewBtn=document.getElementById('closePreview');
var toastEl=document.getElementById('toast');
var issueOverlay=document.getElementById('issueOverlay');
var issueBody=document.getElementById('issueBody');
var issueCloseBtn=document.getElementById('issueClose');
var issuePreviewRaw=document.getElementById('issuePreviewRaw');
var issueFixAll=document.getElementById('issueFixAll');

/* ═══════════ TOAST ═══════════ */
var toastTimer=null;
function showToast(msg){
  toastEl.textContent=msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){toastEl.classList.remove('show');},2200);
}

/* ═══════════ RENDER ═══════════ */
function renderLineNums(text){
  var n = (text.match(/\n/g)||[]).length + 1;
  var h='';
  for(var i=1;i<=n;i++) h+='<div class="ln">'+i+'</div>';
  lineNums.innerHTML=h;
}
function renderHL(text){hlLayer.innerHTML=highlight(text);}
function updateBtns(){
  undoBtn.disabled=!(undoSt[activeId]&&undoSt[activeId].length>0);
  redoBtn.disabled=!(redoSt[activeId]&&redoSt[activeId].length>0);
}

function renderTabs(){
  tabsBar.innerHTML='';
  for(var i=0;i<files.length;i++){
    (function(f){
      var btn=document.createElement('button');
      btn.className='tab'+(f.id===activeId?' active':'');

      if(f.id === editingTabId){
        var input = document.createElement('input');
        input.type = 'text';
        input.value = f.name;
        input.style.cssText = 'background:transparent; border:none; outline:none; color:inherit; font:inherit; width:100%; padding:0; margin:0;';
        input.addEventListener('keydown', function(e){
          e.stopPropagation();
          if(e.key === 'Enter') finishRename(input.value.trim(), f.id);
          if(e.key === 'Escape') cancelRename();
        });
        input.addEventListener('blur', function(){
          finishRename(input.value.trim(), f.id);
        });
        btn.appendChild(input);
        setTimeout(function(){ input.focus(); input.select(); }, 20);
      } else {
        var sp=document.createElement('span');sp.textContent=f.name;btn.appendChild(sp);
      }

      if(files.length>1){
        var x=document.createElement('button');x.className='tab-x';x.title='Close';
        x.innerHTML='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
        x.addEventListener('click',function(e){e.stopPropagation();closeTab(f.id);});
        btn.appendChild(x);
      }

      var pressStartTime = 0;
      var longPressed = false;

      function onTouchStart(e) {
        if (editingTabId !== null) return;
        pressStartTime = Date.now();
        longPressed = false;
      }

      function onTouchEnd(e) {
        if (!pressStartTime) return;
        var elapsed = Date.now() - pressStartTime;
        if (elapsed >= 500) {
          longPressed = true;
          if (f.id === activeId) startEditTabName(f.id);
          e.preventDefault();
        } else {
          longPressed = false;
        }
        pressStartTime = 0;
      }

      function onTouchCancel(e) {
        pressStartTime = 0;
        longPressed = false;
      }

      btn.addEventListener('mousedown', function(e) {
        if (editingTabId !== null) return;
        pressStartTime = Date.now();
        longPressed = false;
      });
      btn.addEventListener('mouseup', function(e) {
        if (!pressStartTime) return;
        var elapsed = Date.now() - pressStartTime;
        if (elapsed >= 500) {
          longPressed = true;
          if (f.id === activeId) startEditTabName(f.id);
        } else {
          longPressed = false;
        }
        pressStartTime = 0;
      });
      btn.addEventListener('mouseleave', function() { pressStartTime = 0; });

      btn.addEventListener('touchstart', onTouchStart, {passive: true});
      btn.addEventListener('touchend', onTouchEnd, {passive: false});
      btn.addEventListener('touchcancel', onTouchCancel, {passive: true});

      btn.addEventListener('click', function(e) {
        if (editingTabId !== null) return;
        if (longPressed) {
          longPressed = false;
          return;
        }
        if (e.target.closest('.tab-x')) return;
        if (f.id !== activeId) switchTab(f.id);
      });

      tabsBar.appendChild(btn);
    })(files[i]);
  }
}

/* ═══════════ TABS ═══════════ */
function switchTab(id){
  commitUndo();
  activeId=id;
  editingTabId = null;
  renderTabs();
  renderEditor();
  closeDropdown();
  copyTip.classList.remove('show');
}

function closeTab(id){
  if(files.length===1)return;
  if(editingTabId === id) editingTabId = null;
  files=files.filter(function(f){return f.id!==id;});
  delete undoSt[id];delete redoSt[id];
  if(activeId===id)activeId=files[files.length-1].id;
  renderTabs();renderEditor();
}

/* ═══════════ INLINE RENAME ═══════════ */
function startEditTabName(id){
  editingTabId = id;
  renderTabs();
}
function finishRename(newName, id){
  if(editingTabId !== id) return;
  newName = (newName || '').trim();
  if(newName){
    for(var k=0;k<files.length;k++){
      if(files[k].id === id){ files[k].name = newName; break; }
    }
  }
  editingTabId = null;
  renderTabs();
}
function cancelRename(){
  editingTabId = null;
  renderTabs();
}

/* ═══════════ UNDO / REDO ═══════════ */
function initSt(id){if(!undoSt[id])undoSt[id]=[];if(!redoSt[id])redoSt[id]=[];}
function pushUndo(snap){
  initSt(activeId);
  var st=undoSt[activeId];
  if(st.length&&st[st.length-1]===snap)return;
  st.push(snap);if(st.length>100)st.shift();
  redoSt[activeId]=[];
}
function commitUndo(){
  clearTimeout(undoTimer);
  var cur=codeArea.value;
  if(cur !== lastCommit){
    pushUndo(lastCommit);
    lastCommit = cur;
  }
}
function applyContent(val){
  for(var k=0;k<files.length;k++)if(files[k].id===activeId){files[k].content=val;break;}
  codeArea.value = val;
  renderHL(val);
  renderLineNums(val);
  updateBtns();
}
function doUndo(){
  commitUndo();initSt(activeId);
  var st=undoSt[activeId];if(!st.length)return;
  var prev=st.pop();redoSt[activeId].push(getFile().content);
  applyContent(prev);lastCommit=prev;
}
function doRedo(){
  initSt(activeId);
  var st=redoSt[activeId];if(!st.length)return;
  var next=st.pop();undoSt[activeId].push(getFile().content);
  applyContent(next);lastCommit=next;
}

/* ═══════════ TEXTAREA EVENTS ═══════════ */
codeArea.addEventListener('input',function(){
  var val=codeArea.value;
  for(var k=0;k<files.length;k++)if(files[k].id===activeId){files[k].content=val;break;}
  renderHL(val);renderLineNums(val);
  clearTimeout(undoTimer);
  var snap=lastCommit;
  undoTimer=setTimeout(function(){
    if(val!==snap){pushUndo(snap);lastCommit=val;updateBtns();}
  },600);
});

codeArea.addEventListener('scroll',function(){
  hlLayer.scrollTop=codeArea.scrollTop;
  hlLayer.scrollLeft=codeArea.scrollLeft;
  lineNums.scrollTop=codeArea.scrollTop;
});

codeArea.addEventListener('keydown',function(e){
  if(e.key==='Tab'){
    e.preventDefault();
    var s=codeArea.selectionStart,en=codeArea.selectionEnd,v=codeArea.value;
    var nv=v.slice(0,s)+'  '+v.slice(en);
    commitUndo();codeArea.value=nv;codeArea.selectionStart=codeArea.selectionEnd=s+2;
    for(var k=0;k<files.length;k++)if(files[k].id===activeId){files[k].content=nv;break;}
    renderHL(nv);renderLineNums(nv);lastCommit=nv;return;
  }
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='z'){e.preventDefault();doUndo();return;}
  if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='z'))){e.preventDefault();doRedo();return;}
  if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();doSave();return;}
  if((e.ctrlKey||e.metaKey)&&e.key==='a'){setTimeout(function(){copyTip.classList.add('show');},50);}
});

/* ═══════════ TOOLBAR BUTTONS ═══════════ */
undoBtn.addEventListener('click',doUndo);
redoBtn.addEventListener('click',doRedo);
selAllBtn.addEventListener('click',function(){codeArea.focus();codeArea.select();copyTip.classList.add('show');});
copyBtn.addEventListener('click',function(){
  var txt=codeArea.value;
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).catch(function(){fbCopy(txt);});
  }else fbCopy(txt);
  copyTip.classList.remove('show');
  showToast('Copied!');
});
function fbCopy(t){var ta=document.createElement('textarea');ta.value=t;ta.style.cssText='position:fixed;top:-9999px;left:-9999px;opacity:0';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');}catch(e){}document.body.removeChild(ta);}
tipDismiss.addEventListener('click',function(){copyTip.classList.remove('show');});
document.addEventListener('mousedown',function(e){if(!copyTip.contains(e.target)&&e.target!==selAllBtn)copyTip.classList.remove('show');});

/* ═══════════ DROPDOWN ═══════════ */
function closeDropdown(){ dropdown.classList.remove('show'); }
menuBtn.addEventListener('click', function(e) { e.stopPropagation(); dropdown.classList.toggle('show'); });
function handleOutsideClick(e) {
  if (!dropdown.classList.contains('show')) return;
  if (e.target === menuBtn || menuBtn.contains(e.target)) return;
  if (dropdown.contains(e.target)) return;
  closeDropdown();
}
document.addEventListener('click', handleOutsideClick);
document.addEventListener('touchend', function(e) { setTimeout(function() { handleOutsideClick(e); }, 10); });

/* ═══════════ PROJECT SAVE ═══════════ */
var LS_KEY='ce_saves_v1';
function getSaves(){ try{return JSON.parse(localStorage.getItem(LS_KEY)||'[]');}catch(e){return[];} }
function setSaves(arr){ try{localStorage.setItem(LS_KEY,JSON.stringify(arr));}catch(e){showToast('Storage full!');} }
function doSave(){
  var projectName = prompt('Enter a name for your project:', 'MyProject');
  if (!projectName || !projectName.trim()) { showToast('Save cancelled'); closeDropdown(); return; }
  projectName = projectName.trim();
  var arr = getSaves();
  var now = new Date();
  var label = now.toLocaleDateString('en',{month:'short',day:'numeric'})+' '+now.toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'});
  var projectFiles = files.map(function(f){ return { id:f.id, name:f.name, content:f.content }; });
  var projectEntry = { id:'proj_'+Date.now(), type:'project', name:projectName, files:projectFiles, date:label };
  arr.unshift(projectEntry);
  if(arr.length > 50) arr = arr.slice(0, 50);
  setSaves(arr);
  showToast('Project saved: ' + projectName);
  closeDropdown();
}
saveBtn.addEventListener('click', doSave);

/* ═══════════ SAVED FILES PANEL ═══════════ */
function renderSavesList() {
  var arr = getSaves();
  if(!arr.length) { savesList.innerHTML = '<div class="save-empty">No saved files or projects.<br>Use <strong>Save Project</strong> to save all tabs.</div>'; return; }
  var html = '';
  arr.forEach(function(s) {
    var isProject = (s.type === 'project');
    var iconSvg = isProject
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#82aaff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><polyline points="17 8 12 13 8 10"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#c792ea" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    var nameDisplay = esc(s.name);
    if (isProject) nameDisplay += ' <span style="color:#82aaff;font-size:11px;">[Project]</span>';
    html += '<div class="save-card" data-id="'+s.id+'">'
      +'<div class="save-icon">'+iconSvg+'</div>'
      +'<div class="save-info"><div class="save-name">'+nameDisplay+'</div><div class="save-date">'+esc(s.date)+'</div></div>'
      +'<div class="save-actions">'
      +'<button class="save-load" data-load="'+s.id+'">Load</button>'
      +'<button class="save-del" data-del="'+s.id+'" title="Delete"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>'
      +'</div></div>';
  });
  savesList.innerHTML = html;

  savesList.querySelectorAll('[data-load]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var id = this.getAttribute('data-load');
      var arr2 = getSaves();
      for(var i = 0; i < arr2.length; i++) {
        if(arr2[i].id === id) {
          var item = arr2[i];
          if(item.type === 'project' && item.files) {
            commitUndo();
            files = item.files.map(function(f){ return { id:f.id, name:f.name, content:f.content }; });
            undoSt = {}; redoSt = {};
            files.forEach(function(f){ undoSt[f.id] = []; redoSt[f.id] = []; });
            activeId = files[0].id;
            var maxId = files.length > 0 ? Math.max.apply(null, files.map(function(f){ return f.id; })) : 0;
            nextId = maxId + 1;
            editingTabId = null;
            renderTabs(); renderEditor();
          } else {
            commitUndo();
            getFile().name = item.name;
            applyContent(item.content);
            lastCommit = item.content;
            renderTabs();
          }
          savesPanel.classList.remove('show');
          showToast('Loaded: ' + item.name);
          return;
        }
      }
    });
  });

  savesList.querySelectorAll('[data-del]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (confirm('Are you sure you want to delete this saved item?')) {
        var id = this.getAttribute('data-del');
        var arr2 = getSaves().filter(function(s){ return s.id !== id; });
        setSaves(arr2);
        renderSavesList();
        showToast('Deleted');
      }
    });
  });
}
openSavesBtn.addEventListener('click',function(){ closeDropdown(); renderSavesList(); savesPanel.classList.add('show'); });
savesClose.addEventListener('click',function(){ savesPanel.classList.remove('show'); });

/* ═══════════ DELETE / RENAME / ADD FILE ═══════════ */
deleteBtn.addEventListener('click',function(){
  commitUndo();
  applyContent('');
  lastCommit = '';
  closeDropdown();
  showToast('Code cleared');
});

renameBtn.addEventListener('click',function(e){
  e.stopPropagation();
  startEditTabName(activeId);
  closeDropdown();
});

addFileBtn.addEventListener('click',function(){
  var id = nextId++;
  var name = 'file'+id+'.js';
  files.push({id:id, name:name, content:''});
  undoSt[id] = []; redoSt[id] = [];
  activeId = id;
  editingTabId = null;
  renderTabs(); renderEditor();
  closeDropdown();
  codeArea.focus();
});

/* ═══════════ UNIVERSAL MULTI-FILE PREVIEW ═══════════ */
function buildMultiFilePreview(){
  var activeFile = getFile();
  var baseFile = null;
  if (/\.html$/i.test(activeFile.name)) { baseFile = activeFile; }
  else {
    for (var i = 0; i < files.length; i++) {
      if (/\.html$/i.test(files[i].name)) { baseFile = files[i]; break; }
    }
  }
  if (!baseFile) return activeFile.content;

  var htmlContent = baseFile.content;
  var cssTags = '', jsTags = '';
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    if (file.id === baseFile.id) continue;
    var nameLower = file.name.toLowerCase();
    if (nameLower.endsWith('.css')) { cssTags += '\n<style>\n' + file.content + '\n</style>\n'; }
    else if (nameLower.endsWith('.js')) { jsTags += '\n<script>\n' + file.content + '\n<\/script>\n'; }
  }

  if (!/<head/i.test(htmlContent) && !/<body/i.test(htmlContent)) {
    htmlContent = '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"></head><body>\n' + htmlContent + '\n</body></html>';
  }

  var result = htmlContent;
  if (cssTags) result = result.replace(/<\/head>/i, cssTags + '</head>');
  if (jsTags) result = result.replace(/<\/body>/i, jsTags + '</body>');
  return result;
}

/* ═══════════════════════════════════════════════════
   SMART PIPELINE — 3 phases, each runs exactly once.
   Phases 1 & 2 are silent (never shown to user).
   Phase 3 detects remaining issues and shows them.
   Fix buttons (individual or Fix-All) only re-run
   Phase 3 — they never re-trigger Phases 1 or 2.
═══════════════════════════════════════════════════ */

var detectedIssues = [];
var previewContentCache = '';

/* ── Phase 1: Assemble Full Page ─────────────────── */
function assembleFullPage(raw) {
  // Strip Markdown code fences
  var code = raw.replace(/```[\w-]*[ \t]*\r?\n?/g, '').replace(/```/g, '');

  // Detect pure CSS or pure JS (no HTML tags at all)
  var hasTags = /<[a-zA-Z][^>]*>/.test(code);
  var isCSS = !hasTags && /\{[^}]*:[^}]*\}/.test(code);
  var isJS  = !hasTags && /\b(function|const|let|var|=>|console\.log|alert|document\.)\b/.test(code);

  if (isCSS) {
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
           '<meta charset="UTF-8">\n' +
           '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
           '<title>Preview</title>\n' +
           '<style>\n' + code + '\n</style>\n' +
           '</head>\n<body>\n</body>\n</html>';
  }
  if (isJS) {
    return '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
           '<meta charset="UTF-8">\n' +
           '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
           '<title>Preview</title>\n' +
           '</head>\n<body>\n' +
           '<script>\n' + code + '\n<\/script>\n' +
           '</body>\n</html>';
  }

  // HTML (possibly partial) — add missing structural elements
  var result = code;
  var hasHtmlTag   = /<html[\s>]/i.test(result);
  var hasDoctype   = /<!DOCTYPE\s+html/i.test(result);

  if (!hasHtmlTag) {
    // Fully wrap bare snippet
    result =
      '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
      '<meta charset="UTF-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
      '<title>Preview</title>\n</head>\n<body>\n' +
      result +
      '\n</body>\n</html>';
  } else {
    if (!hasDoctype) result = '<!DOCTYPE html>\n' + result;
    if (/<head[\s>]/i.test(result)) {
      if (!/<meta[^>]*charset/i.test(result))
        result = result.replace(/(<head[^>]*>)/i, '$1\n<meta charset="UTF-8">');
      if (!/<meta[^>]*name\s*=\s*["']viewport["']/i.test(result))
        result = result.replace(/(<head[^>]*>)/i, '$1\n<meta name="viewport" content="width=device-width, initial-scale=1.0">');
      if (!/<title[\s>]/i.test(result))
        result = result.replace(/<\/head>/i, '<title>Preview</title>\n</head>');
    }
    if (!/<body[\s>]/i.test(result)) {
      result = result.replace(/<\/head>/i, '</head>\n<body>')
                     .replace(/<\/html>/i, '</body>\n</html>');
    }
  }

  return result;
}

/* ── Phase 2: Silent Fixes (applied once, never displayed) ── */
function applySilentFixes(html) {
  var fixed = html;

  // Self-closing block tags → proper open/close pairs
  fixed = fixed.replace(
    /<(div|span|p|section|article|nav|header|footer|main|aside)(\s[^>]*)?\/\s*>/gi,
    function(m, tag, attrs) { return '<' + tag + (attrs || '') + '></' + tag + '>'; }
  );

  // Unitless numeric CSS values → add px (except 0 and numbers inside quotes/strings)
  fixed = fixed.replace(/:\s*(\d+)(?![a-zA-Z%.\d])\s*;/g, function(match, num) {
    return num === '0' ? match : ': ' + num + 'px;';
  });

  // Comment out document.write calls
  fixed = fixed.replace(/^([ \t]*)document\.write\b/gm, '$1// document.write');

  // Fix genuinely missing closing ) before { in if/while/for.
  // The pattern only matches when there is NO closing ) between ( and {,
  // so valid code like `if (x > 5) {` is left completely untouched.
  fixed = fixed.replace(/(if|while|for)\s*\(([^(){}]+)\s*\{/g, function(m, kw, cond) {
    return kw + '(' + cond.replace(/\s+$/, '') + ') {';
  });

  // Add console panel exactly once if console.log is used and no #console exists
  if (/console\.log\(/.test(fixed) && !/id\s*=\s*["']console["']/.test(fixed)) {
    var consoleDiv =
      '<div id="console" style="position:fixed;bottom:0;left:0;right:0;height:120px;' +
      'background:#111;color:#0f0;font-family:monospace;overflow:auto;padding:8px;' +
      'border-top:1px solid #333;z-index:9999;"></div>';
    var consoleScript =
      '<script>(function(){' +
      'var c=document.getElementById("console");if(!c)return;' +
      'var ol=console.log;' +
      'console.log=function(){var a=Array.prototype.slice.call(arguments);c.innerHTML+=a.join(" ")+"\\n";ol.apply(console,a);};' +
      'window.onerror=function(m){c.innerHTML+="ERROR: "+m+"\\n";};' +
      '})();<\/script>';
    if (/<\/body>/i.test(fixed)) {
      fixed = fixed.replace(/<\/body>/i, consoleDiv + consoleScript + '</body>');
    } else {
      fixed += '\n' + consoleDiv + consoleScript;
    }
  }

  return fixed;
}

/* ── Phase 3: Detect Remaining Issues ───────────── */
function detectRemainingIssues(html) {
  var issues = [];

  // Duplicate structural tags
  ['html', 'head', 'body'].forEach(function(tag) {
    var count = (html.match(new RegExp('<' + tag + '[\\s>]', 'gi')) || []).length;
    if (count > 1)
      issues.push({ type: 'duplicate-' + tag, message: 'يوجد أكثر من وسم <' + tag + '>.', fix: null });
  });

  // Mismatched open/close tag counts (excluding void elements and self-closing syntax)
  var voidSet = { br:1,hr:1,img:1,input:1,meta:1,link:1,area:1,base:1,col:1,embed:1,source:1,track:1,wbr:1 };
  var tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  var tagCounts = {}, m;
  while ((m = tagRegex.exec(html)) !== null) {
    var tn = m[2].toLowerCase();
    if (voidSet[tn]) continue;
    if (/\/\s*>$/.test(m[0]) && m[1] !== '/') continue;
    if (!tagCounts[tn]) tagCounts[tn] = { open: 0, close: 0 };
    if (m[1] === '/') tagCounts[tn].close++; else tagCounts[tn].open++;
  }
  var mismatched = [];
  for (var t in tagCounts) {
    if (tagCounts[t].open !== tagCounts[t].close)
      mismatched.push(t + ' (' + tagCounts[t].open + '/' + tagCounts[t].close + ')');
  }
  if (mismatched.length)
    issues.push({ type: 'tag-mismatch', message: 'وسوم غير متطابقة: ' + mismatched.join(', '), fix: null });

  // Duplicate id attributes
  var idMatches = html.match(/\bid\s*=\s*["']([^"']+)["']/gi) || [];
  var idNames = idMatches.map(function(x) { return x.replace(/\bid\s*=\s*["']/i,'').replace(/["']/g,''); });
  var idSeen = {}, dupIds = [];
  idNames.forEach(function(id) {
    if (idSeen[id]) { if (dupIds.indexOf(id) === -1) dupIds.push(id); }
    else idSeen[id] = true;
  });
  if (dupIds.length)
    issues.push({ type: 'duplicate-id', message: 'معرفات id مكررة: ' + dupIds.slice(0,3).join(', '), fix: null });

  // Images without alt attribute
  var imgs = html.match(/<img[^>]*>/gi) || [];
  var noAlt = imgs.filter(function(img) { return !/\balt\s*=/i.test(img); });
  if (noAlt.length) {
    issues.push({
      type: 'img-no-alt',
      message: 'عدد ' + noAlt.length + ' صورة بدون سمة alt.',
      fix: function(h) {
        return h.replace(/<img([^>]*)>/gi, function(full, attrs) {
          if (/\balt\s*=/i.test(attrs)) return full;
          return '<img' + attrs + ' alt="">';
        });
      }
    });
  }

  // Obsolete tags: center, font, marquee
  var obsolete = html.match(/<(center|font|marquee)[\s>]/gi);
  if (obsolete) {
    var uniqueObs = obsolete.filter(function(v,i,a){ return a.indexOf(v)===i; });
    issues.push({
      type: 'obsolete-tags',
      message: 'وسوم قديمة: ' + uniqueObs.join(', '),
      fix: function(h) {
        h = h.replace(/<center(\s[^>]*)?>/gi, '<div style="text-align:center"$1>').replace(/<\/center>/gi, '</div>');
        h = h.replace(/<font(\s[^>]*)?>/gi, '<span$1>').replace(/<\/font>/gi, '</span>');
        h = h.replace(/<marquee(\s[^>]*)?>/gi, '<div$1>').replace(/<\/marquee>/gi, '</div>');
        return h;
      }
    });
  }

  // Input elements without a type attribute
  // Uses negative lookahead so inputs that already have type= are never touched
  if (/<input(?:\s(?!type\s*=)[^>]*|\s*>)/i.test(html)) {
    issues.push({
      type: 'input-no-type',
      message: 'عناصر input بدون type.',
      fix: function(h) {
        // Only insert type="text" when the input tag has no type= attribute
        return h.replace(/<input(\s(?!type\s*=)[^>]*|>)/gi, function(full, rest) {
          return '<input type="text"' + rest;
        });
      }
    });
  }

  // @import over http (warning only)
  if (/@import\s+(?:url\(["']?)?http:/.test(html))
    issues.push({ type: 'css-import-http', message: 'يوجد @import برابط http.', fix: null });

  // <script src="http:..."> (warning only)
  if (/<script[^>]+src\s*=\s*["']http:/.test(html))
    issues.push({ type: 'script-src-http', message: 'سكريبت خارجي برابط http.', fix: null });

  // JavaScript bracket balance (warnings only)
  var scriptBlocks = html.match(/<script[^>]*>([\s\S]*?)<\/script>/gi) || [];
  var jsCode = scriptBlocks.join('');
  function countOccurrences(str, ch) { return str.split(ch).length - 1; }
  if (countOccurrences(jsCode, '{') !== countOccurrences(jsCode, '}'))
    issues.push({ type: 'js-brace-mismatch',   message: 'الأقواس { } غير متطابقة في JavaScript.', fix: null });
  if (countOccurrences(jsCode, '[') !== countOccurrences(jsCode, ']'))
    issues.push({ type: 'js-bracket-mismatch', message: 'الأقواس [ ] غير متطابقة في JavaScript.', fix: null });
  if (countOccurrences(jsCode, '(') !== countOccurrences(jsCode, ')'))
    issues.push({ type: 'js-paren-mismatch',   message: 'الأقواس ( ) غير متطابقة في JavaScript.', fix: null });

  // Security warnings
  if (/\beval\s*\(/.test(html))
    issues.push({ type: 'eval',       message: 'استخدام eval() خطر أمنياً.', fix: null });
  if (/\.innerHTML\s*=/.test(html))
    issues.push({ type: 'innerHTML',  message: 'استخدام innerHTML قد يسبب XSS.', fix: null });

  return issues;
}

/* ── Render Issue Modal ───────────────────────────── */
function renderIssueModal(issues) {
  var hasFixable = issues.some(function(iss) { return !!iss.fix; });

  if (!issues.length) {
    issueBody.innerHTML = '<div class="issue-empty">✅ لا توجد مشاكل، الكود جاهز للمعاينة.</div>';
    issueFixAll.style.display = 'none';
    issuePreviewRaw.style.display = 'none';
    setTimeout(function() {
      issueOverlay.classList.remove('show');
      openPreviewWithContent(previewContentCache);
    }, 400);
    return;
  }

  var html = '';
  for (var i = 0; i < issues.length; i++) {
    var iss = issues[i];
    html += '<div class="issue-item">';
    html += '<span class="issue-icon">⚠️</span>';
    html += '<span class="issue-text">' + iss.message + '</span>';
    if (iss.fix) {
      html += '<button class="issue-fix-btn" data-issue-idx="' + i + '">إصلاح</button>';
    } else {
      html += '<span style="color: var(--fg3); font-size:11px;">يدوي</span>';
    }
    html += '</div>';
  }
  issueBody.innerHTML = html;
  issueFixAll.style.display = hasFixable ? 'inline-block' : 'none';
  issuePreviewRaw.style.display = 'inline-block';

  // Individual fix buttons — apply only that one fix, then re-detect (no phases 1/2)
  issueBody.querySelectorAll('.issue-fix-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(this.getAttribute('data-issue-idx'), 10);
      var issue = detectedIssues[idx];
      if (!issue || !issue.fix) return;
      previewContentCache = issue.fix(previewContentCache);
      detectedIssues = detectRemainingIssues(previewContentCache);
      renderIssueModal(detectedIssues);
    });
  });
}

/* ── Preview helpers ─────────────────────────────── */
function openPreviewWithContent(content) {
  previewFrame.srcdoc = content;
  previewOverlay.classList.add('show');
}

function closePreviewFn() {
  previewOverlay.classList.remove('show');
  previewFrame.srcdoc = '';
}

closePreviewBtn.addEventListener('click', function(e) {
  e.stopPropagation();
  closePreviewFn();
});
closePreviewBtn.addEventListener('touchend', function(e) {
  e.preventDefault();
  e.stopPropagation();
  closePreviewFn();
});

previewOverlay.addEventListener('click', function(e) {
  if (e.target === previewOverlay) closePreviewFn();
});

/* ── Play button: runs the full 3-phase pipeline once ── */
function handlePlayClick() {
  var combined  = buildMultiFilePreview();
  var assembled = assembleFullPage(combined);   // Phase 1 — silent
  var fixed     = applySilentFixes(assembled);  // Phase 2 — silent
  previewContentCache = fixed;
  detectedIssues = detectRemainingIssues(fixed); // Phase 3 — user-visible
  if (detectedIssues.length === 0) {
    openPreviewWithContent(fixed);
  } else {
    renderIssueModal(detectedIssues);
    issueOverlay.classList.add('show');
  }
}
playBtn.addEventListener('click', handlePlayClick);

issueCloseBtn.addEventListener('click', function() {
  issueOverlay.classList.remove('show');
});

issuePreviewRaw.addEventListener('click', function() {
  issueOverlay.classList.remove('show');
  openPreviewWithContent(previewContentCache);
});

// Fix All: apply every fixable issue in one pass, then re-detect once (phases 1/2 never re-run)
issueFixAll.addEventListener('click', function() {
  var snapshot = previewContentCache;
  for (var i = 0; i < detectedIssues.length; i++) {
    if (detectedIssues[i].fix) {
      snapshot = detectedIssues[i].fix(snapshot);
    }
  }
  previewContentCache = snapshot;
  detectedIssues = detectRemainingIssues(previewContentCache);
  if (detectedIssues.length === 0) {
    issueOverlay.classList.remove('show');
    openPreviewWithContent(previewContentCache);
  } else {
    renderIssueModal(detectedIssues);
  }
});

issueOverlay.addEventListener('click', function(e) {
  if (e.target === issueOverlay) issueOverlay.classList.remove('show');
});

/* ═══════════ ESCAPE KEY HANDLING ═══════════ */
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(issueOverlay.classList.contains('show')){
      issueOverlay.classList.remove('show');
      return;
    }
    if(savesPanel.classList.contains('show')){
      savesPanel.classList.remove('show');
      return;
    }
    if(previewOverlay.classList.contains('show')){
      closePreviewFn();
      return;
    }
    if(editingTabId !== null){
      cancelRename();
      return;
    }
    closeDropdown();
  }
});

/* ═══════════ RENDER EDITOR ═══════════ */
function renderEditor(){
  var f = getFile();
  codeArea.value = f.content;
  renderHL(f.content);
  renderLineNums(f.content);
  updateBtns();
  lastCommit = f.content;
}

/* ═══════════ INIT ═══════════ */
renderTabs();
renderEditor();

})();
