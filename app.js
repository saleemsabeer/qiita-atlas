const DATA = window.__ATLAS_DATA;

(function(){
'use strict';
const P = DATA.papers, N = P.length;
const F = {x:0,y:1,title:2,journal:3,year:4,site:5,cluster:6,pmid:7,g8:8,mondo:9,extra:10,tier:11};
const css = getComputedStyle(document.documentElement);
const HUES = ['--c1','--c2','--c3','--c4','--c5','--c6','--c7'].map(v=>css.getPropertyValue(v).trim());
const OTHER = css.getPropertyValue('--other').trim(), NONE = css.getPropertyValue('--none').trim();
const GROUND = css.getPropertyValue('--sky').trim();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- data prep ----------
const xs = new Float32Array(N), ys = new Float32Array(N);
let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
for (let i=0;i<N;i++){ const p=P[i]; xs[i]=p[F.x]; ys[i]=p[F.y];
  if(xs[i]<minX)minX=xs[i]; if(xs[i]>maxX)maxX=xs[i]; if(ys[i]<minY)minY=ys[i]; if(ys[i]>maxY)maxY=ys[i]; }
// robust bounds for the fit (1st–99th percentile) so a few far-flung papers do not set the zoom
const sortedX=Float32Array.from(xs).sort(), sortedY=Float32Array.from(ys).sort();
const pct=(a,p)=>a[Math.min(a.length-1,Math.max(0,Math.floor(p*(a.length-1))))];
const fitX0=pct(sortedX,0.01), fitX1=pct(sortedX,0.99), fitY0=pct(sortedY,0.01), fitY1=pct(sortedY,0.99);
// local density per paper (neighbours within 0.25 data units), used to keep dense regions from burning to white
const dens=new Float32Array(N), dimF=new Float32Array(N);
{ const cell=0.25, grid=new Map(); const key=(a,b)=>a*100003+b;
  for(let i=0;i<N;i++){ const kk=key(Math.floor(xs[i]/cell),Math.floor(ys[i]/cell)); (grid.get(kk)||grid.set(kk,[]).get(kk)).push(i); }
  for(let i=0;i<N;i++){ const cx=Math.floor(xs[i]/cell), cy=Math.floor(ys[i]/cell); let c=0;
    for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){ const arr=grid.get(key(cx+dx,cy+dy)); if(!arr) continue;
      for(const j of arr){ const d=(xs[i]-xs[j])**2+(ys[i]-ys[j])**2; if(d<cell*cell) c++; } }
    dens[i]=c; dimF[i]=1/Math.sqrt(1+c/5); } }
const lineage = DATA.mondoLineage, nodes = DATA.mondoNodes;
const nMapped = P.reduce((a,p)=>a+(p[F.mondo]>=0?1:0),0);
document.getElementById('mondoV').textContent = DATA.mondoVersion || '';
const nLoose = P.reduce((a,p)=>a+((p[F.tier]>0&&p[F.tier]<4)?1:0),0), nCtx = P.reduce((a,p)=>a+(p[F.tier]===4?1:0),0);
document.getElementById('nMapped').textContent = `${DATA.nStrict.toLocaleString()} strict · ${nLoose.toLocaleString()} loose · ${nCtx.toLocaleString()} context`;
document.getElementById('nAll').textContent = N.toLocaleString();

// group key per paper for a mode/level
function groupKeys(mode, level){
  const keys = new Int32Array(N), names = new Map(); // key -> name ; -1 = none
  if (mode==='mondo'){
    for (let i=0;i<N;i++){ const m=P[i][F.mondo];
      if (m<0 || (!S.loose && P[i][F.tier]>0)){ keys[i]=-1; continue; }
      const path = lineage[m]; const k = path[Math.min(level, path.length-1)];
      keys[i]=k; if(!names.has(k)) names.set(k, nodes[k].name);
    }
  } else {
    const idx = F[mode==='group8'?'g8':mode], list = DATA[mode==='site'?'sites':mode==='group8'?'groups8':'clusters'];
    for (let i=0;i<N;i++){ const k=P[i][idx]; const nm=list[k];
      const none = (mode==='cluster' && nm==='unclustered') || (mode==='group8' && nm==='none/healthy-cohort');
      keys[i]= none? -1 : k; if(!none && !names.has(k)) names.set(k,nm);
    }
  }
  return {keys,names};
}

// ---------- state ----------
const S = { mode:'mondo', level:3, keys:null, groups:[], colorOf:new Map(), isolate:null, hover:-1, legendHover:null,
  q:'', y0:2010, y1:2026, haze:true, lines:true, labels:true, loose:true, visible:new Uint8Array(N).fill(1), prevColors:null };

function computeGroups(){
  const {keys,names} = groupKeys(S.mode, S.level);
  const count = new Map();
  for (let i=0;i<N;i++){ const k=keys[i]; if(k<0) continue; count.set(k,(count.get(k)||0)+1); }
  const groups = [...count.entries()].sort((a,b)=>b[1]-a[1]).map(([k,n])=>({k,n,name:names.get(k)}));
  // colour assignment: top 7 get hues; a group inherits its parent's hue when the parent was coloured (keeps colours steady across the slider)
  const colorOf = new Map(); const used = new Set();
  const top = groups.slice(0,7);
  if (S.mode==='mondo' && S.prevColors){
    // map each top group to its ancestor at the previous level
    const claimed = new Map();
    for (const g of top){
      const path = lineage[[...keyOwners(keys,g.k)][0]]; // any paper's lineage that passes through g.k
      let inherit=null;
      for (const anc of path){ if (anc===g.k) break; if (S.prevColors.has(anc)) inherit = S.prevColors.get(anc); }
      // also allow inheriting downward (going broader): the previous level's coloured group may be a descendant
      if (!inherit){ for (const [pk,c] of S.prevColors){ const pp = lineage[[...keyOwnersAny(pk)][0]]||[]; if (pp.includes(g.k) && !claimed.has(c)){ inherit=c; break; } } }
      if (inherit && !used.has(inherit)){ colorOf.set(g.k,inherit); used.add(inherit); claimed.set(inherit,g.k); }
    }
  }
  for (const g of top){ if(colorOf.has(g.k)) continue; const h = HUES.find(c=>!used.has(c)); colorOf.set(g.k,h); used.add(h); }
  S.keys=keys; S.groups=groups; S.colorOf=colorOf;
  if (S.mode==='mondo') S.prevColors = new Map(colorOf);
  if (S.isolate!=null && !count.has(S.isolate)) S.isolate=null;
  buildEdges(); buildLabels(); renderLegend(); requestDraw();
}
function* keyOwners(keys,k){ for(let i=0;i<N;i++) if(keys[i]===k){ yield P[i][F.mondo]; return; } }
function* keyOwnersAny(k){ for(let i=0;i<N;i++){ const m=P[i][F.mondo]; if(m>=0 && lineage[m].includes(k)){ yield m; return; } } }

function colorFor(i){ const k=S.keys[i]; if(k<0) return NONE; return S.colorOf.get(k)||OTHER; }

// ---------- constellation lines: 2 nearest neighbours within each coloured group ----------
let edges=[]; // [i,j,color]
function buildEdges(){
  edges=[];
  const byGroup = new Map();
  for (let i=0;i<N;i++){ const k=S.keys[i]; if(k<0||!S.colorOf.has(k)) continue; (byGroup.get(k)||byGroup.set(k,[]).get(k)).push(i); }
  for (const [k,idx] of byGroup){
    const col=S.colorOf.get(k); const seen=new Set();
    // grid for speed
    const cell=0.35, grid=new Map(); const key=(cx,cy)=>cx*100003+cy;
    for (const i of idx){ const cx=Math.floor(xs[i]/cell), cy=Math.floor(ys[i]/cell); const kk=key(cx,cy); (grid.get(kk)||grid.set(kk,[]).get(kk)).push(i); }
    const dists=[];
    for (const i of idx){
      const cx=Math.floor(xs[i]/cell), cy=Math.floor(ys[i]/cell); let best=[[1e9,-1],[1e9,-1]];
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){ const arr=grid.get(key(cx+dx,cy+dy)); if(!arr) continue;
        for (const j of arr){ if(j===i) continue; const d=(xs[i]-xs[j])**2+(ys[i]-ys[j])**2;
          if(d<best[0][0]){best[1]=best[0];best[0]=[d,j];} else if(d<best[1][0]) best[1]=[d,j]; } }
      for (const [d,j] of best){ if(j<0) continue; const a=Math.min(i,j),b=Math.max(i,j); const id=a*N+b; if(seen.has(id)) continue; seen.add(id); dists.push(Math.sqrt(d)); edges.push([a,b,col,Math.sqrt(d)]); }
    }
  }
  // drop the long stragglers: keep edges under 2.5x the median length
  const ds=edges.map(e=>e[3]).sort((a,b)=>a-b); const med=ds[ds.length>>1]||0.3;
  edges=edges.filter(e=>e[3]<med*2.2);
}

// ---------- labels: place at each group's densest spot ----------
let labels=[]; // {x,y,name,color,n,rank}
function buildLabels(){
  labels=[];
  const cell=0.5; 
  S.groups.forEach((g,rank)=>{
    if (rank>=30) return;
    const grid=new Map(); const pts=[];
    for (let i=0;i<N;i++){ if(S.keys[i]!==g.k) continue; pts.push(i); const cx=Math.floor(xs[i]/cell), cy=Math.floor(ys[i]/cell); const kk=cx+','+cy;
      const e=grid.get(kk); if(e) e.c++; else grid.set(kk,{c:1,cx,cy}); }
    if (!pts.length) return;
    let best=null, bestScore=-1;
    for (const e of grid.values()){ let sc=0; for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){ const n=grid.get((e.cx+dx)+','+(e.cy+dy)); if(n) sc+=n.c*(dx||dy?0.6:1); } if(sc>bestScore){bestScore=sc;best=e;} }
    const cx=best.cx, cy=best.cy;
    let sx=0,sy=0,n=0;
    for (const i of pts){ const dx=xs[i]-(cx+0.5)*cell, dy=ys[i]-(cy+0.5)*cell; if(dx*dx+dy*dy<(cell*1.5)**2){sx+=xs[i];sy+=ys[i];n++;} }
    if(!n){ for(const i of pts){sx+=xs[i];sy+=ys[i];} n=pts.length; }
    labels.push({x:sx/n,y:sy/n,name:g.name,color:S.colorOf.get(g.k)||OTHER,n:g.n,rank,k:g.k});
  });
}

// ---------- legend ----------
const legendEl=document.getElementById('legend');
function renderLegend(){
  const top=S.groups.slice(0,7), rest=S.groups.slice(7);
  const restN=rest.reduce((a,g)=>a+g.n,0);
  const noneN=N - S.groups.reduce((a,g)=>a+g.n,0);
  const noneLabel = S.mode==='mondo'?'No disease term': S.mode==='cluster'?'Unclustered': S.mode==='group8'?'Healthy cohort / none':'';
  document.getElementById('legendTitle').textContent = S.mode==='mondo' ? `Constellations · level ${S.level-2} of 8` : 'Constellations';
  let html='';
  for (const g of top){ const ctx_ = S.mode==='mondo' && nodes[g.k].context; html+=`<li data-k="${g.k}" aria-pressed="${S.isolate===g.k}" tabindex="0" role="button"><span class="swatch" style="background:${S.colorOf.get(g.k)};color:${S.colorOf.get(g.k)}"></span><span class="name"><span class="nm" title="${esc(g.name)}">${esc(g.name)}</span>${ctx_?'<span class="tag">context</span>':''}</span><span class="n">${g.n.toLocaleString()}</span></li>`; }
  if (rest.length) html+=`<li data-k="other" class="dim" aria-pressed="${S.isolate==='other'}" tabindex="0" role="button"><span class="swatch" style="background:${OTHER};color:transparent"></span><span class="name">${rest.length.toLocaleString()} smaller ${rest.length===1?'group':'groups'}</span><span class="n">${restN.toLocaleString()}</span></li>`;
  if (noneN) html+=`<li data-k="none" class="dim" aria-pressed="${S.isolate==='none'}" tabindex="0" role="button"><span class="swatch" style="background:${NONE};color:transparent"></span><span class="name">${noneLabel}</span><span class="n">${noneN.toLocaleString()}</span></li>`;
  legendEl.innerHTML=html;
  const dr=document.getElementById('depthRead'); dr.innerHTML = `<b>${S.groups.length.toLocaleString()}</b> groups`;
}
legendEl.addEventListener('click',e=>{ const li=e.target.closest('li'); if(!li) return; toggleIsolate(li.dataset.k); });
legendEl.addEventListener('keydown',e=>{ if(e.key==='Enter'||e.key===' '){ const li=e.target.closest('li'); if(li){ e.preventDefault(); toggleIsolate(li.dataset.k);} } });
legendEl.addEventListener('mouseover',e=>{ const li=e.target.closest('li'); if(!li) return; S.legendHover=parseKey(li.dataset.k); requestDraw(); });
legendEl.addEventListener('mouseleave',()=>{ S.legendHover=null; requestDraw(); });
function parseKey(k){ return (k==='other'||k==='none')?k:+k; }
function toggleIsolate(k){ k=parseKey(k); S.isolate = (S.isolate===k)?null:k; renderLegend(); requestDraw(); }
function inSelection(i, sel){ // sel: group key | 'other' | 'none'
  const k=S.keys[i];
  if (sel==='none') return k<0;
  if (sel==='other') return k>=0 && !S.colorOf.has(k);
  return k===sel;
}
function esc(s){ return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

// ---------- filters ----------
function applyFilters(){
  const q=S.q.trim().toLowerCase(); let hits=0;
  for (let i=0;i<N;i++){ const p=P[i]; let v = p[F.year]>=S.y0 && p[F.year]<=S.y1;
    if (v && q){ v = p[F.title].toLowerCase().includes(q) || DATA.journals[p[F.journal]].toLowerCase().includes(q); }
    S.visible[i]=v?1:0; if(v) hits++; }
  document.getElementById('hits').textContent = (q||S.y0>2010||S.y1<2026) ? hits.toLocaleString() : '';
  requestDraw();
}

// ---------- view / camera ----------
const cv=document.getElementById('sky'), ctx=cv.getContext('2d');
let W=0,H=0,DPR=1; const cam={k:1,tx:0,ty:0}; // screen = k*(x) + tx  (y flipped)
function resize(){ DPR=Math.min(2,devicePixelRatio||1); W=innerWidth; H=innerHeight; cv.width=W*DPR; cv.height=H*DPR; cv.style.width=W+'px'; cv.style.height=H+'px'; buildSprites(); requestDraw(); }
function fit(animate){
  const panelW = innerWidth>760 ? 360 : 0, panelH = innerWidth>760 ? 0 : innerHeight*0.52;
  const availW=W-panelW-80, availH=H-panelH-110;
  const k=Math.min(availW/(fitX1-fitX0), availH/(fitY1-fitY0));
  const cx=(fitX0+fitX1)/2, cy=(fitY0+fitY1)/2;
  const target={k, tx: panelW + 40 + availW/2 - k*cx, ty: 62 + availH/2 + k*cy};
  if (animate && !reduceMotion) tween(target); else Object.assign(cam,target);
  requestDraw();
}
function sx(x){ return cam.k*x+cam.tx; } function sy(y){ return -cam.k*y+cam.ty; }
function zoomAt(px,py,f){ const nk=Math.max(baseK()*0.35, Math.min(baseK()*40, cam.k*f)); f=nk/cam.k; cam.tx=px-(px-cam.tx)*f; cam.ty=py-(py-cam.ty)*f; cam.k=nk; requestDraw(); }
function baseK(){ const panelW = innerWidth>760 ? 360 : 0, panelH = innerWidth>760 ? 0 : innerHeight*0.52; return Math.min((W-panelW-80)/(fitX1-fitX0),(H-panelH-110)/(fitY1-fitY0)); }
let tw=null; function tween(t){ const from={...cam}; const t0=performance.now(); cancelAnimationFrame(tw);
  const step=now=>{ const u=Math.min(1,(now-t0)/500), e=1-Math.pow(1-u,3); cam.k=from.k+(t.k-from.k)*e; cam.tx=from.tx+(t.tx-from.tx)*e; cam.ty=from.ty+(t.ty-from.ty)*e; draw(); if(u<1) tw=requestAnimationFrame(step); }; tw=requestAnimationFrame(step); }

// ---------- sprites ----------
const sprites=new Map(); // color -> {glow, core}
function makeSprite(color, r, glowR){
  const s=document.createElement('canvas'); const size=Math.ceil(glowR*2)*DPR; s.width=s.height=size; const c=s.getContext('2d');
  const cx=size/2; const g=c.createRadialGradient(cx,cx,0,cx,cx,glowR*DPR);
  g.addColorStop(0, color); g.addColorStop(0.25, hexA(color,.35)); g.addColorStop(1, hexA(color,0));
  c.fillStyle=g; c.fillRect(0,0,size,size);
  return s;
}
function hexA(hex,a){ const n=parseInt(hex.slice(1),16); return `rgba(${n>>16&255},${n>>8&255},${n&255},${a})`; }
function buildSprites(){ sprites.clear(); for (const c of [...HUES,OTHER,NONE,'#F4F0E6']) sprites.set(c,{glow:makeSprite(c,1,14), core:makeSprite(c,1,3)}); }

// ---------- label wrapping: split a long name at the space nearest its middle ----------
function wrapLabel(text, maxChars){
  if (text.length<=maxChars || !text.includes(' ')) return [text];
  const mid=text.length/2; let best=-1, bd=1e9;
  for (let i=text.indexOf(' '); i>=0; i=text.indexOf(' ',i+1)){ const d=Math.abs(i-mid); if(d<bd){bd=d;best=i;} }
  if (best<0) return [text];
  return [text.slice(0,best), text.slice(best+1)];
}

// ---------- density haze ----------
const hz=document.createElement('canvas'), hctx=hz.getContext('2d'); const HS=5; // haze is rendered at 1/5 resolution, then upscaled: cheap and already soft
function drawHaze(fade, focusKey){
  const w=Math.ceil(W/HS), h=Math.ceil(H/HS); if(hz.width!==w||hz.height!==h){ hz.width=w; hz.height=h; }
  hctx.setTransform(1,0,0,1,0,0); hctx.clearRect(0,0,w,h); hctx.globalCompositeOperation='source-over';
  const zoom=cam.k/baseK();
  const R=Math.max(3.5, Math.min(11, 4.5*Math.pow(zoom,0.55)));
  for (let i=0;i<N;i++){
    const k=S.keys[i]; if(k<0||!S.colorOf.has(k)||!S.visible[i]) continue;
    const X=sx(xs[i])/HS, Y=sy(ys[i])/HS; if(X<-R||X>w+R||Y<-R||Y>h+R) continue;
    let a=0.09; if(focusKey!=null) a*= inSelection(i,focusKey)?1:0.12;
    const sp=sprites.get(colorFor(i)); if(!sp) continue;
    hctx.globalAlpha=a*fade; hctx.drawImage(sp.glow, X-R, Y-R, R*2, R*2);
  }
  hctx.globalAlpha=1;
  const hazeA=0.62*Math.max(0.3, Math.min(1, 1-(zoom-1.4)/6)); // overview layer: fades as you zoom in
  ctx.save(); ctx.globalCompositeOperation='screen'; ctx.globalAlpha=hazeA; ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
  try{ ctx.filter='blur(5px)'; }catch(e){}
  ctx.drawImage(hz,0,0,W,H); ctx.filter='none'; ctx.restore();
}

// ---------- draw ----------
let drawQueued=false; function requestDraw(){ if(!drawQueued){ drawQueued=true; requestAnimationFrame(()=>{drawQueued=false; draw();}); } }
let born=performance.now();
function draw(){
  ctx.setTransform(DPR,0,0,DPR,0,0);
  // ground with a soft vignette
  ctx.fillStyle=GROUND; ctx.fillRect(0,0,W,H);
  const vg=ctx.createRadialGradient(W*0.6,H*0.45,H*0.05,W*0.6,H*0.45,Math.max(W,H)*0.85); vg.addColorStop(0,'rgba(30,44,80,.40)'); vg.addColorStop(0.5,'rgba(14,20,38,.22)'); vg.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);

  const zoom=cam.k/baseK();
  const fade = reduceMotion ? 1 : Math.min(1, 0.35 + 0.65*(performance.now()-born)/900);
  const focusKey = S.legendHover!=null ? S.legendHover : S.isolate;
  const filtering = S.q.trim() || S.y0>2010 || S.y1<2026;
  const hoverKey = S.hover>=0 ? S.keys[S.hover] : null;

  // 0. density haze: a soft nebula in each group's colour, drawn with normal compositing so it never burns to white
  if (S.haze && zoom<10) drawHaze(fade, focusKey);

  // 1. constellation lines
  if (S.lines && zoom<12){
    ctx.lineWidth=Math.max(0.5, 0.7*Math.sqrt(zoom)); ctx.globalCompositeOperation='lighter';
    const alphaBase = 0.2;
    let cur=null;
    for (const [a,b,col] of edges){
      if (!S.visible[a]||!S.visible[b]) continue;
      let alpha=alphaBase*Math.min(1, 1.9*Math.min(dimF[a],dimF[b]));
      if (focusKey!=null){ alpha = inSelection(a,focusKey)? 0.34*Math.min(1,1.9*Math.min(dimF[a],dimF[b])) : 0.03; }
      if (hoverKey!=null && hoverKey>=0 && S.keys[a]===hoverKey) alpha=Math.max(alpha,0.4);
      const x1=sx(xs[a]),y1=sy(ys[a]),x2=sx(xs[b]),y2=sy(ys[b]);
      if ((x1<-20&&x2<-20)||(x1>W+20&&x2>W+20)||(y1<-20&&y2<-20)||(y1>H+20&&y2>H+20)) continue;
      const st=hexA(col,alpha*fade); if(st!==cur){ if(cur) ctx.stroke(); ctx.beginPath(); ctx.strokeStyle=st; cur=st; }
      ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
    }
    if(cur) ctx.stroke();
    ctx.globalCompositeOperation='source-over';
  }

  // 2. stars: none/other first (dim), then coloured groups (bright, additive glow)
  const r = Math.min(5.2, 1.3*Math.pow(zoom,0.48));
  const glowR = r*3.0, coreR=r;
  const glowA = Math.min(0.5, 0.17 + 0.09*Math.log2(zoom+1));
  const dimAt = zoom<6 ? 1 : 0; // past 6x the stars are far apart; no density dimming needed
  let inView=0;
  // pass 0: glows, additive, dimmed by local density; pass 1: cores, normal compositing so colour survives in the dense core
  for (let pass=0; pass<2; pass++){
    ctx.globalCompositeOperation = pass===0 ? 'lighter' : 'source-over';
    for (let i=0;i<N;i++){
      const k=S.keys[i]; const colored = k>=0 && S.colorOf.has(k);
      const X=sx(xs[i]), Y=sy(ys[i]); if (X<-20||X>W+20||Y<-20||Y>H+20) continue;
      if (pass===0) inView++;
      const col=colorFor(i);
      let a = colored ? 0.95 : (k<0 ? 0.5 : 0.65);
      if (!S.visible[i]) a *= 0.08;
      else if (focusKey!=null) a *= inSelection(i,focusKey) ? 1 : 0.12;
      if (a<0.02) continue;
      const sp=sprites.get(col); if(!sp) continue;
      if (pass===0){
        const d = dimAt ? (0.35 + 0.65*dimF[i]) : 1;
        ctx.globalAlpha=a*fade*(colored?glowA:0.12)*d;
        ctx.drawImage(sp.glow, X-glowR, Y-glowR, glowR*2, glowR*2);
      } else {
        ctx.globalAlpha=a*fade*(colored?0.95:0.8);
        const cr = colored? coreR : coreR*0.75;
        ctx.drawImage(sp.core, X-cr, Y-cr, cr*2, cr*2);
      }
    }
  }
  ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';

  // 3. labels
  if (S.labels){
    ctx.textAlign='center'; ctx.textBaseline='middle';
    const placed=[];
    for (const L of labels){
      const isTop=L.rank<7;
      if (!isTop && zoom<2.2) continue;
      if (focusKey!=null && focusKey!==L.k && focusKey!=='other') { if(!(focusKey==='other' && !isTop)) continue; }
      const X=sx(L.x), Y=sy(L.y); if (X<40||X>W-40||Y<20||Y>H-20) continue;
      const size = isTop ? Math.min(24, 15 + 3*Math.log2(zoom+1) + Math.min(5, L.n/120)) : 13;
      ctx.font=`italic 600 ${size}px "Cormorant Garamond", Georgia, serif`;
      const lines = wrapLabel(L.name, isTop ? 26 : 22);
      const lh = size*1.02;
      const w=Math.max(...lines.map(t=>ctx.measureText(t).width)), h=lh*lines.length;
      if (placed.some(b=>Math.abs(b.x-X)<(b.w+w)/2+10 && Math.abs(b.y-Y)<(b.h+h)/2+6)) continue;
      placed.push({x:X,y:Y,w,h});
      ctx.lineWidth=Math.max(3,size/5); ctx.lineJoin='round'; ctx.strokeStyle=hexA(GROUND.length===7?GROUND:'#070B14',0.85);
      const fill = isTop? L.color : css.getPropertyValue('--ink-2').trim();
      lines.forEach((t,li)=>{ const y=Y+(li-(lines.length-1)/2)*lh; ctx.globalAlpha=1; ctx.strokeText(t,X,y); ctx.fillStyle=fill; ctx.globalAlpha=isTop?0.95:0.8; ctx.fillText(t,X,y); });
      ctx.globalAlpha=1;
    }
  }

  // 4. hover ring
  if (S.hover>=0){ const X=sx(xs[S.hover]),Y=sy(ys[S.hover]); ctx.beginPath(); ctx.arc(X,Y,r+5,0,Math.PI*2); ctx.strokeStyle='rgba(244,240,230,.9)'; ctx.lineWidth=1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(X,Y,r+1.5,0,Math.PI*2); ctx.fillStyle='#F4F0E6'; ctx.fill(); }

  document.getElementById('stats').innerHTML = `<b>${N.toLocaleString()}</b> stars · <b>${inView.toLocaleString()}</b> in view<br>${Math.round(zoom*100)/100}× · 2010–2026`;
  if (!reduceMotion && fade<1) requestDraw();
}

// ---------- picking ----------
function pick(px,py){ const R=9; let best=-1,bd=R*R;
  for (let i=0;i<N;i++){ if(!S.visible[i]) continue; const dx=sx(xs[i])-px, dy=sy(ys[i])-py; const d=dx*dx+dy*dy; if(d<bd){bd=d;best=i;} }
  return best; }
const tip=document.getElementById('tip');
function showTip(i,px,py){
  const p=P[i]; const k=S.keys[i]; const col=colorFor(i);
  let path='';
  if (p[F.mondo]>=0){ const L=lineage[p[F.mondo]].slice(2); const tier=p[F.tier];
    path = `<div class="path">${L.map((n,j)=>`<span>${esc(nodes[n].name)}</span>`).join('<i>›</i>')}</div>` +
      (tier>0 ? `<div class="m" style="margin-top:3px;color:var(--ink-3)">${tier===4?'Not a MONDO term — grouped by study context':'Loosely placed via '+esc(DATA.tiers[tier])}</div>` : ''); }
  else path = `<div class="path" style="color:var(--ink-3)">No disease term in MeSH headings</div>`;
  const gname = k>=0 ? (S.groups.find(g=>g.k===k)||{}).name : null;
  const extra = p[F.extra]&&p[F.extra].length ? `<div class="m" style="margin-top:4px;color:var(--ink-3)">also: ${p[F.extra].map(n=>esc(nodes[n].name)).join(', ')}</div>`:'';
  tip.innerHTML = `<div class="t">${esc(p[F.title])}</div><div class="m"><b>${esc(DATA.journals[p[F.journal]])}</b> · ${p[F.year]} · ${esc(DATA.sites[p[F.site]])}</div>${path}${extra}
    ${gname?`<div class="row"><span class="dot" style="background:${col};color:${col}"></span>${esc(gname)}</div>`:''}
    <div class="cta">PMID ${esc(p[F.pmid])} · click to open on PubMed</div>`;
  const w=tip.offsetWidth||320, h=tip.offsetHeight||160;
  let x=px+18, y=py+18; if (x+w>W-12) x=px-w-18; if (y+h>H-12) y=py-h-18;
  tip.style.left=x+'px'; tip.style.top=y+'px'; tip.classList.add('show');
}
function hideTip(){ tip.classList.remove('show'); }

// ---------- pointer interaction ----------
let drag=null, moved=false; const pointers=new Map();
cv.addEventListener('pointerdown',e=>{ cv.setPointerCapture(e.pointerId); pointers.set(e.pointerId,{x:e.clientX,y:e.clientY}); if(pointers.size===1){ drag={x:e.clientX,y:e.clientY,tx:cam.tx,ty:cam.ty}; moved=false; } cv.classList.add('dragging'); hideTip(); });
cv.addEventListener('pointermove',e=>{
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if (pointers.size===2){ // pinch
    const [a,b]=[...pointers.values()]; const d=Math.hypot(a.x-b.x,a.y-b.y); const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    if (drag && drag.pd){ zoomAt(mx,my,d/drag.pd); } drag={x:mx,y:my,tx:cam.tx,ty:cam.ty,pd:d}; moved=true; return; }
  if (drag){ const dx=e.clientX-drag.x, dy=e.clientY-drag.y; if (Math.abs(dx)+Math.abs(dy)>3) moved=true; cam.tx=drag.tx+dx; cam.ty=drag.ty+dy; requestDraw(); return; }
  const i=pick(e.clientX,e.clientY);
  if (i!==S.hover){ S.hover=i; requestDraw(); cv.classList.toggle('pointing',i>=0); }
  if (i>=0) showTip(i,e.clientX,e.clientY); else hideTip();
});
function endPointer(e){ pointers.delete(e.pointerId); if(pointers.size<2 && drag) drag.pd=null; if(pointers.size===0){ 
  if (drag && !moved && e.type==='pointerup'){ const i=pick(e.clientX,e.clientY); if(i>=0) window.open('https://pubmed.ncbi.nlm.nih.gov/'+P[i][F.pmid]+'/','_blank','noopener'); }
  drag=null; cv.classList.remove('dragging'); } }
cv.addEventListener('pointerup',endPointer); cv.addEventListener('pointercancel',endPointer);
cv.addEventListener('pointerleave',()=>{ if(!drag){ S.hover=-1; hideTip(); requestDraw(); } });
cv.addEventListener('wheel',e=>{ e.preventDefault(); const f=Math.exp(-e.deltaY*(e.deltaMode===1?0.05:0.0015)); zoomAt(e.clientX,e.clientY,f); if(S.hover>=0){S.hover=-1;hideTip();} },{passive:false});
cv.addEventListener('dblclick',e=>{ zoomAt(e.clientX,e.clientY,1.8); });
document.getElementById('zin').onclick=()=>zoomAt(W/2,H/2,1.5);
document.getElementById('zout').onclick=()=>zoomAt(W/2,H/2,1/1.5);
document.getElementById('zreset').onclick=()=>fit(true);
addEventListener('keydown',e=>{ if (e.target.matches('input')) return; if(e.key==='0') fit(true); if(e.key==='+'||e.key==='=') zoomAt(W/2,H/2,1.5); if(e.key==='-') zoomAt(W/2,H/2,1/1.5); });

// ---------- controls ----------
document.getElementById('modes').addEventListener('click',e=>{ const b=e.target.closest('button'); if(!b) return;
  for (const x of e.currentTarget.children) x.setAttribute('aria-pressed', x===b);
  S.mode=b.dataset.mode; S.isolate=null; document.getElementById('depthBox').hidden = S.mode!=='mondo'; document.getElementById('looseRow').hidden = S.mode!=='mondo'; computeGroups(); updateCrumb(); });
const depth=document.getElementById('depth');
depth.addEventListener('input',()=>{ S.level=+depth.value; computeGroups(); updateCrumb(); });
function updateCrumb(){ const c=document.getElementById('crumb'); if (S.mode!=='mondo'){ c.innerHTML=''; return; }
  const lvl=S.level; // show the path of the largest group as orientation
  const g=S.groups[0]; if(!g){c.innerHTML='';return;}
  let m=-1; for(let i=0;i<N;i++){ if(S.keys[i]===g.k){ m=P[i][F.mondo]; break; } }
  const path=lineage[m].slice(2, lvl+1);
  c.innerHTML = 'e.g. ' + path.map((n,j)=>`<span${j<path.length-1?' style="color:var(--ink-3)"':''}>${esc(nodes[n].name)}</span>`).join('<i>›</i>');
}
const q=document.getElementById('q'); q.addEventListener('input',()=>{ S.q=q.value; applyFilters(); });
const y0=document.getElementById('y0'), y1=document.getElementById('y1');
function years(){ let a=+y0.value,b=+y1.value; if(a>b){ [a,b]=[b,a]; } S.y0=a; S.y1=b; document.getElementById('yearRead').textContent=`${a} – ${b}`;
  const lo=(a-2010)/16*100, hi=(b-2010)/16*100; const f=document.getElementById('yearFill'); f.style.left=lo+'%'; f.style.width=(hi-lo)+'%'; applyFilters(); }
y0.addEventListener('input',years); y1.addEventListener('input',years);
document.getElementById('haze').addEventListener('change',e=>{ S.haze=e.target.checked; requestDraw(); });
document.getElementById('lines').addEventListener('change',e=>{ S.lines=e.target.checked; requestDraw(); });
document.getElementById('labels').addEventListener('change',e=>{ S.labels=e.target.checked; requestDraw(); });
document.getElementById('loose').addEventListener('change',e=>{ S.loose=e.target.checked; S.isolate=null; computeGroups(); updateCrumb(); });

// ---------- boot ----------
addEventListener('resize',()=>{ resize(); fit(false); });
resize(); fit(false); years(); computeGroups(); updateCrumb();
document.fonts && document.fonts.ready.then(()=>requestDraw());
})();
