(function(){
'use strict';

/* ═══════════ MIGRATION (unchanged) ═══════════ */
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

/* ═══════════ HIGHLIGHTER (unchanged) ═══════════ */
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

/* ═══════════ STATE (unchanged) ═══════════ */
var files=[{id:1,name:'index.html',content:''}];
var activeId=1,nextId=2;
var undoSt={1:[]},redoSt={1:[]};
var lastCommit='';
var undoTimer=null;
var editingTabId = null;

function getFile(){for(var k=0;k<files.length;k++)if(files[k].id===activeId)return files[k];return files[0];}
function findFileByName(name){for(var i=0;i<files.length;i++){if(files[i].name===name)return files[i];}return null;}

/* ═══════════ DOM ELEMENTS ═══════════ */
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

/* ═══════════ TOAST (unchanged) ═══════════ */
var toastTimer=null;
function showToast(msg){
  toastEl.textContent=msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(function(){toastEl.classList.remove('show');},3000);
}

/* ═══════════ RENDER (unchanged) ═══════════ */
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

/* ═══════════ TABS (improved switchTab & closeTab) ═══════════ */
function switchTab(id){
  commitUndo();
  activeId=id;
  editingTabId = null;
  renderTabs();
  renderEditor();
  closeDropdown();
  copyTip.classList.remove('show');
  // IMPROVED: trigger real-time validation for newly active file after debounce
  scheduleRealTimeValidation();
}

function closeTab(id){
  if(files.length===1)return;
  if(editingTabId === id) editingTabId = null;
  files=files.filter(function(f){return f.id!==id;});
  delete undoSt[id];delete redoSt[id];
  if(activeId===id)activeId=files[files.length-1].id;
  renderTabs();renderEditor();
  // IMPROVED: update diagnostics after closing tab
  scheduleRealTimeValidation();
  // FIXED: Invalidate analysis cache because file list changed
  _analysisCache = {};
}

/* ═══════════ INLINE RENAME (updated) ═══════════ */
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
  // FIXED: Invalidate cache because filename may affect diagnostics
  _analysisCache = {};
}
function cancelRename(){
  editingTabId = null;
  renderTabs();
}

/* ═══════════ UNDO / REDO (unchanged) ═══════════ */
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

/* ═══════════ TEXTAREA EVENTS (with real-time validation) ═══════════ */
codeArea.addEventListener('input',function(){
  var val=codeArea.value;
  for(var k=0;k<files.length;k++)if(files[k].id===activeId){files[k].content=val;break;}
  renderHL(val);renderLineNums(val);
  clearTimeout(undoTimer);
  var snap=lastCommit;
  undoTimer=setTimeout(function(){
    if(val!==snap){pushUndo(snap);lastCommit=val;updateBtns();}
  },600);
  // IMPROVED: trigger real-time validation for current file
  scheduleRealTimeValidation();
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

/* ═══════════ TOOLBAR BUTTONS (unchanged) ═══════════ */
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

/* ═══════════ DROPDOWN (unchanged) ═══════════ */
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

/* ═══════════ PROJECT SAVE (unchanged) ═══════════ */
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

/* ═══════════ SAVED FILES PANEL (updated) ═══════════ */
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
          // FIXED: Clear analysis cache after loading project/file
          _analysisCache = {};
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

/* ═══════════ DELETE / RENAME / ADD FILE (updated) ═══════════ */
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
  // FIXED: Invalidate cache because file list changed
  _analysisCache = {};
});

/* ═══════════ CLOSE PREVIEW FUNCTION (unchanged) ═══════════ */
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

/* ═══════════ MULTI-FILE COMBINER (unchanged) ═══════════ */
function buildMultiFilePreviewWithFixes(fixedContents) {
  var activeFile = getFile();
  var baseFile = null;
  if (/\.html$/i.test(activeFile.name)) { baseFile = activeFile; }
  else {
    for (var i = 0; i < files.length; i++) {
      if (/\.html$/i.test(files[i].name)) { baseFile = files[i]; break; }
    }
  }
  if (!baseFile) {
    var rawContent = fixedContents && fixedContents[activeFile.id] !== undefined ? fixedContents[activeFile.id] : activeFile.content;
    return rawContent;
  }

  var baseContent = fixedContents && fixedContents[baseFile.id] !== undefined ? fixedContents[baseFile.id] : baseFile.content;
  var cssTags = '', jsTags = '';
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (f.id === baseFile.id) continue;
    var content = fixedContents && fixedContents[f.id] !== undefined ? fixedContents[f.id] : f.content;
    var nameLower = f.name.toLowerCase();
    if (nameLower.endsWith('.css')) { cssTags += '\n<style>\n' + content + '\n</style>\n'; }
    else if (nameLower.endsWith('.js')) { jsTags += '\n<script>\n' + content + '\n<\/script>\n'; }
  }

  var result = baseContent;
  if (cssTags) result = result.replace(/<\/head>/i, cssTags + '</head>');
  if (jsTags) result = result.replace(/<\/body>/i, jsTags + '</body>');
  return result;
}

/* ═══════════ DIAGNOSTIC SYSTEM ═══════════ */
var Diagnostic = (function(){
  var counter = 0;
  function getId(prefix, fileId, line, col) {
    counter++;
    return prefix + '-' + String(counter).padStart(4,'0') + ':' + fileId + ':' + line + ':' + col;
  }
  function Diagnostic(severity, code, message, source, fileId, fileName, startLine, startCol, endLine, endCol, fix) {
    this.id = getId(code, fileId, startLine||1, startCol||1);
    this.severity = severity;
    this.code = code;
    this.message = message;
    this.source = source;
    this.fileId = fileId;
    this.fileName = fileName;
    this.range = {
      startLine: startLine || 1,
      startColumn: startCol || 1,
      endLine: endLine || (startLine || 1),
      endColumn: endCol || (startCol || 1)
    };
    this.fix = fix || null;
    if (this.fix && !this.fix.mode) {
      if (this.fix.type === 'prepend') this.fix.mode = 'auto';
      else this.fix.mode = 'quick';
    }
  }
  return Diagnostic;
})();

function getLineCol(text, offset) {
  if (offset < 0 || offset > text.length) return {line:1, col:1};
  var lines = text.substr(0, offset).split('\n');
  var line = lines.length;
  var col = lines[lines.length-1].length + 1;
  return {line: line, col: col};
}

/* ═══════════ EXTRACTORS (IMPROVED & SIMPLIFIED) ═══════════ */
var Extractors = {
  // FIXED: Completely rewritten tag range finder for robustness and performance.
  // Uses simple indexOf on lowercased code to locate <style> and <script> tags,
  // correctly handling nesting and multiple occurrences.
  html: function(code, fileId, fileName) {
    var doc;
    try {
      doc = (new DOMParser()).parseFromString(code, 'text/html');
    } catch(e) {
      return { doc: null, styles: [], scripts: [] };
    }

    var styles = [];
    var scripts = [];

    function findTagRanges(tagName) {
      var results = [];
      var codeLower = code.toLowerCase();
      var openTag = '<' + tagName.toLowerCase();
      var closeTag = '</' + tagName.toLowerCase() + '>';
      var i = 0;

      while (i < codeLower.length) {
        var openIdx = codeLower.indexOf(openTag, i);
        if (openIdx === -1) break;

        // Find end of opening tag (next '>')
        var tagEnd = codeLower.indexOf('>', openIdx);
        if (tagEnd === -1) break;

        // Extract attributes string from original case
        var attrs = code.substring(openIdx + openTag.length, tagEnd).trim();

        // Now match closing tag, handling nesting
        var depth = 1;
        var searchPos = tagEnd + 1;
        var contentStart = tagEnd + 1;
        var foundClose = false;

        while (depth > 0) {
          var nextOpenIdx = codeLower.indexOf(openTag, searchPos);
          var closeIdx = codeLower.indexOf(closeTag, searchPos);
          if (closeIdx === -1) break;

          if (nextOpenIdx !== -1 && nextOpenIdx < closeIdx) {
            // nested opening tag
            depth++;
            var nestedTagEnd = codeLower.indexOf('>', nextOpenIdx);
            if (nestedTagEnd === -1) break;
            searchPos = nestedTagEnd + 1;
          } else {
            depth--;
            if (depth === 0) {
              var content = code.substring(contentStart, closeIdx);
              results.push({
                start: openIdx,
                end: closeIdx + closeTag.length,
                content: content,
                attrs: attrs
              });
              i = closeIdx + closeTag.length;
              foundClose = true;
            } else {
              searchPos = closeIdx + closeTag.length;
            }
          }
        }
        if (!foundClose) {
          i = tagEnd + 1; // skip malformed tag to avoid infinite loop
        }
      }
      return results;
    }

    var styleRanges = findTagRanges('style');
    styleRanges.forEach(function(r) {
      var rangeStart = getLineCol(code, r.start);
      var rangeEnd = getLineCol(code, r.end);
      styles.push({
        type: 'style',
        content: r.content,
        range: { startLine: rangeStart.line, startCol: rangeStart.col, endLine: rangeEnd.line, endCol: rangeEnd.col }
      });
    });

    var scriptRanges = findTagRanges('script');
    scriptRanges.forEach(function(r) {
      var isModule = /type\s*=\s*["']module["']/i.test(r.attrs);
      var rangeStart = getLineCol(code, r.start);
      var rangeEnd = getLineCol(code, r.end);
      scripts.push({
        type: isModule ? 'module' : 'script',
        content: r.content,
        range: { startLine: rangeStart.line, startCol: rangeStart.col, endLine: rangeEnd.line, endCol: rangeEnd.col }
      });
    });

    return { doc: doc, styles: styles, scripts: scripts };
  }
};

/* ═══════════ VALIDATORS (Rules) (unchanged except comments) ═══════════ */
var rules = [];

function registerRule(rule) {
  rules.push(rule);
}

function addDiagnostic(diag) {
  if (!window.__currentDiagnostics) window.__currentDiagnostics = [];
  window.__currentDiagnostics.push(diag);
}

// Rule: HTML Structure
registerRule({
  id: 'HTML-STRUCTURE',
  validate: function(file, code, extracted) {
    var diags = [];
    var doc = extracted.doc;
    if (!doc) return diags;
    var fileName = file.name;
    var fileId = file.id;

    if (!doc.doctype) {
      diags.push(new Diagnostic('warning', 'HTML-0001', 'Missing DOCTYPE declaration.', 'html-structure', fileId, fileName, 1, 1, 1, 1,
        { type: 'prepend', value: '<!DOCTYPE html>\n', mode: 'auto' }
      ));
    }
    if (!doc.documentElement.hasAttribute('lang')) {
      diags.push(new Diagnostic('warning', 'HTML-0002', 'Missing lang attribute on <html>.', 'html-structure', fileId, fileName, 1, 1, 1, 1, null));
    }
    var head = doc.head;
    if (!head || !head.querySelector('meta[charset]')) {
      diags.push(new Diagnostic('warning', 'HTML-0003', 'Missing <meta charset="UTF-8">.', 'html-structure', fileId, fileName, 1, 1, 1, 1, null));
    }
    if (!head || !head.querySelector('meta[name="viewport"]')) {
      diags.push(new Diagnostic('warning', 'HTML-0004', 'Missing viewport meta tag.', 'html-structure', fileId, fileName, 1, 1, 1, 1, null));
    }
    if (!head || !head.querySelector('title')) {
      diags.push(new Diagnostic('warning', 'HTML-0005', 'Missing <title> in <head>.', 'html-structure', fileId, fileName, 1, 1, 1, 1, null));
    }
    return diags;
  }
});

// Rule: Obsolete tags
registerRule({
  id: 'OBSOLETE-TAGS',
  validate: function(file, code, extracted) {
    var diags = [];
    var doc = extracted.doc;
    if (!doc) return diags;
    var fileName = file.name, fileId = file.id;
    var obsoleteSelectors = ['center', 'font', 'marquee'];
    obsoleteSelectors.forEach(function(tag) {
      var elements = doc.querySelectorAll(tag);
      elements.forEach(function(el) {
        var html = el.outerHTML;
        var idx = code.indexOf(html);
        var lineCol = idx >= 0 ? getLineCol(code, idx) : {line:1, col:1};
        diags.push(new Diagnostic('warning', 'HTML-0010', 'Obsolete tag <'+tag+'> used.', 'html-obsolete', fileId, fileName, lineCol.line, lineCol.col, lineCol.line, lineCol.col + html.length, null));
      });
    });
    return diags;
  }
});

// Rule: Missing alt
registerRule({
  id: 'IMG-ALT',
  validate: function(file, code, extracted) {
    var diags = [];
    var doc = extracted.doc;
    if (!doc) return diags;
    var fileName = file.name, fileId = file.id;
    var imgs = doc.querySelectorAll('img:not([alt])');
    imgs.forEach(function(img) {
      var html = img.outerHTML;
      var idx = code.indexOf(html);
      var lineCol = idx >= 0 ? getLineCol(code, idx) : {line:1, col:1};
      diags.push(new Diagnostic('warning', 'HTML-0011', 'Image missing alt attribute.', 'html-accessibility', fileId, fileName, lineCol.line, lineCol.col, lineCol.line, lineCol.col + html.length, null));
    });
    return diags;
  }
});

// Rule: document.write
registerRule({
  id: 'DOC-WRITE',
  validate: function(file, code, extracted) {
    var diags = [];
    var fileName = file.name, fileId = file.id;
    var segments = [];
    if (extracted.doc) {
      extracted.scripts.forEach(function(s) { segments.push({code: s.content, startLine: s.range.startLine, startCol: s.range.startColumn}); });
    } else if (/\.js$/i.test(fileName)) {
      segments.push({code: code, startLine:1, startCol:1});
    }
    segments.forEach(function(seg) {
      var lines = seg.code.split('\n');
      for (var i=0; i<lines.length; i++) {
        if (lines[i].includes('document.write')) {
          var line = seg.startLine + i;
          var col = lines[i].indexOf('document.write') + 1;
          diags.push(new Diagnostic('warning', 'JS-0001', 'Avoid using document.write().', 'js-best-practice', fileId, fileName, line, col, line, col + 'document.write'.length, null));
        }
      }
    });
    return diags;
  }
});

// Rule: CSS Syntax
registerRule({
  id: 'CSS-SYNTAX',
  validate: function(file, code, extracted) {
    var diags = [];
    var fileName = file.name, fileId = file.id;
    var segments = [];
    if (extracted.doc) {
      extracted.styles.forEach(function(s) { segments.push({code: s.content, startLine: s.range.startLine, startCol: s.range.startColumn}); });
    } else if (/\.css$/i.test(fileName)) {
      segments.push({code: code, startLine:1, startCol:1});
    }
    segments.forEach(function(seg) {
      try {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(seg.code);
      } catch(e) {
        var line = seg.startLine, col = seg.startCol;
        var m = e.message.match(/\((\d+):(\d+)\)/);
        if (m) { line = seg.startLine + parseInt(m[1],10)-1; col = seg.startCol + parseInt(m[2],10)-1; }
        diags.push(new Diagnostic('error', 'CSS-0001', 'CSS syntax error: ' + e.message, 'css-syntax', fileId, fileName, line, col, line, col, null));
      }
    });
    return diags;
  }
});

// Rule: JS Syntax
registerRule({
  id: 'JS-SYNTAX',
  validate: function(file, code, extracted) {
    var diags = [];
    var fileName = file.name, fileId = file.id;
    var segments = [];
    if (extracted.doc) {
      extracted.scripts.forEach(function(s) { segments.push({code: s.content, type: s.type, startLine: s.range.startLine, startCol: s.range.startColumn}); });
    } else if (/\.js$/i.test(fileName)) {
      segments.push({code: code, type: 'script', startLine:1, startCol:1});
    }
    segments.forEach(function(seg) {
      var jsCode = seg.code.trim();
      if (!jsCode) return;
      var isModule = seg.type === 'module';
      var testCode = jsCode;
      if (isModule) {
        testCode = jsCode.replace(/^(import|export)\s/gm, '//$&');
      }
      try {
        new Function('"use strict";\n' + testCode);
      } catch(e) {
        var line = seg.startLine, col = seg.startCol;
        if (e.lineNumber) line = seg.startLine + e.lineNumber - 1;
        else if (e.line) line = seg.startLine + e.line - 1;
        diags.push(new Diagnostic('error', 'JS-0002', 'JavaScript syntax error: ' + e.message, 'js-syntax', fileId, fileName, line, col, line, col, null));
      }
    });
    return diags;
  }
});

// Rule: Self-closing block tags (quick fix)
registerRule({
  id: 'SELF-CLOSING-BLOCK',
  validate: function(file, code, extracted) {
    var diags = [];
    var fileName = file.name, fileId = file.id;
    if (!extracted.doc) return diags;
    var pattern = /<(div|span|p|section|article|nav|header|footer|main|aside)(\s[^>]*)?\/\s*>/gi;
    var match;
    while ((match = pattern.exec(code)) !== null) {
      var full = match[0];
      var tag = match[1];
      var idx = match.index;
      var lineCol = getLineCol(code, idx);
      var replacement = '<' + tag + (match[2] || '') + '></' + tag + '>';
      diags.push(new Diagnostic('warning', 'HTML-0020', 'Self-closing block tag <'+tag+'/> is invalid.', 'html-validity', fileId, fileName, lineCol.line, lineCol.col, lineCol.line, lineCol.col + full.length,
        { type: 'replace', start: idx, end: idx + full.length, replacement: replacement, mode: 'quick' }
      ));
    }
    return diags;
  }
});

// Rule: Markdown fences (warning only)
registerRule({
  id: 'MARKDOWN-FENCES',
  validate: function(file, code, extracted) {
    var diags = [];
    var fileName = file.name, fileId = file.id;
    if (!code.includes('```')) return diags;
    var lines = code.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (/^\s*```/.test(lines[i])) {
        diags.push(new Diagnostic('warning', 'GEN-0001', 'Markdown code fences detected. Remove them for clean code.', 'markdown', fileId, fileName, i+1, 1, i+1, lines[i].length+1, null));
        break;
      }
    }
    return diags;
  }
});

/* ═══════════ FIX REGISTRY (unchanged) ═══════════ */
var FixRegistry = {
  applyFixes: function(code, diagnostics, modeFilter) {
    var fixes = diagnostics.filter(function(d) {
      return d.fix && (modeFilter === null || d.fix.mode === modeFilter);
    }).sort(function(a,b) {
      var aStart = a.fix.start !== undefined ? a.fix.start : 0;
      var bStart = b.fix.start !== undefined ? b.fix.start : 0;
      return bStart - aStart;
    });
    var newCode = code;
    fixes.forEach(function(d) {
      if (d.fix.type === 'replace' && d.fix.start !== undefined) {
        newCode = newCode.substring(0, d.fix.start) + d.fix.replacement + newCode.substring(d.fix.end);
      } else if (d.fix.type === 'prepend') {
        newCode = d.fix.value + newCode;
      }
    });
    return newCode;
  }
};

/* ═══════════ REAL-TIME VALIDATION (IMPROVED with cache & invalidation) ═══════════ */
var lastDiagnostics = [];
var applySafeFixesBeforePreview = false;
var currentFilter = 'all';

// FIXED: Cache for per-file analysis to avoid unnecessary re-validation.
var _analysisCache = {};

// Analyze a single file and return its diagnostics
function analyzeSingleFile(file) {
  var code = file.content;
  var fileName = file.name;
  var fileId = file.id;
  var extracted = { doc: null, styles: [], scripts: [] };
  if (/\.html$/i.test(fileName)) {
    extracted = Extractors.html(code, fileId, fileName);
  }
  var fileDiags = [];
  rules.forEach(function(rule) {
    var res = rule.validate(file, code, extracted);
    if (res && res.length) fileDiags = fileDiags.concat(res);
  });
  return fileDiags;
}

// IMPROVED: Debounced validation (800ms) with cache check.
var realTimeValidationTimer = null;
function scheduleRealTimeValidation() {
  clearTimeout(realTimeValidationTimer);
  realTimeValidationTimer = setTimeout(function() {
    var file = getFile();
    if (!file) return;
    var cacheEntry = _analysisCache[file.id];
    // Skip if content unchanged since last analysis
    if (cacheEntry && cacheEntry.content === file.content) {
      return;
    }
    var diags = analyzeSingleFile(file);
    _analysisCache[file.id] = { content: file.content, diagnostics: diags };
    // Replace diagnostics for this file in global list
    lastDiagnostics = lastDiagnostics.filter(function(d) { return d.fileId !== file.id; });
    lastDiagnostics = lastDiagnostics.concat(diags);
    if (issueOverlay && issueOverlay.classList.contains('show')) {
      renderProblemsPanel(currentFilter);
    }
    updateProblemsBadge();
  }, 800);
}

/* ═══════════ PROBLEMS BADGE & PANEL (enhanced) ═══════════ */
function updateProblemsBadge() {
  if (!problemsBtn) return;
  var errCount = lastDiagnostics.filter(function(d) { return d.severity === 'error'; }).length;
  var warnCount = lastDiagnostics.filter(function(d) { return d.severity === 'warning'; }).length;
  var infoCount = lastDiagnostics.filter(function(d) { return d.severity === 'info'; }).length;
  var total = errCount + warnCount + infoCount;
  if (total > 0) {
    var parts = [];
    if (errCount) parts.push(errCount + '⛔');
    if (warnCount) parts.push(warnCount + '⚠️');
    if (infoCount) parts.push(infoCount + 'ℹ️');
    problemsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg> ' + parts.join(' ');
  } else {
    problemsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';
  }
}

// Problems button creation & insertion
var problemsBtn = document.getElementById('problemsBtn');
if (!problemsBtn) {
  problemsBtn = document.createElement('button');
  problemsBtn.id = 'problemsBtn';
  problemsBtn.title = 'Problems';
  problemsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';
  problemsBtn.style.cssText = 'background:none; border:none; color:var(--fg); cursor:pointer; padding:6px;';
  if (playBtn && playBtn.parentNode) {
    playBtn.parentNode.insertBefore(problemsBtn, playBtn.nextSibling);
  }
}

// Safe Fix Toggle Button
var safeFixBtn = document.createElement('button');
safeFixBtn.id = 'safeFixBtn';
safeFixBtn.title = 'Apply Safe Fixes Before Preview';
safeFixBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 6L9 17l-5-5"/></svg>';
safeFixBtn.style.cssText = 'background:none; border:none; color:var(--dim); cursor:pointer; padding:6px;';
safeFixBtn.addEventListener('click', function() {
  applySafeFixesBeforePreview = !applySafeFixesBeforePreview;
  safeFixBtn.style.color = applySafeFixesBeforePreview ? 'var(--fg)' : 'var(--dim)';
  showToast(applySafeFixesBeforePreview ? 'Safe fixes will be applied on preview' : 'No automatic fixes');
});
if (problemsBtn && problemsBtn.parentNode) {
  problemsBtn.parentNode.insertBefore(safeFixBtn, problemsBtn);
}

// Problems overlay and its inner elements
var issueOverlay = document.getElementById('issueOverlay');
if (issueOverlay) {
  issueOverlay.innerHTML = '<div class="saves-panel-inner" style="max-width:700px;">'
    +'<div class="saves-header"><h3>Problems</h3><button id="fixAllAutoBtn" style="margin-right:8px;font-size:12px;background:var(--accent);border:none;color:white;padding:4px 12px;border-radius:4px;cursor:pointer;">Fix All Auto</button><button id="issueClose" class="saves-close">&times;</button></div>'
    +'<div id="issueFilter" style="display:flex;gap:8px;padding:8px;border-bottom:1px solid var(--border);">'
      +'<button class="filter-btn active" data-filter="all">All</button>'
      +'<button class="filter-btn" data-filter="error">Errors</button>'
      +'<button class="filter-btn" data-filter="warning">Warnings</button>'
      +'<button class="filter-btn" data-filter="info">Info</button>'
    +'</div>'
    +'<div id="issuesList" style="max-height:60vh;overflow-y:auto;padding:10px;"></div>'
    +'</div>';
  var issueClose = document.getElementById('issueClose');
  issueClose.addEventListener('click', function() { issueOverlay.classList.remove('show'); });
  issueOverlay.addEventListener('click', function(e) { if (e.target === issueOverlay) issueOverlay.classList.remove('show'); });

  // FIXED: "Fix All Auto" now refreshes tabs/editor if active file changed, and clears cache for affected files.
  document.getElementById('fixAllAutoBtn').addEventListener('click', function() {
    var diagsToFix = lastDiagnostics.filter(function(d) { return d.fix && d.fix.mode === 'auto'; });
    if (diagsToFix.length === 0) {
      showToast('No auto-fixable issues.');
      return;
    }
    var filesMap = {};
    files.forEach(function(f) { filesMap[f.id] = f; });
    var changedActive = false;
    diagsToFix.forEach(function(d) {
      var file = filesMap[d.fileId];
      if (!file) return;
      if (file.id === activeId) {
        commitUndo();
        changedActive = true;
      }
      file.content = FixRegistry.applyFixes(file.content, [d], 'auto');
      delete _analysisCache[file.id];
    });
    // Update UI if active file was modified
    if (changedActive) {
      var activeFile = getFile();
      applyContent(activeFile.content);
      lastCommit = activeFile.content;
      renderTabs();   // FIXED: ensure tabs reflect any potential name changes (though not needed here, for consistency)
      renderEditor(); // FIXED: explicitly refresh editor after fixes
      scheduleRealTimeValidation();
    }
    analyzeAllFiles(false); // refresh diagnostics
    if (issueOverlay.classList.contains('show')) renderProblemsPanel(currentFilter);
    updateProblemsBadge();
    showToast('Auto fixes applied.');
  });

  // Filter buttons
  var filterBtns = document.querySelectorAll('#issueFilter .filter-btn');
  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter');
      renderProblemsPanel(currentFilter);
    });
  });

  // Navigation helper
  var editorLineHeight = 0;
  function getEditorLineHeight() {
    if (!editorLineHeight) {
      editorLineHeight = parseInt(getComputedStyle(codeArea).lineHeight, 10) || 20;
    }
    return editorLineHeight;
  }

  function goToLocation(fileId, line, col) {
    var file = null;
    for (var i = 0; i < files.length; i++) {
      if (files[i].id === fileId) { file = files[i]; break; }
    }
    if (!file) return;
    if (activeId !== fileId) {
      switchTab(fileId);
    }
    codeArea.focus();
    var text = codeArea.value;
    var lines = text.split('\n');
    var pos = 0;
    for (var i = 0; i < line - 1 && i < lines.length; i++) {
      pos += lines[i].length + 1;
    }
    var targetLine = lines[line - 1] || '';
    var colClamped = Math.min(col - 1, targetLine.length);
    pos += colClamped;
    codeArea.setSelectionRange(pos, pos);
    var lh = getEditorLineHeight();
    codeArea.scrollTop = (line - 1) * lh - codeArea.clientHeight / 3;
  }
}

// FIXED: Debounce opening of problems panel to avoid re-rendering jank
var panelOpenTimer = null;
function showProblemsPanel() {
  if (!issueOverlay) return;
  // If panel already open, just refresh immediately
  if (issueOverlay.classList.contains('show')) {
    renderProblemsPanel(currentFilter);
    return;
  }
  // Debounce initial rendering
  clearTimeout(panelOpenTimer);
  panelOpenTimer = setTimeout(function() {
    issueOverlay.classList.add('show');
    renderProblemsPanel(currentFilter);
  }, 300);
}
// Click handler for problems button
problemsBtn.addEventListener('click', function() {
  if (issueOverlay.classList.contains('show')) {
    issueOverlay.classList.remove('show');
  } else {
    showProblemsPanel();
  }
});

// Renders the problems list inside the panel
function renderProblemsPanel(filter) {
  var list = document.getElementById('issuesList');
  if (!list) return;
  filter = filter || 'all';
  var filtered = lastDiagnostics.filter(function(d) {
    if (filter === 'all') return true;
    return d.severity === filter;
  });
  if (filtered.length === 0) {
    list.innerHTML = '<div style="color:var(--dim);text-align:center;padding:20px;">No problems match filter.</div>';
    return;
  }
  var html = '';
  filtered.forEach(function(d) {
    var icon = d.severity === 'error' ? '🔴' : (d.severity === 'warning' ? '🟡' : '🔵');
    var codeDisplay = esc(d.code);
    var msgDisplay = esc(d.message);
    var fileLineCol = esc(d.fileName) + ':' + d.range.startLine + ':' + d.range.startColumn;
    var quickFixBtn = '';
    if (d.fix && d.fix.mode === 'quick') {
      quickFixBtn = '<button class="quick-fix-btn" data-id="'+d.id+'" style="margin-left:8px;font-size:11px;background:var(--accent);border:none;color:white;padding:2px 8px;border-radius:3px;cursor:pointer;">Fix</button>';
    }
    html += '<div class="problem-item" data-fileid="'+d.fileId+'" data-line="'+d.range.startLine+'" data-col="'+d.range.startColumn+'" style="display:flex;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);cursor:pointer;">'
      +'<span style="margin-right:8px;font-size:14px;">'+icon+'</span>'
      +'<div style="flex:1;"><div style="font-weight:600;">'+codeDisplay+'</div>'
      +'<div>'+msgDisplay+'</div>'
      +'<div style="font-size:12px;color:var(--dim);">'+fileLineCol+'</div></div>'
      + quickFixBtn
      +'</div>';
  });
  list.innerHTML = html;

  list.querySelectorAll('.problem-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (e.target.classList.contains('quick-fix-btn')) return;
      var fileId = parseInt(item.getAttribute('data-fileid'), 10);
      var line = parseInt(item.getAttribute('data-line'), 10);
      var col = parseInt(item.getAttribute('data-col'), 10);
      goToLocation(fileId, line, col);
    });
  });

  list.querySelectorAll('.quick-fix-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var diagId = btn.getAttribute('data-id');
      var diag = lastDiagnostics.find(function(d) { return d.id === diagId; });
      if (!diag || !diag.fix) return;
      var file = files.find(function(f) { return f.id === diag.fileId; });
      if (!file) return;
      if (activeId === file.id) {
        commitUndo();
      }
      var code = file.content;
      var newCode = FixRegistry.applyFixes(code, [diag], diag.fix.mode);
      file.content = newCode;
      if (activeId === file.id) {
        applyContent(newCode);
        lastCommit = newCode;
      }
      delete _analysisCache[file.id];
      lastDiagnostics = lastDiagnostics.filter(function(d) { return d.id !== diagId; });
      renderProblemsPanel(currentFilter || 'all');
      updateProblemsBadge();
      showToast('Fix applied');
    });
  });
}

/* ═══════════ FULL ANALYSIS (unchanged) ═══════════ */
function analyzeAllFiles(applyAutoFixes) {
  var allDiags = [];
  var fixedContents = {};

  files.forEach(function(file) {
    var fileDiags = analyzeSingleFile(file);
    allDiags = allDiags.concat(fileDiags);

    if (applyAutoFixes) {
      var fixedCode = FixRegistry.applyFixes(file.content, fileDiags, 'auto');
      fixedContents[file.id] = fixedCode;
    } else {
      fixedContents[file.id] = file.content;
    }
  });

  lastDiagnostics = allDiags;
  return { diagnostics: allDiags, fixedContents: fixedContents };
}

/* ═══════════ PLAY BUTTON (unchanged) ═══════════ */
function handlePlayClick() {
  var result = analyzeAllFiles(applySafeFixesBeforePreview);
  var combinedCode = buildMultiFilePreviewWithFixes(result.fixedContents);
  
  var errCount = result.diagnostics.filter(function(d) { return d.severity === 'error'; }).length;
  var warnCount = result.diagnostics.filter(function(d) { return d.severity === 'warning'; }).length;
  var infoCount = result.diagnostics.filter(function(d) { return d.severity === 'info'; }).length;
  
  var msgParts = [];
  if (errCount) msgParts.push(errCount + ' error(s)');
  if (warnCount) msgParts.push(warnCount + ' warning(s)');
  if (infoCount) msgParts.push(infoCount + ' info');
  var toastMsg = msgParts.length ? '📋 ' + msgParts.join(', ') : '✅ No issues found.';
  showToast(toastMsg);
  
  if (issueOverlay && issueOverlay.classList.contains('show')) {
    renderProblemsPanel(currentFilter || 'all');
  }
  updateProblemsBadge();
  
  previewFrame.srcdoc = combinedCode;
  previewOverlay.classList.add('show');
}

playBtn.addEventListener('click', handlePlayClick);

/* ═══════════ ESCAPE KEY (unchanged) ═══════════ */
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(savesPanel.classList.contains('show')){
      savesPanel.classList.remove('show');
      return;
    }
    if(previewOverlay.classList.contains('show')){
      closePreviewFn();
      return;
    }
    if(issueOverlay && issueOverlay.classList.contains('show')){
      issueOverlay.classList.remove('show');
      return;
    }
    if(editingTabId !== null){
      cancelRename();
      return;
    }
    closeDropdown();
  }
});

/* ═══════════ RENDER EDITOR (unchanged) ═══════════ */
function renderEditor(){
  var f = getFile();
  codeArea.value = f.content;
  renderHL(f.content);
  renderLineNums(f.content);
  updateBtns();
  lastCommit = f.content;
}

/* ═══════════ INIT (unchanged) ═══════════ */
renderTabs();
renderEditor();

})();