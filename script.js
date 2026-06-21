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

/* ═══════════ ISSUE DETECTION & FIX (NEW SYSTEM) ═══════════ */
var detectedIssues = [];
var previewContentCache = '';

// ========== PHASE 1: Silent Auto-Fixes ==========
function applySilentAutoFixes(html) {
  var fixed = html;
  
  // Remove Markdown fences
  fixed = fixed.replace(/```[\w-]*\s*\n?/g, '').replace(/```/g, '');
  
  // Fix self-closing block tags: <div/> -> <div></div> (with or without attributes)
  fixed = fixed.replace(/<(div|span|p|section|article|nav|header|footer|main|aside)(\s[^>]*)?\/\s*>/gi, function(m, tag, attrs) {
    return '<' + tag + (attrs || '') + '></' + tag + '>';
  });
  
  // Add px to unitless CSS values (except 0)
  fixed = fixed.replace(/:\s*(\d+)(?![a-zA-Z%])\s*;/g, function(match, num) {
    return num === '0' ? match : ': ' + num + 'px;';
  });
  
  // Comment out document.write
  fixed = fixed.replace(/^([ \t]*)document\.write/gm, '$1// document.write');
  
  // Fix missing ) before { in if statements
  fixed = fixed.replace(/(if\s*\([^{]*?) \{/g, '$1) {');
  
  // Add console div if console.log exists and no console div present
  if (/console\.log\(/.test(fixed) && !/id\s*=\s*["']console["']/.test(fixed)) {
    var consoleDiv = '<div id="console" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#111;color:#0f0;font-family:monospace;overflow:auto;padding:8px;border-top:1px solid #333;z-index:9999;"></div>';
    var script = '<script>(function(){var c=document.getElementById("console");if(!c)return;var oldLog=console.log;console.log=function(){var args=Array.prototype.slice.call(arguments);c.innerHTML+=args.join(" ")+"\\n";oldLog.apply(console,args);};window.onerror=function(m,s,l,cl,er){c.innerHTML+="ERROR: "+m+"\\n";};})();<\/script>';
    if (/<\/body>/i.test(fixed)) {
      fixed = fixed.replace(/<\/body>/i, consoleDiv + script + '</body>');
    } else {
      fixed = fixed + consoleDiv + script;
    }
  }
  
  return fixed;
}

// ========== PHASE 2: Detect remaining issues ==========
function detectRemainingIssues(cleaned) {
  var issues = [];
  var hasTags = /<[a-zA-Z][^>]*>/.test(cleaned);
  
  if (!/<!DOCTYPE\s+html/i.test(cleaned)) {
    issues.push({
      type: 'no-doctype',
      message: 'لا يوجد <!DOCTYPE html>. قد يعمل المتصفح في وضع المراوغات.',
      fix: function(h) { return '<!DOCTYPE html>\n' + h; }
    });
  }
  
  if (!/<html[\s>]/i.test(cleaned)) {
    issues.push({
      type: 'no-html-tag',
      message: 'لا يوجد وسم <html>. ستتم إضافته.',
      fix: function(h) { return '<!DOCTYPE html>\n<html>\n' + h + '\n</html>'; }
    });
  }
  
  if (hasTags && !/<head[\s>]/i.test(cleaned) && !/<body[\s>]/i.test(cleaned)) {
    issues.push({
      type: 'no-head-body',
      message: 'يحتوي وسوماً HTML لكن بدون <head> أو <body>. سيتم إضافتهما.',
      fix: function(h) {
        return h.replace(/(<html[^>]*>)/i, '$1\n<head><meta charset="UTF-8"></head>\n<body>')
                .replace(/<\/html>/i, '</body>\n</html>');
      }
    });
  }
  
  var countTag = function(tag, h) {
    return (h.match(new RegExp('<' + tag + '[\\s>]', 'gi')) || []).length;
  };
  ['html', 'head', 'body'].forEach(function(tag) {
    if (countTag(tag, cleaned) > 1) {
      issues.push({
        type: 'duplicate-' + tag,
        message: 'يوجد أكثر من وسم <' + tag + '>. قد يسبب سلوكاً غير متوقع.',
        fix: null
      });
    }
  });
  
  if (hasTags && /<head/i.test(cleaned) && !/<meta[^>]*charset/i.test(cleaned)) {
    issues.push({
      type: 'no-charset',
      message: 'لا يوجد <meta charset="UTF-8">. قد تظهر الرموز مشوهة.',
      fix: function(h) { return h.replace(/(<head[^>]*>)/i, '$1\n<meta charset="UTF-8">'); }
    });
  }
  
  if (hasTags && /<head/i.test(cleaned) && !/<meta[^>]*name\s*=\s*["']viewport["'][^>]*>/i.test(cleaned)) {
    issues.push({
      type: 'no-viewport',
      message: 'لا يوجد <meta viewport>. التصميم لن يتجاوب على الجوال.',
      fix: function(h) { return h.replace(/(<head[^>]*>)/i, '$1\n<meta name="viewport" content="width=device-width, initial-scale=1.0">'); }
    });
  }
  
  if (hasTags && /<head/i.test(cleaned) && !/<title[^>]*>/i.test(cleaned)) {
    issues.push({
      type: 'no-title',
      message: 'لا يوجد وسم <title> في الرأس.',
      fix: function(h) { return h.replace(/<\/head>/i, '<title>Preview</title>\n</head>'); }
    });
  }
  
  if ((cleaned.match(/<title[^>]*>/gi) || []).length > 1) {
    issues.push({ type: 'multi-title', message: 'يوجد أكثر من وسم <title>.', fix: null });
  }
  
  if (!hasTags && /[{;]\s*\n?\s*[a-zA-Z-]+\s*:/.test(cleaned)) {
    issues.push({
      type: 'pure-css',
      message: 'يبدو أنه كود CSS خالص. سيتم تغليفه بصفحة.',
      fix: function(h) {
        return '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">\n<style>\n' + h + '\n</style></head><body></body></html>';
      }
    });
  }
  
  if (!hasTags && /\b(function|const|let|var|=>|console\.log|alert|document\.)\b/.test(cleaned)) {
    issues.push({
      type: 'pure-js',
      message: 'يبدو أنه كود JavaScript خالص. سيتم تغليفه بصفحة.',
      fix: function(h) {
        return '<!DOCTYPE html>\n<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body>\n<script>\n' + h + '\n<\/script></body></html>';
      }
    });
  }
  
  if (hasTags && /\b[a-zA-Z-]+\s*:\s*[^;]+;/.test(cleaned) && !/<style[^>]*>/i.test(cleaned)) {
    issues.push({
      type: 'css-outside-style',
      message: 'توجد خواص CSS خارج وسم <style>. ستُنقل إليه.',
      fix: function(h) {
        var cssBlocks = h.match(/\b[a-zA-Z-]+\s*:\s*[^;]+;/g);
        if (cssBlocks) {
          var styleTag = '\n<style>\n' + cssBlocks.join('\n') + '\n</style>\n';
          return h.replace(/(<head[^>]*>)/i, '$1' + styleTag);
        }
        return h;
      }
    });
  }
  
  if (hasTags && /\b(function|const|let|var|=>|console\.log)\b/.test(cleaned) && !/<script[^>]*>/i.test(cleaned)) {
    issues.push({
      type: 'js-outside-script',
      message: 'كود JavaScript مبعثر خارج وسم <script>. ستُنقل إليه.',
      fix: function(h) {
        var jsPattern = /(?:function\s+\w+\s*\(.*?\)\s*\{[^}]*\}|const\s+\w+\s*=\s*[^;]+;|let\s+\w+\s*=\s*[^;]+;|var\s+\w+\s*=\s*[^;]+;|console\.log\([^)]*\);?)/g;
        var jsCode = h.match(jsPattern);
        if (jsCode) {
          var scriptTag = '\n<script>\n' + jsCode.join('\n') + '\n<\/script>\n';
          return h.replace(/<\/body>/i, scriptTag + '</body>');
        }
        return h;
      }
    });
  }
  
  // Mismatched HTML tags
  var voidElements = ['br','hr','img','input','meta','link','area','base','col','embed','source','track','wbr'];
  var tagRegex = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  var tagCounts = {};
  var match;
  while ((match = tagRegex.exec(cleaned)) !== null) {
    var tagName = match[2].toLowerCase();
    var isClosing = match[1] === '/';
    if (voidElements.indexOf(tagName) !== -1) continue;
    var fullTag = match[0];
    if (/\/\s*>$/.test(fullTag) && !isClosing) continue;
    if (!tagCounts[tagName]) tagCounts[tagName] = { open: 0, close: 0 };
    if (isClosing) tagCounts[tagName].close++;
    else tagCounts[tagName].open++;
  }
  var mismatched = [];
  for (var t in tagCounts) {
    if (tagCounts[t].open !== tagCounts[t].close) {
      mismatched.push(t + ' (' + tagCounts[t].open + '/' + tagCounts[t].close + ')');
    }
  }
  if (mismatched.length) {
    issues.push({
      type: 'tag-mismatch',
      message: 'وسوم غير متطابقة: ' + mismatched.join(', '),
      fix: null
    });
  }
  
  // Duplicate IDs
  var ids = cleaned.match(/id\s*=\s*["']([^"']+)["']/gi) || [];
  var idNames = ids.map(function(x) { return x.replace(/id\s*=\s*["']/i, '').replace(/["']/g, ''); });
  var duplicates = idNames.filter(function(id, idx) { return idNames.indexOf(id) !== idx; });
  if (duplicates.length) {
    issues.push({
      type: 'duplicate-id',
      message: 'معرفات id مكررة: ' + duplicates.slice(0,3).join(', '),
      fix: null
    });
  }
  
  // Img without alt
  var imgs = cleaned.match(/<img[^>]*>/gi) || [];
  var noAlt = imgs.filter(function(img) { return !/alt\s*=/i.test(img); });
  if (noAlt.length) {
    issues.push({
      type: 'img-no-alt',
      message: 'عدد ' + noAlt.length + ' صورة بدون سمة alt. ستضاف تلقائياً.',
      fix: function(h) {
        return h.replace(/<img([^>]*)>/gi, function(m, attrs) {
          if (/alt\s*=/i.test(attrs)) return m;
          return '<img' + attrs + ' alt="">';
        });
      }
    });
  }
  
  // Obsolete tags
  var obsolete = cleaned.match(/<(center|font|marquee)[\s>]/gi);
  if (obsolete) {
    issues.push({
      type: 'obsolete-tags',
      message: 'وسوم قديمة غير مدعومة (center, font, marquee). ستستبدل بعناصر حديثة.',
      fix: function(h) {
        h = h.replace(/<center([\s>])/gi, '<div style="text-align:center"$1').replace(/<\/center>/gi, '</div>');
        h = h.replace(/<font([\s>])/gi, '<span$1').replace(/<\/font>/gi, '</span>');
        h = h.replace(/<marquee([\s>])/gi, '<div$1').replace(/<\/marquee>/gi, '</div>');
        return h;
      }
    });
  }
  
  if (/<html/i.test(cleaned) && !/<html[^>]*\slang\s*=/i.test(cleaned)) {
    issues.push({
      type: 'no-lang',
      message: 'وسم <html> بدون سمة lang. ستضاف lang="en".',
      fix: function(h) { return h.replace(/<html/i, '<html lang="en"'); }
    });
  }
  
  if (/<input\s(?!type)/i.test(cleaned) || /<input\s*>/i.test(cleaned)) {
    issues.push({
      type: 'input-no-type',
      message: 'عناصر input بدون type. سيتم افتراض type="text".',
      fix: function(h) {
        return h.replace(/<input\s/gi, '<input type="text" ')
                .replace(/<input>/gi, '<input type="text">');
      }
    });
  }
  
  if (/@import\s+url\(["']?http:/.test(cleaned)) {
    issues.push({ type: 'css-import-http', message: 'يوجد @import برابط http قد يُمنع.', fix: null });
  }
  
  if (/<script[^>]+src\s*=\s*["']http:/.test(cleaned)) {
    issues.push({ type: 'script-src-http', message: 'سكريبت خارجي من رابط http قد يمنع.', fix: null });
  }
  
  var jsCode = '';
  var scriptMatches = cleaned.match(/<script[^>]*>([\s\S]*?)<\/script>/gi);
  if (scriptMatches) {
    jsCode = scriptMatches.join('');
  } else if (!hasTags) {
    jsCode = cleaned;
  }
  var countChar = function(code, ch) { return (code.match(new RegExp('\\' + ch, 'g')) || []).length; };
  if (countChar(jsCode, '{') !== countChar(jsCode, '}')) {
    issues.push({ type: 'js-brace-mismatch', message: 'الأقواس { } غير متطابقة في JavaScript.', fix: null });
  }
  if (countChar(jsCode, '[') !== countChar(jsCode, ']')) {
    issues.push({ type: 'js-bracket-mismatch', message: 'الأقواس [ ] غير متطابقة في JavaScript.', fix: null });
  }
  if (countChar(jsCode, '(') !== countChar(jsCode, ')')) {
    issues.push({ type: 'js-paren-mismatch', message: 'الأقواس ( ) غير متطابقة في JavaScript.', fix: null });
  }
  
  return issues;
}

function renderIssueModal(issues, previewContent) {
  if (!issues.length) {
    issueBody.innerHTML = '<div class="issue-empty">✅ لا توجد مشاكل، الكود جاهز للمعاينة.</div>';
    issueFixAll.style.display = 'none';
    issuePreviewRaw.style.display = 'none';
    setTimeout(function() {
      issueOverlay.classList.remove('show');
      openPreviewWithContent(previewContent);
    }, 400);
  } else {
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
    issueFixAll.style.display = 'inline-block';
    issuePreviewRaw.style.display = 'inline-block';

    var fixBtns = issueBody.querySelectorAll('.issue-fix-btn');
    for (var b = 0; b < fixBtns.length; b++) {
      fixBtns[b].addEventListener('click', function(e) {
        var idx = parseInt(this.getAttribute('data-issue-idx'));
        var issue = detectedIssues[idx];
        if (issue && issue.fix) {
          previewContentCache = issue.fix(previewContentCache);
          detectedIssues = detectRemainingIssues(previewContentCache);
          renderIssueModal(detectedIssues, previewContentCache);
        }
      });
    }
  }
}

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
  if (e.target === previewOverlay) {
    closePreviewFn();
  }
});

function handlePlayClick() {
  var combined = buildMultiFilePreview();
  var autoFixed = applySilentAutoFixes(combined);
  previewContentCache = autoFixed;
  detectedIssues = detectRemainingIssues(autoFixed);
  if (detectedIssues.length === 0) {
    openPreviewWithContent(autoFixed);
  } else {
    renderIssueModal(detectedIssues, autoFixed);
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
issueFixAll.addEventListener('click', function() {
  for (var i = 0; i < detectedIssues.length; i++) {
    if (detectedIssues[i].fix) {
      previewContentCache = detectedIssues[i].fix(previewContentCache);
    }
  }
  detectedIssues = detectRemainingIssues(previewContentCache);
  if (detectedIssues.length === 0) {
    issueOverlay.classList.remove('show');
    openPreviewWithContent(previewContentCache);
  } else {
    renderIssueModal(detectedIssues, previewContentCache);
  }
});
issueOverlay.addEventListener('click', function(e) {
  if (e.target === issueOverlay) {
    issueOverlay.classList.remove('show');
  }
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
