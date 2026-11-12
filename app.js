'use strict';
/** 排氨與泌尿 2.0：自主排列 + 有向連線 + 物質標籤，無外部函式庫。 */
const ORGANS = [
  {name:'各處器官', className:'color-0', special:true},
  {name:'小腸',className:'color-1'},
  {name:'肝',className:'color-2'},
  {name:'腎',className:'color-3'},
  {name:'膀胱',className:'color-4'},
  {name:'汗腺',className:'color-5'},
  {name:'體外',className:'color-6'}
];
const MATTERS = [
  {name:'蛋白質',color:'#d9f99d'},{name:'胺基酸',color:'#fed7aa'},
  {name:'氨',color:'#fecdd3'},{name:'尿素',color:'#fef08a'},
  {name:'尿液',color:'#bae6fd'},{name:'汗液',color:'#99f6e4'}
];
// 原本肺、腦是「各處器官」的兩個例子：合併後只有七個不同的必要關係，不重複製造同一連線。
const REQUIRED = [
  ['小腸','各處器官','胺基酸'],['各處器官','肝','氨'],
  ['肝','腎','尿素'],['肝','汗腺','尿素'],
  ['腎','膀胱','尿液'],['膀胱','體外','尿液'],
  ['汗腺','體外','汗液']
];
const REQUIRED_KEYS=new Set(REQUIRED.map(x=>x.join('→')));
const GRID=24, GAP=9;
const $=id=>document.getElementById(id);
const canvas=$('canvas'),svg=$('svg-layer'),slots=$('line-slots');
const orgPool=$('organ-pool'),matPool=$('matter-pool');
const snapButton=$('snap-btn'),returnButton=$('return-btn');
let organs=new Map(), connections=[], sourceId=null, activeTool=null, drag=null;
let snapping=false, nextConnectionId=0, ignoreClickUntil=0, modalLastFocus=null, deferredInstall=null, offlineReady=false;
const clamp=(n,a,b)=>Math.max(a,Math.min(n,Math.max(a,b)));
const nameOf=id=>organs.get(id)?.name;
const keyOf=(from,to,matter)=>[nameOf(from),nameOf(to),matter||''].join('→');
const say=s=>{$('status-text').textContent=s;};
const rectOf=o=>({x:o.x,y:o.y,w:o.w,h:o.h});
function sizes(o){return o.special?{w:180,h:128}:{w:106,h:51};}
function occupied(exceptId){return [...organs.values()].filter(o=>o.placed && o.id!==exceptId).map(rectOf);}
function overlap(x,y,w,h,rects){return rects.some(r=>x<r.x+r.w+GAP && x+w+GAP>r.x && y<r.y+r.h+GAP && y+h+GAP>r.y);}
function clampPoint(o,x,y){return {x:clamp(x,0,Math.max(0,canvas.clientWidth-o.w)),y:clamp(y,0,Math.max(0,canvas.clientHeight-o.h))};}
function findSpot(o,x,y,grid=snapping,rects=occupied(o.id)){
  const start=clampPoint(o,x,y),maxR=Math.ceil(Math.max(canvas.clientWidth,canvas.clientHeight)/(grid?GRID:17))+3;
  const step=grid?GRID:17;
  let best=null;
  for(let r=0;r<=maxR;r++){
    for(let dx=-r;dx<=r;dx++) for(let dy=-r;dy<=r;dy++){
      if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
      const px=grid?Math.round((start.x+o.w/2)/GRID)*GRID-o.w/2+dx*GRID:start.x+dx*step;
      const py=grid?Math.round((start.y+o.h/2)/GRID)*GRID-o.h/2+dy*GRID:start.y+dy*step;
      if(px<0||py<0||px+o.w>canvas.clientWidth||py+o.h>canvas.clientHeight)continue;
      if(overlap(px,py,o.w,o.h,rects))continue;
      const d=(px-x)**2+(py-y)**2;
      if(!best||d<best.d)best={x:px,y:py,d};
    }
    if(best)return best;
  }
  return start; // 小畫面嚴重擁擠時仍保持字卡可達，不默默移出畫布。
}
function showPosition(o){o.el.style.setProperty('--x',`${o.x}px`);o.el.style.setProperty('--y',`${o.y}px`);}
function updateCounter(){
  const placed=[...organs.values()].filter(o=>o.placed).length;
  const valid=new Set(connections.filter(c=>REQUIRED_KEYS.has(keyOf(c.fromId,c.toId,c.matter))).map(c=>keyOf(c.fromId,c.toId,c.matter)));
  $('canvas-counter').textContent=`器官 ${placed}／${ORGANS.length} · 必要路徑 ${valid.size}／${REQUIRED.length}`;
  $('canvas-empty').hidden=placed>0;
  return valid.size;
}
function clearSelection(){
  if(sourceId&&organs.get(sourceId))organs.get(sourceId).el.classList.remove('selected');
  sourceId=null;activeTool=null;
  document.querySelectorAll('.pool-selected').forEach(el=>el.classList.remove('pool-selected'));
  canvas.classList.remove('placing-mode'); returnButton.disabled=true;
}
function chooseTool(tool,el){
  clearSelection();activeTool=tool;el?.classList.add('pool-selected');canvas.classList.add('placing-mode');
  say(tool.kind==='organ'?'在畫布上點一下放置器官；也可以直接拖曳。':'先連接兩張器官卡，再點選連線中間的虛線框放置物質。');
}
function setSource(o){
  clearSelection();sourceId=o.id;o.el.classList.add('selected');returnButton.disabled=false;
  say(`已選取「${o.name}」：再點另一張器官建立 ${o.name} → 對方 的箭頭。點同一張可取消。`);
}
function createOrgan(data,index){
  const id=`organ-${index}`;
  const el=document.createElement('button'); el.type='button';
  el.className=`organ-card ${data.className}${data.special?' special':''}`;el.dataset.organId=id;
  el.setAttribute('aria-label',`器官：${data.name}`);
  if(data.special){
    const center=document.createElement('span');center.className='center-tile';center.textContent='各處器官';el.append(center);
    const labels=['腦','眼','唇','骨','臀','肌','肺','心'];
    const coords=[[50,10],[76,20],[90,40],[82,78],[50,90],[18,78],[10,40],[24,20]];
    labels.forEach((label,i)=>{const c=document.createElement('span');c.className='orbit';c.textContent=label;c.style.setProperty('--ox',coords[i][0]+'%');c.style.setProperty('--oy',coords[i][1]+'%');el.append(c);});
  }else{el.textContent=data.name;}
  const o={id,name:data.name,special:!!data.special,el,placed:false,x:0,y:0,w:0,h:0,placeholder:null};
  organs.set(id,o);orgPool.append(el);
  el.addEventListener('pointerdown',e=>onPointerDown(e,{kind:'organ',o}));
  return o;
}
function init(){
  cancelDrag();clearSelection();organs.clear();connections=[];nextConnectionId=0;
  // 真正移除前一輪畫布上的器官節點，避免重設後殘留與重複 ID（1.0 B02）。
  canvas.querySelectorAll('.organ-card.placed').forEach(el=>el.remove());
  orgPool.replaceChildren();matPool.replaceChildren();svg.replaceChildren();slots.replaceChildren();
  ORGANS.forEach(createOrgan);
  MATTERS.forEach(m=>{
    const b=document.createElement('button');b.type='button';b.className='matter-template';b.textContent=m.name;b.style.setProperty('--fg',m.color);
    b.dataset.matter=m.name;matPool.append(b);
    b.addEventListener('pointerdown',e=>onPointerDown(e,{kind:'matter',name:m.name,el:b}));
  });
  updateCounter();say('將器官字卡拖到畫布，依序點兩張器官建立箭頭，再把物質拖到連線上。');
  snapButton.textContent='貼齊格線：關';snapButton.setAttribute('aria-pressed','false');snapping=false;
  hideDialog();
}
function placeOrgan(o,position){
  if(o.placed)return;
  const s=sizes(o);o.w=s.w;o.h=s.h;o.placed=true;
  const ph=document.createElement('div');ph.className='pool-placeholder';ph.textContent='已放入';ph.dataset.placeholder=o.id;
  o.el.replaceWith(ph);o.placeholder=ph;
  o.el.classList.add('placed');o.el.style.setProperty('--w',o.w+'px');o.el.style.setProperty('--h',o.h+'px');
  canvas.append(o.el);
  const p=findSpot(o,position.x,position.y,false);o.x=p.x;o.y=p.y;showPosition(o);
  updateCounter();
}
function removeOrgan(o){
  if(!o.placed)return;
  const removed=connections.filter(c=>c.fromId===o.id||c.toId===o.id).length;
  connections=connections.filter(c=>c.fromId!==o.id&&c.toId!==o.id);
  o.placed=false;o.el.classList.remove('placed','selected','dragging');o.el.removeAttribute('style');
  if(o.placeholder?.isConnected)o.placeholder.replaceWith(o.el);else orgPool.append(o.el);
  o.placeholder=null;
  if(sourceId===o.id)clearSelection();
  drawLines();updateCounter();say(`已收回「${o.name}」${removed?`，並移除相關的 ${removed} 條連線`:''}。`);
}
function relocate(o,x,y,avoid=false){
  const p=avoid?findSpot(o,x,y,snapping):clampPoint(o,x,y);
  o.x=p.x;o.y=p.y;showPosition(o);drawLines();
}
function alignAll(){
  const list=[...organs.values()].filter(o=>o.placed);
  const planned=[];
  // 依現有位置就近排入格線，不代替學生判定哪個器官應放在上面。
  for(const o of list){const p=findSpot(o,o.x,o.y,true,planned);planned.push({...p,w:o.w,h:o.h,id:o.id});}
  for(const p of planned){const o=organs.get(p.id);o.x=p.x;o.y=p.y;showPosition(o);o.el.classList.remove('snapped');void o.el.offsetWidth;o.el.classList.add('snapped');}
  drawLines();return list.length;
}
function toggleConnection(a,b){
  if(a.id===b.id){clearSelection();return;}
  const existing=connections.findIndex(c=>(c.fromId===a.id&&c.toId===b.id)||(c.fromId===b.id&&c.toId===a.id));
  if(existing>=0){connections.splice(existing,1);say('已取消原連線。想改箭頭方向，請依正確的起點、終點重新點選。');}
  else {connections.push({id:`link-${++nextConnectionId}`,fromId:a.id,toId:b.id,matter:'',status:'neutral'});say(`${a.name} → ${b.name}：請拖入物質卡，或先選物質再點這條線的虛線框。`);}
  drawLines();updateCounter();
}
function onOrganClick(o){
  if(!o.placed){chooseTool({kind:'organ',id:o.id},o.el);return;}
  if(activeTool){clearSelection();}
  if(!sourceId){setSource(o);return;}
  if(sourceId===o.id){clearSelection();say('已取消選取。');return;}
  const src=organs.get(sourceId);toggleConnection(src,o);clearSelection();
}
function canvasClick(e){
  if(performance.now()<ignoreClickUntil)return;
  if(!activeTool||activeTool.kind!=='organ'){
    if(sourceId&&e.target===canvas){clearSelection();say('已取消選取。');}
    return;
  }
  const o=organs.get(activeTool.id);if(!o||o.placed){clearSelection();return;}
  const r=canvas.getBoundingClientRect(),s=sizes(o);
  placeOrgan(o,{x:e.clientX-r.left-s.w/2,y:e.clientY-r.top-s.h/2});
  clearSelection();say(`已放入「${o.name}」。點兩張器官字卡可建立有方向的連線。`);
}
function attachMatter(conn,name){
  if(!MATTERS.some(m=>m.name===name))return;
  conn.matter=name;conn.status='neutral';drawLines();updateCounter();
  say(`已在 ${nameOf(conn.fromId)} → ${nameOf(conn.toId)} 的路徑放上「${name}」。`);
}
function slotClick(id){
  const c=connections.find(c=>c.id===id);if(!c)return;
  if(activeTool?.kind==='matter'){
    const name=activeTool.name;attachMatter(c,name);clearSelection();return;
  }
  if(c.matter){c.matter='';c.status='neutral';drawLines();updateCounter();say('已取下物質卡；可以再放入其他物質。');return;}
  say('先從物質卡區選一張，再點這個虛線框；或直接把物質拖過來。');
}
function nearestConnection(clientX,clientY){
  const r=canvas.getBoundingClientRect(),x=clientX-r.left,y=clientY-r.top;
  let best=null;
  for(const c of connections){const p=(Number.isFinite(c.slotX)&&Number.isFinite(c.slotY))?{x:c.slotX,y:c.slotY}:lineMid(c);if(!p)continue;const d=Math.hypot(x-p.x,y-p.y);if(d<62 && (!best||d<best.dist))best={conn:c,dist:d};}
  return best?.conn||null;
}
function lineMid(c){
  const a=organs.get(c.fromId),b=organs.get(c.toId);if(!a?.placed||!b?.placed)return null;
  const p=cent(a),q=cent(b);return {x:(p.x+q.x)/2,y:(p.y+q.y)/2};
}
function cent(o){return{x:o.x+o.w/2,y:o.y+o.h/2};}
function chooseSlotPosition(a,b,priorSlots=[]){
  const vx=b.x-a.x,vy=b.y-a.y,L=Math.hypot(vx,vy)||1;
  const nx=-vy/L,ny=vx/L;
  const otherRects=[...organs.values()].filter(o=>o.placed).map(rectOf);
  let backup=null;
  for(const off of [0,27,-27,46,-46,70,-70,95,-95]){
    for(const t of [.5,.4,.6,.3,.7,.2,.8]){
      const x=a.x+vx*t+nx*off,y=a.y+vy*t+ny*off;
      const rect={x:x-38,y:y-19,w:76,h:38};
      if(rect.x<4||rect.y<4||rect.x+rect.w>canvas.clientWidth-4||rect.y+rect.h>canvas.clientHeight-4)continue;
      if(overlap(rect.x,rect.y,rect.w,rect.h,otherRects))continue;
      if(overlap(rect.x,rect.y,rect.w,rect.h,priorSlots))continue;
      return{x,y,rect};
    }
  }
  const mid={x:clamp((a.x+b.x)/2,36,canvas.clientWidth-36),y:clamp((a.y+b.y)/2,18,canvas.clientHeight-18)};
  return{x:mid.x,y:mid.y,rect:{x:mid.x-38,y:mid.y-19,w:76,h:38}};
}
function drawLines(){
  svg.replaceChildren();slots.replaceChildren();
  svg.setAttribute('viewBox',`0 0 ${Math.max(canvas.clientWidth,1)} ${Math.max(canvas.clientHeight,1)}`);
  const NS='http://www.w3.org/2000/svg';
  const defs=document.createElementNS(NS,'defs');
  ['neutral','green','red'].forEach((state)=>{
    const colors={neutral:'#8094a4',green:'#059669',red:'#ea5455'};
    const marker=document.createElementNS(NS,'marker');
    for(const [k,v] of Object.entries({id:`arrow-${state}`,viewBox:'0 0 10 10',refX:'9',refY:'5',markerWidth:'6',markerHeight:'6',orient:'auto-start-reverse'}))marker.setAttribute(k,v);
    const tri=document.createElementNS(NS,'path');tri.setAttribute('d','M0 0 L10 5 L0 10z');tri.setAttribute('fill',colors[state]);marker.append(tri);defs.append(marker);
  });svg.append(defs);
  const takenSlots=[];
  for(const c of connections){
    const from=organs.get(c.fromId),to=organs.get(c.toId);if(!from?.placed||!to?.placed)continue;
    const a=cent(from),b=cent(to),dx=b.x-a.x,dy=b.y-a.y,dist=Math.hypot(dx,dy)||1;
    // 讓線段從器官外緣出發，方向箭頭不被字卡完全遮住。
    const trim1=from.special?55:32,trim2=to.special?55:32,shift=Math.min(Math.max(0,dist/2-3),trim1+trim2);
    const s=Math.min(trim1,shift),t=Math.min(trim2,shift);
    const line=document.createElementNS(NS,'line');
    line.setAttribute('x1',a.x+dx/dist*s);line.setAttribute('y1',a.y+dy/dist*s);
    line.setAttribute('x2',b.x-dx/dist*t);line.setAttribute('y2',b.y-dy/dist*t);
    const color=c.status==='green'?'#059669':c.status==='red'?'#ea5455':'#8094a4';
    line.setAttribute('stroke',color);line.setAttribute('stroke-width',c.status==='neutral'?'2.7':'3.4');
    line.setAttribute('marker-end',`url(#arrow-${c.status})`);svg.append(line);
    const pos=chooseSlotPosition(a,b,takenSlots);c.slotX=pos.x;c.slotY=pos.y;takenSlots.push(pos.rect);
    const slot=document.createElement('button');slot.type='button';slot.className='line-slot';
    if(c.matter){slot.classList.add('filled');slot.dataset.matter=c.matter;}
    if(c.status==='green')slot.classList.add('correct');if(c.status==='red')slot.classList.add('wrong');
    slot.style.left=pos.x+'px';slot.style.top=pos.y+'px';slot.textContent=c.matter||'＋物質';
    slot.setAttribute('aria-label',`${from.name}到${to.name}的物質：${c.matter||'尚未放置'}；點擊可放入或取下`);
    slot.addEventListener('click',e=>{e.stopPropagation();slotClick(c.id);});slots.append(slot);
  }
}
function checkAnswers(){
  let valid=0,wrong=0;
  for(const c of connections){
    const ok=REQUIRED_KEYS.has(keyOf(c.fromId,c.toId,c.matter));
    c.status=ok?'green':'red';if(ok)valid++;else wrong++;
  }
  const remaining=REQUIRED.length-valid;
  drawLines();updateCounter();clearSelection();
  if(remaining===0&&wrong===0&&connections.length===REQUIRED.length){
    showDialog('排氨系統建構成功！',`你已完成全部 ${REQUIRED.length} 條必要物質運輸路徑，方向、物質與器官之間的連結都正確。`);
    say('所有必要路徑都正確！');
  }else{
    say(`已確認正確 ${valid}/${REQUIRED.length} 條；需修正 ${wrong} 條（紅色）；還缺 ${remaining} 條必要路徑。`);
  }
}
function showDialog(title,content,isHTML=false){
  modalLastFocus=document.activeElement;$('dialog-title').textContent=title;
  const area=$('dialog-content');area.replaceChildren();
  if(isHTML){area.innerHTML=content;}else{const p=document.createElement('p');p.textContent=content;area.append(p);}
  $('dialog').hidden=false;$('dialog-close').focus();
}
function hideDialog(){const d=$('dialog');if(!d.hidden){d.hidden=true;modalLastFocus?.focus?.();}}
function cancelDrag(){if(!drag)return;window.removeEventListener('pointermove',onPointerMove);window.removeEventListener('pointerup',onPointerUp);window.removeEventListener('pointercancel',onPointerCancel);drag.ghost?.remove();drag.o?.el.classList.remove('dragging');drag=null;}
function onPointerDown(e,desc){
  if(e.button!==undefined && e.button!==0)return;
  if(drag)cancelDrag();
  if(desc.kind==='organ'&&desc.o.placed&&activeTool?.kind==='matter')clearSelection();
  // 記住「原本就在畫布上」與「從卡池首次拖出」，不可在跨過卡池邊界前就改變來源元素的位置。
  const wasPlaced=desc.kind==='organ'&&desc.o.placed;
  let offX=0,offY=0;
  if(wasPlaced){
    const r=canvas.getBoundingClientRect();
    offX=e.clientX-r.left-desc.o.x;offY=e.clientY-r.top-desc.o.y;
  }
  drag={...desc,pointerId:e.pointerId,startX:e.clientX,startY:e.clientY,x:e.clientX,y:e.clientY,started:false,ghost:null,wasPlaced,offX,offY};
  e.stopPropagation();window.addEventListener('pointermove',onPointerMove,{passive:false});
  window.addEventListener('pointerup',onPointerUp);window.addEventListener('pointercancel',onPointerCancel);
}
function moveFloatingOrgan(d,clientX,clientY){
  if(!d.ghost)return;
  const s=sizes(d.o);
  d.ghost.style.setProperty('--x',`${clientX-s.w/2}px`);
  d.ghost.style.setProperty('--y',`${clientY-s.h/2}px`);
}
function onPointerMove(e){
  if(!drag||e.pointerId!==drag.pointerId)return;
  drag.x=e.clientX;drag.y=e.clientY;
  if(!drag.started&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>=7){
    drag.started=true;clearSelection();
    if(drag.kind==='organ'){
      const o=drag.o;
      if(drag.wasPlaced){
        // 原畫布上的字卡維持原本的抓取點，不切到卡片中心造成閃跳。
        o.el.classList.add('dragging');
      }else{
        // 卡池字卡留在原處直到「放開在畫布」；固定定位的預覽卡全程跟著手指。
        const s=sizes(o),ghost=o.el.cloneNode(true);
        ghost.removeAttribute('data-organ-id');ghost.setAttribute('aria-hidden','true');ghost.tabIndex=-1;
        ghost.classList.add('placed','dragging','drag-ghost');
        ghost.style.setProperty('--w',`${s.w}px`);ghost.style.setProperty('--h',`${s.h}px`);
        document.body.append(ghost);drag.ghost=ghost;
      }
    }else{
      const ghost=document.createElement('span');ghost.className='matter-template';ghost.textContent=drag.name;ghost.style.cssText='position:fixed;width:74px;height:36px;z-index:200;pointer-events:none;opacity:.82;';
      document.body.append(ghost);drag.ghost=ghost;
    }
  }
  if(!drag.started)return;
  e.preventDefault();
  if(drag.kind==='organ'){
    if(!drag.wasPlaced){
      moveFloatingOrgan(drag,e.clientX,e.clientY);
    }else{
      const r=canvas.getBoundingClientRect(),o=drag.o;
      relocate(o,e.clientX-r.left-drag.offX,e.clientY-r.top-drag.offY,false);
    }
  }else if(drag.ghost){drag.ghost.style.left=e.clientX-37+'px';drag.ghost.style.top=e.clientY-18+'px';}
}
function onPointerUp(e){
  if(!drag||e.pointerId!==drag.pointerId)return;
  const d=drag,moved=d.started;ignoreClickUntil=moved?performance.now()+180:0;
  if(moved){
    if(d.kind==='organ'){
      const r=canvas.getBoundingClientRect(),o=d.o;
      const inArea=e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;
      if(!d.wasPlaced){
        // 在側欄期間只顯示跟手預覽；唯有在畫布內放手才真正放入。
        if(inArea){
          const s=sizes(o);
          placeOrgan(o,{x:e.clientX-r.left-s.w/2,y:e.clientY-r.top-s.h/2});
          if(snapping){const p=findSpot(o,o.x,o.y,true);o.x=p.x;o.y=p.y;showPosition(o);}
          drawLines();say(`已放入「${o.name}」${snapping?'，並貼齊格線':''}。`);
        }else say('器官仍留在左側字卡區；請拖到畫布內放開。');
      }else if(!inArea){removeOrgan(o);}
      else{
        const p=findSpot(o,o.x,o.y,snapping);o.x=p.x;o.y=p.y;showPosition(o);drawLines();
        say(snapping?'已貼齊附近格線；概念關係與連線保留。':`已移動「${o.name}」。`);
      }
    }else{
      const c=nearestConnection(e.clientX,e.clientY);if(c)attachMatter(c,d.name);else say('請把物質卡拖到連線中央的「＋物質」方框上；或先點物質，再點方框。');
    }
  }else if(d.kind==='organ')onOrganClick(d.o);
  else chooseTool({kind:'matter',name:d.name},d.el);
  cancelDrag();
}
function onPointerCancel(){cancelDrag();}
function confirmReset(){
  const hadWork=connections.length>0||[...organs.values()].some(o=>o.placed);
  if(!hadWork||window.confirm('確定清空所有器官與連線，重新開始嗎？'))init();
}
function showInstall(){
  if(deferredInstall){deferredInstall.prompt();deferredInstall.userChoice.finally(()=>{deferredInstall=null;});return;}
  showDialog('安裝到 iPad／手機','',false);
  $('dialog-content').innerHTML='<p><strong>iPad／iPhone（Safari）</strong>：開啟部署後的網站 → 分享 → 加入主畫面 → 新增。</p><p><strong>Android（Chrome）</strong>：開啟網站 → 瀏覽器選單 → 安裝應用程式或加入主畫面。</p><p>完成第一次連網載入並快取後，可在網路中斷時重新開啟本單元。第一次安裝及離線能力仍需在實機驗證。</p>';
}
function updateNetwork(){
  const isOnline=navigator.onLine,el=$('network-status');
  el.textContent=offlineReady?(isOnline?'✓ 已備妥離線檔案':'✓ 離線可使用'):(isOnline?'離線檔案尚未備妥':'目前離線（未確認快取）');
  el.classList.toggle('offline',!isOnline||!offlineReady);
}
async function verifyOffline(reg){
  if(!reg?.active)return;
  try {
    const channel=new MessageChannel();
    const reply=new Promise(resolve=>{channel.port1.onmessage=e=>resolve(e.data);setTimeout(()=>resolve(null),4000);});
    reg.active.postMessage({type:'CHECK_OFFLINE'},[channel.port2]);
    const result=await reply;
    offlineReady=!!result?.ready;
  }catch(e){offlineReady=false;}
  updateNetwork();
}
// 主操作
$('check-btn').addEventListener('click',checkAnswers);
snapButton.addEventListener('click',()=>{snapping=!snapping;snapButton.setAttribute('aria-pressed',String(snapping));snapButton.textContent='貼齊格線：'+(snapping?'開':'關');if(snapping){const n=alignAll();say(`已開啟貼齊格線，立即整理 ${n} 張字卡；之後移動也會自動貼齊。`);}else say('已關閉貼齊格線，可以自由移動字卡。');});
returnButton.addEventListener('click',()=>{if(sourceId){const o=organs.get(sourceId);clearSelection();removeOrgan(o);}});
$('reset-btn').addEventListener('click',confirmReset);
$('install-btn').addEventListener('click',showInstall);
$('dialog-close').addEventListener('click',hideDialog);
$('dialog').addEventListener('click',e=>{if(e.target===$('dialog'))hideDialog();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('dialog').hidden)hideDialog();else clearSelection();}});
canvas.addEventListener('click',e=>{if(e.target===canvas||e.target===svg)canvasClick(e);});
window.addEventListener('resize',()=>{for(const o of organs.values())if(o.placed){const p=clampPoint(o,o.x,o.y);o.x=p.x;o.y=p.y;showPosition(o);}drawLines();});
window.addEventListener('online',updateNetwork);window.addEventListener('offline',updateNetwork);
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;});
updateNetwork();init();
if('serviceWorker'in navigator && location.protocol.startsWith('http')){
  window.addEventListener('load',async()=>{
    try {
      const reg=await navigator.serviceWorker.register('./sw.js');
      await navigator.serviceWorker.ready;
      await verifyOffline(reg);
    }catch(err){console.warn('離線功能尚未啟用：',err);}
  });
  navigator.serviceWorker.addEventListener('controllerchange',async()=>{
    try { await verifyOffline(await navigator.serviceWorker.getRegistration('./')); }catch(e){}
  });
}
