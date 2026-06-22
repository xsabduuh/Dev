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
        input.addEventListener('blur', function(){ finishRename(input.value.trim(), f.id); });
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
      var pressStartTime = 0, longPressed = false;
      function onTouchStart(e) { if (editingTabId !== null) return; pressStartTime = Date.now(); longPressed = false; }
      function onTouchEnd(e) {
        if (!pressStartTime) return;
        if (Date.now() - pressStartTime >= 500) {
          longPressed = true;
          if (f.id === activeId) startEditTabName(f.id);
          e.preventDefault();
        } else { longPressed = false; }
        pressStartTime = 0;
      }
      function onTouchCancel(e) { pressStartTime = 0; longPressed = false; }
      btn.addEventListener('mousedown', function(e) { if (editingTabId !== null) return; pressStartTime = Date.now(); longPressed = false; });
      btn.addEventListener('mouseup', function(e) {
        if (!pressStartTime) return;
        if (Date.now() - pressStartTime >= 500) {
          longPressed = true;
          if (f.id === activeId) startEditTabName(f.id);
        } else { longPressed = false; }
        pressStartTime = 0;
      });
      btn.addEventListener('mouseleave', function() { pressStartTime = 0; });
      btn.addEventListener('touchstart', onTouchStart, {passive: true});
      btn.addEventListener('touchend', onTouchEnd, {passive: false});
      btn.addEventListener('touchcancel', onTouchCancel, {passive: true});
      btn.addEventListener('click', function(e) {
        if (editingTabId !== null) return;
        if (longPressed) { longPressed = false; return; }
        if (e.target.closest('.tab-x')) return;
        if (f.id !== activeId) switchTab(f.id);
      });
      tabsBar.appendChild(btn);
    })(files[i]);
  }
}

/* ═══════════ TABS (unchanged) ═══════════ */
function switchTab(id){
  commitUndo();
  activeId=id;
  editingTabId = null;
  renderTabs();
  renderEditor();
  closeDropdown();
  copyTip.classList.remove('show');
  scheduleRealTimeValidation();
}

function closeTab(id){
  if(files.length===1)return;
  if(editingTabId === id) editingTabId = null;
  files=files.filter(function(f){return f.id!==id;});
  delete undoSt[id];delete redoSt[id];
  if(activeId===id)activeId=files[files.length-1].id;
  renderTabs();renderEditor();
  _analysisCache = {};
  scheduleRealTimeValidation();
}

/* ═══════════ INLINE RENAME (unchanged) ═══════════ */
function startEditTabName(id){ editingTabId = id; renderTabs(); }
function finishRename(newName, id){
  if(editingTabId !== id) return;
  newName = (newName || '').trim();
  if(newName){
    for(var k=0;k<files.length;k++){ if(files[k].id === id){ files[k].name = newName; break; } }
  }
  editingTabId = null;
  renderTabs();
  _analysisCache = {};
}
function cancelRename(){ editingTabId = null; renderTabs(); }

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
  if(cur !== lastCommit){ pushUndo(lastCommit); lastCommit = cur; }
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

/* ═══════════ TEXTAREA EVENTS (unchanged) ═══════════ */
codeArea.addEventListener('input',function(){
  var val=codeArea.value;
  for(var k=0;k<files.length;k++)if(files[k].id===activeId){files[k].content=val;break;}
  renderHL(val);renderLineNums(val);
  clearTimeout(undoTimer);
  var snap=lastCommit;
  undoTimer=setTimeout(function(){
    if(val!==snap){pushUndo(snap);lastCommit=val;updateBtns();}
  },600);
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
  if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).catch(function(){fbCopy(txt);}); }
  else fbCopy(txt);
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

/* ═══════════ SAVED FILES PANEL (unchanged) ═══════════ */
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

/* ═══════════ DELETE / RENAME / ADD FILE (unchanged) ═══════════ */
deleteBtn.addEventListener('click',function(){
  commitUndo();
  applyContent('');
  lastCommit = '';
  closeDropdown();
  showToast('Code cleared');
});
renameBtn.addEventListener('click',function(e){ e.stopPropagation(); startEditTabName(activeId); closeDropdown(); });
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
  _analysisCache = {};
});

/* ═══════════ CLOSE PREVIEW FUNCTION (unchanged) ═══════════ */
function closePreviewFn() { previewOverlay.classList.remove('show'); previewFrame.srcdoc = ''; }
closePreviewBtn.addEventListener('click', function(e) { e.stopPropagation(); closePreviewFn(); });
closePreviewBtn.addEventListener('touchend', function(e) { e.preventDefault(); e.stopPropagation(); closePreviewFn(); });
previewOverlay.addEventListener('click', function(e) { if (e.target === previewOverlay) closePreviewFn(); });

/* ═══════════ MULTI-FILE COMBINER (unchanged) ═══════════ */
function buildMultiFilePreviewWithFixes(fixedContents) {
  var activeFile = getFile();
  var baseFile = null;
  if (/\.html$/i.test(activeFile.name)) { baseFile = activeFile; }
  else { for (var i = 0; i < files.length; i++) { if (/\.html$/i.test(files[i].name)) { baseFile = files[i]; break; } } }
  if (!baseFile) {
    return fixedContents && fixedContents[activeFile.id] !== undefined ? fixedContents[activeFile.id] : activeFile.content;
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

/* ═══════════ DIAGNOSTIC SYSTEM (REWRITTEN & STABILIZED) ═══════════ */
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

/* ═══════════ EXTRACTORS (SIMPLIFIED & SAFE) ═══════════ */
var Extractors = {
  html: function(code, fileId, fileName) {
    var doc;
    try { doc = (new DOMParser()).parseFromString(code, 'text/html'); } catch(e) { return { doc: null, styles: [], scripts: [] }; }
    var styles = [], scripts = [];

    // Extract Styles safely
    var styleTags = doc.querySelectorAll('style');
    styleTags.forEach(function(tag) {
      var content = tag.textContent;
      var idx = code.indexOf(content);
      var rs = idx >= 0 ? getLineCol(code, idx) : {line:1, col:1};
      var re = idx >= 0 ? getLineCol(code, idx + content.length) : {line:1, col:1};
      styles.push({ type:'style', content: content, range: { startLine: rs.line, startCol: rs.col, endLine: re.line, endCol: re.col } });
    });

    // Extract Scripts safely
    var scriptTags = doc.querySelectorAll('script');
    scriptTags.forEach(function(tag) {
      var content = tag.textContent;
      if(!content.trim()) return;
      var isModule = tag.type === 'module';
      var idx = code.indexOf(content);
      var rs = idx >= 0 ? getLineCol(code, idx) : {line:1, col:1};
      var re = idx >= 0 ? getLineCol(code, idx + content.length) : {line:1, col:1};
      scripts.push({ type: isModule?'module':'script', content: content, range: { startLine: rs.line, startCol: rs.col, endLine: re.line, endCol: re.col } });
    });

    return { doc: doc, styles: styles, scripts: scripts };
  }
};

/* ═══════════ VALIDATORS (Rules - TUNED) ═══════════ */
var rules = [];
function registerRule(rule) { rules.push(rule); }

// Check if browser supports constructible stylesheets
var supportsCSSSyntaxCheck = ('CSSStyleSheet' in window && 'replaceSync' in CSSStyleSheet.prototype);

registerRule({
  id: 'HTML-STRUCTURE',
  validate: function(file, code, extracted) {
    var diags = [], doc = extracted.doc;
    if (!doc || !code.trim()) return diags;
    // Changed to 'info' so it doesn't overwhelm the user while typing simple snippets
    if (!doc.doctype) diags.push(new Diagnostic('info','HTML-0001','Missing DOCTYPE declaration.','html-structure',file.id,file.name,1,1,1,1,{type:'prepend',value:'<!DOCTYPE html>\n',mode:'auto'}));
    if (!doc.documentElement.hasAttribute('lang')) diags.push(new Diagnostic('info','HTML-0002','Missing lang attribute on <html>.','html-structure',file.id,file.name,1,1,1,1,null));
    var head = doc.head;
    if (!head || !head.querySelector('meta[charset]')) diags.push(new Diagnostic('info','HTML-0003','Missing <meta charset="UTF-8">.','html-structure',file.id,file.name,1,1,1,1,null));
    if (!head || !head.querySelector('meta[name="viewport"]')) diags.push(new Diagnostic('info','HTML-0004','Missing viewport meta tag.','html-structure',file.id,file.name,1,1,1,1,null));
    if (!head || !head.querySelector('title')) diags.push(new Diagnostic('info','HTML-0005','Missing <title> in <head>.','html-structure',file.id,file.name,1,1,1,1,null));
    return diags;
  }
});

registerRule({
  id: 'CSS-SYNTAX',
  validate: function(file, code, extracted) {
    var diags = [], segments = [];
    if (!supportsCSSSyntaxCheck) return diags; // Skip if not supported to prevent crashes
    
    if (extracted.doc) {
      extracted.styles.forEach(function(s) { segments.push({code:s.content, startLine:s.range.startLine, startCol:s.range.startColumn}); });
    } else if (/\.css$/i.test(file.name)) segments.push({code:code, startLine:1, startCol:1});
    
    segments.forEach(function(seg) {
      if(!seg.code.trim()) return;
      try { 
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(seg.code); 
      } catch(e) {
        // Ignore incomplete typing errors
        if (e.message.includes("Unexpected end of input") || e.message.includes("Expected")) return;
        
        var line = seg.startLine, col = seg.startCol;
        var m = e.message.match(/\((\d+):(\d+)\)/);
        if (m) { line = seg.startLine + parseInt(m[1],10)-1; col = seg.startCol + parseInt(m[2],10)-1; }
        diags.push(new Diagnostic('error','CSS-0001','CSS syntax error.','css-syntax',file.id,file.name,line,col,line,col,null));
      }
    });
    return diags;
  }
});

registerRule({
  id: 'JS-SYNTAX',
  validate: function(file, code, extracted) {
    var diags = [], segments = [];
    if (extracted.doc) {
      extracted.scripts.forEach(function(s) { segments.push({code:s.content, type:s.type, startLine:s.range.startLine, startCol:s.range.startColumn}); });
    } else if (/\.js$/i.test(file.name)) segments.push({code:code, type:'script', startLine:1, startCol:1});
    
    segments.forEach(function(seg) {
      var jsCode = seg.code.trim(); 
      if (!jsCode) return;
      
      // Better regex to comment out imports/exports without breaking syntax
      var testCode = jsCode.replace(/(^|\n)\s*(import|export)\b/g, '$1//$2');
      
      try { 
        new Function('"use strict";\n' + testCode); 
      } catch(e) {
        // Ignore errors caused by incomplete typing or module syntax that slipped through
        if (e.message.includes("Unexpected end of input")) return;
        if (e.message.includes("Cannot use import statement") || e.message.includes("Unexpected token 'export'")) return;
        
        var line = seg.startLine, col = seg.startCol;
        if (e.lineNumber) line = seg.startLine + e.lineNumber - 1;
        else if (e.line) line = seg.startLine + e.line - 1;
        
        diags.push(new Diagnostic('error','JS-0002','JavaScript syntax error: ' + e.message,'js-syntax',file.id,file.name,line,col,line,col,null));
      }
    });
    return diags;
  }
});

/* ═══════════ FIX REGISTRY (unchanged) ═══════════ */
var FixRegistry = {
  applyFixes: function(code, diagnostics, modeFilter) {
    var fixes = diagnostics.filter(function(d) { return d.fix && (modeFilter === null || d.fix.mode === modeFilter); })
                           .sort(function(a,b) { return (b.fix.start||0) - (a.fix.start||0); });
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

/* ═══════════ REAL-TIME VALIDATION (with cache & longer debounce) ═══════════ */
var lastDiagnostics = [];
var applySafeFixesBeforePreview = false;
var currentFilter = 'all';
var _analysisCache = {};

function analyzeSingleFile(file) {
  var code = file.content;
  var extracted = { doc: null, styles: [], scripts: [] };
  if (/\.html$/i.test(file.name)) extracted = Extractors.html(code, file.id, file.name);
  var fileDiags = [];
  rules.forEach(function(rule) {
    var res = rule.validate(file, code, extracted);
    if (res && res.length) fileDiags = fileDiags.concat(res);
  });
  return fileDiags;
}

var realTimeValidationTimer = null;
function scheduleRealTimeValidation() {
  clearTimeout(realTimeValidationTimer);
  // Increased debounce to 1200ms to prevent flashing errors while typing
  realTimeValidationTimer = setTimeout(function() {
    var file = getFile(); if (!file) return;
    var cacheEntry = _analysisCache[file.id];
    if (cacheEntry && cacheEntry.content === file.content) return;
    var diags = analyzeSingleFile(file);
    _analysisCache[file.id] = { content: file.content, diagnostics: diags };
    lastDiagnostics = lastDiagnostics.filter(function(d) { return d.fileId !== file.id; }).concat(diags);
    if (issueOverlay && issueOverlay.classList.contains('show')) renderProblemsPanel(currentFilter);
    updateProblemsBadge();
  }, 1200);
}

function analyzeAllFiles(applyAutoFixes) {
  var allDiags = [], fixedContents = {};
  files.forEach(function(file) {
    var fileDiags = analyzeSingleFile(file);
    allDiags = allDiags.concat(fileDiags);
    if (applyAutoFixes) fixedContents[file.id] = FixRegistry.applyFixes(file.content, fileDiags, 'auto');
    else fixedContents[file.id] = file.content;
  });
  lastDiagnostics = allDiags;
  return { diagnostics: allDiags, fixedContents: fixedContents };
}

/* ═══════════ PROBLEMS BADGE & PANEL ═══════════ */
function updateProblemsBadge() {
  if (!problemsBtn) return;
  var err = lastDiagnostics.filter(function(d) { return d.severity === 'error'; }).length;
  var warn = lastDiagnostics.filter(function(d) { return d.severity === 'warning'; }).length;
  var info = lastDiagnostics.filter(function(d) { return d.severity === 'info'; }).length;
  var total = err + warn + info;
  if (total > 0) {
    var parts = [];
    if (err) parts.push(err + '⛔');
    if (warn) parts.push(warn + '⚠️');
    if (info) parts.push(info + 'ℹ️');
    problemsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg> ' + parts.join(' ');
  } else {
    problemsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';
  }
}

var problemsBtn = document.getElementById('problemsBtn');
if (!problemsBtn) {
  problemsBtn = document.createElement('button');
  problemsBtn.id = 'problemsBtn';
  problemsBtn.title = 'Problems';
  problemsBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>';
  problemsBtn.style.cssText = 'background:none; border:none; color:var(--fg); cursor:pointer; padding:6px;';
  if (playBtn && playBtn.parentNode) playBtn.parentNode.insertBefore(problemsBtn, playBtn.nextSibling);
}

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
if (problemsBtn && problemsBtn.parentNode) problemsBtn.parentNode.insertBefore(safeFixBtn, problemsBtn);

// CRASH FIX: Create issueOverlay if it doesn't exist in HTML
var issueOverlay = document.getElementById('issueOverlay');
if (!issueOverlay) {
  issueOverlay = document.createElement('div');
  issueOverlay.id = 'issueOverlay';
  issueOverlay.className = 'overlay'; // Use your existing overlay class if you have one
  issueOverlay.style.cssText = 'display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; justify-content:center; align-items:center;';
  document.body.appendChild(issueOverlay);
  
  // Add a small CSS rule to handle the 'show' class dynamically
  var style = document.createElement('style');
  style.innerHTML = '#issueOverlay.show { display:flex !important; }';
  document.head.appendChild(style);
}

function renderProblemsPanel(filter) {
  if (!issueOverlay || !issueOverlay.classList.contains('show')) return;
  var list = document.getElementById('issuesList');
  if (!list) return;
  filter = filter || 'all';
  var filtered = lastDiagnostics.filter(function(d) { return filter==='all' ? true : d.severity===filter; });
  if (filtered.length === 0) {
    list.innerHTML = '<div style="color:var(--dim);text-align:center;padding:20px;">No problems match filter.</div>';
    return;
  }
  var html = '';
  filtered.forEach(function(d) {
    var icon = d.severity==='error'?'🔴':(d.severity==='warning'?'🟡':'🔵');
    var quickFixBtn = (d.fix && d.fix.mode==='quick') ? '<button class="quick-fix-btn" data-id="'+d.id+'">Fix</button>' : '';
    html += '<div class="problem-item" data-fileid="'+d.fileId+'" data-line="'+d.range.startLine+'" data-col="'+d.range.startColumn+'">'
      +'<span style="margin-right:8px;font-size:14px;">'+icon+'</span>'
      +'<div style="flex:1;"><div style="font-weight:600;">'+esc(d.code)+'</div><div>'+esc(d.message)+'</div><div style="font-size:12px;color:var(--dim);">'+esc(d.fileName)+':'+d.range.startLine+':'+d.range.startColumn+'</div></div>'
      +quickFixBtn+'</div>';
  });
  list.innerHTML = html;
  list.querySelectorAll('.problem-item').forEach(function(item) {
    item.addEventListener('click', function(e) {
      if (e.target.classList.contains('quick-fix-btn')) return;
      var fid = parseInt(item.dataset.fileid), line = parseInt(item.dataset.line), col = parseInt(item.dataset.col);
      goToLocation(fid, line, col);
    });
  });
  list.querySelectorAll('.quick-fix-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var diag = lastDiagnostics.find(function(d) { return d.id === this.dataset.id; });
      if (!diag || !diag.fix) return;
      var file = files.find(function(f) { return f.id === diag.fileId; });
      if (!file) return;
      if (activeId === file.id) commitUndo();
      file.content = FixRegistry.applyFixes(file.content, [diag], diag.fix.mode);
      if (activeId === file.id) { applyContent(file.content); lastCommit = file.content; }
      delete _analysisCache[file.id];
      lastDiagnostics = lastDiagnostics.filter(function(d) { return d.id !== diag.id; });
      renderProblemsPanel(currentFilter);
      updateProblemsBadge();
      showToast('Fix applied');
    });
  });
}

function goToLocation(fileId, line, col) {
  var file = files.find(function(f) { return f.id === fileId; });
  if (!file) return;
  if (activeId !== fileId) switchTab(fileId);
  codeArea.focus();
  var text = codeArea.value;
  var lines = text.split('\n');
  var pos = 0;
  for (var i=0; i<line-1 && i<lines.length; i++) pos += lines[i].length + 1;
  pos += Math.min(col-1, (lines[line-1]||'').length);
  codeArea.setSelectionRange(pos, pos);
  var lh = parseInt(getComputedStyle(codeArea).lineHeight,10) || 20;
  codeArea.scrollTop = (line-1) * lh - codeArea.clientHeight/3;
}

// ── Play Preview Modal ──
function showPlayIssuesModal(diagnostics, fixedContents) {
  var errs = diagnostics.filter(function(d) { return d.severity==='error'; }).length;
  var warns = diagnostics.filter(function(d) { return d.severity==='warning'; }).length;
  if (errs===0 && warns===0) {
    var combined = buildMultiFilePreviewWithFixes(fixedContents);
    previewFrame.srcdoc = combined;
    previewOverlay.classList.add('show');
    return;
  }
  var listHtml = '';
  diagnostics.forEach(function(d) {
    var icon = d.severity==='error'?'🔴':(d.severity==='warning'?'🟡':'🔵');
    listHtml += '<div style="display:flex;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);">'
      +'<span style="margin-right:8px;font-size:14px;">'+icon+'</span>'
      +'<div style="flex:1;"><strong>'+esc(d.code)+'</strong> '+esc(d.message)+' <span style="color:var(--dim);font-size:12px;">('+esc(d.fileName)+':'+d.range.startLine+')</span></div>'
      +'</div>';
  });
  issueOverlay.innerHTML =
    '<div class="saves-panel-inner" style="max-width:600px;">'
    +'<div class="saves-header"><h3>🔍 تدقيق الكود</h3><button id="playIssueClose" class="saves-close">&times;</button></div>'
    +'<div style="padding:12px;max-height:50vh;overflow-y:auto;">'+listHtml+'</div>'
    +'<div style="display:flex;gap:8px;padding:12px;border-top:1px solid var(--border);justify-content:flex-end;">'
    +'<button id="playFixAllAuto" class="issue-btn primary">إصلاح الكل (تلقائي)</button>'
    +'<button id="playPreviewRaw" class="issue-btn secondary">معاينة كما هي</button>'
    +'</div></div>';
  issueOverlay.classList.add('show');

  document.getElementById('playIssueClose').addEventListener('click', function() { issueOverlay.classList.remove('show'); });
  document.getElementById('playFixAllAuto').addEventListener('click', function() {
    var filesMap = {}; files.forEach(function(f){ filesMap[f.id]=f; });
    var changedActive = false;
    diagnostics.filter(function(d) { return d.fix && d.fix.mode==='auto'; }).forEach(function(d) {
      var file = filesMap[d.fileId]; if (!file) return;
      if (file.id === activeId) { commitUndo(); changedActive = true; }
      file.content = FixRegistry.applyFixes(file.content, [d], 'auto');
      delete _analysisCache[file.id];
    });
    if (changedActive) {
      var af = getFile();
      applyContent(af.content);
      lastCommit = af.content;
      renderTabs(); renderEditor();
    }
    var newResult = analyzeAllFiles(applySafeFixesBeforePreview);
    issueOverlay.classList.remove('show');
    showPlayIssuesModal(newResult.diagnostics, newResult.fixedContents);
  });
  document.getElementById('playPreviewRaw').addEventListener('click', function() {
    issueOverlay.classList.remove('show');
    var combined = buildMultiFilePreviewWithFixes(fixedContents);
    previewFrame.srcdoc = combined;
    previewOverlay.classList.add('show');
  });
}

/* ═══════════ PLAY BUTTON ═══════════ */
function handlePlayClick() {
  var result = analyzeAllFiles(applySafeFixesBeforePreview);
  showPlayIssuesModal(result.diagnostics, result.fixedContents);
  updateProblemsBadge();
}
playBtn.addEventListener('click', handlePlayClick);

/* ═══════════ PROBLEMS BUTTON (manual panel) ═══════════ */
problemsBtn.addEventListener('click', function() {
  if (issueOverlay.classList.contains('show')) {
    issueOverlay.classList.remove('show');
    return;
  }
  issueOverlay.innerHTML =
    '<div class="saves-panel-inner" style="max-width:700px;">'
    +'<div class="saves-header"><h3>Problems</h3><button id="fixAllAutoBtn" style="margin-right:8px;font-size:12px;background:var(--acc);border:none;color:white;padding:4px 12px;border-radius:4px;cursor:pointer;">Fix All Auto</button><button id="issueClose" class="saves-close">&times;</button></div>'
    +'<div id="issueFilter" style="display:flex;gap:8px;padding:8px;border-bottom:1px solid var(--border);">'
    +'<button class="filter-btn active" data-filter="all">All</button><button class="filter-btn" data-filter="error">Errors</button><button class="filter-btn" data-filter="warning">Warnings</button><button class="filter-btn" data-filter="info">Info</button>'
    +'</div>'
    +'<div id="issuesList" style="max-height:60vh;overflow-y:auto;padding:10px;"></div>'
    +'</div>';
  issueOverlay.classList.add('show');

  var closeBtn = document.getElementById('issueClose');
  closeBtn.addEventListener('click', function() { issueOverlay.classList.remove('show'); });

  document.getElementById('fixAllAutoBtn').addEventListener('click', function() {
    var diagsToFix = lastDiagnostics.filter(function(d) { return d.fix && d.fix.mode==='auto'; });
    if (!diagsToFix.length) { showToast('No auto-fixable issues.'); return; }
    var filesMap = {}; files.forEach(function(f){ filesMap[f.id]=f; });
    var changedActive = false;
    diagsToFix.forEach(function(d) {
      var file = filesMap[d.fileId]; if (!file) return;
      if (file.id === activeId) { commitUndo(); changedActive = true; }
      file.content = FixRegistry.applyFixes(file.content, [d], 'auto');
      delete _analysisCache[file.id];
    });
    if (changedActive) {
      applyContent(getFile().content);
      lastCommit = getFile().content;
      renderTabs(); renderEditor();
      scheduleRealTimeValidation();
    }
    analyzeAllFiles(false);
    renderProblemsPanel(currentFilter);
    updateProblemsBadge();
    showToast('Auto fixes applied.');
  });

  var filterBtns = document.querySelectorAll('#issueFilter .filter-btn');
  filterBtns.forEach(function(btn) {
    btn.addEventListener('click', function() {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter');
      renderProblemsPanel(currentFilter);
    });
  });

  renderProblemsPanel(currentFilter);
});

issueOverlay.addEventListener('click', function(e) {
  if (e.target === issueOverlay) issueOverlay.classList.remove('show');
});

/* ═══════════ ESCAPE KEY ═══════════ */
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(savesPanel.classList.contains('show')){ savesPanel.classList.remove('show'); return; }
    if(previewOverlay.classList.contains('show')){ closePreviewFn(); return; }
    if(issueOverlay && issueOverlay.classList.contains('show')){ issueOverlay.classList.remove('show'); return; }
    if(editingTabId !== null){ cancelRename(); return; }
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

